---
step: 4
title: 入口按钮与小地图收尾
status: done
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
  - 按钮放 AgentChat.tsx 右侧工具轨道顶部按钮组（MessageMinimap 之前）而非 Minimap 内部：Minimap 在 turns<3 时 return null，放内部入口会跟着消失
  - 按钮加 hasMessages 条件（空会话不显示）与 !search.isOpen 隐藏（SearchBar z-30 覆盖右上角，与 Minimap hidden 模式一致）
  - minimap-utils 同口径修复采用复用 parseUserMessageReferences(text).userMessage + 叠加剔 command/task-execution 标签；顺带修复旧手写串漏掉的 referenced_files/conversations/shared_files/notes、local-command-stdout、跨工作区提示行
- 改动文件清单：components/agent-chat/AgentChat.tsx（搜索按钮 SearchIcon w-8 h-8，onClick=openSearch）、components/agent-chat/minimap-utils.ts（extractMessagePreview user 分支同口径）
- 验证：bun run lint 0 errors（改动文件 0 告警）、tsc 无类型错误；4 组构造消息脚本验证 preview 与 searchable 文本一致（task-execution 场景剥包裹属预期差异）后临时脚本已清理

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `useMessageSearch(...).open()` — 搜索浮条唯一入口，Ctrl+F 与按钮共用
  - `extractMessagePreview(msg): string` — user 分支现与 getUserMessageSearchableText 同口径（叠加 command/task-execution 剔除）
- 下个 step 该从哪里继续：全部 4 step 已完成；手动回归清单在共享区 step4-delivery.md（15 项：双入口/四域搜索/路径可点/小地图预览），留用户 dev 环境执行
- 待办或已知限制：
  - task-execution 消息搜索口径：getUserMessageSearchableText 不剥 `<task-execution>` 包裹，搜索可命中任务元数据，高亮降级块级/消息级定位（Step 1 既有口径未动）
  - parseUserMessageReferences 对属性不全条目不剥外层标签时，预览与搜索侧一致残留（同口径非缺陷）
