---
step: 3
title: 渲染层终端面板
status: pending
---

## 目标
右侧栏「终端」tab 变真终端：xterm 渲染 + 底部子 tab 栏（「我的」shell 与「会话」后台终端两组），可输入可 Ctrl+C；跟随/固定沿用一期模式；工作台窗口复用。

## 依赖上下文（接力棒输入）
- 前置 step1/2 产出：tipc 上行 ptyCreate/ptyWrite/ptyResize/ptyKill/getPtyBuffer/listPtyTerminals；下行广播 ptyCreated/ptyData/ptyExit（读 step1 实施回填确认实际字段名）
- 现有一期实现将被重写：`stores/terminal-store.ts`（buffers/runningIds/事件订阅模式——订阅写法照搬 smart-category-store 的 dynamic import `@/lib/events` 模式）、`components/companion/TerminalPanel.tsx`（头部跟随/固定逻辑与 useFollowScroll 可参考丢弃）
- CompanionPanel 挂载点已有 `<TerminalPanel />` 分支（无 props 纪律保持）
- 工作台窗口依赖：terminal-store 每渲染进程独立实例，窗口初始化 `pinConversation(conversationId)` 一行进固定模式（一期验证过的机制）

## 计划改动
- [ ] 重写 `stores/terminal-store.ts`：
  - 状态：`terminals: Map<terminalId, { terminalId, conversationId, command, exited, exitCode }>`（元数据，不存内容流）；`activeTerminalId`；`followMode`/`pinnedConversationId`（沿用一期）；模块级订阅 ptyCreated/ptyData/ptyExit——ptyData 按终端路由给注册的监听器（`registerDataSink(terminalId, cb)` 供 xterm 组件收流，store 自身不攒内容）
  - actions：openUserShell()（ptyCreate conversationId:null）、killTerminal(id)、setActive(id)、pinConversation/setFollowMode 保留；ensureTerminals()（listPtyTerminals 拉实例列表补 tab，工作台窗口后开场景）
  - 「会话」组可见性：conversationId 非 null 且命中当前会话（跟随态=activeTabId，固定态=pinnedId）；「我的」组= conversationId null 全显示
- [ ] 新建 `components/companion/XtermTerminal.tsx`：
  - props `{ terminalId }`；挂载时 new Terminal({ scrollback: 5000, 等宽字体 }) + FitAddon + DOM renderer；`getPtyBuffer(terminalId)` 灌历史后 registerDataSink 接实时流；onData → ptyWrite；ResizeObserver → fit() + ptyResize（注意 attach 后才 fit）
  - 实例缓存：模块级 `Map<terminalId, Terminal>`，tab 激活时 open()/attach，切走时 detach 不 dispose（保内容）；ptyExit 后组件显示终态条（exitCode）并停写
- [ ] 重写 `components/companion/TerminalPanel.tsx`：
  - 头部 h-9：跟随/固定切换 + 会话下拉（固定态）——照搬一期实现（Pin/PinOff 图标、Select）删清屏按钮（终端内容自持，无清屏语义）
  - 身体：activeTerminal 对应的 XtermTerminal；无实例时空态「点下方 + 打开 shell，或让 agent 后台运行命令」
  - 底部子 tab 栏：左「我的」（$ shell，多个则 $ shell 2 递增）+ 分隔 + 右「会话」（command 短名，运行中 Loader2 转圈，退出变灰 + exit code）；tab 点 × kill；最右 `+` 开新 shell；会话切换时 activeTerminalId 若失效则默认选「会话」组最新或置空
- [ ] 工作台窗口（一期 step4 的窗口初始化代码）：确认 `pinConversation` 调用仍生效 + 挂 ensureTerminals 拉列表

## 验证
- [ ] `bunx tsc --noEmit` + `bun run lint` + store 冒烟 `terminal-store.test.ts`（事件路由、分组过滤、activeTerminal 切换）
- [ ] 真机完整链路：开 shell 敲命令/Ctrl+C、agent 后台跑 `bun run dev` 出 tab 且输出滚动、用户 Ctrl+C 后 agent read_terminal 见退出码、关会话其终端 tab 消失、工作台窗口同看同输、后开窗口灌历史

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
