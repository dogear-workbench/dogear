---
step: 2
title: 授权机制退役
status: pending
---

## 目标

域名授权三处校验、授权 UI、permission_state 收发、authorizedOrigins 存量数据整体退役；agent 独立窗口内导航与操作不再受域级限制（支付黑名单成为唯一域级防线）。

## 依赖上下文（接力棒输入）

- 授权相关代码分布（2026-10-03 核实）：
  - 扩展侧：`extension/src/tab-commands.js:23`（读 authorizedOrigins）`:96`（openTab 校验）；`extension/src/background.js:186-191`（授权读写）、`:361`（命令级校验 permission_denied）；popup 授权管理 UI（popup.html/js）
  - gateway：`browser-gateway.ts` `validateNavigateTarget`（授权段在 `isOriginAuthorized` 检查）、`sendExtensionCommand` 非 tab 命令的 origin 检查、`applyPermissionState`（permission_state 帧消费）、currentStatus.authorizedOrigins 字段
  - 工具层：`extension-command-shared.ts` SHARED_SCOPE_NOTE（含「仅限已授权域名」表述）、ERROR_MESSAGES 的 navigation_blocked/permission_denied 映射文案
- 关键决策：协议帧定义（nm-protocol 双副本）**保留不删**，只停发停消费；错误码与映射保留（组空态判断 `isEmptyGroup` 依赖 permission_denied 分支，保留）

## 计划改动

- [ ] `extension/src/tab-commands.js`：openTab 删授权校验分支与 getAuthorizedOrigins 引用
- [ ] `extension/src/background.js`：删 `:361` 命令级域校验分支；删 authorizedOrigins storage 读写（:186-191 附近）；删 permission_state 发送调用；顶层一次性 `chrome.storage.local.remove('authorizedOrigins')`（幂等清理存量）
- [ ] `extension/popup.html` + `popup.js`：授权管理 UI 与逻辑整体移除
- [ ] `extension/manifest.json`：version 0.3.0 → 0.4.0
- [ ] `electron/main/services/browser/browser-gateway.ts`：
  - `validateNavigateTarget` 删授权检查（保留 targetUrl 非空/合法 URL/http-https 协议检查）
  - `sendExtensionCommand` 删非 tab 命令的 `isOriginAuthorized` 拦截（close_tab/list_tabs 本就不查）
  - 删 `applyPermissionState` 与 handleFrame 的 permission_state 分支；`extractOrigin`/`isOriginAuthorized` 若无其他引用一并删
  - currentStatus 的 authorizedOrigins 字段与 takeOver 初始化删（状态类型同步）
- [ ] `electron/main/agents/tools/extension-command-shared.ts`：SHARED_SCOPE_NOTE 改写（删「仅限已授权域名」/「授权」表述，改为「导航不受域名限制；支付与网银域名一律禁用」）；navigation_blocked 文案改为纯「无法导航」（不再提授权）；permission_denied 映射保留原文案（不再触发，防协议旧版扩展）
- [ ] `extension-tools.ts` / `extension-tab-tools.ts` 等工具描述中提「授权」的表述清理（grep「授权」全扫）
- [ ] 渲染层如引用 authorizedOrigins 状态（设置页/浏览器状态展示）同步清理

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
