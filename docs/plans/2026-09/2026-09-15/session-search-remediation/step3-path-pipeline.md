---
step: 3
title: 路径补全与存在性校验管道
status: done
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
  - resolveAndValidate 保持单根签名（文件树操作仍限主根，避免扩大操作面），多根逻辑放新函数 resolveWithinRoots，仅读盘与存在性校验消费；startsWith 分隔符修复落在 isWithinRoot 单根/多根两条路径都生效
  - path-link.tsx 拆出纯函数模块 path-resolve.ts（超 300 行约束 + 可脚本验证）；旧符号经 re-export，tool-renderers 既有 import 零改动
  - 存在性校验直接做轻量批量聚合（30ms 窗口按 workspaceId 合并，一轮渲染通常 1 次 IPC）而非逐条起步；负缓存 TTL 30s（未来式路径落盘后重渲染变可点）
  - MarkdownRenderer renderPathSegments 升级「路径+搜索高亮」混合模式：path 段内文本也消耗块级编号器，mark id 与搜索端严格对齐（否则开路径识别会破坏 Step 1/2 正文高亮）
  - 顺手修既有 PATH_TOKEN_RE 误捕 bug：`docs/a.md` 后半段 `/a.md` 被绝对正则捕获挤掉完整相对 token；临时脚本 10 用例验证（中文语境/多根/兄弟碰撞/`..` 穿越/baseDir 优先）全过
- 改动文件清单：electron/main/tipc/explorer.ts（新 checkPathsExist procedure + readFile 多根）、electron/main/services/workspace-fs-service.ts（resolveWithinRoots / checkPathsExist / readWorkspaceTextFile 多根 / isWithinRoot 分隔符）、electron/main/services/workspace-json-service.ts（getEnabledRoots）、components/agent-chat/path-resolve.ts（新，纯函数：resolvePathCandidates / splitPathSegments / REL_PATH_TOKEN_RE 裸相对启发式）、components/agent-chat/path-link.tsx（重写：roots 缓存 / existenceCache + 批量聚合 / useExistenceResolved / GatedPathChip / PathChip 点击兑底 toast）、components/MarkdownRenderer.tsx（混合模式 + a 分支多根候选 + openPathCandidates）、components/agent-chat/ContentBlockItem.tsx（workspacePath 透传）、components/agent-chat/MessageItem.tsx（AI 正文两处传 workspacePath + TaskExecutionCard planPath 走同一管道）
- 验证：tsc 前端+electron 全绿、lint 0 errors、build:electron 通过；纯函数临时脚本 10 用例验证后已清理

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `GatedPathChip` / `useExistenceResolved` / `useWorkspaceRoots` 从 `components/agent-chat/path-link` 导出，Step 4 或别处渲染路径胶囊直接复用
  - existence 负缓存 TTL = 30s（path-link.tsx NEGATIVE_TTL_MS）；正值常驻，文件删除由 PathChip 点击兑底覆盖
  - MessageItem 会话所属工作区统一 useWorkspaceId()（context）；currentWorkspaceId 仅剩跨工作区徽章用途，勿混用
- 下个 step 该从哪里继续：Step 4 入口按钮与小地图收尾（AgentChat 搜索按钮 + minimap-utils extractMessagePreview 同口径），与本 step 零文件交集
- 待办或已知限制：
  - tool-renderers 卡片路径仍单根语义（resolvePathInWorkspace 薄封装只认主根），附加根文件的工具卡不可点（计划 6 项未含，后续任务）
  - InjectedMessageCard / 用户消息正文未开路径识别（计划范围外）
  - 裸文件名（不含分隔符）不识别为路径（design 预期）
