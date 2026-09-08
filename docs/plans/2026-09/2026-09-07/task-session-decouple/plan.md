# 任务与会话解耦实施计划

**目标**：执行会话可主动申报任务结果（`dogear__ReportTaskResult`），任务新增 `interrupted` 中断语义，删除文件心跳，队列降级为「启动 + 兜底 + 防卡死」，所有结果丢弃路径留痕。

**架构思路**：申报制为主、队列旁听 `<task-result>` 为兜底；`rejected` 管执行前确定性拒绝、`interrupted` 管执行中意外中断（交用户手动处理，会话续跑完成后申报回 review）。设计与排查结论见 [design.md](./design.md)。

**涉及模块**：`electron/main/services/task-store.ts` / `task-service.ts` / `task-queue.ts`、`electron/main/agents/tools/task-tools.ts`、`types/task.ts`、`stores/task-store.ts`、`components/notes/TaskPanel.tsx`

## 步骤索引

- [x] [Step 1: 状态机与存储层](./step1-store.md) — interrupted 状态 + 新迁移边 + interruptTask/reportTaskResult，删心跳，重写启动恢复
- [x] [Step 2: 申报工具与队列加固](./step2-queue-tool.md) — dogear__ReportTaskResult 工具、执行提示词申报约定、队列防卡死与留痕、safeInterrupt 分流
- [x] [Step 3: 前端展示与操作](./step3-ui.md) — TaskPanel interrupted 分组/徽标/详情操作，类型镜像同步

## 全局决策

- **状态机分工**：`rejected` = 执行前确定性拒绝（无 plan / 无 origin）；`interrupted` = 执行中意外中断（重启 / 卡死 / 执行轮异常）。两者都并入 plan 组尾部显示（TaskPanel 现状 rejected 即如此）。
- **result 字段复用**：中断原因写进 `task.result`（与 rejected 的 reason 一致）；申报成功后被摘要覆盖。
- **申报校验原子化**：`reportTaskResult` 在 `mutateTasks` 闭包内完成「按 execSessionId 查找 + 状态校验 + 迁移 review」，不做先查后写的两步（防竞态）。
- **写回防双写**：队列兜底写回前 `getTask` 查状态，已 review（被申报）则跳过；申报工具遇已 review 返回「已回写」提示。
- **lastActiveAt**：停止写入，读时忽略，字段不删（存量兼容）。
- **通知文案**：中断类通知统一带引导句「让会话继续时，完成后请它调用 dogear__ReportTaskResult 回写任务」（老会话不知道申报约定的过渡补线）。
- 不写单测（项目偏好），每步以 `bun run build:electron` + `bun run lint` + 前端 tsc 通过为验证线。

## 完成总结

三步全部完成（2026-09-07）：

1. **step1 存储层**（commit 0445c0c）：TaskStatus 新增 interrupted 八状态机；新增 interruptTask / reportTaskResult（按 execSessionId 原子申报回 review）/ appendResultNote；删 touchRunningTask 文件心跳，启动恢复重写为无条件 running→interrupted 不自动重跑；lastActiveAt 停写。
2. **step2 工具与队列**（commit d7bff95）：新增 dogear__ReportTaskResult 工具，执行提示词约定申报 + <task-result> 备用信号；队列 idle 熔断后 60s Promise.race 强制放行防永久卡死；markTaskRunning 后意外中断走 safeInterrupt（带申报引导句通知），safeReject 收窄为执行前拒绝；结果丢弃路径留痕进 result 并通知。
3. **step3 前端**（commit 870d3df）：TaskPanel 将 interrupted 并入计划组尾部显示 + 橙色「已中断」徽标；详情页提供重新入队/移回计划/手动完成三操作，中断原因按 result 渲染；TaskStatusBadge 补八状态。

验证线：build:electron / lint / 前端 tsc 全绿；task-store.test.ts 19 pass（含新语义用例）。真机验收清单见共享区 step3-delivery.md（7 项，待用户在场执行）。
