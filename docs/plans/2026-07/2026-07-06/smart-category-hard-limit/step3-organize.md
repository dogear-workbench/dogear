---
step: 3
title: 存量清理任务链路 + UI
status: done
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

## 实施回填

### 实际改动

**类型层**：
- `types/smart-category.ts:29-53` + `electron/main/types.ts:171-197` — `CategorizeRecentEntry.kind`/`CategorizeActivity.current.kind` 加 `'organize'`；`CategorizeRecentEntry.outcome` 加 `'done'`

**任务定义**：
- `electron/main/agents/task-types.ts` — `TaskType.CATEGORIZE_ORGANIZE = 'categorize_organize'` + `CategorizeOrganizeSessionPayload { workspaceId, modelSelection? }`

**编排器**（未拆独立文件，扩展现 232 行文件）：
- `electron/main/services/memory/category-trigger.ts`：`CategorizeJob` union 加 `organize` 分支；`classifyCategorizeOutcome` 新增 `isOrganize` 参数（organize 直接返 `done`）；`runOne` 按 kind 分派 payload / TaskType；broadcast 条件扩到 `match/join/new/done`；新增导出 `triggerCategorizeOrganize` / `cancelCategorizeOrganize`（**只在 `current?.kind === 'organize'` 时才真正 cancel**，避免误杀 per-group）

**新增提示词模块**：
- `electron/main/services/memory/organize-prompt.ts`（新文件 74 行）— 沿用 categorize-prompt 模式：`DEFAULT_ORGANIZE_PROMPT` + `loadOrganizePrompt` / `saveOrganizePrompt`，种子落 `<configDir>/organize-prompt.md`

**Worker Handler**：
- `electron/main/agents/agent-worker.ts:151-157` — switch 加 CATEGORIZE_ORGANIZE 分派
- `electron/main/agents/agent-worker.ts:1153-1257` — 新 `handleCategorizeOrganizeTask`：三级 fallback 走 `resolveModelSelection`；`loadOrganizePrompt` + 字符串拼接注入 workspaceId / 分类数（不碰 systemPrompt）；allowedTools = `[ListCategories, PruneCategoryTags, SaveCategory]`（server 名 `dogear-smart-category`）；query 接 `this.currentAbortController`；haiku 不传 effort；结束后重读 `readCategoryIndex` 用头插法 `recentDecisions` + `startedAt` 分界统计 `{prune, merge}`；不自己 broadcast（由 category-trigger 统一）

**IPC**：
- `electron/main/tipc/category.ts` — 新增 4 个 RPC：`triggerCategorizeOrganize` / `cancelCategorizeOrganize` / `getOrganizePrompt` / `setOrganizePrompt`（`getCategorizeActivity` 复用，未新建 organize 专用版本）

**前端**：
- `stores/smart-category-store.ts` — 加 `triggerOrganize(workspaceId)` / `cancelOrganize()` actions
- `app/settings/memory/SmartCategoryPanel.tsx` — 新增 `Wand2` 图标 + `handleOrganize` 走 `useConfirmStore.confirm()` 二次确认；按钮紧跟"立即重跑全部分类"（中间竖分割线）；活动状态里 `kind==='organize'` 显示"正在整理现有标签…"；停止按钮按 kind 分流；recent 列表 `kind==='organize'` 显示"批量整理"+ prune/merge 计数；outcome `'done'` 显示 ✅

验证：`bun run build:electron` 通过；`bun run lint` 0 errors / 83 既有 warnings。

### 给 Step 4 的接力棒（联调 + 手测）

**手测清单**（子会话已列，主会话 Step 4 执行）：
1. 打开设置页 → 会话摘要 Tab → 智能分类面板；确认"一键整理现有标签"按钮在"立即重跑全部分类"右侧、中间有竖分割线
2. 点击按钮 → 应弹出 confirm-store 弹窗（非浏览器 confirm）；取消 → 无请求；开始整理 → 触发任务
3. 运行期间：活动状态显示"正在整理现有标签…" + 停止按钮；如果此时有 per-group 会进入队列等待（queueDepth 增）
4. 完成后：查 `<workspace>/.dogear/workspaces/<wsId>/smart-categories.json`——所有 `anchorTags.length <= 10`；`recentDecisions` 里有 `decision: 'prune'` / `'merge'` 条目（`groupId` 为空串是预期）；语义重合分类是否真的合并（旧两个 id 消失、新分类 groupIds 是两者去重合并）
5. 点停止验证：活动状态回空闲，recent 出现 `outcome: 'cancelled'` 的批量整理条目；已落库的部分保留（agent 是逐工具落库的，中断只停后续调用）

**未评估项**（Step 4 用真实数据观察）：
- CATEGORIZE_ORGANIZE 的合并候选识别质量
- anchorTags 压缩后 Step A `matchByThreshold` 命中率是否提升
- organize prompt 是否需要迭代（比如过度合并 / 保守不合并）

**Step 4 手测前注意**：Step 2 已删本地 `.dogear/categorize-prompt.md` + `.dogear/group-digest-prompt.md`，本步骤新增的 `.dogear/organize-prompt.md` 首次跑时会自动播种，不需要手动删
