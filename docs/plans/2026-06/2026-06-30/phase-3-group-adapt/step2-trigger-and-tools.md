---
step: 2
title: 触发链 + Agent 任务 + MCP 工具改造
status: done
---

## 目标

打通完整组级链路：会话变动 → group-digest-trigger → GROUP_DIGEST_SESSION 任务 → agent (CleanTranscript dirty conv + SaveGroupDigest) → chainCategorize → review-scanner stale。Step 2 完成后**后端**已全面组化，旧 digest-* 文件正式删除；前端 UI 仍按 conversation 渲染（Step 3 改）。

## 依赖上下文（接力棒输入）

- Step 1 落地的关键签名（执行前补全）：
  - `group-digest-store.ts`: saveGroupDigest / readGroupDigest / listGroupDigests / deleteGroupDigest / getGroupDigestPath / mergeSourcesSeen
  - `group-digest-scanner.ts`: isGroupDirty / findDirtyConversationsInGroup / findDirtyGroups
  - `group-digest-prompt.ts`: loadGroupDigestPrompt / saveGroupDigestPrompt
  - `migration-p3.ts`: runMigrationP3 已执行 → 数据全部组化
- 现状关键事实（Step 2 前）：
  - 旧 digest-trigger 已 no-op（Step 1 改）；旧文件还在但无活动
  - smart-category 数据已是 `groupIds[]`，但 store/engine/tools 代码还按 `conversationIds` 引用 → Step 2 全面改名
  - `category-tools.ts:69-198` ListCategories/SaveCategory 当前按 conversationId
  - `review-tools.ts:43-149` ListDigests / ReadDigest / TraceSource / ReadReport / WriteReport
  - `review-scanner.ts:12-32` isReportStale 用最新 session digest createdAt
- 全局决策：复用 `settings.digestModelSelection`；子会话过滤 `role !== 'sub'`；任务 payload 含 dirtyConversations

## 计划改动

### 任务类型与编排

- [ ] `electron/main/agents/task-types.ts`
  - 新增 `GROUP_DIGEST_SESSION`
  - Payload：`GroupDigestSessionPayload { workspaceId, workspacePath, groupId, dirtyConversations: Array<{conversationId, sessionId, mtime}>, hasExistingCard: boolean, modelSelection?: ModelSelection }`
  - 删除 `DIGEST_SESSION`（或保留常量但标 deprecated）

- [ ] `electron/main/services/memory/group-digest-trigger.ts`（新增，**替代** digest-trigger）
  - 串行队列并发=1 + in-flight 去重（按 `${workspaceId}:${groupId}`）
  - `triggerByConversation(convId)`：找 conversation.groupId → 计算 dirtyConversations → 提交任务
  - `triggerByGroup(workspaceId, workspacePath, groupId)`：手动入口
  - `triggerScanAll()`：扫所有工作区所有 group → dirty 的提交（启动扫/夜间03/手动重跑用）
  - 活动采集：current / queueDepth / recent 环形 15 / lastScan
  - 提交任务前：`hasExistingCard = !!readGroupDigest(groupId)`；`dirtyConversations` 由 scanner 算
  - onSaved 回调：触发 `chainCategorize(workspaceId, groupId, groupDigestPath)`
  - 提供 `whenGroupDigestIdle()` 供 review-trigger 排队

### Agent Worker

- [ ] `electron/main/agents/agent-worker.ts`
  - 新增 `handleGroupDigestTask(payload)`：
    - `resolveModelSelection(payload.modelSelection ?? settings.digestModelSelection ?? settings.defaultModelSelection)` 重建凭证 env
    - 拼 system prompt：`loadGroupDigestPrompt()` + 上下文（groupId / current sourcesSeen / dirtyConversations 列表带 sessionId / 共享区文件清单 + 描述 / `_notes/` 清单）
    - 提供 MCP servers：
      - `dogear-group-digest`（新）：ReadGroupDigest + SaveGroupDigest
      - `dogear-memory-digest`（保留 CleanTranscript）
      - `dogear-group`（Phase 1 已有 ReadGroupFile / ListGroupFiles）
    - AbortController 接 cancelTask
  - 删除 `handleDigestSessionTask`（或保留空 stub）

### MCP 工具

