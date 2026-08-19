# 子会话调度简化重构设计

**日期**：2026-08-19
**状态**：设计已与用户逐块拍板

## 背景

8-18 调度站改造引入了 delegation-state.json 持久层，事后复盘增量价值撑不起复杂度：

- 相比 conversation 层补集路径，持久层的真实增量只有三个：retryCount 防无限重试（重启打断重试+人工调起+再失败的三层叠加，概率极低）、区分 completed vs interrupted（常态出现但只影响显示）、errorMessage 复活提示（低概率且信息价值低）
- 终态条目永不清理，全局单文件形态怪异
- **已发现真 bug**：`markChildDelivered` 的 `status !== 'running'` guard 把「曾经 no_delivery、后来真交付」的状态更新挡掉——交付事实被丢弃，UI 永远显示未交付
- 根因是结构性的：交付判定塞进了调度状态机（`no_delivery` 这个状态本身就是「调度没看到交付」，不是业务事实）
- UI 问题：子会话图标与手动分叉混用（`isFork = !!parentConversationId` 命中所有子会话，Workflow 分支永远不执行）；状态文字标签（「正在运行」「未交付」）冗余

## 目标

1. 删除 delegation-state.json 持久层，运行时状态只在内存
2. 自动重试改**连续计数**语义：同一中断周期内 3 次，重连成功即清零
3. 交付与状态机分离：交付是独立单调事实，任何状态到达都能落上
4. ListLinkedSessions 简化：内存运行时 + conversation 补集（截断）
5. ListGroupFiles 支持按 relPath 读单个文件
6. UI：子会话图标换 Network、去掉状态文字标签

## 架构

### 状态模型精简

调度状态（内存 childStates）只保留进程视角：

| 状态 | 含义 |
|---|---|
| `running` | 本进程在跑 |
| `stopped` | 不在跑（failed/hang/timeout/cancelled/no_delivery 全部收敛于此；死因放 `lastError` 文本字段，运行时可见，重启即失） |

交付事实独立：`delivered: boolean`（内存）。delivery 消息到达（`markChildDelivered`）即置 true，**guard 只挡重复标记，不挡状态**——修复未交付卡死 bug 的核心。

`no_delivery` 从状态降级为**通知事件**：complete 正常到达且 `delivered === false` → 通知 waiter，状态就是 stopped。代码不判断「说完没交付」是真完成还是半途停，这是主会话的活。

### 自动重试（连续计数）

- 计数器改名 `consecutiveFails`，语义：连续失败次数
- 触发自动 resumeChild：failed(transient) / hang / timeout
- **清零时机：complete 正常到达（本轮跑完）**
- 上限 3 次（`getDelegationMaxRetry` 改默认值 3）
- quota 分类仍走全局 failover 链（`modelTried` 防重复用同一降级模型，运行时内存）
- cancelled 不重试
- 人工 ResumeSession 不受计数约束（现状保留）

### 交付判定（agent 视角）

不持久化任何交付标记，靠两个天然锚点：

- **delivery 消息**：落在主会话消息历史（conversation 层天然持久化，重启恢复后主会话记得）
- **共享区文件**：outputPath 文件存在性，可查

ListLinkedSessions 工具描述写明判定规则：

- `running` → 等通知，不用管
- `stopped` + 你上下文中收到过 delivery / 共享区文件已存在 → 完成，别动
- `stopped` + 无交付 → 可 ResumeSession 调起，子会话自检进度续跑（有半截产出它会自己发现）

### 持久层删除

- `delegation-persist.ts` 整文件删除
- `delegation-bridge.ts`：`touchPersist` / `persistChildStates` / `loadChildStates` 全删；启动时检测到旧 delegation-state.json 静默删除（一次性清理）
- `getChildrenByParent`：内存 childStates + `conversationService.listByParent` 补集合并（保留），补集按 `updatedAt` 降序截断最近 **10** 条；`conversationToSnapshot` 的 status 恒 `stopped`、delivered 恒 false
- 回归测试 `delegation-persist.test.ts` 删除，`delegation-regression.test.ts` 相应改造

### ListGroupFiles 增强

- 新增可选 `relPath` 参数：传入则只读该文件内容
- **默认行为变更**：不传 relPath 时只列文件名 + 大小 + mtime，不再返回全部内容（消除 token 爆炸）
- 工具描述引导：先列清单，再按需读
- 提示词契约（session-append-templates.ts）里引导子会话「查看共享区产出」的措辞同步检查——从「一次拿全」改为「列表 + 按需读」

### 工具守纪（防历史死循环复发）

新增/改造的工具守住 8-18 tool-prefix 改革的两条纪律：

- `dogear__` 前缀写死在 defineTool 名字本体
- isError / 空数据返回只陈述事实，不引导改用其他工具；描述限定场景（「仅用于共享区文件」）

## 模块边界

| 文件 | 改动 |
|---|---|
| `electron/main/agents/delegation-persist.ts` | 删除 |
| `electron/main/agents/delegation-bridge.ts` | 持久化调用点全删；`markChildDelivered` 改 guard（任何状态可标记 delivered，幂等挡重复）；状态精简 running/stopped；`consecutiveFails` 清零逻辑；`getChildrenByParent` 补集截断 |
| `electron/main/agents/delegation-resume.ts` | `decideResumeOnError` 改连续计数语义 |
| `electron/main/agents/delegation-terminal.ts` | max retry 默认 3 |
| `electron/main/agents/tools/delegation-tools.ts` | ListLinkedSessions 返回结构（status 精简 + delivered）与描述判定规则；ResumeSession 拦截条件对齐 stopped |
| `electron/main/agents/tools/group-tools.ts` | ListGroupFiles 加 relPath、默认轻量化 |
| `electron/main/agents/session-append-templates.ts` | 协作规范提示词对齐（交付判定规则、共享区按需读） |
| `components/conversation-list/ConversationRow.tsx` | 子会话（`contractMetadata.createdBy === 'agent'`）优先于 isFork 显示 Network；删状态文字标签 |
| `electron/main/types.ts` | ChildStatus 精简 |
| `docs/codebase-map.md` | 同步 |

## 数据流

重启后：主会话醒来 → `ListLinkedSessions`（内存空 + 补集最近 10 条 stopped/delivered=false）→ 凭上下文记忆 + 共享区文件判定 → 需要续跑的 `ResumeSession` → `resumeChild`（内存 status → running，consecutiveFails 保留）。

运行时：子会话挂 → `settleTerminal` → 可重试则静默 `resumeChild`（consecutiveFails +1），连续 3 次耗尽或不可重试分类 → 通知 waiter；complete 正常到达 → consecutiveFails 清零。

## 错误处理 / 边界情况

- settling 锁、resumeChild 的 running guard 保留（防双路并发，已在运行的行为 no-op）
- 旧 delegation-state.json 启动静默删除
- 前端 `deliveriesAwaitChanged` 广播、ConversationRow 状态图标逻辑对齐新状态集：delivered → CircleCheck；stopped 未交付 → Ban 或中性图标；running → StatusPulse
- 重启后补集条目 delivered 恒 false——主会话工具描述已声明以上下文/文件为准，不产生误判闭环
- `modelTried` 重启即失：重启后 quota 再挂会从头走 failover 链，可能重试已试过的模型——可接受（多试一次的代价）

## 未决问题

- 补集截断条数 N=10 是否合适，实施后观察
- ListGroupFiles 默认轻量化的行为变更对存量提示词的影响面，实施时 grep 全部引用点确认
- Network 与现有图标的视觉大小平衡，实施时肉眼验收
