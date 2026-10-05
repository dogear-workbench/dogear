---
step: 3
title: 预览读盘链路与全链路验收
status: done
---

## 目标

点击共享区胶囊能打开 md 预览浮窗正常读盘渲染；全链路验收 + 文档同步。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2-group-context.md] 胶囊已能渲染（existence 通过）；`PathChip` 已有 `groupId?: string` prop 未消费；checkPathsExist IPC 已带 groupId
- 当前关键文件状态：
  - `stores/markdown-preview-store.ts` — `open(workspaceId, filePath, fileName)`，state 无 groupId
  - `components/MarkdownFileDialog.tsx:31` — `client.readFile({workspaceId, path: filePath})`
  - `electron/main/tipc/explorer.ts` readFile procedure 入参 `{workspaceId, path}`，roots 来自 `getEnabledRoots(workspace)`
- 关键决策回顾：PathChip 点击有兜底再校验（不存在 toast「文件不存在或已被移动」），共享区链路同样要过兜底

## 计划改动

- [x] `electron/main/tipc/explorer.ts` readFile 入参加可选 `groupId?: string`，roots 拼装逻辑与 checkPathsExist 一致
- [x] `stores/markdown-preview-store.ts` state 加 `groupId: string | null`，`open` 签名加末位可选参 `groupId?: string`，`close` 重置
- [x] `components/MarkdownFileDialog.tsx` readFile 调用带 `groupId`
- [x] `path-link.tsx` PathChip `handleClick`：兜底 `checkPathsExist` 与 `open` 均带 groupId；GatedPathChip → PathChip 已透传（step2 完成）
- [x] 全链路验收（无 UI 环境改为代码级链路核对，结果见验收段）
- [x] doc-sync：更新 `docs/codebase-map/chat.md`（path-link / workspace-id-context 行补 groupId 与共享区根维度、「注意」区路径胶囊表述改为正文 workspacePath 场景已可点）与 `docs/codebase-map/infra.md`（MarkdownRenderer 主描述行在 infra.md:54，补 extraRoots/sharedGroupId 并修正过时的「正文不识别路径」）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - MarkdownRenderer 行的 doc-sync 落在 `infra.md` 而非 chat.md（chat.md 只有引用行，主描述在 infra.md:54），过时的「正文不识别路径」表述一并修正
  - 其余逐条按计划实施，无差异
- 改动文件清单：`electron/main/tipc/explorer.ts` / `stores/markdown-preview-store.ts` / `components/MarkdownFileDialog.tsx` / `components/agent-chat/path-link.tsx` / `docs/codebase-map/chat.md` / `docs/codebase-map/infra.md`

### 完成总结（并入 plan.md）
- 预览读盘链路收口：PathChip 点击兜底校验与 open、preview store state、MarkdownFileDialog readFile、explorer.readFile IPC 四段全部带可选 groupId，主进程 readFile 与 checkPathsExist 同模式拼 sharedDir 进 roots（排工作区根之后）。groupId 全链路可选，无组上下文（笔记卡 / plan 预览 / 文件树 / Write 预览）行为与改动前完全一致。全链路验收按任务约定改为代码级核对（见验收段），lint 0 errors / tsc 无新增（本计划文件 0 错误）/ build:electron 通过，已 GitCommit 落库

## 验收（全链路，无 UI 环境改为代码级核对）

- [x] 共享区胶囊点击 → 预览浮窗打开并正常渲染 md 内容（含关闭重开）：handleClick 兜底 checkPathsExist 带 groupId（step2 IPC 已拼 sharedDir）→ open 带 groupId → state.groupId → MarkdownFileDialog readFile 带 groupId → explorer.readFile roots 拼 sharedDir 返回 content；close 重置 groupId: null，重开由 open 重设
- [x] 共享区文件被删后点击 → toast「文件不存在或已被移动」：兜底校验 roots 含 sharedDir 真实落盘判定，exists false 走既有 toast 分支
- [x] 工作区路径胶囊点击行为不变（回归）：groupId undefined 时 IPC 序列化省略字段、主进程 roots 不变；open 其余三调用点（ToolBlock/WorkspaceExplorer/TiptapEditor）均不传 groupId；openInline 五处签名未动且 inline 模式不读盘
- [x] 行内 code / 笔记卡 / plan 预览场景回归（step1 验收项不回退）：本 step 未动 MarkdownRenderer/path-resolve，PathChip 的 groupId 为可选透传
- [x] `bun run lint` 0 errors、tsc 无新增错误（本计划 4 个代码文件 0 错误；tsc 输出中 `stores/session-store.ts:216` 为并行 tab-bar-rework 未提交改动的 in-flight 错误，非本计划引入）、`bun run build:electron` 通过；改动经 dogear__GitCommit 落库（不加 AI 署名 trailer）
