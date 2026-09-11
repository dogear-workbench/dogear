---
step: 5
title: 旧轨下线
status: done
---

## 目标
砍 group_digest/review 内置定时任务，删除 digest/review 生产模块与工具，前端组卡/报告展示移除，共享函数迁移——旧双轨整体退场。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step4-naming.md] 话题命名已迁入状态卡链路（旧联动 SaveGroupDigest→updateGroup 可安全删除）
- 当前关键文件状态：scheduler `types.ts:3` BuiltinTaskId 含 group_digest/review；`builtin-task-meta.ts:47-66` 两组元数据；`plan-runner.ts:78/83` cancel 分支；`task-executor.ts:69/83` 执行 case；`plan-store.ts:88` maintenance 引用。memory 下 group-digest-{trigger,scanner,store,prompt}.ts、review-{trigger,store,prompt,scanner}.ts。工具 `group-digest-tools.ts`（ReadGroupDigest/CleanTranscript/SaveGroupDigest/ListGroupFiles）、`review-tools.ts`（ListDigests/ReadDigest/TraceSource/ReadReport/WriteReport）。前端 `components/TopicPanel.tsx:167-201`「组卡提炼」区、`app/data-center/digests-panel.tsx`
- 关键决策回顾：磁盘 digest.md/报告数据保留不删；既有用户 plan 中两任务项过滤隐藏（数据保留）；共享函数 getGroupDir/mergeSourcesSeen/GroupDigestSourceSeen 迁出 group-digest-store；review 工具组中记忆/core-profile 工具是独立注册的不受影响（确认后处理）

## 计划改动
- [ ] 共享函数迁移：getGroupDir/getGroupsRootDir/mergeSourcesSeen/GroupDigestSourceSeen（getStaleConversations 等背景侧依赖）从 group-digest-store.ts 迁至 background-store.ts 或独立模块
- [ ] scheduler：types.ts BuiltinTaskId 删两项；builtin-task-meta 对应条目删除；plan-runner/task-executor 对应 case 删除；plan-store.ts:88 maintenance 集合更新；既有 plan 数据过滤（读取侧不展示 group_digest/review 项，文件数据不动）
- [ ] 删除文件：group-digest-trigger/scanner/store/prompt.ts、review-trigger/store/prompt/scanner.ts（先全仓 grep 引用确认无残留）
- [ ] 工具删除：group-digest-tools.ts 整组（确认 CleanTranscript 是否 STATE_EXTRACT 或其他链路复用——是则单独保留注册）；review-tools.ts 中 ListDigests/ReadDigest/TraceSource/ReadReport/WriteReport 删除（RecallMemory 等非 review 专属工具确认注册归属后保留）
- [ ] 前端：TopicPanel.tsx 删「组卡提炼」Section 与 digest 状态/加载；app/data-center 删 digests-panel.tsx 及 page.tsx 引用；grep 报告相关 UI（ReadReport 消费面）一并清理
- [ ] 全仓 grep group_digest / GroupDigest / digest 残留引用清理（docs 外）；`bun run lint` + `bun run build:electron` 过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. 共享函数拆两处：getGroupsRootDir/getGroupDir 入 background-store.ts；mergeSourcesSeen + 类型改名 SourceSeen 入 state-card.ts（sourcesSeen 本就是状态卡 schema 字段）；另新建 digest-file.ts 承接存量 digest.md 读写（parse/read/save/getPath + GroupDigestCard 类型）——category-trigger、agent-worker categorize 链路、migration-p3/p4 历史迁移脚本仍需读旧卡，step6 删分类链时一并删
  2. scheduler 调度侧过滤：磁盘存量 group_digest/review 任务条目保留，但 scheduler-service（8 处 loadTasks 调用统一走 listSchedulableTasks）与 tipc listTasks 过滤隐藏；plan-store 新增导出 isRetiredBuiltinTask；task-executor runBuiltinTask 加 default 兑底（未知内置任务返回 failed，防存量任务被手动触发）
  3. 连带删除（删模块后无消费方的整链）：agent-worker handleGroupDigestTask/handleReviewSessionTask、task-types 两组枚举与 payload、pi-session 两处 dogear-memory-review 挂载、custom-agent-tools 装配行、digest-tools.ts（dogear__CleanTranscript 无其他链路复用，STATE_EXTRACT 用的是 transcript-adapter 直调函数）、tipc/digest.ts、tipc/review.ts、dashboard-watcher.ts + renderer-handlers.reportUpdated + main-app 启动调用（前端无报告 UI 消费面）
  4. settings 链清理：ai.digestModelSelection/reviewModelSelection 字段删除（消费面全在本步删除范围内），连带 settings-normalize.test 两测试改用 parse/stateModelSelection、前端 types/settings、settings 页 clearIfMatch
  5. reference-tools ListSiblingSessions：hasDigestCoverage（组卡 sourcesSeen）改为 hasStateCoverage（状态卡 sourcesSeen），语义迁移到新轨
  6. 话题命名旧联动（SaveGroupDigest→updateGroup）随 group-digest-tools.ts 整文件删除，无需单独处理
