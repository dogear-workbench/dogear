---
step: 1
title: 止血与清理
status: done
---

## 目标
MarkdownFileDialog 改非模态（点外部不关、Esc 关）；删除 Agent 监控的整条链路（窗口、路由、按钮、IPC）。

## 依赖上下文（接力棒输入）
- 当前关键文件状态：
  - `components/MarkdownFileDialog.tsx` — shadcn Dialog，`onOpenChange={(open) => { if (!open) close(); }}`，内容由 markdown-preview-store 驱动
  - `electron/main/index.ts:57` — `agentMonitorWindow` 模块级变量；`:167-219` createAgentMonitorWindow / getAgentMonitorWindow / sendToAgentMonitorWindow；`:322-323` app 退出时 close 该窗口
  - `electron/main/tipc/agent.ts:167` — openMonitorWindow procedure
  - `src/App.tsx:4,22` — AgentMonitorPage import 与 `/agent-monitor` 路由
  - `app/agent-monitor/page.tsx` — 页面本体
  - `stores/workspace-store.ts:26,105-108` — openMonitorWindow 声明与实现（调 `client.openMonitorWindow()`）
  - `app/page.tsx:78,211-214` — header 按钮与 store 取用，`Activity` icon import
- 关键决策回顾：`sendToAgentMonitorWindow` / `getAgentMonitorWindow` 在当前源码中已无调用点（仅 dist 旧构建产物有），可安全整段删除

## 计划改动
- [ ] `components/MarkdownFileDialog.tsx` — `<DialogContent>` 加 `onInteractOutside={(e) => e.preventDefault()}` 与 `onPointerDownOutside={(e) => e.preventDefault()}`；保留 Esc 关闭（Dialog 默认行为走 onOpenChange 已有 close）
- [ ] `electron/main/index.ts` — 删 `agentMonitorWindow` 变量、createAgentMonitorWindow / getAgentMonitorWindow / sendToAgentMonitorWindow 三函数、退出清理两行
- [ ] `electron/main/tipc/agent.ts` — 删 openMonitorWindow procedure
- [ ] `src/App.tsx` — 删 AgentMonitorPage import 与 `/agent-monitor` 路由
- [ ] 删除 `app/agent-monitor/page.tsx`
- [ ] `stores/workspace-store.ts` — 删 openMonitorWindow 声明与实现
- [ ] `app/page.tsx` — 删 header 的 Agent 监控按钮、`openMonitorWindow` 取用、`Activity` icon import
- [ ] `bun run build:electron` + `bun run dev` 验证

## 验收
- 打开任一 Markdown 预览（话题面板组卡原文 / 共享区文件），点击 Dialog 外部不再关闭，Esc 可关
- header 无「Agent 监控」按钮；`#/agent-monitor` 路由落到 `*` 兜底回首页；`bun run lint` 与 TS 编译无 agent-monitor 残留引用

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无差异，严格按计划改动段执行。额外验证：tsc 全量检查的 20 个 error 经 git stash 基线比对确认全部为既有问题（集中在 agent-chat、AboutTab、debug/page，与本次改动无关）
- 改动文件清单：
  - `components/MarkdownFileDialog.tsx` — DialogContent 加 onInteractOutside / onPointerDownOutside preventDefault，Esc 关闭保留
  - `electron/main/index.ts` — 删 agentMonitorWindow 变量、createAgentMonitorWindow / getAgentMonitorWindow / sendToAgentMonitorWindow 三函数、closeAllChildWindows 中两行
  - `electron/main/tipc/agent.ts` — 删 openMonitorWindow procedure（openStockWindow 保留）
  - `src/App.tsx` — 删 AgentMonitorPage import 与 /agent-monitor 路由
  - `app/agent-monitor/page.tsx` — 整目录删除
  - `stores/workspace-store.ts` — 删 openMonitorWindow 声明与实现
  - `app/page.tsx` — 删 header「Agent 监控」按钮、store 取用、Activity icon import

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `electron/main/index.ts` 现存窗口单例：mainWindow / tray / debugWindow / stockWindow / sessionWindows Map；closeAllChildWindows 遍历 stock + debug + sessionWindows
  - tipc agent router 保留 openStockWindow / openSessionWindow 作为窗口创建范例（step2 windows.ts 可参考）
  - `getDetailedStatus` procedure 保留（原 agent-monitor 页用，现无调用方，如 step 后续确认无用可再删）
- 下个 step 该从哪里继续：step2（设置窗口），新 IPC 路由集中到 `electron/main/tipc/windows.ts`，窗口创建照抄 stockWindow 模式
- 待办或已知限制：
  - `docs/codebase-map.md:36` 仍提到 agent-monitor，doc-sync 归 step4
  - dist/ 与 release/ 旧构建产物有残留，属构建产物不需手改，下次打包自然覆盖
  - Markdown Dialog「点外部不关、Esc 可关」需 GUI 手动验收（子会话环境无法跑 GUI）
