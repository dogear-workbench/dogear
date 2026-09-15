---
step: 4
title: 入口按钮与小地图收尾
status: pending
---

## 目标

搜索入口可见化（小地图上方按钮）；小地图预览从正文开始（剔除 referenced_files）；全量 lint 与手动回归。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-hit-model.md] useMessageSearch.open() 可唤起搜索浮条；[step3-path-pipeline.md] 正文路径已可点
- 小地图按钮位置：MessageMinimap.tsx 触发器按钮（MapIcon）在 AgentChat 右侧工具列，搜索按钮放它上方
- 小地图预览根因：minimap-utils.ts:24-30 extractMessagePreview 手写剔除串漏了 `<referenced_files>`（搜索侧 getUserMessageSearchableText 走 parseUserMessageReferences 是干净的，utils.ts:50 有现成解析）

## 计划改动

- [ ] `components/agent-chat/AgentChat.tsx`（或 MessageMinimap 同容器处）：小地图按钮上方加搜索按钮（SearchIcon），点击 openSearch()，与 MapIcon 并排同尺寸样式
- [ ] `components/agent-chat/minimap-utils.ts`：extractMessagePreview 的 user 分支与 parseUserMessageReferences 同口径——剔除 referenced_files（或直接复用其 userMessage 提取再叠加其余注入标签剔除）
- [ ] `bun run lint` 全绿
- [ ] 手动回归清单：Ctrl+F 与按钮双入口；user/text/thinking/tool 四域搜索命中 + 跳转定位 + 折叠展开；正文 md 裸路径与链接点击打开；未来式路径渲染为纯文本；planPath 卡可点；小地图预览从正文开始

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
