---
step: 1
title: 帧协议 v2 + gateway 命令通道
status: done
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
  1. `extension/src/nm-protocol.js` 无需改动：protocolVersion 只是 hello 消息字段，帧编解码器不动（已在交付文档说明）
  2. 验证脚本因本机安装版 Dogear 占用真实 pipe（不能杀），改为：拷贝编译产物到临时目录 + 仅替换临时拷贝的 pipe 路径常量为测试路径，产品代码零污染，验证的仍是同一份编译产物逻辑
  3. 失败 command_result 若缺/非法 errorCode，防御性兜底 `stale_protocol` + error 文案兜底「扩展返回了不合规的失败结果」（error 文案保证 step4 展示不误导；errorCode 不新造值）
  4. takeOver 除 handleDisconnect 外也 rejectAllPending（计划要求项，补齐「连接切换」场景）
- 改动文件清单：
  - `electron/main/services/browser/nm-protocol.ts:8-39`：ProtocolVersion=2、CommandKind、CommandErrorCode（12 值联合）、ExtensionCommand、CommandResult
  - `electron/main/services/browser/browser-gateway.ts:28-56`（CommandError/PendingCommand/超时与 errorCode 全集常量/pending map）、`:87-94`（rejectAllPending）、`:96-124`（takeOver 记录 protocolVersion + 清 pending）、`:142-176`（parseErrorCode + handleCommandResult）、`:185-190`（hello 解析 protocolVersion）、`:192-194`（command_result 分支）、`:206-212`（handleDisconnect 清 pending）、`:214-243`（sendExtensionCommand）
  - `extension/src/background.js:90`：hello 帧加 protocolVersion: 2
- 验证：自建 node 冒烟 14/14 PASS（not_connected / 响应 resolve / 超时+迟到回包忽略 / legacy v1 stale_protocol / 断连 reject / takeOver 清 pending+goodbye / 并发 requestId 关联 / guard_password 错误透传）；回归 build:electron ✓、lint 0 errors（本次改动文件零告警）✓、run-pipeline 20/20 ✓

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `sendExtensionCommand(kind: CommandKind, params: Record<string, unknown>, timeoutMs = 30000): Promise<CommandResult>`——成功 resolve `{requestId, ok: true, data?}`；失败 reject `{errorCode: CommandErrorCode, error: string}`（CommandError，gateway.ts:28）
  - 命令帧（主→扩展）：`{type:'command', requestId, tabId, url, kind, params}`，tabId/url 取自当前连接状态
  - 结果帧（扩展→主）：`{type:'command_result', requestId, ok: boolean, data?, error?, errorCode?}`——**ok 必须严格布尔**（gateway 用 `=== true` 判断），失败必须带 12 值 errorCode 之一，error 建议中文文案（gateway 原样透传给工具层）
  - `ExtensionStatus` connected 分支新增 `protocolVersion: number`（tipc extensionStatusChanged 推送 payload 已带，设置页可直接展示）
  - requestId 格式 `${Date.now()}-${seq}`，扩展侧只需原样回传
- 下个 step 该从哪里继续：step2 在扩展侧收 command 帧 → 校验 tabId/url → executeScript → 回 command_result；注意 command_result 的 ok 布尔 + errorCode 契约；若 url 快照未就绪（连接初期 url 为空串），扩展侧 url 前缀校验需容忍空串
- 待办或已知限制：gateway 命令前置校验 permission_denied（纵深防御）属 step3 授权模型；本验证未跑真机扩展（headful 链路属 step4 验收）；真实 pipe 被安装版占用的环境下 dev 实验需注意两实例 pipe 冲突
