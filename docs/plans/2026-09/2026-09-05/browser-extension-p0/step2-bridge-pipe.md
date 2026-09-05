---
step: 2
title: bridge 分流 + named pipe 转发
status: done
---

## 目标

主 exe 带 `--nm-host-bridge` 启动时成为哑转发进程：stdio 帧 ↔ `\\.\pipe\dogear-nm-gateway` 双向转发，stdin EOF 退出；无 flag 时正常启动零变化。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-extension-skeleton.md] extension/ 与 dev 注册脚本就位；帧协议语义见 `extension/src/nm-protocol.js`（4B LE 长度 + JSON，本 step 主进程侧按同语义实现 TS 版，**不 import extension/ 文件**）
- 当前关键文件状态：`electron/main/index.ts` 入口处有 `requestSingleInstanceLock` 调用（分流必须插它之前）；主进程服务初始化都在 app ready 之后
- 关键决策回顾：Electron 进程当 host 已接受 ~100MB/冷启动 1-2s 代价；pipe client 连接失败重试 3s（覆盖 Dogear 启动窗口期）后放弃退出

## 计划改动

- [ ] `electron/main/index.ts` 入口最前（import 后、一切 app 调用前）：`process.argv.includes('--nm-host-bridge')` → 进入 `runNmBridge()` 分支并 return，**不触** requestSingleInstanceLock / 窗口 / 服务初始化
- [ ] 新文件 `electron/main/services/browser/nm-bridge.ts`：`runNmBridge(): Promise<void>`——`app.disableHardwareAcceleration()`；帧转发循环（process.stdin ↔ net.connect pipe）；两侧任一 EOF/错误 → `app.exit(0)`；pipe 连接失败每 500ms 重试至 3s 后退出码 1（stderr 一行原因，stderr 不进协议）
- [ ] 主进程帧编解码 TS 实现放 `nm-bridge.ts` 内或独立小模块（与 extension/src/nm-protocol.js 语义一致）
- [ ] 验证脚本（临时 node，跑完删）：起假 pipe server → 经 dev bat 拉起 `electron.exe --nm-host-bridge` → 向 pipe 写 welcome 帧 → 从假 server 侧读 hello/从 bridge stdout 验证帧往返与断连退出
- [ ] 回归：无 flag 正常 `bun run dev` 启动无变化；`bun run build:electron` 通过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. index.ts 拆出 main-app.ts（module ES2020 不支持 top-level await、ESM 顶层无 return，改用「薄入口二选一动态加载」实现分流语义）；6 处 tipc 引用 ../index.js 改指 ../main-app.js
  2. bridge 转发为字节直通（Buffer passthrough）；帧编解码以独立模块 nm-protocol.ts 落地供 gateway 复用（接力棒允许二选一）
  3. **形态变更（已拍板）**：Electron app 模式启动时向 fd 1 固有写 2 字节 `\r\n`（任何用户代码之前，实测 ELECTRON_NO_ATTACH_CONSOLE/--disable-logging 等开关均无效），污染 NM 帧流 → 浏览器侧解析必挂，app 模式当 NM host 不可用。已改用 `ELECTRON_RUN_AS_NODE=1` + 同一 electron.exe 跑纯 Node worker（`resources/nm-host/nm-bridge-worker.cjs`，asar 外，纯 CJS 零依赖）；安装版 bat 与 dev 注册脚本同源指向它。原 app 分流（index.ts/nm-bridge.ts/main-app.ts）保留为防御路径
  4. process.stdin/stdout 在 Electron 主进程的 Node 包装层不可用（立即 EOF，RUN_AS_NODE 模式同样如此），worker 与防御路径均用 fs.createReadStream/WriteStream(null, {fd:0/1}) 直读句柄
- 改动文件清单：
  - electron/main/index.ts（重写为薄分流入口）
  - electron/main/main-app.ts（新，原 index.ts 全量搬移零修改）
  - electron/main/tipc/agent.ts / settings.ts / windows.ts（import 指向改 main-app.js）
  - electron/main/services/browser/nm-bridge.ts（新，runNmBridge，防御路径）
  - electron/main/services/browser/nm-protocol.ts（新，encodeNmFrame/makeNmDecoder/NM_GATEWAY_PIPE_PATH）
  - resources/nm-host/nm-bridge-worker.cjs（新，NM host 正式入口，纯 CJS 零依赖）
  - resources/nm-host/nm-host.bat（改：set ELECTRON_RUN_AS_NODE=1 + Dogear.exe 跑同目录 worker.cjs，CRLF）
  - scripts/register-nm-dev.mjs（改：生成的 dev bat 同源跑仓库内 worker.cjs）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `NM_GATEWAY_PIPE_PATH`（nm-protocol.ts 导出，gateway 复用）；`encodeNmFrame(msg): Buffer`；`makeNmDecoder(): {onFrame, push}`（语义与 extension/src/nm-protocol.js 一致，已对拍 5/5）
  - `runNmBridge(): Promise<void>`（nm-bridge.ts）：app.disableHardwareAcceleration → pipe 连接重试（500ms 间隔至 3s，失败 exit 1 + stderr 一行）→ 字节直通双向转发 → 任一 EOF/错误 exit 0
- 下个 step 该从哪里继续：gateway（electron/main/services/browser/browser-gateway.ts）pipe server 侧开工，直接复用 nm-protocol.ts；gateway 不受 host 形态影响
- 待办或已知限制：headful 手动验收（step1 遗留，链路已通可做）；安装版 extraResources 需含 resources/nm-host/（NSIS step 范围，当前 electron-builder.yml 未配）；worker 每连接一个进程，单会话语义由 gateway 层处理
