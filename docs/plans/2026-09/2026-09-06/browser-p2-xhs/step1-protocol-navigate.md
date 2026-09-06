---
step: 1
title: 帧协议 navigate 命令 + gateway 路由
status: pending
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
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
