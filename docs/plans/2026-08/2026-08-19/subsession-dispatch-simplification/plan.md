# 子会话调度简化重构 实施计划

**目标**：删除 delegation-state.json 持久层，状态精简为 running/stopped，交付事实与状态机分离（修复「未交付卡死」bug），重试改连续计数，ListGroupFiles 支持按需读，子会话图标换 Network。

**架构思路**：运行时调度状态只在内存，重启恢复完全走 conversation 层补集（截断 10 条）。对外状态收敛为进程视角（running/stopped），死因/错误分类降级为内部字段供重试决策用，交付是独立单调事实（delivered 布尔，任何状态可置 true）。排除的选项：conversation 层加 deliveredAt 持久字段（用户拍板砍掉——delivery 消息本身在主会话消息历史里天然持久，字段是冗余副本）。

**涉及模块**：`electron/main/agents/delegation-bridge.ts`、`delegation-persist.ts`（删）、`delegation-lifecycle.ts`、`delegation-resume.ts`、`delegation-terminal.ts`、`tools/delegation-tools.ts`、`tools/group-tools.ts`、`electron/main/types.ts`、`types/electron-api.ts`、`electron/main/index.ts:483`、`components/conversation-list/ConversationRow.tsx`、`components/agent-chat/AgentChat.tsx:37`、`session-append-templates.ts`

**设计文档**：[../subsession-dispatch-simplification-design.md](../subsession-dispatch-simplification-design.md)

## 步骤索引

- [x] [Step 1: 状态模型精简与重试语义](./step1-state-model.md) — ChildStatus 收敛 running/stopped、delivered 独立事实、consecutiveFails 连续计数、修复交付 guard bug
- [x] [Step 2: 持久层删除](./step2-remove-persistence.md) — delegation-persist.ts 删除、启动清理旧文件、补集截断
- [x] [Step 3: 工具层与提示词](./step3-tools-prompts.md) — ListLinkedSessions 判定规则、ListGroupFiles relPath、契约提示词对齐
- [x] [Step 4: UI 与收尾](./step4-ui-cleanup.md) — Network 图标、删状态文字徽章、codebase-map 同步、全量验证

## 全局决策

- **类型约定**：`ChildStatus = 'running' | 'stopped'`（对外唯一状态集）。`ChildStateInternal` 增加 `terminalReason?: 'failed' | 'hang' | 'timeout' | 'cancelled' | 'no_delivery'`（stopped 时记录死因，仅供调度内部重试决策）；`delivered: boolean`；`retryCount` 改名 `consecutiveFails`。快照（`ChildStateSnapshot`）移除 `summary / errorClass / modelTried / retryCount`，新增 `delivered`，`errorMessage` 改名 `lastError`
- **交付语义**：`markChildDelivered` 只置 `delivered = true` + broadcast + releaseOutputPath，**不改 status、不 clear timers**（complete 事件才是安全收尾点，见 delegation-bridge.ts:249 注释）；guard 只挡 `delivered` 已 true 的重复调用，不挡状态——这是修复卡死 bug 的核心
- **重试语义**：`consecutiveFails` 在 complete 正常到达（subtype=success）时清零；失败复活 +1；上限 3（`getDelegationMaxRetry` 默认值改 3）；quota 仍走 failover 链 + `modelTried` 防重（internal 字段保留）；人工 ResumeSession 不查计数
- **no_delivery 降级为通知事件**：complete success 到达且 `!delivered` → 终态通知主会话，状态就是 stopped（terminalReason='no_delivery'）
- **补集**：`conversationToSnapshot` 产出 status 恒 stopped、delivered 恒 false、lastError 恒 undefined；按 `updatedAt` 降序截断 10 条
- **工具守纪**：isError / 空返回只陈述事实不引导改用其他工具；新参数描述限定场景（防 8-18 前缀改革的死循环复发）
- **分步纪律**：Step 1 不碰 persist 相关代码（touchPersist 保留调用），Step 2 统一删——每步独立可编译可测试

## 完成总结

- **实际改动汇总**：① Step 1 状态模型精简——`ChildStatus` 收敛 running/stopped，死因降为内部 `terminalReason`，`delivered` 成为独立单调事实（修复 no_delivery 终态后补交付被 guard 挡掉的卡死 bug），`retryCount` → `consecutiveFails`（success 清零，上限 3），前端 ConversationRow/AgentChat 最小适配；② Step 2 持久层删除——delegation-persist.ts 删除，启动 `cleanupLegacyStateFile` 一次性清理旧 delegation-state.json，重启恢复走 conversation 补集（updatedAt 降序截 10 条，转 stopped/delivered=false 快照）；③ Step 3 工具与提示词——ListLinkedSessions 写明交付判定规则（running 等通知 / stopped+交付勿动 / stopped+无交付可调起，delivered 为运行时视角）+ 渲染加交付标记，ListGroupFiles 默认列清单 + relPath 读单文件，契约/组卡提示词对齐（含 group-digest-prompt 旧特征哨兵重播种）；④ Step 4 UI 收尾——ConversationRow 子会话图标换 Network（isAgentConversation 提前到 isFork 前，手动分叉保留 GitBranch 紫），删状态文字徽章与 CircleAlert 死分支，codebase-map.md 同步
- **与原计划的偏差**：无实质偏差。AgentChat 状态文案 map 核对后确认 Step 1 已对齐，未改（计划内预期路径）；Step 4 顺带删除不可达的 CircleAlert 分支与相应 import（新模型下 childSnapshot 状态只剩两态，该分支必死）；dev 走查项（子会话 Network 图标 / 无徽章 / 补交付绿勾 / 重启补集 ResumeSession / 旧状态文件启动清理）需 GUI，留主会话/用户执行，见共享区 step4-delivery.md
- **已知遗留（均非本计划产物）**：codebase-map.md:172 types/delegation.ts 条目仍写 ChildSessionState（计划前已过期）；docs/standards/tool-description-guide.md 里 ListGroupFiles 示例描述过时（Step 3 已记录）；package.json 0.1.40→0.1.41 为其他流程改动
