---
step: 6
title: 智能分组下线与跨话题检索
status: pending
---

## 目标
砍 categorize/categorize_organize 与 smart-category 全链（输入本已依赖 digest.md，Step 5 后断粮）；新增零模型 dogear__ListTopics 工具补跨话题检索空缺。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step5-remove-legacy.md] group-digest-store 已删（共享函数已迁移）；digest 工具组已删
- 当前关键文件状态：scheduler `types.ts` BuiltinTaskId 含 categorize/categorize_organize；`builtin-task-meta.ts` categorize 条目工具为 ListCategories/SaveCategoryJoin/SaveCategoryNew/SaveCategoryMerge；memory 目录 category-trigger.ts（sweep 读 digest.md，`:305-349`）/ smart-category-engine.ts / smart-category-store.ts / categorize-prompt.ts；前端 components/conversation-list/SmartSection.tsx、app/data-center/smart-category-panel.tsx、stores/smart-category-store.ts
- 关键决策回顾：分类层无受众（检索已 agent 化）直接砍不改；categories.json 保留；ListTopics 零模型纯本地 IO；agent 动线 = ListTopics → ReadGroupBackground → ReadReferenceSession

## 计划改动
- [ ] scheduler：BuiltinTaskId 删 categorize/categorize_organize；builtin-task-meta/plan-runner/task-executor 对应条目与 case 删除；plan-store 既有 plan 项过滤
- [ ] 删除文件：category-trigger.ts / smart-category-engine.ts / smart-category-store.ts（memory 侧）/ categorize-prompt.ts；categorize 工具注册（ListCategories/SaveCategory*）——先全仓 grep 引用确认（dashboard-watcher / category-trigger 手动触发链等）
- [ ] 前端：删 SmartSection.tsx 及会话列表分类视图接入（回归话题平铺）；删 app/data-center/smart-category-panel.tsx 与 page.tsx 引用；删 stores/smart-category-store.ts
- [ ] 新增 `reference-tools.ts` dogear__ListTopics：遍历 groups.json → 每组读状态卡 topic 一句话（无卡回退组标题）+ updatedAt + 主会话数 + 是否归档；返回紧凑列表；末尾 registerTools() 注册元数据
- [ ] 全仓 grep categorize / smart-category / SmartSection 残留清理；`bun run lint` + `bun run build:electron` 过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
