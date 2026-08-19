# on_session_close 触发链路重构 实施计划

**目标**：把 `on_session_close` 触发点从「独立窗口 closed 事件」下沉到 PiSessionManager 会话自然销毁点，统一覆盖主窗口关 tab / 独立窗口 / orphan 跑完回收，排除强杀与退出，并让 group_digest 内置任务按触发会话精准提炼。

**架构思路**：所有关闭路径汇聚到 `_destroySession`，加 `source` 区分自然销毁/强杀，自然销毁后 fire-and-forget 通知调度器；调度器按工作区过滤任务并把 `triggerContext.conversationId` 透传到 executor，group_digest 有 context 时走 `triggerByConversation`（补脏判定后）单组入队。设计详见 [session-close-trigger-design.md](../session-close-trigger-design.md)。

**涉及模块**：`electron/main/services/memory/group-digest-trigger.ts`、`group-digest-scanner.ts`、`electron/main/services/scheduler/scheduler-service.ts`、`runtime/plan-runner.ts`、`runtime/task-executor.ts`、`electron/main/agents/pi-session/pi-session-manager.ts`、`electron/main/index.ts`

## 步骤索引

- [ ] [Step 1: triggerByConversation 补脏判定](./step1-dirty-check.md) — 复活「触发点③」钩子：查到组后先 findDirtyGroup 判脏，脏才入队
- [ ] [Step 2: 调度器 handleSessionClose 重构 + triggerContext 贯通](./step2-scheduler-context.md) — 新签名/退出标志/工作区过滤，RunTaskOptions 加 context，group_digest 精准分支
- [ ] [Step 3: 触发点下沉 pi-session-manager](./step3-manager-hook.md) — _destroySession 加 source，自然销毁后通知调度器
- [ ] [Step 4: 清理旧触发点 + 端到端验证](./step4-cleanup-verify.md) — 删 index.ts 旧调用，行为矩阵逐项验证，doc-sync

## 全局决策

- **签名微调**：`handleSessionClose(conversationId: string)`（workspaceId 由调度器内部经 conversation-service 解析，与设计文档的 `(workspaceId, conversationId)` 不同）——让 agents/pi-session 层只依赖调度器单入口，不为解析 workspaceId 多 import 一个服务
- `source` 枚举：`'natural' | 'forced'`；`release` 非运行分支与 `maybeCollectOrphan` → natural，`closeSession` / `closeAll` → forced
- 触发链路全部 fire-and-forget：动态 import + `.catch()`，任何失败只 warn/log，不阻塞销毁、不外抛
- `triggerContext` 类型：`{ conversationId: string }`，仅 group_digest 消费，其余任务类型忽略；不进前端类型
- 前端零改动（`types/scheduler.ts` 不动）
- 主进程代码改动后需 `bun run build:electron` 重新编译才能验证
