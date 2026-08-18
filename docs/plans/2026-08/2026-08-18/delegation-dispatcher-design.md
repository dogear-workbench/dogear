# 子会话调度站（Delegation Dispatcher）设计

## 背景

多 agent 协作链路在高频使用中暴露两类问题：

1. **子会话死亡，主会话干等**：供应商不稳定导致子会话中断。根因一：`delegation-bridge.ts` 的 `onSessionComplete` 在子会话终态时只更新 `childStates` + 广播 UI，不 resolve 主会话挂起的 `WaitForMessage`——主进程明知子会话已死，主会话仍要干等满 30 分钟超时，且拿到的信息只有「超时」，不含死因。根因二：供应商 hang 住（流不结束也不报错）时无任何事件，只能等满总超时。
2. **重启后派遣关系失忆**：conversation 持久层其实写入了 `parentConversationId` + `contractMetadata`（parentSessionId/task/outputPath），但 `ListLinkedSessions` 只读内存 `childStates`，`SendMessage` 对未 attach 的会话返回 `target_inactive`，且没有「调起已有子会话」的工具——主会话在重启后完全无法继续之前的工作。

另有一个已知的 UI 绑定 bug（子会话只显示标题和首条消息、任务实际完成但界面像新会话），已于 2026-08-18 排查修复：根因是 conversation-service 的「无锁读-改-写」被并发写者（applyUsageSummary fire-and-forget）用旧快照覆盖 updateSessionId 的写回；修复为 withConversationsTxn 事务串行化。调度站的状态落盘沿用同一套锁纪律。

## 目标

用代码层（主进程）构建可靠的调度底座，不依赖任何 LLM 存活：

- 子会话死亡 → 等待中的主会话**秒级**收到结构化通知（谁、死因、已重试几次）
- 子会话死亡 → 按错误分类**自动复活重调**（复活原会话续跑，不新建副本）
- 费率/限流类失败 → 沿 profile 链自动降级到**异供应商**模型
- 重试/降级链耗尽 → 通知主会话，由 LLM 做更高层决策（换 profile、改方案、放弃）
- 应用重启 → 派遣关系不失忆，主会话可通过工具调起之前的子会话继续

LLM 层的智能调度（主会话根据结构化通知做复杂决策）是后续叠加项，本次只保证通知信息足够结构化。

## 架构

**定位**：主进程 `delegation-bridge` 从「一次性派遣运行时」升级为「持久调度站」。不引入新进程/Worker/轮询——所有检测都是事件驱动（PiSession 事件 + setTimeout），与现有 `timeoutTimer` 同一套机制。

**检测与重调的核心循环**：

```
PiSession 事件流
  ├─ 'complete'(failed/cancelled) ──→ 终态联动：resolve 父会话的 messageWaiters（结构化通知）
  │                                      └─ 错误分类 → 自动重调决策
  ├─ 'message'（任何流事件）──→ 重置该子会话的 idleTimer（滑动计时）
  │        └─ idleTimer 到期（无活动 N 分钟）──→ 判定 hang → stopChild → 走重调
  └─ 总超时 timeoutTimer（保留，兜底「跑太久」场景）
```

**错误分类与重调矩阵**：

| 错误类型 | 判定 | 动作 |
|---|---|---|
| transient（500/网络/sendMessage 失败/hang） | `error.kind ∈ {model, runtime}` 且消息不匹配费率关键词；或 idle 超时 | 原模型复活重试，上限 N 次（默认 2） |
| quota（429/rate limit/quota/余额/限流 关键词匹配） | 错误消息关键词分类表 | 沿 profile 链找第一个**异供应商**模型复活；链上无可用异供应商 → 直接通知主会话 |
| cancelled（用户手动停止） | 用户意图优先 | 不重调 |

**复活机制（Resume）——统一入口**：`resumeChild(childId, opts)`，自动重调与主会话工具共用：

1. 会话已存在（conversation 持久层），不新建
2. `releaseOutputPath` 后重新 claim（同 childId 允许 force reclaim，绕过「部分交付文件已存在」的 file_exists）
3. `attachConversation` 重新拉起（降级场景通过模型覆盖注入异供应商模型——注入点实现时确认）
4. `wireSession` + 重挂 idleTimer
5. `sendMessage(继续提示)`：固定模板「你刚才因{原因}中断，请检查已完成的部分和共享区产出，继续完成任务」
6. 重试计数 +1，落盘

主会话工具新增 `dogear__ResumeSession(sessionId)`：校验契约通道（`contractMetadata.parentSessionId === 自己`）后调 `resumeChild`——重启后主会话说「继续」时，调起之前的子会话接着干。

**排除的选项及原因**：

- **LLM 主会话当调度员**（轮询把控）：调度员自身会被供应商打死；轮询烧 token；反应延迟。仅保留其「决策层」角色（收通知后决策）。
- **独立进程/Worker 常驻巡检**：所有 PiSession 活在主进程内，生命周期不分离，独立守护进程无意义；主进程死亡 = 应用退出，属另一层故障。
- **重启后自动续跑子会话**：重启时主会话自身也断了，续跑成功也无人接收交付；复杂度高收益低。改为标记 `interrupted` + 主会话工具手动调起。
- **重调 = 新建会话重跑**：重跑已完成部分浪费 token；会话列表堆积 retry 副本；有「改了一半代码又从头改」的重复副作用风险。复活原会话（上下文在磁盘）天然规避三者。

