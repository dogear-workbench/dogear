# 任务与会话解耦（申报制回写 + 中断语义）设计

**日期**：2026-09-07
**状态**：已拍板

## 背景（排查结论）

任务自动回写自 09-03 起多次失败，用户被迫「取消 + 手动完成」，result 摘要全部丢失（tasks.json 中 7 个任务 result 为「手动标记完成」，而它们的执行会话逐字稿末尾全部带 `<task-result>` 标签，会话侧 100% 履约）。全量日志零 task-queue WARN/ERROR。

根因是三层断链：

1. **写回通道单点**：结果回写完全押在 `await session.sendMessage` 这条 promise 上（task-queue.ts `runExecutionTurn`）。该 promise 在 pi 内部收尾不 settle 时永久挂死（pi-harness-adapter.ts 注释已记录 harness `waitForIdle` 永久等待的坑）→ 会话实际跑完、任务永远卡 running，无任何提示。
2. **恢复策略粗暴**：应用重启后 `recoverInterruptedTasks` 按心跳陈旧度把 running 置回 queued 并**自动重跑**；用户被迫取消+手动完成。心跳（60s 文件写）依赖主会话消息事件，与「挂起 WaitForMessage 等子会话」的长静默天然冲突。
3. **静默丢弃**：写回前重查 `current.status !== 'running'` 时直接丢弃结果（仅 log.info 不落盘）。取消/恢复路径改过状态后，已产出的摘要无声蒸发。

**责任倒置**是本质：执行会话是干活的人，却没有任何手段申报成果；任务状态完全依赖主进程旁听 + 一条可能断的线。

## 目标

- 执行会话完成时**主动申报**结果（新工具），任务回写不再依赖单一 promise
- `interrupted`（已中断）成为一等状态：中断交用户手动处理（打开会话看原因 → 让它继续 → 会话申报回写）
- 删除文件心跳机制，启动恢复无条件 running → interrupted，不自动重跑
- 所有结果丢弃/覆盖路径留痕（WARN 日志 + result 附加 + 通知）

## 架构

**申报制为主，旁听为兜底**：

- 新工具 `dogear__ReportTaskResult`：执行会话跑完调用，按 `execSessionId` 校验归属，running/interrupted/rejected → review
- 队列旁听 `<task-result>` 提取保留为兜底：写回前查状态，已申报（review）则跳过
- 队列防卡死：idle 熔断 interrupt 后加超时强制放行（Promise.race），队列永不死锁

**状态机新分工**：

```
rejected    = 执行前的确定性拒绝（无 plan、找不到 origin）→ 改好后重新入队
interrupted = 执行中的意外中断（应用重启、卡死、执行轮异常）→ 打开会话处理后续
```

新边：`running → interrupted`（恢复/队列判定）、`interrupted → review/queued/plan/done`、`rejected → review`（申报）。

完整迁移表（`task-store.ts` ALLOWED_TRANSITIONS）：

| from | to（新增/保留） |
|------|------|
| plan | backlog, queued, done |
| backlog | queued, done |
| queued | running, rejected, backlog |
| running | review, **interrupted**, rejected, backlog |
| review | done, rejected |
| done | plan |
| rejected | plan, backlog, done, **review** |
| **interrupted** | **review, queued, plan, done** |

排除的选项：
- 会话完成后自动置 done（不经人审）——保留 review 人审语义，申报只到 review
- 保留文件心跳 + 拉长阈值——治标不治本，且与 WaitForMessage 长静默冲突无解；单机单实例下内存判定足够
- 恢复时自动续跑原会话——需要队列重新挂接会话上下文，复杂且违背「交用户手动」的决策

## 模块边界

| 文件 | 改动 |
|------|------|
| `electron/main/services/task-store.ts` | TaskStatus 加 interrupted；迁移表新边；`interruptTask` / `reportTaskResult`（按 execSessionId 原子查找+迁移）；删 `touchRunningTask`；`recoverInterruptedTasks` 重写（无条件 running→interrupted，附原因）；`executeTask`/`completeTaskManually`/`moveTaskToPlan` 放宽 from 含 interrupted；`lastActiveAt` 读兼容不再写 |
| `electron/main/services/task-service.ts` | 广播包装同步（interrupt/report 透传+广播，touch 删除，RECOVER_STALE_MS 删除） |
| `electron/main/services/task-queue.ts` | 删心跳（TASK_TOUCH_INTERVAL_MS/maybeTouchHeartbeat）与 12min 复查；`buildExecutionPrompt` 加申报约定；写回前查已申报跳过；丢弃路径留痕（log.warn + result 附加 + notify）；`safeInterrupt`（markTaskRunning 之后的意外中断 → interrupted，对照 safeReject 只管执行前确定性拒绝）；runExecutionTurn 的 interrupt 超时强制放行 |
| `electron/main/agents/tools/task-tools.ts` | 新增 `dogear__ReportTaskResult`（挂 dogear-tasks 组，校验归属） |
| `types/task.ts` | TaskStatus/TaskGroups 镜像同步（七组→八组） |
| `stores/task-store.ts` | TaskGroups 类型消费同步 |
| `components/notes/TaskPanel.tsx` | interrupted 并入 plan 组尾部显示（同 rejected 现状），「已中断」徽标；详情页 interrupted 态操作（重新入队/移回计划/手动完成）+ 中断原因（result 字段）展示 |

## 数据流

**正常流**：queued → 队列建执行会话（autoExecute）→ running → 会话完成调 `dogear__ReportTaskResult(summary)` → review + 通知 → 用户审核 done/rejected。

**兜底流**：会话没调工具 → sendMessage resolve → 队列查状态非 review → 旁听提取 `<task-result>` 写入 review。

**中断流**：
- 应用重启 → 启动恢复：running → interrupted（result=「应用重启时任务执行中断」）+ 通知（文案带引导：*让会话继续时，完成后请它调用 dogear__ReportTaskResult 回写任务*）
- 执行轮异常/卡死强制放行 → safeInterrupt → interrupted（result=原因）+ 同款通知
- 用户打开执行会话（任务详情「跳来源会话」）→ 插话让它继续 → 跑完申报 → interrupted → review

## 错误处理 / 边界情况

- **双写防护**：申报工具与队列兜底都到 review 时，后者查状态非 running 自然跳过；工具层申报时任务已 review → 报「任务已回写」不重复
- **老会话兼容**：中断前创建的会话不知道申报约定，靠通知文案引导用户插话时带一句；新任务从 buildExecutionPrompt 起自带约定
- **lastActiveAt 存量数据**：读时忽略（字段保留不删，避免迁移）
- **多实例误伤**：第二实例启动会把第一实例正在跑的任务置 interrupted——单机单实例语义下接受（误标为中断的损失远小于误重跑历史事故）
- **申报工具防误用**：非执行会话调用（execSessionId 不匹配任何 running/interrupted/rejected 任务）→ isError 提示无权申报

## 未决问题（实施时定）

- `PiSessionTurnResult.subtype` 的确切枚举值（cancelled 等），强制放行路径构造 outcome 时对齐
- 中断通知是否按工作区合并为一条（避免启动恢复批量刷屏）——默认逐任务通知，数量大再合并
