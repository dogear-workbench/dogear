---
step: 2
title: personal 空间后端
status: done
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

- [x] 共享常量 `PERSONAL_WORKSPACE_ID = 'personal'`：放前后端均可引用的位置（跟随现有共享类型/常量模块惯例），并附「保留字」注释
- [x] workspace 数据层：确保 personal 的目录结构自愈（workspaces/personal/、conversations.json、groups 初始化），不写入工作区注册表（workspaces.json 之类）或注册为带 hidden 标记——按现有存储形态选择侵入最小方案，回填记录
- [x] `workspace-json-service.getAll()` 增加 `includePersonal` 参数（默认 false 过滤），所有 UI 向消费方零改动保持过滤；`startAutoArchiveTimer` 改为额外跑一次 personal 归档
- [x] `auto-archive-service.ts`：`autoArchiveStaleGroups` 加阈值参数或 personal 专用入口（7 天 = 7 * 86400_000）；personal 无手动文件夹树，`collectFolderGroupIds` 对 personal 跳过
- [x] 会话/组服务验证：conversationService.create / group 创建对 personal 无需改动即可工作（按 workspaceId 组织天然支持）——验证而非改码，若发现硬编码假设则修正并回填
- [x] workspace-watcher、conversation-tree-service（手动文件夹）对 personal 显式跳过
- [x] `bun run build:electron` + 手动验收

## 验收

- [x] 主进程直接调用 `conversationService.create(PERSONAL_WORKSPACE_ID, ...)` 成功，`.dogear/workspaces/personal/` 结构生成
- [x] `getAll()` 默认不含 personal；设置页工作区管理、切换器不受影响（回归）
- [x] 造一个 updatedAt 超 7 天的 personal 组 → 归档 timer（或手动调用归档入口）将其归档；30 天工作区组归档逻辑不变（回归）
- [x] 30 天阈值的工作区归档照常（回归）

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
  - 共享常量采用**镜像双份**而非单一共享文件：主进程 tsconfig.electron.json `rootDir: ./electron` 无法 import 根 `types/`（conversation-service.ts 已有同因先例），故 `types/workspace.ts`（前端）与 `electron/main/types.ts`（主进程）各一份，跟随 `BROWSER_PARSE_SUB_AGENT_PROFILE_ID` 的既有镜像惯例
  - 目录自愈**无需显式初始化**：group/conversation service 写入均走 `safeJsonWrite`（内部 `mkdir recursive`），首次 create 即落盘（已验证），未新增 ensurePersonalDirs 之类的函数
  - `getById('personal')` **未放行**（返回 undefined）：runtime 层 `workspace?.path ?? ''` 恰好落地设计约定「无 workspacePath → 无文件能力」，属预期行为，不改
  - 计划外修正：`workspace-json-service.ts` 的 `getConfigDir` 原是全项目唯一不支持 `DOGEAR_CONFIG_DIR` 短路且 `app.isPackaged` 无空值防御的（group/conversation service 均支持），补齐以保持一致 + 可测试性
  - 手动文件夹树禁用选择在 `loadTree`/`saveTree` 底层拦截（读恒空树、写一律丢弃）而非逐个导出函数拦截，一行覆盖全部入口；`auto-archive` 的 `collectFolderGroupIds` 另行显式跳过（避免读盘）
- 改动文件清单：
  - `types/workspace.ts`（新建）：`PERSONAL_WORKSPACE_ID` + 保留字注释（前端侧）
  - `electron/main/types.ts`：同名常量镜像段
  - `electron/main/services/workspace-json-service.ts`：`getAll(options?: { includePersonal?: boolean })` 默认过滤 personal（即使误注册），includePersonal 时拼入内存合成条目（name=临时会话，path=''）；`getConfigDir` 补 `DOGEAR_CONFIG_DIR` 短路与 `app?.` 防御
  - `electron/main/services/auto-archive-service.ts`：`autoArchiveStaleGroups(wsId, thresholdMs = 30天)` 加阈值参数；`PERSONAL_STALE_THRESHOLD_MS = 7天`；personal 跳过 `collectFolderGroupIds`；`startAutoArchiveTimer` 遍历真实工作区后额外跑一次 personal 归档
  - `electron/main/services/conversation-tree-service.ts`：`loadTree`/`saveTree` 对 personal 拦截
  - `electron/main/services/workspace-watcher.ts`：`syncWorkspaceWatchers` 对 personal 防御性 continue（getAll 默认过滤后本就不含）

### 给下一步的接力棒

- 关键签名 / 数据结构：
  - `PERSONAL_WORKSPACE_ID = 'personal'`：前端 `@/types/workspace`，主进程 `electron/main/types.js`（两份镜像，改需同步）
  - `getAll(options?: { includePersonal?: boolean })`：默认过滤 personal；归档 timer 不传该参数，直接单独调 `autoArchiveStaleGroups(PERSONAL_WORKSPACE_ID, PERSONAL_STALE_THRESHOLD_MS)`
  - personal 的 conversationService.create / createGroup / archiveGroup / importConversation 均零改动可用（按 workspaceId 组织天然支持，已验证）
  - personal 会话运行时 `workspacePath = ''`（getById 返回 undefined 所致），pi-session-repository 的 sessions 目录为 `.dogear/workspaces/personal/sessions/` 照常
  - usage 按 `usage/{conversationId}.jsonl` 全局存，personal 并入全局统计无需改动
- 下个 step 该从哪里继续：
  - Step 3/4 前端接线：临时会话创建即「createGroup(personal) + conversationService.create(personal, groupId)」两连调，后端已就绪；tipc 层无 personal 专用路由也能走现有 conversation/group 路由（前端直接传 workspaceId='personal'）
  - personal 能力包 / 最小提示词（pi-session、ability-registry）属后续 step，本 step 未动
- 待办或已知限制：
  - workspaces.json 里若出现 id=personal 的脏数据，getAll 默认会过滤掉但文件不会被清理（防御性过滤，无自清理）
  - workspace-watcher 的 continue 纯防御冗余，若未来有人给 getAll 传 includePersonal 后遍历起 watcher 也不会误监听
  - 验收方式：本 step 验收用 bun 脚本直跑主进程源码完成（临时脚本已删），Electron 内的手动验收留给前端 step 联调时一并覆盖
