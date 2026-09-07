---
step: 1
title: 帧协议 navigate 命令 + gateway 路由
status: done
---

## 目标

帧协议支持 navigate 命令与快照代际，gateway 侧完成路由与目标域名授权校验——纯主进程 + 协议层改动，node 可单测。

## 依赖上下文（接力棒输入）

- 前置：P1 已完成（commit 245dabc 等），`nm-protocol.ts` 现有 `CommandKind = 'observe' | 'click' | 'fill' | 'read_text'`、12 个 `CommandErrorCode`、帧格式 4B LE + JSON
- 当前关键文件状态：`electron/main/services/browser/nm-protocol.ts`（95 行）类型定义；`browser-gateway.ts`（302 行）有 `sendExtensionCommand` / `getExtensionStatus` / `takeOver`，P1 已有命令前置 origin 校验（未授权域命令不发出）
- 关键决策回顾：navigate 是「工作区 tab」模型的核心——agent 把已连接 tab 导航到任意**已授权**域名（真实导航，非合成点击）；授权语义与 P1 的操作命令校验同源（authorizedOrigins）

## 计划改动

- [ ] `nm-protocol.ts`：`CommandKind` 加 `'navigate'`；命令 payload 加 `targetUrl`（navigate 专用）；`tab_snapshot` 帧加 `generation: number` 字段；`CommandErrorCode` 加 `'navigation_blocked'`
- [ ] `extension/src/nm-protocol.js`：同步以上帧结构改动（两份实现语义一致）
- [ ] `browser-gateway.ts`：
  - navigate 命令路由进 `sendExtensionCommand` 现有通道（复用 pending map / 超时 / 断连清理，不另起机制）
  - navigate 前置校验：`new URL(targetUrl)` 的 origin ∈ authorizedOrigins，否则**不发命令**直接 resolve `navigation_blocked`（对齐 P1 permission_denied 的「前置拦截不发出」模式）
  - 校验 targetUrl 是 http/https（拒绝 javascript: / file: 等）
  - gateway 侧连接状态 url 跟随 navigate 成功结果更新
- [ ] `extension-tools.ts` 的 `ERROR_MESSAGES` 补 `navigation_blocked` 中文文案（「目标域名未授权，请在扩展弹窗授权后重试」）——工具函数本 step 不实现 navigate 工具，只补映射保证类型完备
- [ ] 单测：node 脚本验证（复用 `resources/browser-eval/` 模式）——navigate 未授权域拦截、非 http 协议拒绝、帧编解码含新字段

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. `extension/src/nm-protocol.js` 零运行时改动——它是纯字节层编解码（无 kind/errorCode 枚举与消息 schema），帧格式不变（4B LE + JSON、64MB）则两份实现语义天然一致；新字段兼容性由 `nm-navigate-smoke.mjs` 帧级 roundtrip 用例证明
  2. gateway 额外把 `generation` 解析进 `ExtensionStatus.connected`（takeOver 初始 0，applySnapshot 跟随帧值；旧扩展 snapshot 无 generation 则保持当前值）——协议字段的 gateway 侧落地，协议版本不 bump（纯新增可选字段向后兼容，P1 旧扩展配新 gateway 不受影响）
  3. navigate 分支**跳过** P1 的「当前页域 permission_denied」校验，只做目标域校验——工作区模型语义（把 tab 从任意页面导航到已授权域，入口场景当前页可能未授权）；授权语义与 P1 同源（authorizedOrigins，含 `<all_urls>` 通配）
- 改动文件清单：
  - `electron/main/services/browser/nm-protocol.ts`：CommandKind 加 navigate、CommandErrorCode 加 navigation_blocked、新增 NavigateCommandParams / TabSnapshotMessage 接口
  - `electron/main/services/browser/browser-gateway.ts`：导出 `validateNavigateTarget` 纯函数、sendExtensionCommand navigate 前置校验分支（拦截不发命令）、PendingCommand 记 kind、navigate 成功结果 data.url 同步 status.url、applySnapshot 解析 generation
  - `electron/main/agents/tools/extension-tools.ts`：ERROR_MESSAGES 补 navigation_blocked（Record 全键完备由 tsc 证明）
  - `resources/browser-eval/nm-navigate-smoke.mjs`（新增）：node 单测，validateNavigateTarget 从 dist 编译产物 import

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `sendExtensionCommand(kind, params, timeoutMs?)`：navigate 时 `params.targetUrl: string`，校验失败 `Promise.reject({ errorCode: 'navigation_blocked', error })`，命令帧不发出
  - `validateNavigateTarget(targetUrl: unknown, authorizedOrigins: string[]): CommandError | null`（browser-gateway.ts 导出，纯函数，三查：字符串非空 → URL 可解析 → http/https → origin 已授权）
  - navigate 成功约定：扩展侧 `command_result` 的 `data` 带 `{ url: string }`（导航后最终 URL），gateway 据此同步 status.url；随后扩展还应回推新 tab_snapshot（generation 递增）
  - `TabSnapshotMessage.generation: number` 协议字段已就位，gateway 存于 `ExtensionStatus.connected.generation`
- 下个 step 该从哪里继续：step2 background.js——COMMAND_FUNCS 加 navigate 处理（chrome.tabs.update → 等加载完成 → 回推含 generation 的 snapshot + data.url）；所有 snapshot 推送统一带 generation（内存 Map<tabId, generation>）；URL 变化节流重采
- 待办或已知限制：
  - ERROR_MESSAGES 的 navigation_blocked 文案固定为「目标域名未授权…」，但非 http 协议 / 非法 URL 拦截共用同一 errorCode，工具层文案会不准（gateway 的 error detail 有具体原因）——step3 实现 navigate 工具时建议入口先校验 URL 形态或对 detail 特判
  - 单测覆盖纯函数与帧级；真实 named pipe 全链路验证留待 step4 真机
