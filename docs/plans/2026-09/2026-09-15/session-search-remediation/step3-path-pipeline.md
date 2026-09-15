---
step: 3
title: 路径补全与存在性校验管道
status: pending
---

## 目标

会话正文 md 路径可点开：多根确定性补全 + 存在性校验门槛（挡未来式路径与误报），读盘层放开多根，planPath 卡接入同一管道。

## 依赖上下文（接力棒输入）

- 路径链路根因（调研报告 §4 / search-path-investigation）：MessageItem.tsx:500 未传 workspacePath → 正文裸路径不识别、相对 md 链接 window.open 必失败；path-link.tsx:19-48 resolvePathInWorkspace 单根；workspace-fs-service.ts:20-29 resolveAndValidate 单根 + startsWith 无分隔符；MessageItem.tsx:113 planPath 零校验原样当 resolved
- agent 侧语义：相对路径一律相对主工作区根；多根 = workspace.path + enabled additional_paths（conversation-runtime-service.ts:103-105）
- 工作区列表 IPC：path-link.tsx:80-105 client.getAll() 已有 workspaceId→path 缓存
- markdown-preview 链路：PathChip → useMarkdownPreviewStore.open → MarkdownFileDialog client.readFile → tipc explorer.ts:123 → workspace-fs-service

## 计划改动

- [ ] tipc 新增批量存在性校验 procedure（入参 workspaceId + paths[]，出参 path→bool；放 explorer 组）
- [ ] `electron/main/services/workspace-fs-service.ts`：resolveAndValidate 改多根（workspace.path + enabled additional_paths）；前缀校验 startsWith 统一加路径分隔符
- [ ] `components/agent-chat/path-link.tsx`：resolvePathInWorkspace 改多根逐试语义；新增「候选 token → 补全 → 存在性校验 → 通过才渲染 PathChip」管道；裸相对路径 token 启发式（含 / 或 \ 且匹配 ALLOWED_EXT_RE）；存在性结果前端缓存（workspaceId+path → bool，模块级 Map）
- [ ] `components/agent-chat/MessageItem.tsx`：正文 MarkdownRenderer 传 workspacePath（开裸路径识别 + md 链接 openPathPreview）；task-execution 卡 planPath 改走同一管道（resolved 由管道产出）
- [ ] PathChip 点击兜底：再校验一次，不存在 toast「文件不存在或已被移动」（项目禁 window.*，用现有 toast 机制）
- [ ] 存在性校验初版逐条 + 缓存；若单消息路径数多再聚合批量（回填记录实际量级）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
