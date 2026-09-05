---
step: 2
title: bridge 分流 + named pipe 转发
status: pending
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
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
