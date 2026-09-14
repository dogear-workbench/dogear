---
step: 4
title: 独立会话窗口改版
status: pending
---

## 目标

独立会话窗口从「文件树+聊天+预览」改为「聊天 + 右侧 CompanionPanel」，与主窗口 tab 内布局一致；订阅互斥广播（工作台窗口开 = 本窗口右栏也隐藏）。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-main-infra.md] workbenchWindowOpened/Closed 广播已就绪；[step2-main-header.md] ui-store 已有 workbenchWindowOpen 字段
- 当前关键文件状态：
  - `app/session-window/page.tsx` — 现布局：可折叠 WorkspaceExplorer（左）+ AgentChat（中）+ ArticlePreview（右）；本地 state leftPanelOpen/rightPanelOpen
  - `components/companion/CompanionPanel.tsx` — 复用主体，需要 workspaceId + groupId props（参考 `app/workbench-window/page.tsx` 用法：本窗口会话固定单会话锚点）
- 关键决策回顾：独立会话窗口是一会话一窗，锚点即本窗口会话（不需焦点跟随）；互斥时右栏隐藏与主窗口行为一致；ArticlePreview 保留在聊天位

## 计划改动

- [ ] `app/session-window/page.tsx`：
  - 移除 WorkspaceExplorer 左栏与 leftPanelOpen 逻辑
  - 右侧改为 CompanionPanel：workspaceId 取初始化好的 windowWorkspaceId；groupId 取本窗口会话的 groupId（conversations.find）；终端锚点 = 本窗口 conversationId
  - 订阅 workbenchWindowOpened/Closed → ui-store workbenchWindowOpen；右栏渲染条件 = !workbenchWindowOpen && 本地右栏开关开
  - 窗口内加右栏折叠按钮（位置照主窗口 header 右侧习惯，本窗口 header 简化后放右侧）
  - ArticlePreview 布局调整到聊天位内（保留现有触发链路）
- [ ] 验证：弹出的独立会话窗口 = 左聊天右工具箱；工作台窗口打开时其右栏同步消失、关闭恢复；终端 tab 显示本窗口会话的终端流；文章预览可用

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