- [ ] `electron/main/agents/tools/group-digest-tools.ts`（新增）
  - MCP server `dogear-group-digest`：
    - `ReadGroupDigest({ groupId })`：读组卡返回 JSON-friendly 结构（agent 看到现有 summary/items/keyOutputs）
    - `SaveGroupDigest({ groupId, title, summary, items, keyOutputs, tags? })`：
      - schema 校验
      - 自动从 task payload 拿 `dirtyConversations` 计算新 sourcesSeen：`mergeSourcesSeen(existing.sourcesSeen ?? [], dirtyConversations)`
      - 写 `<groupId>.md`
      - 触发 onSaved 回调（trigger 模块订阅）

- [ ] `electron/main/agents/tools/digest-tools.ts`
  - 保留 `CleanTranscript` 工具不变（被组 digest 任务用）
  - 删除 `ReadExistingDigest` / `SaveDigest`（被 ReadGroupDigest / SaveGroupDigest 替代）
  - 文件可保留或重命名为 `transcript-tools.ts`

- [ ] `electron/main/agents/tools/category-tools.ts`
  - `SaveCategory` 入参 `conversationId` → `groupId`；schema/discriminatedUnion 同步
  - `ListCategories` 的 sampleTitles：从 `groupIds.slice(-3)` 查 group + `deriveGroupTitle(group, groupConversations)` 取标题
  - `deriveGroupTitle` 实现：group.title 优先；为空用组内主会话最近 1 个 title + 「等 N 个」（若多）

- [ ] `electron/main/agents/tools/review-tools.ts`
  - `ListDigests({ workspaceId })`：改为 `listGroupDigests(workspaceId)` 列**组卡**；行格式 `- ${groupId} · ${createdAt} · ${title} · ${sessionCount}会话`
  - `ReadDigest({ groupId })`：读组卡，返回概述+items+keyOutputs；items 输出带 `sources: [{sessionId, uuid}]`
  - `TraceSource({ sessionId, uuid })`：行为不变

### 服务层

- [ ] `electron/main/services/memory/smart-category-store.ts`
  - 字段引用 `conversationIds` → `groupIds`
  - 函数重命名：`pushConversation` → `pushGroup`，`removeConversationEverywhere` → `removeGroupEverywhere`

- [ ] `electron/main/services/memory/smart-category-engine.ts`
  - `matchByThreshold(tags, categories, threshold)`：内部逻辑不变，仅类型字段名更新
  - `pickRedistributeCandidates` 同步

- [ ] `electron/main/services/memory/category-trigger.ts`
  - `triggerCategorize(workspaceId, groupId, groupDigestPath)`：入参换 groupId
  - 任务 payload 字段同步

- [ ] `electron/main/services/memory/categorize-prompt.ts`
  - 模板文案：「为这个**组**找一个合适的分类」「样例展示的是组的代表标题」

- [ ] `electron/main/services/memory/review-scanner.ts`
  - `isReportStale(report, latestGroupDigestCreatedAt)`：用组卡 createdAt
  - `findStaleWorkspaces`：调 `listGroupDigests(wsId)` 取最大 createdAt

- [ ] `electron/main/services/memory/review-prompt.ts`
  - 模板文案：「按**组**聚合『近期做了哪些』」「每行：组标题 + summary + 关键 items 或产出」

- [ ] `electron/main/services/group-shared-service.ts`
  - 约定 `_notes/` 子目录：listSharedFiles 时分类（普通 vs `_notes/`），manifest 带 frontmatter.summary

### IPC

- [ ] `electron/main/tipc/category.ts`
  - 入参 conversationId → groupId

- [ ] `electron/main/tipc/digest.ts`
  - 改名/调整 RPC：
    - `triggerDigestScan` → `triggerGroupDigestScan`
    - `cancelDigest` → `cancelGroupDigest`
    - `getDigestActivity` → `getGroupDigestActivity`
    - `getDigestPrompt / setDigestPrompt` → `getGroupDigestPrompt / setGroupDigestPrompt`
    - `getDigestModelSelection / setDigestModelSelection` 保留（复用现有 settings.digestModelSelection）
  - 前端 store/UI 调用方对齐

### 删除（Step 2 末尾）

- [ ] `electron/main/services/memory/digest-store.ts`
- [ ] `electron/main/services/memory/digest-scanner.ts`
- [ ] `electron/main/services/memory/digest-trigger.ts`
- [ ] `electron/main/services/memory/digest-prompt.ts`
- [ ] 旧 task-types 中的 DIGEST_SESSION（如保留则确认无引用）

### Working agent prompt 注入

- [ ] `electron/main/agents/query-based-session.ts`（或 system prompt 拼装入口）
  - 在所有会话 system prompt 末尾追加段落：
    > 当感觉某阶段告一段落，或上下文用量已较高时，你可以主动调用 `WriteGroupFile` 写一份阶段总结到 `shared/_notes/<YYYY-MM-DD-HHmm>-<phase>.md`，frontmatter 带 `summary` 一行。这不是强制——只在确实有价值时做。

