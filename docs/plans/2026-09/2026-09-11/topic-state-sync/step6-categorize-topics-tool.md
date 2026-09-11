---
step: 6
title: 智能分组下线与跨话题检索
status: done
---

## 目标
砍 categorize/categorize_organize 与 smart-category 全链（输入本已依赖 digest.md，Step 5 后断粮）；新增零模型 dogear__ListTopics 工具补跨话题检索空缺。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step5-remove-legacy.md] group-digest-store 已删（共享函数已迁移）；digest 工具组已删
- 当前关键文件状态：scheduler `types.ts` BuiltinTaskId 含 categorize/categorize_organize；`builtin-task-meta.ts` categorize 条目工具为 ListCategories/SaveCategoryJoin/SaveCategoryNew/SaveCategoryMerge；memory 目录 category-trigger.ts（sweep 读 digest.md，`:305-349`）/ smart-category-engine.ts / smart-category-store.ts / categorize-prompt.ts；前端 components/conversation-list/SmartSection.tsx、app/data-center/smart-category-panel.tsx、stores/smart-category-store.ts
- 关键决策回顾：分类层无受众（检索已 agent 化）直接砍不改；categories.json 保留；ListTopics 零模型纯本地 IO；agent 动线 = ListTopics → ReadGroupBackground → ReadReferenceSession

## 计划改动
- [x] scheduler：BuiltinTaskId 删 categorize/categorize_organize；builtin-task-meta/plan-runner/task-executor 对应条目与 case 删除；plan-store 既有 plan 项过滤
- [x] 删除文件：category-trigger.ts / smart-category-engine.ts / smart-category-store.ts（memory 侧）/ categorize-prompt.ts；categorize 工具注册（ListCategories/SaveCategory*）——先全仓 grep 引用确认（dashboard-watcher / category-trigger 手动触发链等）
- [x] 前端：删 SmartSection.tsx 及会话列表分类视图接入（回归话题平铺）；删 app/data-center/smart-category-panel.tsx 与 page.tsx 引用；删 stores/smart-category-store.ts
- [x] 新增 `reference-tools.ts` dogear__ListTopics：遍历 groups.json → 每组读状态卡 topic 一句话（无卡回退组标题）+ updatedAt + 主会话数 + 是否归档；返回紧凑列表；末尾 registerTools() 注册元数据
- [x] 全仓 grep categorize / smart-category / SmartSection 残留清理；`bun run lint` + `bun run build:electron` 过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. **builtin 概念整体退役**（BuiltinTaskId 空集问题的处理）：删 BuiltinTaskId/BuiltinScheduledTask 类型，ScheduledTask = CustomScheduledTask；isRetiredBuiltinTask 语义变为「kind==='builtin' 即 retired」（一行 WHY 注释），对存量 categorize/categorize_organize 条目自动覆盖隐藏；plan-store 删 seed 逻辑、migrateLegacyPlans 对 builtin 存量条目原样透传（数据保留）；tipc/scheduler 删 getBuiltinTaskDetail/saveBuiltinPrompt/resetBuiltinPrompt 三路由，deleteTask 拒删改用 isRetiredBuiltinTask；task-executor 删 runBuiltinTask/resolveTaskWorkspaces/waitForQueueIdle
  2. **migration-p3/p4/gate 整体删除**（接力棒「确认为幂等 no-op 可跳过」路线）：本机数据验证两工作区 conversation-tree.json / smart-categories.json 均 schemaVersion=2、digests/ 只剩 _archive/——p3/p4 恒 no-op；p3 处理的 digest.md 与 p4 搬迁目标在新体系全是死数据；main-app.ts 的 p3/p4 调用段删除，topic-lifecycle 迁移调用保留（原在 p4 try 块内，已拆出独立）
  3. **连带删除**：organize-prompt.ts（organize 任务提示词，计划未列但属分类链）；auto-archive-service / topic-lifecycle-service / conversation-service.getConversationsByIds（唯一消费方 category-tools）对 smart-category-store 的清理调用；settings 的 smartCategory 顶层字段（enabled/threshold/maxCategories，消费面全在删除范围）；types.ts 主进程镜像分类类型段；renderer-handlers 的 categoriesUpdated 事件定义
  4. **docs/codebase-map.md 同步更新**：删 19 个失效条目/段落，改写 TaskEditorPage/ConversationList/section-collapse-store/types.settings/scheduler 系列/agent-worker/agent-query-config/task-types/reference-tools（补 ListTopics）等条目
  5. **验收补做两轮**：①codebase-map 的 step5 范围旧条目（digest/review 链路两大段、group-digest-* / review-* / digests-panel / digest-tools 等条目、TopicPanel 组卡提炼描述）全部清理，旧轨链路段替换为状态卡新轨描述；②发现并修复 step5 遗漏：ReportSection.tsx + dashboard-store.ts 调用已删的 getReport/getReviewActivity/triggerReview 路由（运行时必报错），删除两文件，NotesPanel 四 mode 收三 mode（报告 tab 删，默认 mode 从 report 改 notes），renderer-handlers 报告注释残留清理
- 验收：两轮补做后复核：lint 0 errors、bun run build、bun test 255 pass 0 fail；全仓 grep ReportSection/dashboard-store/报告路由引用清零；scheduler 退役逻辑（isRetiredBuiltinTask 对存量四类 builtin 条目自动覆盖）/ ListTopics 实现（零模型、单组失败不阻塞、活跃在前倒序）抽查合格
- 改动文件清单：
  - 删除 22 文件：memory 侧 category-trigger(+test)/smart-category-engine(+test)/smart-category-store(+test)/categorize-prompt(+test)/organize-prompt/digest-file/migration-gate/migration-p3(+test)/migration-p4；agents/tools/category-tools.ts；tipc/category.ts；scheduler/builtin-task-meta.ts；前端 SmartSection.tsx / smart-category-panel.tsx / smart-category-store.ts / smart-category.ts / BuiltinTaskDetailSection.tsx
  - 主进程修改 17 文件：scheduler types/plan-store/plan-validate/plan-runner/task-executor/scheduler-service（注释未改逻辑）；tipc scheduler/index/agent/renderer-handlers；agents task-types/agent-worker/agent-query-config(注释)/reference-tools(+ListTopics)；services settings-types/settings-service/settings-normalize.test/auto-archive-service/topic-lifecycle-service/conversation-service/conversation-tree-service(注释)/types.ts；main-app.ts
  - 前端修改 7 文件：ConversationList.tsx / memory-section.tsx / TaskEditorPage.tsx / SchedulerPanel.tsx / settings page.tsx / section-collapse-store.ts / types scheduler+settings

### 给下一步的接力棒
- 计划 6 步已全部完成，无下一步
- 遗留限制备查（与 step5 交付口径一致）：单会话 prompt 无裁剪、保真校验只查 uuid 存在性、emit_state_increment 未注册 tool-registry、STATE_EXTRACT 未接 scheduler、ListTopics 无分页/过滤参数（组多时列表长）、manualTaskDone 事件发送方已退役但监听方仍在（manual-task-toasts，非本任务范围遗留待清）
- 验收基线：lint 0 errors / 102 warnings 存量；build:electron tsc 0 error；bun run build 通过；bun test 254 pass / 0 fail / 1 skip（存量交互 shell 跳过）
