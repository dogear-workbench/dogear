# 后台任务统一执行历史 实施计划

**目标**：执行历史成为所有不在主会话中进行的后台 agent 任务（定时任务 / 状态抽取 / 文章解析 / 协作任务）的统一历史，删解析历史 tab，统一「正在运行」注册表，顺带补 STATE_EXTRACT 用量。

**架构思路**：`RunHistoryEntry` 加 `source` 字段区分四类（旧数据读侧缺省 `'scheduler'`，无迁移）；新建内存态 `background-activity-service` 承载统一运行注册表；四类任务在各自终态回调处写历史（详情=结果，各任务自己填）。排除了「前端聚合多 IPC」方案（查询口分散、筛选难做）和「agent-manager 统一写史」方案（协作任务不走 agent-manager，且详情组装在调用方手里最自然）。设计全文见 [../background-task-history-design.md](../background-task-history-design.md)。

**涉及模块**：`services/scheduler/`（types、run-history-store、plan-runner、scheduler-service、tipc/scheduler）、`services/background-activity-service.ts`（新建）、`services/memory/state-extract-trigger.ts`、`agents/agent-worker.ts`、`tipc/article.ts`、`services/task-service.ts`、渲染层 `types/scheduler.ts`、`stores/scheduler-store.ts`、`app/data-center/`。

## 步骤索引

- [x] [Step 1: 数据层与统一活动注册表](./step1-data-model.md) — RunHistoryEntry 加 source、queryHistory 类型筛选、新建 background-activity-service、scheduler 侧接入
- [x] [Step 2: STATE_EXTRACT 接入](./step2-state-extract.md) — agent-worker 补用量累加、state-extract-trigger 注册运行 + 终态写历史
- [x] [Step 3: PARSE_ARTICLE 接入与删解析历史](./step3-parse-article.md) — tipc/article 终态写历史、删 getParseHistory、数据中心五 tab → 四 tab
- [x] [Step 4: 协作任务接入](./step4-collab-task.md) — task-service 三处状态迁移写历史
- [x] [Step 5: 执行历史 UI](./step5-history-ui.md) — 类型筛选、类型徽章、运行区统一来源

## 全局决策

- `source` 取值固定四类：`'scheduler' | 'state-extract' | 'parse-article' | 'collab-task'`；读旧 JSONL 无 source 字段的条目一律视为 `'scheduler'`，`queryHistory` 按 source 筛选时 scheduler 需同时匹配「有 source=scheduler」与「无 source 字段」两种
- `planName` 字段名不动（避免旧数据迁移），语义泛化为任务名
- 详情 = 结果：沿用 `summary/error` 字段，各任务自己填，不新增字段、不引入摘要概念
- tokens 口径：scheduler（现有）与 state-extract（新补）带；parse-article（Claude SDK 无现成 usage）与 collab-task（用量已归执行会话维度，避免双计）不带
- 协作任务 `rejected` 映射历史状态 `failed`（详情注明拒绝原因），不扩状态枚举
- 写历史统一 try/catch + log，失败不影响任务本身
- 运行注册表接口：`reportRunning(key, { source, name })` / `reportDone(key)` / `getRunning()`；key 用各任务自身 id；先写历史再 reportDone（UI 轮询视角 done 即历史可见）；missed 条目不注册运行
- 顺序纪律：先写历史 → reportDone；reportRunning 在任务真正开始执行时（非排队时）

## 完成总结

五步全部实施完毕（2026-09-14）：

1. **数据层**：`RunHistoryEntry` 加 `source` 四类枚举（scheduler / state-extract / parse-article / collab-task），旧 JSONL 无 source 条目读侧归一为 scheduler，无迁移；`queryHistory` 与 `listRunHistory` IPC 支持按 source 筛选
2. **统一运行注册表**：新建 `services/background-activity-service.ts`（内存单例 reportRunning / reportDone / getRunning），scheduler 运行态改由注册表提供，`getSchedulerActivity` 天然聚合四类
3. **四类接入**：定时任务（plan-runner）、状态抽取（state-extract-trigger + agent-worker 补跨会话 tokens 累加）、文章解析（tipc/article，删 getParseHistory 路由与解析历史 tab，history.jsonl 保留作诊断）、协作任务（task-service 三处迁移写史，rejected→failed，cancel/complete 出口补注册表收口）
4. **UI**：执行历史面板「按任务筛选」→「按类型筛选」（后端参数），卡片与运行区带四色类型徽章，触发方式徽章仅定时任务显示
5. 统一顺序纪律：先写历史再 reportDone，写史失败 try/catch 不影响任务本身

遗留（运行时验证待人工）：四类任务各产生一条历史后的可视验证；取消的解析任务无入口不达 CANCELLED 分支；协作任务手动取消不写历史（仅收口注册表，计划内取舍）；状态筛选致空列表时「加载更多」不显示（既有行为）。
