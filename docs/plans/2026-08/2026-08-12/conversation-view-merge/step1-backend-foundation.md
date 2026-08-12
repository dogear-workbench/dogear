---
step: 1
title: 后端数据层基础
status: done
---

## 目标

让 `group.updatedAt` 反映会话活动时间（新增 touchGroup）；简化 deriveGroupTitle 去掉动态派生；SaveGroupDigest 保存后同步更新 group.title。

## 依赖上下文（接力棒输入）

- 当前代码状态：
  - `group-service.ts` 无 touchGroup 函数；updateGroup 只接受 `{ title?: string }` patch，内部会设 updatedAt = Date.now()
  - `conversation-service.ts` 有 `touch(wsId, id)` 方法（约 :430），只更新 conv.updatedAt；create 方法在约 :280
  - `group-helpers.ts` deriveGroupTitle 签名 `(group: Group, conversations: ConversationIndex[]) => string`，有 title 返回 title，无则用会话标题派生
  - `group-digest-tools.ts` SaveGroupDigest 工具保存组卡到文件，不触碰 group.title
  - `group-digest-prompt.ts` 已有 SAVE_BACKGROUND_SENTINEL 机制；title 字段说明是"组的整体主题（一短句，复用现有 title 若仍准确）"

## 计划改动

- [ ] `electron/main/services/group-service.ts`：新增 `touchGroup(wsId, groupId)` — 读组、设 updatedAt = Date.now()、保存。组不存在或已归档时静默跳过（不 throw，因为这是副效果）
- [ ] `electron/main/services/conversation-service.ts`：
  - `create` 方法（约 :280）末尾，saveWorkspaceConversations 后，调 `touchGroup(wsId, groupId)`（用延迟 import 避免循环依赖）
  - `touch` 方法（约 :430）末尾，saveWorkspaceConversations 后，调 `touchGroup(wsId, conv.groupId)`
- [ ] `electron/main/services/group-helpers.ts`：deriveGroupTitle 签名改为 `(group: Group) => string`；逻辑：`group.title?.trim() ? group.title : '未命名组'`，删除会话标题派生逻辑
- [ ] `electron/main/agents/agent-worker.ts:778`：`deriveGroupTitle(g, allConvs.filter(...))` → `deriveGroupTitle(g)`
- [ ] `electron/main/agents/tools/category-tools.ts` ListCategories 内：`deriveGroupTitle(group, allConvs.filter(...))` → `deriveGroupTitle(group)`（约 :99）
- [ ] `electron/main/agents/tools/group-digest-tools.ts` SaveGroupDigest：保存组卡后、return 前，加 `await groupService.updateGroup(workspaceId, groupId, { title: args.title })`（try-catch 包裹，失败只 log warn 不影响组卡保存）。需要 import groupService
- [ ] `electron/main/services/memory/group-digest-prompt.ts`：
  - DEFAULT_GROUP_DIGEST_PROMPT 的 title 说明改为：`title：组的整体主题（一短句）。此 title 会同步为话题组的显示名称，要简短准确。复用现有 title 若仍准确`
  - 加新 sentinel（如 `'同步为话题组的显示名称'`）用于检测旧版 prompt 并覆盖播种（参考已有的 SAVE_BACKGROUND_SENTINEL 模式，在 loadGroupDigestPrompt 里检查）

## 实施回填

### 实际改动

7 条计划改动全部实施，`bun run build:electron` 编译通过，lint 无新增错误。

1. **group-service.ts** — 新增 `touchGroup(wsId, groupId)`，组不存在/已归档时静默跳过
2. **conversation-service.ts** — `create`(~:316) 和 `touch`(~:441) 方法末尾用延迟 `import('./group-service.js')` 调 `touchGroup`
3. **group-helpers.ts** — `deriveGroupTitle(group: Group) => string`，无 title 返回 `'未命名组'`；删除 ConversationIndex 导入和动态派生
4. **agent-worker.ts:778** — `deriveGroupTitle(g)`
5. **category-tools.ts:86** — `deriveGroupTitle(group)`
6. **group-digest-tools.ts** — SaveGroupDigest 保存后 try-catch 调 `updateGroup` 同步 group.title，import 增加 `updateGroup`
7. **group-digest-prompt.ts** — 新增 `TITLE_SYNC_SENTINEL`，title 说明更新，缓存检查增加 sentinel 条件

### 给下一步的接力棒

- 后端 `deriveGroupTitle` 签名已简化为 `(group: Group)`，所有后端调用点已适配
- 前端 `components/group-list/utils.ts` 有同名 `deriveGroupTitle` 函数（前端版），step2 需处理
- `touchGroup` 已就绪，会话 create/touch 时自动刷新组 updatedAt
- SaveGroupDigest 现在会同步 group.title，step2 智能分类可依赖此行为
