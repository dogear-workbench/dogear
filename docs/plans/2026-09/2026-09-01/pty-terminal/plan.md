# PTY 真终端（终端二期）实施计划

**目标**：右侧栏「终端」tab 从只读卡片流改为真 PTY 终端——agent 长驻命令（`run_in_background`）与用户自有 shell 共存于底部子 tab 栏，可看可输入可 Ctrl+C，工作台窗口复用同一套。

**架构思路**：双轨 bash——同步命令走原 createBashTool 路径零改动，后台命令进主进程 pty-service 的 PTY 实例并立即返回；agent 用 read_terminal/kill_terminal 管理后台进程；渲染层 xterm.js + 终端实例 tab。设计全文见 [../pty-terminal-design.md](../pty-terminal-design.md)，技术调研见会话组共享区 `pi-bash-chain-research.md`。

**涉及模块**：
- 主进程：`electron/main/services/pty-service.ts`（新）、`electron/main/tipc/pty.ts`（新）、`renderer-handlers.ts`（改）、`agents/pi-session/builtin-tools.ts`（改）、`pi-session.ts`（改）
- 渲染层：`stores/terminal-store.ts`（重写）、`components/companion/TerminalPanel.tsx`（重写）、`components/companion/XtermTerminal.tsx`（新）
- 删除：`TerminalCard.tsx`、`terminal-stream-service.ts`、`tipc/terminal.ts`、pi-session `forwardBashTerminalEvent`、`ansi-to-react`
- 依赖新增：node-pty、@xterm/xterm、@xterm/addon-fit

## 步骤索引

- [x] [Step 1: 主进程 PTY 服务 + tipc 通道](./step1-pty-service.md) — 纯新增，PTY 实例管理/缓冲/广播与上行通道，不碰现有逻辑
- [x] [Step 2: bash 双轨 + agent 管理工具 + 生命周期](./step2-bash-tool.md) — 包装 createBashTool 分流 run_in_background，新增 read_terminal/kill_terminal，会话 close 杀 PTY
- [x] [Step 3: 渲染层终端面板](./step3-renderer.md) — terminal-store 重写、xterm 组件、底部子 tab 栏（我的/会话两组）、跟随固定保留
- [x] [Step 4: 一期删除 + 打包善后](./step4-cleanup.md) — 删卡片流全家、asarUnpack、agent.md RTK 修正、回归验证

## 完成总结

四步全部完成，每步独立 commit：`7a691fa`（PTY 服务+tipc）、`52b03f2`（bash 双轨+管理工具）、`4812a95`（渲染层 xterm 面板）、`bf7d72b`（一期删除+打包）。

**最终架构**：双轨 bash——同步命令零变化走原 createBashTool 路径；`run_in_background: true` 走主进程 pty-service（Git Bash 优先探测/100KB 尾部缓冲/全窗口广播）立即返回，agent 用 read_terminal（strip-ANSI+8KB 尾部，按会话归属过滤）/kill_terminal 管理；渲染层 xterm.js 实例缓存面板，「我的 shell」与「会话后台终端」两组 tab 共存，跟随/固定沿用一期；会话 close 杀其名下 PTY，app 退出全杀；工作台窗口同构复用。

**实施中的关键发现**：node-pty Windows 需双 error listener 压制 uncaught；工具层错误通道是 throw 而非返回对象（agent-loop 硬编码 isError:false）；stripAnsi 必须先做 CRLF→LF 归一否则 Windows 输出整行误删；xterm 实例换容器用 host div 搬家而非重复 open；hydration 需要 pending 队列防历史/实时乱序。

**遗留待用户验证**：真机完整链路（agent 后台命令出 tab/键盘交互/Ctrl+C/关会话 tab 消失/双窗口同看/后开窗口灌历史）；`bun run dist` 安装包 node-pty asarUnpack 生效。后续可调项：read_terminal 截断 8KB 首版值、终端无 TTL 回收（自然退出实例留 Map 到 tab × 或会话清理）。

## 全局决策

- **工具族归属**：read_terminal/kill_terminal 与 bash 同族，进 `builtin-tools.ts` 的 tools 数组，不走 registerTools 能力域机制；需加进子会话 `BUILTIN_FILE_TOOLS` 白名单（`computeSubAgentActiveTools`，'bash' 硬编码处）。前端工具面板是否展示这俩：实施时查 bash 当前呈现方式，与其对齐
- **terminalId**：uuid（项目现有 id 生成方式），不用自增
- **PTY 归属**：实例带 `conversationId`（agent 后台命令）或 `null`（用户 shell）；会话 close → 杀其名下全部；app quit → 全杀
- **用户 shell 选型**：复用项目 shell 探测（Git Bash 优先），与 agent 一致；ptyCreate 留可选 shell 参数备将来
- **LLM 侧文本**：read_terminal 返回 strip-ANSI + 尾部截断（自写简化版，不复用 pi-agent-core 内部 tail）；用户侧 xterm 保留原始 ANSI
- **xterm 渲染器**：DOM renderer（最稳，Canvas/WebGL 有透明/缩放坑）；scrollback 5000 行
- **内容持有**：渲染层 store 只存实例元数据 + 事件路由，终端内容归 xterm 实例自持（每终端缓存一个 xterm 实例，tab 切换 attach/detach + refit）；后开窗口/后切 tab 从主进程 100KB 尾部缓冲灌历史
- **错误兜底**：node-pty 的 write/resize/kill 全 try-catch（Windows ConPTY 偶发 ECONNABORTED）；dispose 前 write('\rexit\r') 的稳妥收尾不做强制，kill 失败静默记日志
- **验证基线**：每步 `bun run lint`（0 errors）+ `bun run build:electron`；涉及渲染层加 `bunx tsc --noEmit`；冒烟测试沿用项目 `*.test.ts` 同目录惯例
