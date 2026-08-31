# 伴随工作台一期：终端观察窗 + 容器化 实施计划

**目标**：右侧栏升级为伴随工作台（宽度自由拖拽 + 各 tab 记忆宽度），新增终端观察窗面板（agent Bash 过程实时转播，只读），可弹出为「伴随工作台窗口」（同构 tab、直接打开、记住位置）。

**架构思路**：转播源零 patch——pi-agent-core Bash 原生 `onUpdate`（100ms 节流累积快照）经 agent-loop `tool_execution_update` 事件透传到 pi-session，在 pi-session 分流到主进程 terminal-stream 服务（环形缓冲 + 前缀 diff 增量广播 + 历史 RPC）。渲染为按命令分组的滚动卡片流 + ANSI 颜色（非 xterm——onUpdate 是累积快照非字节流，卡片流天然支持重设；xterm 全屏终端心智留给二期 PTY）。面板组件可移植（store + IPC，不依赖主窗口上下文），右侧栏与工作台窗口两容器复用。排除：底部 dock（阅读动线）、宽窄分档（自由拖拽）、布局编排器（YAGNI）。

**涉及模块**：
- `electron/main/agents/pi-session/pi-session.ts`（事件分流）
- `electron/main/services/terminal-stream-service.ts`（新，缓冲+广播+RPC）
- `electron/main/tipc/terminal.ts`（新，路由）+ `electron/main/index.ts`（工作台窗口创建 + 广播注册）
- `app/page.tsx` 右侧栏 aside（抽组件 + 拖宽 + 终端 tab）
- `stores/ui-store.ts`（tab 类型 + 宽度）、`stores/terminal-store.ts`（新）
- `components/companion/`（新目录：CompanionPanel / TerminalPanel / ANSI 渲染）
- `app/workbench-window/page.tsx`（新路由）
- 设计文档：`docs/plans/2026-09/2026-09-01/companion-workbench-design.md`

## 步骤索引

- [x] [Step 1: 主进程终端流服务](./step1-terminal-stream-service.md) — pi-session 分流 bash 流式事件，terminal-stream 服务缓冲/广播/历史 RPC
- [x] [Step 2: 右侧栏容器化 + 宽度记忆](./step2-right-panel-resize.md) — aside 抽组件、拖拽调宽、各 tab 记忆宽度、加终端 tab 占位
- [x] [Step 3: 终端面板（跟随/固定 + 卡片流渲染）](./step3-terminal-panel.md) — 拉历史+订阅增量、ANSI 渲染、命令卡片流、跟随活动会话/固定会话切换
- [ ] [Step 4: 伴随工作台窗口](./step4-workbench-window.md) — 单例窗口 + 记住位置 + 同构 tab 页面 + header 入口

## 全局决策

- **事件与 RPC 命名**：广播事件 `terminal-stream:append`；RPC `getTerminalBuffer(conversationId)` 返回该会话全量命令条目。数据结构：`TerminalEntry = { toolCallId, command, startedAt, exitCode?, text }`（text 为该命令累积输出）
- **增量协议**：主进程每次收到 `tool_execution_update`（累积快照），与该 toolCallId 上次快照做前缀比较——`新快照.startsWith(旧快照)` 则广播 `{type:'append', suffix}`；否则广播 `{type:'replace', text}`。渲染端按 toolCallId 定位卡片 append 或重设
- **分流条件**：`event.type === 'tool_execution_update' && event.toolName === 'bash'`，`args.command` 为命令文本；会话映射 conversationId 从 pi-session 现有上下文取
- **缓冲上限**：每会话 entries 上限 200 条命令、单命令 text 上限 256KB，超限截断（头部丢弃保尾部）；会话销毁（pi-session destroy 链路）时清缓冲
- **广播范围**：主进程向所有窗口 `webContents.send`，渲染端按 conversationId 过滤消费（不搞定向，符合既有广播模式）
- **宽度持久化**：每 tab 宽度存 localStorage（key `companion-width:{tab}`），主窗口本地 UI 状态，不进 settings、不跨窗
- **tab 类型**：`rightPanelTab: 'files' | 'additional' | 'topic' | 'terminal'`；工作台窗口本地独立的 tab 状态（不与主窗口共享）
- **面板可移植纪律**：`components/companion/` 下组件只依赖 store + tipc client，不 import 主窗口特有上下文（与笔记面板同款要求）
- **节流**：pi-agent-core 已 100ms 节流，主进程直接转发不额外节流
- **不做**：xterm.js（二期 PTY）、工具块↔终端联动、快捷键、PTY
