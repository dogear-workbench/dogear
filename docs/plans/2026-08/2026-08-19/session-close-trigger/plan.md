# on_session_close 触发链路重构 实施计划

**目标**：把 `on_session_close` 触发点从「独立窗口 closed 事件」下沉到 PiSessionManager 会话自然销毁点，统一覆盖主窗口关 tab / 独立窗口 / orphan 跑完回收，排除强杀、退出与 failover 换血，并让 group_digest 内置任务按触发会话精准提炼。

**架构思路**：所有关闭路径汇聚到 `_destroySession`，加 `source` 区分自然销毁/强杀，自然销毁后 fire-and-forget 通知调度器；调度器解析工作区、过滤任务并把 `triggerContext.conversationId` 透传到 executor，group_digest 有 context 时走 `triggerByConversation`（带脏判定）单组入队。设计详见 [session-close-trigger-design.md](../session-close-trigger-design.md)，执行以本文件 + 各 step 为准（含下述复核修订）。

**涉及模块**：`electron/main/services/memory/group-digest-trigger.ts`、`electron/main/services/scheduler/scheduler-service.ts`、`runtime/plan-runner.ts`、`runtime/task-executor.ts`、`electron/main/agents/pi-session/pi-session-manager.ts`、`electron/main/services/conversation-runtime-service.ts`、`electron/main/agents/model-failover.ts`、`electron/main/index.ts`

## 复核修订（基于 HEAD 5917f26 冲突核查，报告见会话组共享区 session-close-design-conflict-check.md）

设计书（5d4f878，2026-08-19）写作后代码迭代多版，逐条核查结论：核心锚点文件（pi-session-manager / conversation-runtime-service / plan-runner / index.ts / types）零改动，无架构级冲突。修订如下：

1. **四步并为三步**：`runOne` 出队时已自带 `findDirtyGroup` 脏判定（`group-digest-scanner.ts:208`，设计时点已存在），原独立 step「补脏判定」想防的白跑已有兜底；前置脏判定降级为「不脏时留日志」，并入 step1。
2. **triggerContext 并入 hooks**：`executeTask` 已有第二参数 `hooks?: TaskExecuteHooks`（`task-executor.ts:59`），不是从零加参。
3. **精准分支 summary 不引用数字**：`lastScan.dirtyCount` 只反映全量扫描，精准路径不更新 lastScan，summary 文案改定性描述。
4. **failover 排除（已拍板：透传 source）**：`model-failover.ts:102` quota 换血走 `detachByConversationHolder → release → _destroySession`，与用户关 tab 形态相同（turn 已 failed、session 非 running、refCount 归零）；在 detach 链路透传 `source='forced'` 使其不触发调度器。
5. **事实修正**：`closeAll` 不走 `_destroySession`（直接 clear Maps），退出路径天然不触发，quitting 拦截只需覆盖窗口关闭触发的 release 路径；设计书「pi-session-manager 不是 EventEmitter」为笔误（不影响方案选择）。
6. **新增语义知悉**：failStreaks（连续 3 次 no-card/error 暂停该组自动提炼）对精准触发同样生效，行为合理，不做调整。

## 步骤索引

- [x] [Step 1: 调度器重构 + triggerContext 贯通 + 精准提炼入口](./step1-scheduler-context.md) — handleSessionClose 新签名/退出标志/工作区过滤，triggerContext 并入 hooks，triggerByConversation 补脏判定，group_digest 精准分支
- [ ] [Step 2: 触发点下沉 pi-session-manager + failover 排除](./step2-manager-hook.md) — _destroySession 加 source，自然销毁后通知调度器，detach 链路透传 source 排除 failover 换血
- [ ] [Step 3: 清理旧触发点 + 端到端验证](./step3-cleanup-verify.md) — 删 index.ts 旧调用，行为矩阵（含 failover / failStreaks 边界）逐项验证，doc-sync

## 全局决策

- **签名微调**：`handleSessionClose(conversationId: string)`（workspaceId 由调度器内部经 conversation-service 解析，与设计文档的 `(workspaceId, conversationId)` 不同）——让 agents/pi-session 层只依赖调度器单入口，不为解析 workspaceId 多 import 一个服务
- `source` 枚举：`'natural' | 'forced'`；`release`（默认）/ `maybeCollectOrphan` → natural，`closeSession` → forced；`release` / `detachAttachment` / `detachByConversationHolder` 加可选 source 参数（默认 natural），failover 调用处传 forced；`closeAll` 不走 `_destroySession`，退出路径天然不触发
- 触发链路全部 fire-and-forget：动态 import + `.catch()`，任何失败只 warn/log，不阻塞销毁、不外抛
- `triggerContext` 类型：`{ conversationId: string }`，并入 `TaskExecuteHooks` 透传，仅 group_digest 消费，其余任务类型忽略；不进前端类型
- 前端零改动（`types/scheduler.ts` 不动）
- 主进程代码改动后需 `bun run build:electron` 重新编译才能验证
