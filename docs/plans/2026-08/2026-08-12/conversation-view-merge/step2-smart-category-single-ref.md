---
step: 2
title: 智能分类单引用 + 去标识
status: done
---

## 目标

智能分类改为单引用（一个组只在一个分类里）；删除 AppearanceBadge（⟂N 标识）；前端 deriveGroupTitle 简化。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1] 后端 deriveGroupTitle 已简化为 `(group: Group) => string`，agent-worker 和 category-tools 的调用已适配
- 当前代码状态：
  - `smart-category-store.ts` 的 `pushGroup(cat, groupId)` 是纯函数，只往单个 cat 加 groupId（不去其他分类）；`removeGroupEverywhere(idx, groupId)` 从所有分类移除
  - `category-tools.ts` SaveCategoryJoin 用 `pushGroup(cat, groupId)` 直接加入，不先移除其他分类；SaveCategoryNew 直接设 `cat.groupIds = [args.groupId]`，不先移除
  - `GroupCard.tsx` 渲染 `<AppearanceBadge count={appearanceCount} />`（约 :136），import 了 `useAppearanceCount` 和 `AppearanceBadge`
  - `conversation-list/utils.ts` 的 `useAppearanceCount(groupId)` 计算组在手动文件夹 + 智能分类中的总出现次数
  - `group-list/utils.ts` 的 `deriveGroupTitle(group, conversations)` 有动态派生逻辑（group.title 为空/新对话时用会话标题拼"等N个"）
  - `categorize-prompt.ts` 的 DEFAULT_CATEGORIZE_PROMPT 无 sentinel 机制（缺失才播种）；loadCategorizePrompt 逻辑简单

## 计划改动

- [ ] `electron/main/agents/tools/category-tools.ts`：
  - SaveCategoryJoin：在 `pushGroup(cat, args.groupId)` 之前，先 `idx = removeGroupEverywhere(idx, args.groupId)`（需要 import removeGroupEverywhere）
  - SaveCategoryNew：在 `cat.groupIds = [args.groupId]` 之前，先 `idx = removeGroupEverywhere(idx, args.groupId)`
- [ ] `electron/main/services/memory/categorize-prompt.ts`：
  - DEFAULT_CATEGORIZE_PROMPT 加单引用说明：在「决策原则」或「硬约束」部分加一条"一个组只能在一个分类里，加入新分类会自动从旧分类移除，不需要手动处理"
  - loadCategorizePrompt 加 sentinel 机制（如检测旧版不含"一个组只能在一个分类"则覆盖播种）
- [ ] `components/group-list/utils.ts`：deriveGroupTitle 签名改为 `(group: Group) => string`；逻辑：`group.title && group.title.trim() && group.title !== '新对话' ? group.title : '未命名话题'`。删除 conversations 参数和动态派生
- [ ] `components/group-list/GroupCard.tsx`：
  - 删除 `import { AppearanceBadge }` 和 `import { useAppearanceCount }`
  - 删除 `const appearanceCount = useAppearanceCount(group.id);`
  - 删除 `{!isArchived && <AppearanceBadge count={appearanceCount} />}` 渲染（约 :136）
  - deriveGroupTitle 调用从 `deriveGroupTitle(group, conversations)` 改为 `deriveGroupTitle(group)`
- [ ] 删除 `components/conversation-list/AppearanceBadge.tsx`
- [ ] `components/conversation-list/utils.ts`：删除 `useAppearanceCount` 函数及其 imports（useConversationStore nodeMap / useSmartCategoryStore categories）

## 实施回填

### 实际改动

6 条计划改动全部实施，`bun run build:electron` 编译通过，`grep AppearanceBadge|useAppearanceCount components/` 无残留。

1. **category-tools.ts** — SaveCategoryJoin/SaveCategoryNew 加入前先 `removeGroupEverywhere`，import 增加 removeGroupEverywhere
2. **categorize-prompt.ts** — 新增 `SINGLE_REF_SENTINEL`，loadCategorizePrompt 加 sentinel 检测，「硬约束」加单引用说明
3. **group-list/utils.ts** — `deriveGroupTitle(group: Group) => string`，无 title/新对话 返回 `'未命名话题'`
4. **GroupCard.tsx** — 删除 AppearanceBadge 渲染 + useAppearanceCount + 相关 import；deriveGroupTitle 去掉 conversations 参数
5. **删除 AppearanceBadge.tsx**
6. **conversation-list/utils.ts** — 删除 useAppearanceCount 函数 + useSmartCategoryStore import

### 给下一步的接力棒

- 智能分类已实现单引用语义（加入分类自动从其他分类移除）
- AppearanceBadge 组件完全删除，GroupCard 不再渲染出现次数标识
- 前后端 deriveGroupTitle 签名统一为 `(group: Group) => string`
- categorize-prompt 加了 sentinel，旧用户下次启动自动升级 prompt