- 改动文件清单：
  - 删除 19 个：memory 下 group-digest-{trigger,scanner,store,prompt}.ts、review-{trigger,scanner,store,prompt}.ts 及 4 个 *.test.ts、dashboard-watcher.ts；tools 下 group-digest-tools.ts、digest-tools.ts、review-tools.ts；tipc/digest.ts、tipc/review.ts；app/data-center/digests-panel.tsx
  - 新增 1 个：memory/digest-file.ts
  - 修改 27 个：state-card.ts、background-store.ts、category-trigger.ts、migration-p3/p4.ts、migration-gate.ts、topic-lifecycle-service.ts、agent-worker.ts、task-types.ts、agent-query-config.ts、pi-session.ts、group-context-builder.ts、session-append-templates.ts、reference-tools.ts、memory-tools.ts、custom-agent-tools.ts、scheduler 7 文件（types/builtin-task-meta/plan-store/plan-runner/task-executor/scheduler-service/tipc/scheduler）、tipc/index.ts、tipc/agent.ts、renderer-handlers.ts、main-app.ts、settings-types.ts、settings-service.ts、settings-normalize.test.ts、前端 TopicPanel.tsx、data-center/page.tsx、BuiltinTaskDetailSection.tsx、SchedulerPanel.tsx、CustomToolPacksSection.tsx、settings/page.tsx、types/scheduler.ts、types/settings.ts

- 验收：首次验收发现 scheduler-service.ts listSchedulableTasks 方法体自递归 bug（插入脚本误伤，tsc/lint 均无法发现）打回修复为 await loadTasks()，复核无递归；lint 0 errors、build:electron、bun run build 完整构建、settings-normalize.test 51 pass 均过；抽查 scheduler 双层过滤（写路径不过滤防物理删除）、task-executor default 兑底、全仓 grep 残留清零（前端 markdown-preview-store 为模式误匹配非真残留）均合格
- 待办或已知限制（补充）：无 GUI 视觉验收欠账：TopicPanel 组卡区消失、数据中心无组卡 Tab、调度页只剩两个内置任务、settings 模型选择项变化——建议 GUI 跑 bun run dev 肉眼过一遍；用户磁盘 plans.json 存量 group_digest/review 条目保留但不再展示/调度（若用户问「组卡提炼去哪了」属预期行为）

### 给下一步的接力棒
- 关键签名 / 数据结构：state-card.ts 新增 `SourceSeen` 类型与 `mergeSourcesSeen(existing, dirty)`；background-store.ts 新增 `getGroupsRootDir/getGroupDir`（background-store 是组目录结构的唯一权威源）；digest-file.ts 是存量 digest.md 唯一入口
- 下个 step 该从哪里继续：step6 删分类链时：删 category-trigger.ts、smart-category-*、categorize-prompt.ts、organize-prompt.ts、category-tools.ts、agent-worker handleCategorizeSessionTask/handleCategorizeOrganizeTask、scheduler categorize 两 case（types/builtin-task-meta/plan-runner/task-executor + BUILTIN_TASK_IDS/LABELS/META）、BuiltinTaskDetailSection MODEL_IO、task-types CATEGORIZE_* 枚举与 payload、settings categorizeModelSelection、前端 SmartSection/smart-category-panel/smart-category-store、tipc/category.ts、migration-gate（唯一剩余 block 对象是 category-trigger）；然后删 digest-file.ts 本体；step6 新增 ListTopics 时在 reference-tools.ts 挂载，组标题/topic 从 groups.json + 状态卡取
- 待办或已知限制：plans.json 存量 group_digest/review 条目物理保留（isRetiredBuiltinTask 过滤隐藏）；磁盘 digest.md/报告/categories.json 未动；migration-p3/p4 仍会在启动时跑（幂等 no-op）；review-skill-service.ts（no-op 历史兼容）未删；验证基线：lint 0 errors/102 warnings（存量）、build:electron tsc 0 error、bun run build 过、settings-normalize.test 51 pass
