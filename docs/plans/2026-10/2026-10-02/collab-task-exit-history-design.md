# 协作任务退出执行历史 设计

**背景**：数据中心「执行历史」目前记录四类后台任务（定时/状态抽取/文章解析/协作任务）。协作任务的执行会话本身就是完整记录，任务状态机（queued→running→review→done/rejected）与任务详情里的结果摘要又是一份，执行历史属于第三份冗余，且历史条目内信息（时间、摘要）无独占内容。

**目标**：协作任务在执行历史中完全无痕迹（历史条目、正在运行区、写入逻辑全删），执行历史面板语义收窄为「headless 后台任务」的历史。协作任务状态可见性回归任务列表（running 徽章）与会话列表。

**架构**：纯删除，无新增逻辑。`background-activity-service` 不动——它是通用注册表，协作任务调用方删除后自然退化为三类。

**模块边界**：

主进程（需 `build:electron`）：
- `electron/main/services/task-service.ts` — 删 `collabTaskName()`、`recordCollabRun()` 及三处调用（interruptTask / reportTaskResult / rejectTask）；cancelTask/completeTask 里的 `reportDone` 一并删；清理相关 imports（appendHistoryEntry、getRunning/reportDone、RunHistoryEntry/RunHistoryStatus 类型）
- `electron/main/services/task-queue.ts` — 删 markTaskRunning 后的 `reportRunning(task.id, { source: 'collab-task', ... })` 及 import

渲染层：
- `app/data-center/history-panel.tsx` — SOURCE_OPTIONS 排除 `collab-task`（筛选下拉去掉「协作任务」死选项）
- `app/data-center/history-utils.ts` — `SOURCE_META` 的 `collab-task` 条目**保留**，旧数据条目渲染兜底；`RunHistorySource` 类型同理保留

文档：
- `docs/codebase-map/data-center.md` — 四类后台任务描述改三类

**数据流**：run-history JSON 中已写入的 `source: 'collab-task'` 旧条目原样保留，「全部类型」视图正常渲染，不做迁移清理；不再产生新记录。

**错误处理 / 边界情况**：
- 旧条目渲染依赖 SOURCE_META 保留 collab-task key，删除该 key 会导致 HistoryEntryCard 渲染崩溃——保留不删
- reportDone 对不存在注册的 key 本是无操作，但删除调用保持代码干净

**未决问题**：无。

**不分步骤理由**：纯删除、5 文件无步骤依赖、单会话可完成验证。
