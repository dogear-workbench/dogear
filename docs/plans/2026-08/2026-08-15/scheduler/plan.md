# 定时计划系统（Scheduler）实施计划

**目标**：做一套全局定时计划系统——计划 = 任务序列（内置 agentwork + 自定义 agent 任务）+ 触发器（时间规则 ∪ 条件规则，OR），计划内串行断点续跑、计划间并行，运行历史独立页面展示，现有三个硬编码触发点迁移为出厂计划。

**架构思路**：主进程新增 `services/scheduler/`（分钟级 tick 调度器 + 纯函数时间引擎 + plan-runner 执行器 + 历史存储）；自定义任务走 agent-manager Worker 池新类型 `CUSTOM_AGENT`（pi runOnce + 按设置过滤的工具集）；内置任务直接调现有 trigger 层不重写。不引 cron 库（窗口连续消费/断点续跑/错过记 missed 均为自定义语义）。详见 [设计文档](../scheduler-design.md)。

**涉及模块**：`electron/main/services/scheduler/`（新）、`electron/main/agents/task-types.ts` / `agent-worker.ts`、`electron/main/tipc/scheduler.ts`（新）、`electron/main/index.ts`（迁移）、`types/scheduler.ts`（新镜像）、`stores/scheduler-store.ts`（新）、`app/settings/SchedulerTab.tsx`（新）、`app/run-history/page.tsx`（新）

## 步骤索引

- [x] [Step 1: 数据模型 + 时间引擎 + 计划存储](./step1-model-engine.md) — 类型定义、time-rule-engine 纯函数、plan-store 含出厂播种
- [x] [Step 2: 运行历史存储 + 计划执行器](./step2-runner-history.md) — run-history-store（按月 JSONL）、plan-runner（串行消费/断点/停机/防重入）、内置任务对接现有 trigger 层
- [x] [Step 3: 自定义任务类型 CUSTOM_AGENT](./step3-custom-agent.md) — agent-worker 新 handler：prompt + 模型 fallback + 按设置过滤的工具集
- [x] [Step 4: 调度核心 + 启动集成](./step4-scheduler-core.md) — scheduler-service（tick 求值/窗口状态机/条件事件/错过判定）、index.ts 启动接线
- [ ] [Step 5: 触发点迁移 + tipc 路由](./step5-migrate-ipc.md) — 删三个硬编码触发点改走调度器、scheduler.ts 七个 RPC + 校验
- [ ] [Step 6: 前端 store + 设置页「定时计划」Tab](./step6-settings-ui.md) — scheduler-store、计划列表 + 编辑器（任务编排/触发器多选/工作区选择）
- [ ] [Step 7: 执行历史页面 + 收尾](./step7-history-page.md) — 独立路由页面、状态徽章/分页/摘要展开、codebase-map 同步

## 全局决策

**数据与存储**
- 计划全局一份：`.dogear/plans.json`（safe-json 原子写）。任务级 `workspaceId`：builtin 缺省 = 全部工作区（现有语义）；custom 缺省 = 当前激活工作区。
- `Trigger` 带稳定 `id`（创建时生成），`lastFiredAt` / `once.fired` 内嵌在 trigger 上随 plans.json 持久化；savePlan 按 trigger.id 保留旧 lastFiredAt（编辑不重置）。
- 运行历史：`.dogear/run-history/YYYY-MM.jsonl`，任务级条目（完成时写完整条目）+ missed 触发条目（无 taskId）；保留 3 个月自动清理；运行中状态不落历史，走 activity 实时查。
- 断点：`plan.runState = { pendingTasks: taskId[], cursor? }`，每次任务切换时落盘。

**调度语义（跨步骤必须一致）**
- 触发器 OR：任一命中即触发。防重入：计划运行中再命中 → 忽略记日志。
- 窗口期：窗口开 → 启动/继续消费队列；窗口关 → 停机信号，当前任务跑完（允许超窗）不再派发。
- 错过不补跑：启动/tick 检出错过 → 历史记一条 missed（每规则只记最近一次，防堆积）；once 错过或触发后标记失效。
- 计划内串行，计划间并行；自定义任务受 Worker 池上限（4）自然排队。
- 内置任务执行 = 调现有 trigger 层（脏检查/串行队列/链式分类原样保留），只加可选 workspaceId 参数；设置页手动按钮不动。

**自定义任务**
- `TaskType.CUSTOM_AGENT`，payload: `{ taskName, prompt, modelSelection?, workspaceId, workspacePath }`。
- 模型三级 fallback：payload.modelSelection ?? settings.defaultModelSelection，不完整返回明确 error。
- 工具集：基础文件工具（workspace 边界校验）+ 按设置工具包开关/basicToolPermissions 过滤的扩展工具；产物 agent 用工具自己写，跑完不通知。
- token 用量：能从 runOnce usage 提取则记入历史条目，提取不到字段留空。

**命名与规范**
- 主进程单例 `getSchedulerService()`；tipc 路由 `scheduler.ts`；前端 `scheduler-store.ts`；历史页面路由 `/run-history`（HashRouter）。
- 不写注释；不留半成品/空 stub；单文件 >300 行拆分。主进程改动需 `bun run build:electron` 验证编译。
