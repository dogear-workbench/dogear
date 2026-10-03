---
step: 2
title: 授权机制退役
status: done
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

- [x] `extension/src/tab-commands.js`：openTab 删授权校验分支与 getAuthorizedOrigins 引用
- [x] `extension/src/background.js`：删 `:361` 命令级域校验分支；删 authorizedOrigins storage 读写（:186-191 附近）；删 permission_state 发送调用；顶层一次性 `chrome.storage.local.remove('authorizedOrigins')`（幂等清理存量）
- [x] `extension/popup.html` + `popup.js`：授权管理 UI 与逻辑整体移除
- [x] `extension/manifest.json`：version 0.3.0 → 0.4.0
- [x] `electron/main/services/browser/browser-gateway.ts`：
  - `validateNavigateTarget` 删授权检查（保留 targetUrl 非空/合法 URL/http-https 协议检查）
  - `sendExtensionCommand` 删非 tab 命令的 `isOriginAuthorized` 拦截（close_tab/list_tabs 本就不查）
  - 删 `applyPermissionState` 与 handleFrame 的 permission_state 分支；`extractOrigin`/`isOriginAuthorized` 若无其他引用一并删
  - currentStatus 的 authorizedOrigins 字段与 takeOver 初始化删（状态类型同步）
- [x] `electron/main/agents/tools/extension-command-shared.ts`：SHARED_SCOPE_NOTE 改写（删「仅限已授权域名」/「授权」表述，改为「导航不受域名限制；支付与网银域名一律禁用」）；navigation_blocked 文案改为纯「无法导航」（不再提授权）；permission_denied 映射保留原文案（不再触发，防协议旧版扩展）
- [x] `extension-tools.ts` / `extension-tab-tools.ts` 等工具描述中提「授权」的表述清理（grep「授权」全扫）
- [x] 渲染层如引用 authorizedOrigins 状态（设置页/浏览器状态展示）同步清理（grep 确认无引用）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. background.js `:361` 实为 executeScript 注入失败的 `isPermissionError` → permission_denied 处理段（非显式域校验），按语义连同 `isPermissionError` 一并删；注入异常统一走 navigated_away / lost-click 兜底
  2. `commandErrorMessage` 的 navigation_blocked 旧文案 `includes('目标域名未授权')` 识别条件随默认文案退役删除
  3. **验收补救**：manifest `optional_host_permissions` 改硬声明 `host_permissions: ["<all_urls>"]`——授权 UI 删除后新装用户无入口获得 optional host 权限，而 observe/click/fill 全依赖 executeScript 注入（activeTab 不覆盖 NM 后台驱动），不硬声明则扩展通道对新装用户整体不可用
  4. closeTab 的 `permission_denied`（「仅能关闭 Dogear 分组内的标签页」）是组内保护非域名授权，保留
- 改动文件清单（commit 见 plan）：extension/src/tab-commands.js、extension/src/background.js、extension/popup.html、extension/popup.js、extension/manifest.json（0.4.0）、electron/main/services/browser/browser-gateway.ts、extension-command-shared.ts、extension-tab-tools.ts、extension-tools.ts、extension-site-tools.ts；验证 node --check ×3 + JSON.parse + lint 0 errors + build:electron 通过

### 给下一步的接力棒
- 关键签名 / 数据结构：`validateNavigateTarget(targetUrl: unknown)` 单参（browser-gateway.ts:172，消费方 extension-tab-tools.ts:118 与 sendExtensionCommand）；`ExtensionStatus` connected 分支不再有 authorizedOrigins；域级防线现状仅工具层 `isPaymentBlocked`（site-policy）
- 下个 step 该从哪里继续：step3 从 site-policy.ts 的 PAYMENT_BLOCKED_HOSTS 常量开始，加 setPaymentBlockedHosts 注入 + settings schema
- 待办或已知限制：扩展 0.4.0 需用户在 chrome://extensions 重载生效（新增硬声明 host 权限，重载/更新时 Chrome 可能弹新权限确认）；旧版扩展发 permission_state 被按未知帧忽略，兼容安全；真机验证留 step4
