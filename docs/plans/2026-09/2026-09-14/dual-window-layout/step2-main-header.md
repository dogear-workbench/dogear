---
step: 2
title: 主窗口 header 改版与互斥响应
status: pending
---

## 目标

主窗口 header 完成新布局（左右分组、缩小、删刷新按钮、设置/消息左移），右栏折叠按钮从聊天区移到 header 最右；订阅互斥广播实现「工作台窗口开 = 右栏收起 + 右栏开关隐藏 + 工作台按钮切换态」。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-main-infra.md] 新增了 workbenchWindowOpened/Closed 广播与事件定义
- 当前关键文件状态：
  - `app/page.tsx` — header 现布局：左（折叠按钮 + WorkspaceSwitcherPopover）右（NotificationCenter + 设置 + 自选股 + 数据中心 + 工作台 + 微信 + 刷新）；h-12
  - `components/agent-chat/AgentChat.tsx` — 接收 `rightPanelToggle: { open, onToggle }` prop 渲染聊天区内右栏开关
  - `stores/ui-store.ts` — rightPanelOpen / rightPanelTab；本 step 加 `workbenchWindowOpen`
- 关键决策回顾：互斥状态 ui-store 内存态不落盘；工作台按钮是切换钮（启用态点击 = 关窗收回右栏）

## 计划改动

- [ ] `stores/ui-store.ts`：加 `workbenchWindowOpen: boolean`（默认 false）+ setter
- [ ] `app/page.tsx`：
  - 订阅 `workbenchWindowOpened` → setWorkbenchWindowOpen(true) + closeRightPanel()；`workbenchWindowClosed` → setWorkbenchWindowOpen(false) + openRightPanel()
  - header 改版：左侧 = 折叠按钮 + WorkspaceSwitcherPopover + 设置 + NotificationCenter；右侧 = 自选股 + 数据中心 + 微信 + 工作台（切换态样式）+ 右栏折叠按钮（workbenchWindowOpen 时隐藏）
  - 删除刷新按钮与 loadWorkspaceFiles 调用残留
  - header 高度收缩（h-12 → h-10 视觉定）、按钮 size 收紧
  - 工作台按钮：workbenchWindowOpen 时高亮态 + 点击调关闭（需主进程或现有 close 路径；若无现成 RPC，在 tipc/windows.ts 加 `closeWorkbenchWindow`）
- [ ] `components/agent-chat/AgentChat.tsx`：移除 rightPanelToggle prop 与内部按钮渲染；`app/page.tsx` 调用点同步清理
- [ ] 验证：开发模式跑 `bun run dev`——开工作台窗口后主窗口右栏收起、按钮隐藏、工作台按钮高亮；关窗恢复；聊天区内无右栏开关残留

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
