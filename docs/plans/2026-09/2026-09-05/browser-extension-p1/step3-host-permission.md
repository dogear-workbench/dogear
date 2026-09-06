---
step: 3
title: 域名授权链路
status: done
---

## 目标

用户在 popup 一键授权/撤销当前域名，gateway 汇聚授权状态、命令前置校验 origin，设置页展示授权列表——「未授权域快速失败」闭环。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2-extension-actions.md] 四命令已在真实页面跑通（此时用临时硬授权或 about:blank 等价路径）；command_result 帧稳定
- 当前关键文件状态：`extension/manifest.json` permissions = [nativeMessaging, activeTab, scripting]；popup.js 已有 connect/get_state 3s 轮询模式；`ExtensionStatus` 联合类型（browser-gateway.ts:9-23）+ `ExtensionStatusLine.tsx` 全量快照收即渲染
- 关键决策回顾：授权粒度 = 当前页 origin；permissions API 必须用户手势（主进程不能代办撤销，设置页只展示）；authorizedOrigins 持久化在扩展 chrome.storage（SW 重启不丢，gateway 状态随连接重建）

## 计划改动

- [x] `extension/manifest.json`：加 `optional_host_permissions: ["<all_urls>"]`（不动现有 permissions）
- [x] `extension/popup.html` + `popup.js`：授权区——「授权此域名」按钮（手势内 `chrome.permissions.request({origins: [origin+'/*']})`）；已授权显示「已授权 ✓ | 撤销」（`chrome.permissions.remove`）；popup 打开与点击后 `chrome.permissions.getAll` 刷新展示
- [x] `extension/src/background.js`：
  - 新增 `sendPermissionState()`：`chrome.permissions.getAll` → 推 `permission_state {origins: string[]}` 帧（hello 后立即推一次 + permissions.onAdded/onRemoved 监听推增量）
  - 连接建立（welcome 后）推全量；授权列表存 chrome.storage.local 冗余（SW 冷启恢复）
- [x] `electron/main/services/browser/nm-protocol.ts`：`permission_state` 帧类型
- [x] `electron/main/services/browser/browser-gateway.ts`：ExtensionStatus connected 分支加 `authorizedOrigins: string[]`（快照帧缺省空数组）；handleFrame 加 permission_state 分支合并 + 广播；`sendExtensionCommand` 前置校验命令 url 的 origin ∈ authorizedOrigins（否则 permission_denied 快速失败，不发出命令）
- [x] `app/settings/ExtensionStatusLine.tsx`：connected 态渲染授权域名 chip 列表（只读展示；旁注「在扩展 popup 中撤销」）；`lib/events.ts` 类型自动流转
- [x] 验证（headful 真实手势，无法全自动化的部分列人工清单）：
  - popup 授权当前域 → 主进程状态行出现 chip → observe 命令放行；撤销 → observe 返回 permission_denied
  - 未授权域（先 navigate 到新域）命令被 gateway 前置拦截
  - 重启 Edge（SW 冷启）→ 重连后 authorizedOrigins 恢复（chrome.storage 路径）
  - Edge 与 Chrome 各过一遍 permissions.request UI 差异（记录进回填）
- [x] 回归：lint / build:electron / tsc / 管线 20/20

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. **manifest permissions 加 `storage`**（计划外必要依赖）：sendPermissionState 的 chrome.storage.local 冗余持久化需要 storage 权限，实测缺失时 chrome.storage undefined 抛 TypeError 被 catch 吞掉 → permission_state 帧静默不发。
  2. **授权变化推送改「popup 主动通知 + onAdded/onRemoved 事件」双路径**：popup grant/remove 完成后 sendMessage(dogear_permission_changed) 通知 SW 推送；permissions.onAdded/onRemoved 实测在 Edge 152 也能触发（双路径幂等各推一次），但 Chromium 版本行为不保证，popup 主动通知为可靠主路径。
  3. **归一化单一职责在扩展侧**：帧内 origins 已是 origin 形态（patternToOrigin 去尾部 `/*`），gateway 信任帧内容只做类型过滤，不做语义转换；`<all_urls>` 原样透传，gateway 校验时视为全放行。
  4. **popup 增加页 scheme 白名单**：http/https/ftp/file 之外的页面（chrome://、edge://、chrome-extension:// 等）显示「此页面无法按域名授权」，避免无效按钮。
  5. **Chrome 侧自动化验证不可行**：Chrome 137+ 稳定版移除 `--load-extension` 支持（Edge 未跟随），扩展无法注入 Chrome，permissions.request UI 差异列入人工清单。
- 改动文件清单：
  - `extension/manifest.json:7-8`：permissions 加 storage；optional_host_permissions
  - `extension/popup.html:35-59`：授权区样式 + #perm 容器
  - `extension/popup.js:30-113`：originFromUrl（scheme 白名单）/ getCurrentOrigin / isOriginGranted / renderPermission / refreshPermission；refresh 轮询并入授权刷新；授权/撤销后 sendMessage 通知 SW
  - `extension/src/background.js:71-95` patternToOrigin + sendPermissionState（getAll→归一化→storage 冗余→getAll 失败回退 storage）；:251 hello 后推；:258 welcome 后推；:283-289 onAdded/onRemoved 监听；:297-299 onMessage dogear_permission_changed 分支
  - `electron/main/services/browser/nm-protocol.ts:42-45`：PermissionStateMessage 接口
  - `electron/main/services/browser/browser-gateway.ts:26` authorizedOrigins 字段；:114 takeOver 重置空数组；:144-157 extractOrigin + isOriginAuthorized；:159-167 applyPermissionState；:228 handleFrame permission_state 分支；:261-266 sendExtensionCommand 前置校验（未授权 → permission_denied 快速失败，不发出命令）
  - `app/settings/ExtensionStatusLine.tsx:38-46`：授权域名 chip 列表（只读 + 旁注「撤销请在扩展弹窗中操作」）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - 上行帧 `{type:'permission_state', origins: string[]}`（origins 为 origin 形态如 `http://127.0.0.1:18777`，特殊值 `<all_urls>`）；gateway 收到后合并进 ExtensionStatus.connected.authorizedOrigins 并广播
  - `ExtensionStatus.connected.authorizedOrigins: string[]`（重连/接管重置空数组，快照/其他帧保留）
  - gateway 前置校验：sendExtensionCommand 时 `new URL(currentStatus.url).origin` ∈ authorizedOrigins（或含 `<all_urls>`）才发出，否则 reject `{errorCode:'permission_denied', error:'当前标签页域名未授权，请在浏览器扩展 Dogear 弹窗中授权此域名后重试'}`；url 无法解析（空/about:blank）同样拦截
  - SW→popup：`dogear_permission_changed`（popup→SW 方向）触发 SW 立即推 permission_state
- 下个 step 该从哪里继续：step4 工具层——dogear__browser__* 四命令接入扩展后端；permission_denied 的 gateway 侧文案已含引导（「请在浏览器扩展 Dogear 弹窗中授权此域名」），工具层可直接透传
- 待办或已知限制：
  - Chrome（137+ 稳定版）无法 --load-extension，Chrome 侧授权 UI/链路未自动化验证（人工清单）
  - 授权后立刻强杀浏览器（<5s）可能因权限持久化未落盘而丢失授权（安全方向失败，可接受）
  - popup 在 chrome:// 等不可授权页面显示「此页面无法按域名授权」；file:// 页 origin 为 `file://`，授权匹配按 origin 字符串进行
