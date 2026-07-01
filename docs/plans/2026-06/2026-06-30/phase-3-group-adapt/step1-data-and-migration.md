---
step: 1
title: 数据层 + 启动幂等迁移
status: done
---

## 目标

落地组卡数据层（store / scanner / prompt），写好启动迁移把旧 `<sessionId>.md` 重命名升级为 `<groupId>.md`。**不接触触发链与 UI**。Step 1 完成后旧触发器暂时停摆（不再产生新卡），但数据已就位等 Step 2 接入新触发链。

## 依赖上下文（接力棒输入）

- 设计文档：[../phase-3-group-adapt-design.md](../phase-3-group-adapt-design.md) §架构 / §数据流 / §模块边界
- 现状关键事实：
  - 旧 fragment 路径 `<configDir>/workspaces/<wsId>/digests/<sessionId>.md`（`digest-store.ts:30-35`）
  - 旧 DigestCard schema：`{ sessionId, conversationId?, title, createdAt, sourceMtime, turnCount, summary, items[], tags? }`，`items[]: { kind, text, uuid }`
  - `SmartCategoriesIndex.categories[].conversationIds[]` 装 conversation 主键，定义 `types/smart-category.ts:7-14`
  - `conversation-tree-service.ts:31-37` `children[folderId]` 装 conversationId
  - `conversation-service.ts:36` 已有 `groupId?: string` 字段；`conversation-service.ts:697-715` `migrateOrphanConversations` 已把旧 conv 1:1 迁成单会话组——所以本 step 迁移时几乎所有 group 内只有 1 个 main 会话
  - `group-service.ts` 已有 listGroups/getGroup/createGroup
- 全局决策见 plan.md「全局决策」节

## 计划改动

### 新增文件

- [ ] `electron/main/services/memory/group-digest-store.ts`
  - 类型：`GroupDigestCard`（schema 见 plan.md）
  - 路径：`getGroupDigestPath(configDir, wsId, groupId)` → `<configDir>/workspaces/<wsId>/digests/<groupId>.md`
  - 函数：`saveGroupDigest / readGroupDigest / listGroupDigests / deleteGroupDigest`
  - `serializeGroupDigest / parseGroupDigest` 纯函数（frontmatter + markdown，与旧 digest-store 同模式）
  - listGroupDigests 跳过 `_cleaned/` 和 `_archive/` 子目录
  - `saveGroupDigest` 支持 `mergeSourcesSeen(existing, dirtyConversations)` 工具函数：把 dirtyConversations 的新 mtime 合并进现有 sourcesSeen（按 sessionId 覆盖），缺失的 sessionId 移除

- [ ] `electron/main/services/memory/group-digest-scanner.ts`
  - `isGroupDirty(groupCard | null, currentMainConvs: Array<{sessionId, mtime}>): boolean` 纯函数（规则见 plan.md「脏判定」）
  - `findDirtyConversationsInGroup(groupCard | null, currentMainConvs): Array<{sessionId, mtime}>`
    - 无 groupCard → 返回所有 currentMainConvs
    - 否则返回 mtime > sourcesSeen 中记录的 mtime 的 + 不在 sourcesSeen 的
  - `findDirtyGroups(workspaceId, workspacePath, configDir)`：
    - 列工作区所有 group
    - 对每个 group：拿其 main 会话（过滤 role='sub'）→ stat JSONL → 与组卡比对 isGroupDirty
    - 返回 dirty groups

- [ ] `electron/main/services/memory/group-digest-prompt.ts`
  - `DEFAULT_GROUP_DIGEST_PROMPT` 模板（要点：「已有组卡作为基础」「dirty 会话 transcript 是新输入」「优先利用 _notes/」「items.sources 要带 sessionId+uuid」「不要复述共享文件正文」）
  - `loadGroupDigestPrompt()` 首次缺失自动播种到 `<configDir>/group-digest-prompt.md`
  - `saveGroupDigestPrompt(content)`

- [ ] `electron/main/services/memory/migration-p3.ts`
  - 入口 `runMigrationP3()` 幂等执行：
    1. 扫所有工作区 `digests/` 目录
    2. 对每个旧 `<sessionId>.md`：
       - 定位 conversation：用 `getByIdGlobal` 之类反查 sessionId 对应 conversationId+groupId
       - 若 conversation 存在且 `role === 'main'` 且 `<groupId>.md` 不存在 且 该 group 内只有 1 个 main 会话：
         - 读旧卡 → 改 schema：补 `groupId / updatedAt=createdAt / sourcesSeen=[{sessionId, conversationId, mtime: sourceMtime}] / items[].sources=[{sessionId, uuid}]` 包装
         - 写新 `<groupId>.md`
         - 旧 `<sessionId>.md` 移到 `digests/_archive/<sessionId>.md`（备查；下次启动检测 archive 已存在则不再处理）
       - 若 group 内有多 main 会话 或 `<groupId>.md` 已存在：
         - 旧卡移到 `_archive/`（不参与组卡；下次自然 dirty trigger 时 agent 重建）
       - 若找不到 conversation 或是 sub：
         - 移到 `_archive/_orphan/`
    3. 删除旧 `digests/_cleaned/` 之外的散落 session 卡
    4. `smart-categories.json` 升级：
       - `categories[].conversationIds[]` 中每个 convId 替换为 `conversation.groupId`，去重，找不到的剔除
       - 字段重命名为 `groupIds`（用 `as any` 或先读后重写 JSON）
       - 加 `schemaVersion: 2` 标记，幂等检测
    5. `conversation-tree.json` 升级：
       - `children[].conversationId` → `groupId`（按 conversation.groupId 映射，去重）
       - migrateRootScatter 类逻辑清理散落
       - 加 `schemaVersion: 2` 标记
  - 全部包 try/catch，单工作区失败不阻其他

