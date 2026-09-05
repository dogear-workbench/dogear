---
step: 3
title: 域名授权链路
status: pending
---

## 目标

用户在 popup 一键授权/撤销当前域名，gateway 汇聚授权状态、命令前置校验 origin，设置页展示授权列表——「未授权域快速失败」闭环。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2-extension-actions.md] 四命令已在真实页面跑通（此时用临时硬授权或 about:blank 等价路径）；command_result 帧稳定
- 当前关键文件状态：`extension/manifest.json` permissions = [nativeMessaging, activeTab, scripting]；popup.js 已有 connect/get_state 3s 轮询模式；`ExtensionStatus` 联合类型（browser-gateway.ts:9-23）+ `ExtensionStatusLine.tsx` 全量快照收即渲染
- 关键决策回顾：授权粒度 = 当前页 origin；permissions API 必须用户手势（主进程不能代办撤销，设置页只展示）；authorizedOrigins 持久化在扩展 chrome.storage（SW 重启不丢，gateway 状态随连接重建）

## 计划改动

- [ ] `extension/manifest.json`：加 `optional_host_permissions: ["<all_urls>"]`（不动现有 permissions）
- [ ] `extension/popup.html` + `popup.js`：授权区——「授权此域名」按钮（手势内 `chrome.permissions.request({origins: [origin+'/*']})`）；已授权显示「已授权 ✓ | 撤销」（`chrome.permissions.remove`）；popup 打开与点击后 `chrome.permissions.getAll` 刷新展示
- [ ] `extension/src/background.js`：
  - 新增 `sendPermissionState()`：`chrome.permissions.getAll` → 推 `permission_state {origins: string[]}` 帧（hello 后立即推一次 + permissions.onAdded/onRemoved 监听推增量）
  - 连接建立（welcome 后）推全量；授权列表存 chrome.storage.local 冗余（SW 冷启恢复）
- [ ] `electron/main/services/browser/nm-protocol.ts`：`permission_state` 帧类型
- [ ] `electron/main/services/browser/browser-gateway.ts`：ExtensionStatus connected 分支加 `authorizedOrigins: string[]`（快照帧缺省空数组）；handleFrame 加 permission_state 分支合并 + 广播；`sendExtensionCommand` 前置校验命令 url 的 origin ∈ authorizedOrigins（否则 permission_denied 快速失败，不发出命令）
- [ ] `app/settings/ExtensionStatusLine.tsx`：connected 态渲染授权域名 chip 列表（只读展示；旁注「在扩展 popup 中撤销」）；`lib/events.ts` 类型自动流转
- [ ] 验证（headful 真实手势，无法全自动化的部分列人工清单）：
  - popup 授权当前域 → 主进程状态行出现 chip → observe 命令放行；撤销 → observe 返回 permission_denied
  - 未授权域（先 navigate 到新域）命令被 gateway 前置拦截
  - 重启 Edge（SW 冷启）→ 重连后 authorizedOrigins 恢复（chrome.storage 路径）
  - Edge 与 Chrome 各过一遍 permissions.request UI 差异（记录进回填）
- [ ] 回归：lint / build:electron / tsc / 管线 20/20

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
