---
step: 1
title: 主进程 PTY 服务 + tipc 通道
status: done
---

## 目标
纯新增主进程 PTY 管理服务与双向 tipc 通道，不碰任何现有逻辑——完成后主进程具备 create/write/resize/kill 终端实例与广播输出的完整能力。

## 依赖上下文（接力棒输入）
- 设计文档：[../pty-terminal-design.md](../pty-terminal-design.md)；调研：共享区 `pi-bash-chain-research.md`（切入点清单第三节）
- 现有广播收口：`electron/main/tipc/renderer-handlers.ts`（terminalStreamAppend 事件模式，照此加新事件）
- 现有 tipc 路由模式：`electron/main/tipc/terminal.ts`（getTerminalBuffer 的 procedure 写法）
- `broadcastToWindows` 是项目统一全窗口广播入口

## 计划改动
- [x] `bun add node-pty @xterm/xterm @xterm/addon-fit`（渲染层依赖本步一并装上；node-pty 原生模块靠已有 postinstall electron-rebuild）
- [x] 新建 `electron/main/services/pty-service.ts`：
  - 实例结构 `{ terminalId, conversationId: string | null, command: string, cwd: string, shell: string, cols, rows, buffer: string, exited: boolean, exitCode?: number }`
  - `createTerminal({ conversationId, command, cwd, shell?, cols, rows }): terminalId`——shell 缺省走项目 shell 探测（Git Bash 优先，参考 pi-agent-core `getShellConfig` 行为，自写等价探测）；spawn 用 node-pty，cwd 校验沿用「resolveWithinPaths 工作区边界」语义（读 `workspace-execution-env.ts:140` 的 guard 实现抄思路）
  - `onData`：追加尾部缓冲（上限 100KB，头部丢弃）+ 广播 `ptyData { terminalId, data }`
  - `onExit`：标记 exited/exitCode + 广播 `ptyExit { terminalId, exitCode }`
  - `writeTerminal(terminalId, data)` / `resizeTerminal(terminalId, cols, rows)` / `killTerminal(terminalId)`——全部 try-catch 兜底（ConPTY 偶发抛错），失败仅 console.warn
  - `getBuffer(terminalId)`：返回尾部缓冲（补历史用）
  - `listTerminals()` / `killConversationTerminals(conversationId)` / `killAll()`
  - 新建/退出也广播 `ptyCreated { terminalId, conversationId, command }`（渲染层建 tab 用）
- [x] 新建 `electron/main/tipc/pty.ts`：上行 `ptyCreate`（用户 shell 用）/ `ptyWrite` / `ptyResize` / `ptyKill` / `getPtyBuffer` / `listPtyTerminals`，注册进 `tipc/index.ts`
- [x] `renderer-handlers.ts`：加 `ptyCreated` / `ptyData` / `ptyExit` 三个下行广播事件类型
- [x] app 生命周期：主进程 `before-quit` 或 will-quit 挂 `killAll()`（找现有 app 退出钩子位置，如 main.ts/index.ts）

## 验证
- [x] `services/pty-service.test.ts` 冒烟（bun test，node 环境可真跑 node-pty）：create+write+data 事件、exit 事件与 exitCode、buffer 尾部截断、killConversationTerminals、killAll、重复 kill 不抛
- [x] `bun run lint` 0 errors + `bun run build:electron` 通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 服务层广播改为注册制（`setPtyEventBroadcaster`），tipc 层 `registerPtyBroadcaster()` 桥接到三个渲染层事件，由 `tipc/index.ts` 的 `registerTipcHandlers` 显式调用（对齐 article.ts 先例）——原因：`renderer-broadcast.ts` → `@egoist/tipc/main` 顶层 import electron，直接依赖会让 bun test 加载即炸，服务层保持零 electron 依赖
  - `createTerminal` 增加 node-pty IPty 双 error listener 压制（node-pty Windows 对非 EIO socket error 在 listeners<2 时直接 throw uncaught）
  - `pty-service.ts` 直接复用 `workspace-boundary.ts` 的 `resolveWithinPaths`（未抄思路自写），单一实现避免语义漂移
  - bun 运行时对 Windows ConPTY 命名管道 write 有兼容缺陷（ERR_SOCKET_CLOSED，node v25 正常），生产 Electron 主进程不受影响；测试中 write 回流用例用 `test.skipIf(isBun)` 标注，其余真跑
  - `getPtyBuffer` 返回 `PtyBufferSnapshot`（buffer+cols/rows+exited/exitCode），渲染层恢复场景一次往返拿全
- 改动文件清单：
  - 新增：`electron/main/services/pty-service.ts`、`electron/main/tipc/pty.ts`、`electron/main/services/pty-service.test.ts`
  - 修改：`electron/main/tipc/index.ts`（注册 ptyRouter + registerPtyBroadcaster）、`electron/main/tipc/renderer-handlers.ts`（三事件）、`electron/main/index.ts`（before-quit 挂 killAll）、`package.json`（node-pty@1.1.0 / @xterm/xterm@6.0.0 / @xterm/addon-fit@0.11.0）

### 给下一步的接力棒
- 关键签名 / 数据结构：见共享区 `pty/step1-delivery.md`
- 下个 step 该从哪里继续：Step 2（builtin-tools 包装 bash + read_terminal/kill_terminal；pi-session close() 挂 `killConversationTerminals` 也在此步）
- 待办或已知限制：
  - pi-session close() → killConversationTerminals 的挂接不在本步范围，Step 2 落
  - bun 下无法真测 write 回流（Electron 下正常）；将来若 bun 修复可去掉 skipIf
  - node-pty 噪音：Windows 下每次 spawn 伴随 conpty_console_list agent 的 `AttachConsole failed` stderr 输出，无害可忽略