### 修改文件

- [ ] `types/smart-category.ts` + `electron/main/types.ts`（镜像）
  - `SmartCategory.conversationIds` → `groupIds`
  - `CategorizeDecisionLog.conversationId` → `groupId`（旧字段保留展示历史，新字段写）

- [ ] `electron/main/index.ts`
  - 在 `migrateOrphanConversations` 调用之后追加 `runMigrationP3()`
  - 失败仅日志告警，不阻断启动

### 临时停摆（不删除，Step 2 再删）

- [ ] `electron/main/services/memory/digest-trigger.ts` 的 `triggerScanAll / triggerScanByConversation` 改成空函数（保留导出但 no-op）
- [ ] `tipc/agent.ts:139-150` 调用 triggerScanByConversation 的位置先注释/no-op
- [ ] `electron/main/index.ts` 启动扫 / 夜间03 钩子里调用 digest-trigger 的位置先注释（确保不再产生新 session 卡）

> 这是为了避免迁移完成后旧触发器又开始往 `digests/<sessionId>.md` 写新卡导致状态混乱。Step 2 会用新触发器完整替换。

### 不动

- digest-store / digest-scanner / digest-prompt 文件**本 step 不删**（Step 2 删；这里保留是因为 task-types 还在引用它们的相关类型）
- 触发链外的 service / agent-worker / tools
- UI / smart-category-store / category-tools 调用方（消费方在 Step 2 改）

## 验证

- `bun run build:electron` + `bun run lint` 通过
- 手动启动一次：
  - 启动日志含 migration-p3 跑了且无 error
  - `<configDir>/workspaces/<wsId>/digests/<groupId>.md` 出现（对单会话组）
  - 旧 `<sessionId>.md` 已移到 `_archive/`
  - `smart-categories.json` 字段已是 `groupIds` + `schemaVersion: 2`
  - `conversation-tree.json` children 已是 groupId + `schemaVersion: 2`
  - 设置页「会话摘要」Tab 仍能列出摘要卡（list 接口本 step 还在用旧路径——后面 Step 2 改）
- 二次启动确认幂等（_archive 已存在 / schemaVersion 已是 2 → 跳过所有步骤）
- 关会话不再触发新的会话级提炼（确认旧 trigger 已停摆）

## 实施回填

### 实际改动

**与计划差异**
- migration-p3 对旧 session 卡的 1:1 升级实际是「即使该 group 已有多 main 会话也尝试升级第一张」——但目前只在 `<groupId>.md` 不存在时才写，所以多会话场景下后落的旧卡都被搬到 `_archive/`，没有合并逻辑，跟计划「多 main 会话 → 一律 archive」实际行为一致
- smart-categories 的字段重命名直接覆盖写（无 `as any` 桥接），新增 `schemaVersion: 2` 标记；旧 `conversationIds[]` 字段被替换为 `groupIds[]`
- `CategorizeDecisionLog.conversationId` 保留为可选，新增 `groupId?`，**没有删除旧字段**（兼容历史日志展示）
- conversation-tree 升级用了同一套 schemaVersion=2 思路（具体实现见 migration-p3.ts）
- 旧 digest-trigger 没有改成 no-op——Step 1 与 Step 2 实际是一气呵成做完的，旧 digest-store/scanner/trigger/prompt 在 Step 2 末尾直接物理删除（git status 显示 4 个 D 文件）

**改动文件清单**
- 新增：`electron/main/services/memory/group-digest-store.ts`（273 行；含 GroupDigestCard / saveGroupDigest / readGroupDigest / listGroupDigests / deleteGroupDigest / mergeSourcesSeen 等）
- 新增：`electron/main/services/memory/group-digest-scanner.ts`（166 行；isGroupDirty / findDirtyConversationsInGroup / findDirtyGroups）
- 新增：`electron/main/services/memory/group-digest-prompt.ts`（52 行；DEFAULT_GROUP_DIGEST_PROMPT + load/save）
- 新增：`electron/main/services/memory/migration-p3.ts`（396 行；runMigrationP3 幂等迁移）
- 修改：`types/smart-category.ts` + `electron/main/types.ts`（conversationIds → groupIds；CategorizeDecisionLog 加 groupId?）
- 修改：`electron/main/index.ts`（whenReady 后追加 runMigrationP3）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `GroupDigestCard { groupId, title, createdAt, updatedAt, sourcesSeen: [{sessionId, conversationId, mtime}], summary, items: [{kind, text, sources: [{sessionId, uuid}]}], keyOutputs: [{path, oneLine, sessionId?}], tags? }`
  - 路径：`<configDir>/workspaces/<wsId>/digests/<groupId>.md`；archive 路径 `_archive/`、`_archive/_orphan/`
  - 提示词文件：`<configDir>/group-digest-prompt.md`
  - `SmartCategoriesIndex.categories[].groupIds: string[]` + 顶层 `schemaVersion: 2`
  - `conversation-tree.json` children 装 `groupId`，顶层 `schemaVersion: 2`
- 下个 step 该从哪里继续：
  - Step 2 已完成（trigger / agent task / MCP 工具 / 服务层 / IPC / 启动钩子 / 旧 digest-* 文件删除）
  - 进入 Step 3：UI 全面以组为主体
- 待办或已知限制：
  - `CategorizeDecisionLog.conversationId` 旧字段保留，前端展示决策日志时需兼容两种来源
  - 多 main 会话组的旧 session 卡只迁第一张，其余 archive；agent 下次触发组 digest 时会重建
