---
step: 2
title: gateway 多 tab 状态模型
status: pending
---

## 目标
gateway 从「单连接单 tab」泛化为「单连接 + Dogear 分组多 tab + 焦点 tab」，命令帧可指定目标 tabId，状态与快照按 tab 维护。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step1-protocol-tabs.md] 扩展已支持 open_tab/close_tab/list_tabs 命令与 tab_snapshot 多 tab 推送，协议 v4。
- 当前关键文件状态：`electron/main/services/browser/browser-gateway.ts` 的 `ExtensionStatus`（connected 分支）为单值字段 `tabId/title/url/textPreview/generation`；`sendExtensionCommand`（约 :270）从 `currentStatus` 取单 tabId 发帧；`applySnapshot` 已接收 message.tabId 但回退单值；`takeOver` 初始化 `authorizedOrigins: []`。
- 关键决策回顾：焦点 tab 模型见 plan.md；ownership（extension-ownership.ts）是通道级会话独占，天然覆盖多 tab，不改逻辑只改文案（busy 提示语不变）。

## 计划改动
- [ ] `ExtensionStatus` connected 分支：保留现有单值字段语义改为「焦点 tab」（渲染层 `ExtensionStatusLine.tsx` 等零改动），新增 `tabs: Array<{tabId: number; title: string; url: string; generation: number}>`。
- [ ] `takeOver`：初始 `tabs: []`；welcome 后主动发一条 `list_tabs` 命令或约定扩展 hello 后立即推送各受控 tab 快照（选扩展侧推送，gateway 零额外命令）。
- [ ] `applySnapshot`：按 message.tabId 更新 `tabs` 数组对应项；若 tabId === 焦点 tabId 同步更新单值字段；未知 tabId（如 open_tab 新页快照先到）追加进数组。
- [ ] `sendExtensionCommand(kind, params, timeoutMs, opts?: {tabId?: number})`：命令帧 tabId 用 `opts?.tabId ?? currentStatus.tabId`（焦点）。
- [ ] open_tab/close_tab/list_tabs 三命令的 gateway 前置校验：
  - `open_tab`：复用 `validateNavigateTarget(params.targetUrl, authorizedOrigins)`。
  - `close_tab`/`list_tabs`：不做 origin 校验（组内管理动作，扩展侧守组边界）。
  - 现有 `isOriginAuthorized(currentStatus.url, ...)` 的其他命令校验改为按**目标 tab 的 url**校验（焦点 tab 的 url，即 currentStatus.url，行为不变）。
- [ ] close_tab 成功后：从 `tabs` 移除；若关的是焦点，焦点回落到 `tabs` 中最后一项并同步单值字段（无剩余 tab 时状态保留 connected、tabId 置 -1 或空标记，工具层文案提示「分组已空，请 open_tab」）。
- [ ] `COMMAND_ERROR_CODES` 无新增；断连/takeOver 时 `tabs: []` 清空。
- [ ] 验证：连接扩展后（Step 1 已可手动触发命令）确认状态行、快照更新、焦点回落逻辑正确；`DOGEAR_EMBEDDED_BROWSER_SELFTEST` 模式参考——不强制写自测，手动验证即可。

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
