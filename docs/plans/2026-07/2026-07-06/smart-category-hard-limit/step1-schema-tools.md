---
step: 1
title: 后端数据模型与工具改造
status: done
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

## 实施回填

### 实际改动

- `types/smart-category.ts:19` — `CategorizeDecisionLog.decision` union 加 `'merge' | 'prune'`（保留原有 `match/join/new/skip/error`）
- `electron/main/types.ts:162` — 同步镜像
- `electron/main/services/memory/smart-category-store.ts:70-88` — 新增纯函数 `mergeCategories`
- `electron/main/agents/tools/category-tools.ts` — 全面改造：
  - `registerTools` 增加 `PruneCategoryTags` 元数据
  - `saveArgs.action` discriminatedUnion 从 2 支扩到 3 支
  - `SaveCategory` 工具体新增 `MERGE_CATEGORIES` 分支 + `JOIN_EXISTING` 加 addAnchorTags/replaceAnchorTags 互斥校验 + 合并后 >10 校验
  - 新增 `PruneCategoryTags` 工具（覆写 anchorTags）
  - 文件 284 行（未超 300）

验证：`bun run build:electron` 通过；`bun run lint` 0 errors / 83 既有 warnings（非本次引入）。

### 给下一步的接力棒（Step 2 写提示词精确引用）

**`SaveCategory.action` 三个变体（zod schema）**：

```ts
z.discriminatedUnion('type', [
  z.object({
    type: z.literal('JOIN_EXISTING'),
    categoryId: z.string(),
    addAnchorTags: z.array(z.string()).optional(),        // 与 replaceAnchorTags 互斥
    replaceAnchorTags: z.array(z.string()).max(10).optional(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal('NEW_CATEGORY'),
    name: z.string().min(1).max(20),
    anchorTags: z.array(z.string()).min(1).max(10),       // zod 已挡 >10
    redistribute: z.array(z.object({ groupId, moveToCategoryId })).optional(),
    reason: z.string().optional(),
  }),
  z.object({
    type: z.literal('MERGE_CATEGORIES'),
    fromIds: z.tuple([z.string(), z.string()]),           // 只支持两两合并
    name: z.string().min(1).max(20),
    anchorTags: z.array(z.string()).min(1).max(10),
    reason: z.string().optional(),
  }),
])
```

顶层 `saveArgs`：`{ workspaceId, groupId, action }`——`groupId` 三种 action 都必填（`MERGE_CATEGORIES` 传触发本次决策的 groupId）。

**`SaveCategory` 运行时校验（提示词要引导 agent 别撞这些）**：
- `JOIN_EXISTING`：addAnchorTags + replaceAnchorTags 同时给 → Error；addAnchorTags 合并后 >10 → Error（"该分类已达 10 tag 上限，请用 replaceAnchorTags 覆写或不加"）
- `NEW_CATEGORY`：categories.length ≥ maxCategories → Error（"必须 JOIN_EXISTING"）
- `MERGE_CATEGORIES`：fromIds 相同 / 任一不存在 → Error

**`PruneCategoryTags` 工具签名**：

```ts
tool('PruneCategoryTags',
  '覆写指定分类的 anchorTags 数组（不是增删，是整体替换）。最多 10 个。',
  z.object({
    workspaceId: z.string(),
    categoryId: z.string(),
    newAnchorTags: z.array(z.string()).min(1).max(10),
    reason: z.string().optional(),
  }))
```

**`mergeCategories` 纯函数**：`(idx, [id1, id2], name, anchorTags) → SmartCategoriesIndex`；不 mutate 入参；返回删除两个旧分类后 push 新分类的新 index，新分类 `groupIds` 是两方去重合并。不写 decision log（由调用方另调 appendDecision）。

**遗留决策（Step 3/4 注意）**：
- `PruneCategoryTags` 的 `appendDecision` 用 `groupId: ''` 占位（Prune 不对应具体组），UI 展示 recentDecisions 时空 groupId 要专门处理
- `MERGE_CATEGORIES` 复用 `args.groupId`（触发本次决策的组）