### Store

- [ ] `stores/smart-category-store.ts`
  - 字段同步（categories[].groupIds）；订阅 categoriesUpdated 逻辑不变

### 启动钩子重新接入

- [ ] `electron/main/index.ts`
  - 启动扫 8s 钩子：`groupDigestTrigger.triggerScanAll() → whenGroupDigestIdle() → reviewTrigger.triggerReviewScan()`
  - 夜间03 钩子同上
- [ ] `tipc/agent.ts:139-150` 关会话钩子：改调 `groupDigestTrigger.triggerByConversation(convId)`

## 验证

- `bun run build:electron` + `bun run lint` 通过
- 启动 app 实测：
  - 单会话组：发消息 → 关会话 → 几秒后组卡 `<groupId>.md` 更新（mtime 变）→ smart-category 决策日志含 join/new → dashboard 刷新含新内容
  - 多会话组：在已有组下新建会话 → 发消息 → 关会话 → 组卡 sourcesSeen 增长，summary/items 合理整合上次内容 + 新会话
  - 子会话：DelegateTo + SubmitDelivery → 父关会话 → 组卡 keyOutputs 含子会话产出；子会话不出现在 sourcesSeen
  - 删除 conversation：组卡下次触发时去掉相关内容
- 设置页「会话摘要」Tab：列出**组卡**（不再是 session 卡）；activity 轮询正常；prompt 编辑入口仍然指向旧 digest-prompt——Step 4 切到 group-digest-prompt
- 旧 digest-* 文件已物理删除，无残留引用

## 实施回填

### 实际改动

**与计划差异**
- `digest-tools.ts` 文件名未重命名为 `transcript-tools.ts`，但内部 `ReadExistingDigest / SaveDigest` 已删，仅保留 `CleanTranscript`；`saveCleanedBackup` 改为本文件内的私有 helper（不再 import 旧 digest-store）
- 组 digest agent 在拼 system prompt 时除了「dirtyConversations + sourcesSeen」还注入了**共享区文件清单** + **`_notes/` 单独列出**（agent 可优先 ReadGroupFile 读），并挂了 `dogear-group` MCP server（ReadGroupFile / ListGroupFiles）
- 新增 `electron/main/services/group-helpers.ts` 导出 `deriveGroupTitle(group, conversations)` 供 worker 内分类决策注入候选时用；前端 `components/group-list/utils.ts` 已有同名函数但实现不同
- `category-tools.ts` 的 ListCategories sampleTitles 改为「拉每个 category 最后 3 个 groupId，用 deriveGroupTitle 取标题」
- `review-tools.ts` 的 ListDigests 行格式调整为 `- ${groupId} · ${createdAt} · ${title} · ${sessionCount}会话`，TraceSource 不变
- `review-scanner.ts` 改 `findStaleWorkspaces` 调 `listGroupDigests`
- `query-based-session.ts` 在普通会话 system prompt 末尾追加 `_notes/` 写作建议（10 行 diff）
- `tipc/digest.ts` 全面改名：`listDigests → listGroupDigests`、`readDigest → readGroupDigest`、`triggerDigest → triggerGroupDigest`、`getDigestActivity → getGroupDigestActivity`、`getDigestPrompt → getGroupDigestPrompt` 等；`getDigestModelSelection / setDigestModelSelection` 保留
- 旧 `digest-store.ts / digest-scanner.ts / digest-trigger.ts / digest-prompt.ts`（含测试）全部物理删除
- `DigestsPanel.tsx` 已更新为消费新接口（122 行 diff），但仍叫 DigestsPanel
- `SmartSection.tsx`、`utils.ts`、`SmartCategoryPanel.tsx` 仅做了字段重命名（conversationIds → groupIds）的同步，**渲染逻辑没换成组卡片**——这部分留给 Step 3
- 共享区 `group-shared-service.ts` 仅小改（+8 行，给 `_notes/` 留路径约定）

**改动文件清单**
- 新增：
  - `electron/main/services/memory/group-digest-trigger.ts`（226 行；串行队列 + 三入口 + 活动采集 + onSaved chainCategorize）
  - `electron/main/agents/tools/group-digest-tools.ts`（129 行；ReadGroupDigest + SaveGroupDigest，从 task payload 注入 dirtyConversations 自动算 sourcesSeen）
  - `electron/main/services/group-helpers.ts`（13 行）
