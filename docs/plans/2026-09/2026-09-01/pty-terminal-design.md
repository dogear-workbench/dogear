# PTY 真终端设计（终端二期）

**背景**：一期终端观察窗是「命令卡片流」——只读旁路捕获 bash 输出成卡片。用户实际反馈：卡片流里全是 agent 的 bash 输出，看不懂；他想要的是**真终端**——agent 起的长驻进程（dev server、watch）过程可见、可干涉（敲字/Ctrl+C），调试时能和 agent 共用同一处终端，不用另开外部 terminal。技术调研（共享区 `pi-bash-chain-research.md`）确认：bash 工具是项目显式注册可同名替换；现状无 stdin 通道、无后台进程机制（长驻命令会挂死工具调用）。

**目标**：
1. 右侧栏「终端」tab 变成真 PTY 终端（xterm.js），可看、可输入、可 Ctrl+C；主窗口布局不动
2. agent 长驻/交互命令进终端，快速命令不刷屏（不进终端）
3. 用户可随时开自己的 shell，与 agent 终端同面板共存
4. 一期卡片流删除
5. 工作台窗口（副屏）复用同一套，一处改两边生效

**架构**（核心做法 + 排除的选项）：

双轨 bash——单一 `bash` 工具加可选参数 `run_in_background`：
- **同步模式（默认）**：完全走现有 createBashTool 路径（spawn pipe 捕获、等退出、返回 LLM），一行不改。快速命令 LLM 必须看结果才能继续；pipe 模式无 ANSI 无回显，LLM 输入质量有保证
- **后台模式**：主进程 PTY 启动，工具立即返回「已在终端 #N 启动」，进程持续存活输出；agent 用 `read_terminal(id)` 查尾部输出与状态、`kill_terminal(id)` 终止

排除的选项：
- ~~全部命令走 PTY~~：同步命令不进终端，PTY 化只剩「机制统一」，却要承担 ANSI/回显污染 LLM 输入的风险
- ~~超时自动转后台~~：不可预期——agent 同步等 30s 的 build，10s 被转后台打断工作节奏；显式传参可预期（Claude Code 同模式）
- ~~agent 往终端敲字（REPL 交互）~~：LLM 协议层无交互概念，YAGNI；用户键盘是唯一输入源

**模块边界**：

主进程：
- `electron/main/services/pty-service.ts`（新建）：PTY 实例管理。实例字段 `{ terminalId, conversationId | null, command, cwd, cols, rows, buffer }`；create/write/resize/kill；每实例尾部输出缓冲（~100KB，供后开窗口/后切 tab 补历史）；exit 事件广播；会话 close → 杀该会话名下全部实例；app 退出 → 全杀。Windows ConPTY，write/kill/resize 全程 try-catch 兜底（已知偶发 ECONNABORTED）
- `electron/main/agents/pi-session/builtin-tools.ts`（改）：包装 `createBashTool()`——execute 检查 `args.run_in_background`，false 委托原工具，true 走 PTY 路径（cwd 取 `context.env.cwd` 沿用工作区边界）；schema 加可选字段；工具描述写明「长驻服务/watch 用后台模式，起完继续干活，read_terminal 查状态」
- 新增工具 `read_terminal(id)`（strip-ANSI 尾部文本 + 运行状态）、`kill_terminal(id)`；加进子会话 `BUILTIN_FILE_TOOLS` 白名单
- `electron/main/tipc/pty.ts`（新建）：上行 `ptyCreate / ptyWrite / ptyResize / ptyKill`
- `electron/main/tipc/renderer-handlers.ts`（改）：下行广播 `ptyCreated / ptyData / ptyExit`
- `pi-session.ts`（改）：close() 挂 pty-service 会话清理
- 同名替换后权限确认、事件流、`toolName==='bash'` 过滤零改动自动生效

渲染层：
- `stores/terminal-store.ts`（重写）：终端实例状态（列表、当前激活 tab、scrollback 镜像、跟随/固定沿用一期模式），模块级订阅 `ptyCreated/ptyData/ptyExit`
- `components/companion/TerminalPanel.tsx`（重写）：头部保留跟随/固定切换；身体 xterm 实例；底部子 tab 栏——左「我的」（全局 shell，不随会话切），右「会话」（当前会话 agent 后台终端，命令名做标题，运行中转圈/死灰），tab 点 × 杀实例，最右 `+` 开新 shell
- xterm 组件（新建）：`@xterm/xterm` + `@xterm/addon-fit`，FitAddon 随栏宽自适应列数，resize 同步 ptyResize
- 依赖：node-pty、@xterm/xterm、@xterm/addon-fit；electron-builder asarUnpack node-pty 的 .node

删除（一期善后）：
- `components/companion/TerminalCard.tsx`、`electron/main/services/terminal-stream-service.ts`、`electron/main/tipc/terminal.ts`、pi-session 的 `forwardBashTerminalEvent` 旁路、`ansi-to-react` 依赖、terminal tipc 注册行
- 顺手修 `agent.md` 过时的 RTK 描述（RTK 已于 commit e31c616 移除）

**数据流**：

后台命令：LLM 调 `bash {command, run_in_background:true}` → 工具 execute 向 pty-service 请求 create（conversationId、command、cwd）→ pty-service spawn PTY → 广播 `ptyCreated {terminalId, command, conversationId}` → 工具立即返回「已在终端 #N 启动」→ PTY 输出广播 `ptyData {terminalId, data(原始ANSI)}` → 各窗口 xterm.write + 服务端留尾部缓冲 → 用户键盘 `ptyWrite` 直通 PTY stdin（Ctrl+C 走 xterm 默认 keybinding 发 ^C）→ 进程退出广播 `ptyExit {terminalId, exitCode}` → agent 下次 read_terminal 看到「已退出(exit N)」

用户 shell：终端 tab 点 `+` → `ptyCreate {conversationId:null, shell:默认}` → 同上，agent 完全不感知

双窗口：ptyData 广播全窗口，主窗口/工作台窗口各自 xterm 渲染同一实例；键盘输入从焦点窗口发出（焦点天然互斥）

**错误处理 / 边界情况**：
- 同步命令行为零变化（不动原路径）
- 会话关闭杀其名下 PTY（对齐 killProcessTree 语义，不留孤儿）；用户手动关 shell tab 即杀
- abort 链路：后台工具立即返回，不占用 harness 工具调用挂起（同步命令 abort 语义原样）
- 后开窗口/后切 tab：先灌尾部缓冲再接实时流
- node-pty 原生模块：升 Electron 必须 electron-rebuild（postinstall 已兜）；打包 asarUnpack
- agent 用好 run_in_background 取决于模型，工具描述需实测打磨
- read_terminal 输出 strip-ANSI + tail 截断防 token 膨胀；xterm 侧保留原始序列
- 右侧栏上限 720px ≈ 90 列，表格/长输出折行——「不动主布局」的已接受代价

**未决问题**：
- read_terminal 是否需要增量读取（since 游标）还是每次全量尾部——实施时先做全量尾部，不够再加
- 终端缓冲 100KB 上限是否够 scrollback 补历史——实测调
- 会话 failover/重启后旧终端归属（close 清空后缓冲重建）——跟随一期已知限制语义
