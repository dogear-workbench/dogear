---
step: 3
title: 预览读盘链路与全链路验收
status: pending
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

- [ ] `electron/main/tipc/explorer.ts` readFile 入参加可选 `groupId?: string`，roots 拼装逻辑与 checkPathsExist 一致
- [ ] `stores/markdown-preview-store.ts` state 加 `groupId: string | null`，`open` 签名加末位可选参 `groupId?: string`，`close` 重置
- [ ] `components/MarkdownFileDialog.tsx` readFile 调用带 `groupId`
- [ ] `path-link.tsx` PathChip `handleClick`：兜底 `checkPathsExist` 与 `open` 均带 groupId；GatedPathChip → PathChip 已透传（step2 完成）
- [ ] 全链路手工验收（见下）
- [ ] doc-sync：更新 `docs/codebase-map/chat.md` agent-chat 段（path-link 行补共享区根/groupId 维度、MarkdownRenderer 行补 extraRoots）与「注意」区「路径胶囊仅工具块内识别路径」表述（正文在 workspacePath 场景已可点，说明边界）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 完成总结（并入 plan.md）
- 实际改动汇总、与原计划偏差

## 验收（全链路）

- 共享区胶囊点击 → 预览浮窗打开并正常渲染 md 内容（含关闭重开）
- 共享区文件被删后点击 → toast「文件不存在或已被移动」
- 工作区路径胶囊点击行为不变（回归）
- 行内 code / 笔记卡 / plan 预览场景回归（step1 验收项不回退）
- `bun run lint` 0 errors、前端 tsc 全绿、`bun run build:electron` 通过；改动经 dogear__GitCommit 落库（不加 AI 署名 trailer）