- 修改：
  - `electron/main/agents/agent-worker.ts`（219 行 diff；新 handleGroupDigestTask + 分类决策方法适配 group）
  - `electron/main/agents/task-types.ts`（DIGEST_SESSION → GROUP_DIGEST_SESSION；payload 字段换）
  - `electron/main/agents/tools/digest-tools.ts`（137 行 diff；删 ReadExistingDigest/SaveDigest，保留 CleanTranscript + 本地 saveCleanedBackup）
  - `electron/main/agents/tools/category-tools.ts`（52 行 diff；conversationId → groupId）
  - `electron/main/agents/tools/review-tools.ts`（45 行 diff；listGroupDigests + 行格式）
  - `electron/main/agents/query-based-session.ts`（10 行 diff；_notes 建议）
  - `electron/main/services/memory/smart-category-store.ts`（pushConversation → pushGroup 等重命名）
  - `electron/main/services/memory/smart-category-engine.ts`（字段同步）
  - `electron/main/services/memory/category-trigger.ts`（入参 groupId）
  - `electron/main/services/memory/categorize-prompt.ts`（文案微调）
  - `electron/main/services/memory/review-prompt.ts`、`review-scanner.ts`（组卡 createdAt）
  - `electron/main/services/group-shared-service.ts`
  - `electron/main/tipc/digest.ts`（全量改名）
  - `electron/main/tipc/category.ts`（conversationId → groupId）
  - `electron/main/tipc/agent.ts`（关会话钩子改 triggerByConversation）
  - `electron/main/index.ts`（启动扫 + 夜间03 改 group-digest-trigger）
  - `app/settings/memory/DigestsPanel.tsx`（消费新接口）
  - `app/settings/memory/SmartCategoryPanel.tsx`（字段同步）
  - `components/conversation-list/SmartSection.tsx`（字段同步，渲染逻辑未换）
  - `components/conversation-list/utils.ts`（字段同步）
- 删除：
  - `electron/main/services/memory/digest-store.ts` + 测试
  - `electron/main/services/memory/digest-scanner.ts` + 测试
  - `electron/main/services/memory/digest-trigger.ts` + 测试
  - `electron/main/services/memory/digest-prompt.ts`

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - 任务：`TaskType.GROUP_DIGEST_SESSION` payload `{ workspaceId, workspacePath, groupId, dirtyConversations[], hasExistingCard, modelSelection? }`
  - 触发：`group-digest-trigger.ts` 暴露 `triggerScanAll / triggerByConversation(convId) / triggerByGroup(wsId, wsPath, groupId) / cancelCurrent / getGroupDigestActivity / whenGroupDigestIdle`
  - MCP：`dogear-group-digest` (ReadGroupDigest / SaveGroupDigest) + `dogear-memory-digest` (CleanTranscript) + `dogear-group` (ReadGroupFile / ListGroupFiles)
  - IPC：`digestRouter` 全部改组级（listGroupDigests / readGroupDigest / triggerGroupDigest / triggerGroupDigestScan / cancelGroupDigest / getGroupDigestActivity / getGroupDigestPrompt / setGroupDigestPrompt / get+setDigestModelSelection 保留）
  - 后端 deriveGroupTitle 在 `electron/main/services/group-helpers.ts`；前端同名函数在 `components/group-list/utils.ts`
- 下个 step 该从哪里继续：
  - SmartSection / TimeSection / ManualSection / ArchiveSection 当前仍按 conversation 渲染（SmartSection 还存在「把 groupId 当 conversationId 查 convById」的 bug，必须修）
  - ViewTabs 目前是 `group | smart | time`，ManualSection 始终先渲染；按 plan 改 `manual | smart | time`，把 ManualSection 也作为 Tab 切换
  - 手动文件夹 `children[]` 数据 schema 已是 groupId，但前端 ConversationFlatNode / ManualSection 仍按 conversation 处理 → 改造点
  - tipc IPC `addConversationToFolder / removeConversationFromFolder / moveConversationBetweenFolders` 数据层语义已是 groupId，建议改名 group 系列，前端 client 调用对齐
- 待办或已知限制：
  - SmartSection 当前 `convById.get(groupId)` 是错的（groupIds 装的是 group ID 不是 conversation ID），UI 上当前可能显示为空 → Step 3 必修
  - GroupList view 还在 ViewTabs 中保留为 'group' tab，Step 3 要去掉
  - ArchiveSection 仍按 conversation 归档（plan 推荐保留此粒度）
