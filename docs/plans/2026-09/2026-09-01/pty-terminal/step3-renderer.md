---
step: 3
title: 渲染层终端面板
status: done
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
- [x] 工作台窗口（一期 step4 的窗口初始化代码）：确认 `pinConversation` 调用仍生效 + 挂 ensureTerminals 拉列表

## 验证
- [x] `bunx tsc --noEmit` + `bun run lint` + store 冒烟 `terminal-store.test.ts`（事件路由、分组过滤、activeTerminal 切换）——全量 bun test 264 pass 0 fail 1 skip，step2 遗留的 2 个 pre-existing 失败已消解
- [ ] 真机完整链路：开 shell 敲命令/Ctrl+C、agent 后台跑 `bun run dev` 出 tab 且输出滚动、用户 Ctrl+C 后 agent read_terminal 见退出码、关会话其终端 tab 消失、工作台窗口同看同输、后开窗口灌历史——需运行中 Electron 应用，留待 step4 后统一真机回归

## 实施回填（做完后填）

### 实际改动
- 与计划差异（详见共享区 pty/step3-delivery.md）：
  - activeTerminal 失效回退链「会话最新 → 我的最新 → null」（避免有 shell 却显空态）；reconcileActive 下沉为 store action 便于测试
  - xterm 宿主用自持 host div 搬家（attach=appendChild/detach=remove）而非重复 open——xterm 对同一实例重复 open 有尺寸测量问题
  - hydration 乱序防护：getPtyBuffer 往返期间实时数据进 pending 队列，灌完按序 flush，保证历史→实时严格有序
  - openUserShell cwd 取 workspace-store 的 workspace.path；无工作区时 toast 报错不发 create
  - ptyCreated 不自动激活（agent 起 tab 不抢用户焦点；openUserShell 例外）；ptyExit 停写双保险
  - 新增导出 dispatchPtyData/selectTerminalGroups 纯函数供测试驱动（ptyData 订阅仅 window 环境建立）
- 改动文件清单：
  - 重写 `stores/terminal-store.ts`（元数据 + 事件路由 + actions）、`components/companion/TerminalPanel.tsx`（头部/身体/底部子 tab 栏）、`stores/terminal-store.test.ts`（5 新用例）
  - 新建 `components/companion/XtermTerminal.tsx`（entryCache + FitAddon + DOM renderer + hydration）
  - 修改 `app/workbench-window/page.tsx`（ensureTerminals 一行）

### 给下一步的接力棒
- 关键签名 / 数据结构：`selectTerminalGroups(terminals, anchor, activeTerminalId)`、`registerDataSink(terminalId, cb) → () => void`；XtermTerminal entryCache 模块级永不 dispose
- 下个 step 该从哪里继续：Step 4 删一期——TerminalCard.tsx / ansi-to-react / tipc/terminal.ts + 注册行 + terminalStreamAppend + forwardBashTerminalEvent 整体删（doClose 的 killConversationTerminals 别动）；getTerminalBuffer 渲染层已无消费者
- 待办或已知限制：
  - 真机完整链路未验（需运行中应用），step4 后统一回归
  - `$ shell N` 标签按当前顺序派生，关中间 shell 后重编号（纯显示层）
  - 窄栏多 tab 靠横向滚动兜底（未做收缩折叠）
  - step2 遗留 terminal-store.test 2 个 pre-existing 失败已查明根因（conversation-store.test 全局 mock 污染 + 旧用例未 await）并随重写消解
