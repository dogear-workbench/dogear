---
step: 1
title: 帧协议 v2 + gateway 命令通道
status: pending
---

## 目标

主进程侧命令通道就绪：protocolVersion 协商、command/command_result 帧、gateway pending map 与全生命周期清理——node 脚本冒烟可验证请求-响应/超时/断连，不依赖浏览器。

## 依赖上下文（接力棒输入）

- 前置：P0 已交付（见 git 07b43eb..5e5ea2c）；摸底报告共享区 browser-p1-context-survey.md §1/§2——帧协议现状 6 种消息、gateway 单会话状态机（`browser-gateway.ts:9-23 ExtensionStatus`、`:96-119 handleFrame`、`:33-37 safeWrite`）
- 设计依据：../browser-extension-p1-design.md「架构 1/2 节」——帧定义、超时 30s、降级语义、errorCode 全集
- 关键决策回顾：requestId 自增+时间戳；旧扩展（无 protocolVersion）连上后 sendExtensionCommand 一律 stale_protocol 快速失败，不静默丢命令

## 计划改动

- [ ] `electron/main/services/browser/nm-protocol.ts`：新增 `ProtocolVersion = 2` 常量与 `ExtensionCommand {requestId, tabId, url, kind, params}` / `CommandResult {requestId, ok, data?, error?, errorCode?}` / `CommandErrorCode`（12 值联合）类型导出
- [ ] `electron/main/services/browser/browser-gateway.ts`：
  - hello 处理读 `protocolVersion`（缺省视为 1），状态机记录 `protocolVersion`
  - 新增导出 `sendExtensionCommand(kind, params, timeoutMs = 30000): Promise<CommandResult>`——activeSocket 空抛语义错误对象（not_connected）；protocolVersion < 2 → stale_protocol；写帧 + 登记 pending map；超时 reject（timeout）清 timer
  - `handleFrame` 加 `command_result` 分支：requestId 命中 pending → ok ? resolve(data) : reject(errorCode/error)；未命中记日志忽略
  - `handleDisconnect` / `takeOver`：清空全部 pending 并 reject（disconnected）
- [ ] `extension/src/background.js`：hello 帧 + `protocolVersion: 2` 字段（一行，扩展侧其余不动，step2 再用）
- [ ] 验证脚本（临时，做完删）：node 直连 `\\.\pipe\dogear-nm-gateway` 模拟扩展——发 hello(v2) + command_result 回包验证 resolve；不回包验证 30s 超时（此处可用 timeoutMs=2000 短超时加速）；发 hello(v1) 验证 stale_protocol；模拟断连验证 pending 清理
- [ ] 回归：`bun run build:electron`、`bun run lint` 0 errors、`node resources/browser-eval/run-pipeline.mjs` 20/20（P0 快照链路无回归）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
