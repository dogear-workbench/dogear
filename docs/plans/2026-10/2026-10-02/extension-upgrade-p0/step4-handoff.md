---
step: 4
title: 一键移交
status: pending
---

## 目标
用户在任意网页右键（或 popup 按钮）「发送到 Dogear」，URL + 标题 + 选中文本 + 正文快照直达最近活跃会话，唤起链路 3+ 步 → 1 步。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step1-protocol-tabs.md] manifest 已含 contextMenus 权限；协议帧机制不变（page_handoff 是扩展主动推送帧，与 tab_snapshot 同类，非 command）。
- 当前关键文件状态：`extension/src/dom-actions.js` 有正文提取纯函数（read_text 用的 article/main 容器择优逻辑）；`browser-gateway.ts` `handleFrame` 按 type 分发（tab_snapshot/command_result/permission_state/...），broadcaster 广播 ExtensionStatus；通知中心基建见 infra 域（标题栏通知）。
- 关键决策回顾：路由拍板为「最近活跃会话直达 + 到达通知」（错发风险可见可控，频繁错发再补选择器）。

## 计划改动
- [ ] `extension/src/background.js`：
  - [ ] `chrome.runtime.onInstalled` 注册 contextMenus：`dogear-handoff-page`（contexts: ['page']，title「发送到 Dogear」）与 `dogear-handoff-selection`（contexts: ['selection']，title「发送选中内容到 Dogear」）；`onClicked` 处理（无需 popup 手势，contextMenus 点击即用户手势，可直接 executeScript 读正文）。
  - [ ] 打包 `{type: 'page_handoff', url, title, selectionText?, textExcerpt?}`：textExcerpt 用 executeScript 复用 dom-actions 正文提取，截断 4000 字符；未连接 NM 时提示「请先在扩展弹窗连接」（或静默忽略，现场取提示方案）。
- [ ] `extension/popup.{html,js}`：加「发送当前页到 Dogear」按钮（popup 点击同 gesture，可 executeScript）。
- [ ] `electron/main/services/browser/nm-protocol.ts`：类型注释补 `PageHandoffMessage`（纯文档性，帧通道通用）。
- [ ] `browser-gateway.ts`：`handleFrame` 加 `page_handoff` 分支 → 新增 `setHandoffHandler(fn)` 注册制回调（对齐 setExtensionStatusBroadcaster 模式），不进 ExtensionStatus。
- [ ] 会话路由（主进程接线处，现场确认）：查 `agents/pi-session/` 会话注册表拿「最近活跃 conversation」（有活动时间戳的排序），通过现有会话消息注入通道把移交内容作为用户侧输入发送；**无活跃会话时走系统通知「Dogear 未找到可接收的会话」**。注入格式：用户消息形态，内容含 url/title/selection/excerpt 并标注「来自浏览器一键移交」。
- [ ] 到达通知：通知中心发「已发送到会话 <标题>」（用户可关或保留，现场对齐通知中心现有分级）。
- [ ] 验证：Chrome 任意页右键发送 → Dogear 最近活跃会话收到完整上下文；选中文字时 selectionText 在场；无会话时收到通知。

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
