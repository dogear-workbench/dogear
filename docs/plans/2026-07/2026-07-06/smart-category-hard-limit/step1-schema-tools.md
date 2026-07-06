---
step: 1
title: 后端数据模型与工具改造
status: pending
---

## 目标

把 `SaveCategory` 扩展到支持 MERGE_CATEGORIES 和 replaceAnchorTags；新增 PruneCategoryTags 工具；工具层强校验 anchorTags ≤10；CategorizeDecisionLog 支持 merge/prune 决策类型。

## 依赖上下文

无前置 step。

**当前关键文件状态**：
- `electron/main/agents/tools/category-tools.ts` — 现有 SaveCategory 的 action 是 `discriminatedUnion(['JOIN_EXISTING', 'NEW_CATEGORY'])`；落库 anchorTags 用 `[...new Set([...cat.anchorTags, ...addTags])]` 只去重不设限
- `electron/main/services/memory/smart-category-store.ts` — 已有 `pushGroup / removeGroupEverywhere / appendDecision / newCategory` 纯函数
- `types/smart-category.ts` — `CategorizeDecisionLog.decision` 是 `'match' | 'join' | 'new'`；主进程镜像在 `electron/main/types.ts`
- `types/settings.ts:92` + `electron/main/services/settings-types.ts:76` — smartCategory 配置块

**关键决策回顾**：
- 硬上限 10 是工具层强校验，不依赖提示词自觉
- MERGE 用 `fromIds: [id1, id2]` 只支持两两合并（避免一次合并 3+ 个复杂化决策）
- PruneCategoryTags 是"覆写整个数组"语义，不是"增删"（一次到位）

## 计划改动

### 类型扩展
- [ ] `types/smart-category.ts` — `CategorizeDecisionLog.decision` union 加 `'merge' | 'prune'`
- [ ] `electron/main/types.ts` — 同步镜像

### 纯函数增强
- [ ] `electron/main/services/memory/smart-category-store.ts` — 新增 `mergeCategories(idx, fromIds: [string, string], name: string, anchorTags: string[]): SmartCategoriesIndex`
  - 删除 fromIds 两个分类，创建新分类
  - `groupIds` 用 `[...new Set([...cat1.groupIds, ...cat2.groupIds])]` 去重合并
  - 返回新 index（不 mutate）
  - fromIds 中任一不存在 → throw Error（由工具层捕获）

### 工具改造（category-tools.ts）
- [ ] SaveCategory action union 加第三个变体：
  ```
  z.object({
    type: z.literal('MERGE_CATEGORIES'),
    fromIds: z.tuple([z.string(), z.string()]),
    name: z.string().min(1).max(20),
    anchorTags: z.array(z.string()).min(1).max(10),
    reason: z.string().optional(),
  })
  ```
- [ ] JOIN_EXISTING 加可选参数 `replaceAnchorTags?: string[]`（若给了就整体覆写；跟 addAnchorTags 互斥）
- [ ] JOIN_EXISTING 落库校验：合并后 anchorTags 若 >10 → 返回 Error 让 agent 重决策（提示"该分类已达 10 tag 上限，请用 replaceAnchorTags 覆写或不加"）
- [ ] NEW_CATEGORY 校验 anchorTags.length ≤ 10（超了返 Error）
- [ ] MERGE_CATEGORIES 落库：调 mergeCategories 纯函数 + appendDecision（decision='merge'）
- [ ] appendDecision 调用点全部改成用新的 decision 类型（match/join/new/merge/prune）

### 新增工具 PruneCategoryTags
- [ ] category-tools.ts 里新增：
  ```
  tool('PruneCategoryTags',
    '覆写指定分类的 anchorTags 数组（不是增删，是整体替换）。最多 10 个。',
    z.object({
      workspaceId: z.string(),
      categoryId: z.string(),
      newAnchorTags: z.array(z.string()).min(1).max(10),
      reason: z.string().optional(),
    }).shape,
    async (args) => { ... })
  ```
- [ ] 落库同时 appendDecision（decision='prune'）；categoryId 不存在 → Error
- [ ] `registerTools([...])` 加 PruneCategoryTags 元数据

### 验证
- [ ] `bun run build:electron`
- [ ] `bun run lint`
- [ ] 检查 category-tools.ts 单文件 <300 行；若超需拆（低概率）

## 实施回填（做完后填）

### 实际改动
（TBD）

### 给下一步的接力棒
（TBD — 至少要写：新 action 类型的具体 schema、PruneCategoryTags 的完整签名、mergeCategories 的返回结构，让 Step 2 写提示词时能精确引用工具名和参数）
