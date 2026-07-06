---
step: 3
title: 存量清理任务链路 + UI
status: pending
---

## 目标

新增 CATEGORIZE_ORGANIZE 任务类型，从设置页按钮触发一次跑完所有分类的存量清理（压 anchorTags + 识别可 MERGE 的语义重合分类），全流程活动状态可见、可停止。

## 依赖上下文

**前置 step 产出**：
- Step 1：PruneCategoryTags 工具已就绪；SaveCategory 支持 MERGE_CATEGORIES
- Step 2：categorize-prompt 已经改造完新决策流程（organize 任务复用大部分决策原则）

**当前关键文件状态**：
- `electron/main/services/memory/category-trigger.ts` — 现有 per-group 的串行队列 + 活动采集实现（本 step 参照它写 organize-trigger）
- `electron/main/agents/task-types.ts` — 现有 SUMMARIZE / CHAT_SESSION / PARSE_ARTICLE / GROUP_DIGEST_SESSION / REVIEW_SESSION / CATEGORIZE_SESSION
- `electron/main/agents/agent-worker.ts` — `handleCategorizeSessionTask` 是最相近的参照
- `electron/main/tipc/category.ts` — 现有 IPC 见 CLAUDE.md 记录（getCategories/triggerCategorize/triggerFullRebuild/cancelCategorize 等）
- `app/settings/memory/SmartCategoryPanel.tsx` — 已经有"立即重跑全部分类"按钮的实现可参照
- `stores/smart-category-store.ts` — 已经有 activity 轮询和 triggerFullRebuild 的模式可参照

**关键决策回顾**：
- CATEGORIZE_ORGANIZE 与 CATEGORIZE_SESSION 互斥（同队列）；不新建独立队列
- 存量清理时 agent 可以主动 MERGE 语义重合分类（用户明确选择）
- 单次跑完不迭代；有 bug 用户可再点

## 计划改动

### 任务类型扩展
- [ ] `electron/main/agents/task-types.ts` — 加 `CATEGORIZE_ORGANIZE` 类型 + `CategorizeOrganizeSessionPayload { workspaceId, modelSelection? }`

### 编排器新增（复用现有 category-trigger 的队列）
- [ ] `electron/main/services/memory/category-trigger.ts` — 扩展：
  - 加 `triggerCategorizeOrganize(workspaceId)` — 入队 CATEGORIZE_ORGANIZE 任务
  - 加 `getCategorizeOrganizeActivity()` — 返回 current/queueDepth/进度（当前处理到哪个分类）
  - 加 `cancelCategorizeOrganize()` — 取消当前 organize
  - 与 per-group triggerCategorize 共享队列（并发 1，天然互斥）
  - 活动状态里区分 kind: 'per-group' | 'organize'（前端根据 kind 决定 UI 展示）
- [ ] 若上面扩展让文件超 300 行，独立成 `category-organize-trigger.ts`（但共享 category-trigger 的队列变量，需要导出/合并）

### Agent Worker Handler
- [ ] `electron/main/agents/agent-worker.ts` — 新增 `handleCategorizeOrganizeTask(payload)`：
  - 复用 resolveModelSelection（三级 fallback: payload.modelSelection ?? settings.categorizeModelSelection ?? settings.defaultModelSelection）
  - 拉 ListCategories 全集（含 anchorTags + 样例组标题）
  - 独立的 organize prompt（不复用 categorize-prompt，因为流程完全不同——不是"给新组卡分类"，是"整理现有分类"）
  - 提示词内容参考：
    - 目标：把每分类 anchorTags 压到 ≤10；发现语义高度重合的分类对就 MERGE
    - 工具：ListCategories / PruneCategoryTags / SaveCategory（MERGE_CATEGORIES 用途）
    - 流程：逐分类看 anchorTags → 判断合并同义词/删噪音 → PruneCategoryTags 覆写；顺带看有没有 MERGE 机会
  - 循环上限：agent 自主终止（不设硬循环上限，靠 AbortController）
- [ ] Organize 提示词是新文件：`electron/main/services/memory/organize-prompt.md`（沿用 categorize-prompt 的加载器模式，用 loadOrganizePrompt / saveOrganizePrompt 播种到 configDir）
- [ ] 完成后 broadcast `categoriesUpdated` 事件（同 categorize-trigger）

### IPC 层
- [ ] `electron/main/tipc/category.ts` — 加 3 个 RPC：
  - `triggerCategorizeOrganize({ workspaceId })`
  - `cancelCategorizeOrganize()`
  - `getCategorizeOrganizeActivity()` — 复用 `getCategorizeActivity` 或独立返回（推荐复用，前端通过 kind 字段区分）
- [ ] 提示词 IPC 也加：`getOrganizePrompt / setOrganizePrompt`（如果设置页要暴露编辑）

### 前端 UI
- [ ] `stores/smart-category-store.ts` — 加：
  - `triggerOrganize()` action
  - `cancelOrganize()` action
  - activity 已存在则复用（增加 kind 字段的处理）
- [ ] `app/settings/memory/SmartCategoryPanel.tsx` — 加：
  - "一键整理现有标签"按钮（confirm-store 二次确认，警告"会覆写现有标签结构，跑期间禁止新入卡"）
  - 活动状态展示当前处理到哪个分类（如 "整理中: 智能分类 71 → 10"）
  - 停止按钮
  - 位置：跟"立即重跑全部分类"按钮并列，加个分割线

### 验证
- [ ] `bun run build:electron`
- [ ] `bun run lint`
- [ ] `bun run dev` 启动应用
- [ ] 手动跑一次真实存量清理：
  - 点按钮 → 二次确认 → 观察活动状态
  - 跑完后打开 smart-categories.json 看：智能分类的 71 tag 应压到 ≤10；会话组的 58 tag 应压到 ≤10
  - 是否有 MERGE 决策？（比如"提炼功能"和"首页重构"可能被合并）
  - 检查 recentDecisions 里是否有 prune/merge 记录
- [ ] 手动停止一次，验证队列清干净

## 实施回填（做完后填）

### 实际改动
（TBD）

### 给下一步的接力棒
（TBD — 至少要写：清理后 smart-categories.json 的实际结构、有哪些分类被合并了、matchByThreshold 命中率变化的初步观察）
