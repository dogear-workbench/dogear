# 智能分类硬上限与整理机制 实施计划

**目标**：把智能分类系统的失控标签压回 10 分类 × 10 标签的硬上限，撞上限时触发整理而非硬塞。

**架构思路**：
- 提炼源头对齐（新组卡打 tag 时看得见分类词汇）+ 落库硬约束（`SaveCategory` 校验 ≤10）+ 撞上限触发 MERGE（不是硬 JOIN）
- 存量走独立的一键整理任务，跟 per-group 触发链路隔离，避免混乱
- 老组归属漂移问题不在本阶段解决，交给阶段 2 归档机制根治

**设计文档**：[smart-category-hard-limit-design.md](../smart-category-hard-limit-design.md)（详细的背景、决策记录、阶段 2 骨架）

**涉及模块**：
- `electron/main/agents/tools/category-tools.ts` — SaveCategory 扩展 + PruneCategoryTags 新增
- `electron/main/services/memory/smart-category-store.ts` — mergeCategories 纯函数
- `electron/main/services/memory/categorize-prompt.md` — 决策流程重写
- `electron/main/services/memory/group-digest-prompt.md` — 加分类词汇对齐段
- `electron/main/services/memory/category-organize-trigger.ts` — 新增存量清理编排
- `electron/main/agents/agent-worker.ts` — 提炼上下文注入 + handleCategorizeOrganizeTask
- `electron/main/agents/task-types.ts` — 加 CATEGORIZE_ORGANIZE
- `electron/main/tipc/category.ts` — 新增 3 个 IPC（触发/取消/活动）
- `app/settings/memory/SmartCategoryPanel.tsx` — 按钮 + 活动状态
- `stores/smart-category-store.ts` — 对应 actions
- `types/smart-category.ts` — CategorizeDecisionLog.decision 加 merge/prune

## 步骤索引

- [x] [Step 1: 后端数据模型与工具改造](./step1-schema-tools.md) — SaveCategory 扩展 + PruneCategoryTags + 硬上限校验
- [x] [Step 2: 提示词与提炼源头对齐](./step2-prompts.md) — categorize-prompt 决策流程 + group-digest-prompt 加分类词汇上下文
- [x] [Step 3: 存量清理任务链路 + UI](./step3-organize.md) — 新任务类型 + trigger + IPC + 按钮
- [ ] [Step 4: 联调 + 手测 + 文档同步](./step4-verify-docsync.md) — 端到端跑通 + doc-sync

## 全局决策

**硬约束（工具层强校验，不靠提示词自觉）**：
- 单分类 `anchorTags.length ≤ 10`
- 总分类数 `categories.length ≤ maxCategories`（默认 10，settings 可配）

**recentDecisions.decision 新增值**：
- `match` / `join` / `new`（现有）
- `merge`（MERGE_CATEGORIES 时写）
- `prune`（PruneCategoryTags 时写）

**MERGE_CATEGORIES 语义**：
- 输入：`fromIds: [id1, id2]` + 新分类的 `name` + `anchorTags`（≤10）
- 落库：删除两个旧分类，创建新分类，`groupIds` 去重合并
- 独立成一次 SaveCategory 调用；如果同轮还要 NEW_CATEGORY，再调一次

**存量清理（CATEGORIZE_ORGANIZE）与 per-group（CATEGORIZE_SESSION）互斥**：
- 同一编排器（category-trigger 已有）内加互斥标志，任一方跑时另一方入队等待

**提炼上下文注入格式**：
```
当前工作区分类词汇表（打 tag 时优先从中选择，实在没合适才自造）：
- 智能分类: [smart-category, quality-review, ...]
- 首页重构: [Dashboard组件, 双层模型, ...]
```
每分类一行，若无分类（冷启动）就不注入此段。

**破坏性变更允许**：本次不留兼容层。settings/数据文件字段直接扩展。旧组卡的 tag 保留不动，新入卡走新逻辑。

**验证策略**：每 step 结束跑 `bun run build:electron && bun run lint`。Step 3 和 Step 4 还要手动跑真实数据。项目不写单测（用户偏好）。