## 模块边界

| 文件 | 改动 |
|---|---|
| `electron/main/agents/delegation-bridge.ts` | 核心：终态联动（onSessionComplete resolve waiters）、idleTimer、错误分类、resumeChild、状态落盘/加载、重启 interrupted 标记 |
| `electron/main/agents/tools/delegation-tools.ts` | 新增 `dogear__ResumeSession`；`ListLinkedSessions` 改为「持久层为基础 + 内存实时状态覆盖」合并数据源；`WaitForMessage` 返回结构扩展 terminal 信息 |
| `electron/main/agents/pi-session/pi-session.ts` | 确认/补充流式 activity 事件（若流式 delta 不走 'message'，需加流级打点） |
| `electron/main/services/conversation-runtime-service.ts` | attachConversation 的模型覆盖注入点（降级重调用） |
| `electron/main/types.ts` | `ChildStateSnapshot` 扩展（retryCount、errorClass、lastActivityAt、resumedFrom） |
| `electron/main/services/settings-types.ts` | profile 链语义文档化（顺序即降级链）；新增 profile 追加链尾（现有行为确认） |
| 存储 `.dogear/` | 新增 delegation 状态持久化文件 |

不改动：`pi-session-manager.ts`、契约通道校验（`contract-channel-service.ts`）、共享区服务（仅 bridge 内部调用方式微调）。

## 数据流

**常态派遣**：CreateSession → startChild（不变）→ 运行中 message 事件持续重置 idleTimer → 交付（SendMessage delivery → markChildDelivered）→ complete → 释放资源。

**失败自动重调**：complete(failed) → classifyError → [transient 且 retryCount < N] 或 [quota 且降级链有异供应商] → resumeChild（重试计数 +1，落盘）→ 子会话复活续跑 → 若再失败回到本步 → 耗尽 → 终态落盘 + 结构化通知投递给父会话（waiter 挂起中则直接 resolve；否则 deliverMessage queued 路径推进父会话下一轮）。

**hang 检测**：运行中 N 分钟无 message 事件 → idleTimer 触发 → stopChild('hang') → 按 transient 走重调。

**重启恢复**：启动加载持久化文件 → 所有 `running` 改标 `interrupted`（附中断时间）→ 父会话打开后 ListLinkedSessions 能看到（持久层合并）→ 用户/LLM 决定 ResumeSession 或重新 CreateSession。

**结构化通知格式**（WaitForMessage 结果扩展）：

```
terminal: { status: 'failed'|'hang'|'timeout'|'interrupted'|'no_delivery',
            errorMessage, errorClass, attempts, modelTried[] }
```

通知文案含行动建议：quota 类附「疑似费率上限，已尝试降级至 {model} 失败/无可用异供应商，建议更换供应商 profile 重派」。

## 错误处理 / 边界情况

- **复活时 outputPath 文件已存在**（部分产出）：claim 走 force reclaim（holder 是自己）
- **interrupt() 对 hang 会话不响应**：卡在 await 流中时靠 adapter.abort() 断流——实现时验证，必要时接受「旧 session 成为孤儿、新 attach 覆盖」
- **流式 delta 不 emit 'message'**：长输出单条消息期间无事件 → idle 误判。实现前先确认事件粒度，不足则在 PiSession 加流级 activity 事件；idle 阈值默认 10 分钟（兼顾长工具执行）
- **用户 StopSession**：cancelled 不自动重调；ResumeSession 手动调起仍允许
- **重试计数持久化**：重启不重置，防无限重试
- **done 但无交付消息（no_delivery）**：也走终态联动通知主会话（提示检查 outputPath 是否有产出）
- **同一子会话并发复活**：resumeChild 前置检查 status !== 'running'，幂等保护
- **总超时与 idle 共存**：idle 管「卡死」（分钟级），总超时管「跑太久」（默认 30 分钟，任务死循环场景），互不替代
- **主会话与子会话同供应商**：quota 场景下主会话自身可能也撞墙——这正是降级做在代码层的原因；通知投递（queued 路径）不依赖主会话当轮存活

## 未决问题

- 模型覆盖注入点：attachConversation 参数还是 conversation 更新，实施时看 conversation-runtime-service 现有签名
- 供应商判定字段：modelSelection 中 provider 的取值路径（实施时确认）
- idle 阈值、重试上限 N、费率关键词表：先给默认值（10min / 2 次 / 常见英文+中文关键词），是否暴露到设置页看后续需求
- 结构化通知投递时若父会话 attachment 已释放（用户关了主会话窗口）：queued 路径需要父会话活着，死了则只落盘，等父会话下次打开时通过 ListLinkedSessions 补看——是否需要「打开时自动推送积压通知」暂不做，列入后续
