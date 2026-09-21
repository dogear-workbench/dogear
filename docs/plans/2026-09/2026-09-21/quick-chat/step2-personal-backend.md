---
step: 2
title: personal 空间后端
status: pending
---

## 目标

`personal` 成为可承载会话的隐藏工作区：常量共享、目录自愈、工作区列表全面过滤、归档走 7 天阈值、单会话组约定落地。

## 依赖上下文（接力棒输入）

- 前置 step 产出：Step 1 registry 已有 `quick-chat-new` 条目（本 step 不接线，仅并存）
- 关键现状签名：
  - 工作区列表来源：`electron/main/services/workspace-json-service.ts` 的 `getAll()`（auto-archive-service.ts:38 也在用）
  - 归档：`auto-archive-service.ts` `autoArchiveStaleGroups(wsId)` 按**组**过滤 `STALE_THRESHOLD_MS = 30 天`（:4），`startAutoArchiveTimer()` 遍历 getAll()
  - 组：`group-service.ts` 的 groups 存 `.dogear/workspaces/{wsId}/groups/{wsId}.json`，`archiveGroup(wsId, groupId)`
  - 索引：`conversation-service.ts` `create(workspaceId, groupId, title, modelSel, ...)`、`importConversation(targetWorkspaceId, conv)`（:628，仅索引层，不搬 session 文件）
  - 会话数据目录：`getWorkspaceDataDir(workspaceId)`（conversation-service.ts:139 附近引用）
- 关键决策回顾：personal 每会话建隐式单会话组（后端复用组/归档，前端平铺）；`getAll()` 的消费方分两类——需要看见 personal 的（归档 timer）与不能看见的（切换器/设置页工作区管理）

## 计划改动

- [ ] 共享常量 `PERSONAL_WORKSPACE_ID = 'personal'`：放前后端均可引用的位置（跟随现有共享类型/常量模块惯例），并附「保留字」注释
- [ ] workspace 数据层：确保 personal 的目录结构自愈（workspaces/personal/、conversations.json、groups 初始化），不写入工作区注册表（workspaces.json 之类）或注册为带 hidden 标记——按现有存储形态选择侵入最小方案，回填记录
- [ ] `workspace-json-service.getAll()` 增加 `includePersonal` 参数（默认 false 过滤），所有 UI 向消费方零改动保持过滤；`startAutoArchiveTimer` 改为额外跑一次 personal 归档
- [ ] `auto-archive-service.ts`：`autoArchiveStaleGroups` 加阈值参数或 personal 专用入口（7 天 = 7 * 86400_000）；personal 无手动文件夹树，`collectFolderGroupIds` 对 personal 跳过
- [ ] 会话/组服务验证：conversationService.create / group 创建对 personal 无需改动即可工作（按 workspaceId 组织天然支持）——验证而非改码，若发现硬编码假设则修正并回填
- [ ] workspace-watcher、conversation-tree-service（手动文件夹）对 personal 显式跳过
- [ ] `bun run build:electron` + 手动验收

## 验收

- [ ] 主进程直接调用 `conversationService.create(PERSONAL_WORKSPACE_ID, ...)` 成功，`.dogear/workspaces/personal/` 结构生成
- [ ] `getAll()` 默认不含 personal；设置页工作区管理、切换器不受影响（回归）
- [ ] 造一个 updatedAt 超 7 天的 personal 组 → 归档 timer（或手动调用归档入口）将其归档；30 天工作区组归档逻辑不变（回归）
- [ ] 30 天阈值的工作区归档照常（回归）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
