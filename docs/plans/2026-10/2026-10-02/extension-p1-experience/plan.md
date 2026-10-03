# 扩展通道 P1 体验升级 实施计划

**目标**：用户浏览器扩展通道从「手动连接、抢占前台、移交直发」升级为「装好即用、agent 独立窗口后台干活、移交草稿可编辑」，并补齐 click 探索交互三处增强。

**架构思路**：设计文档见 [../extension-p1-experience-design.md](../extension-p1-experience-design.md)。三个主题六项改动全部在既有模块内演进，不新增协议帧、不新增错误码；agent 窗口靠 storage.local 记 windowId + 组锚定双源解析；移交草稿走「gateway 广播 → 前端 store → 输入框引用块」新链路，废弃 sendMessage 直发。

**涉及模块**：extension/（background.js、tab-commands.js、dom-actions.js、find-actions.js、popup）、electron/main/services/browser/（extension-handoff.ts、browser-gateway.ts）、electron/main/tipc/browser.ts、stores/handoff-draft-store.ts（新）、会话输入区组件。

## 步骤索引

- [x] [Step 1: 自动连接 + 去页面绑定 + popup 改造](./step1-auto-connect.md) — SW 冷启动自动连、断线 30s 重试、connect 不再绑焦点页、popup 按钮/断开语义
- [x] [Step 2: agent 独立窗口](./step2-agent-window.md) — open_tab 全部开进 Dogear 专属后台窗口（windowId 双源解析 + 自动重建）
- [x] [Step 3: 移交草稿引用](./step3-handoff-draft.md) — 移交不再直发会话，改前端草稿 store + 输入框引用块 + 待编辑通知
- [x] [Step 4: 探索交互增强](./step4-click-enhance.md) — click 新 tab 检测回报、_blank 焦点跟随、完整事件序列、find visible 标注

## 完成总结

P1 四步全部落地（bb664b98 / 76951423 / 5b422fdf / 本步），扩展版本 0.3.0，协议层零新增（无新帧、无新错误码），安全层零改动，桌面端仅移交草稿链路与 click 透传两处。

- 主题一（自动连接）：SW 冷启动自动连、断线/失败 30s alarm 重试、手动断开 storage.session 标记；connect 去页面绑定（hello 传 NO_FOCUS 哨兵 -1）；popup 改「把当前页交给 Dogear」焦点入口
- 主题一（独立窗口）：open_tab 全部开进 focused:false 后台窗口，windowId 三级解析（storage → 组锚定 → 新建）+ onRemoved 兜底重建
- 主题二（移交草稿）：handoff 广播 browserHandoffReceived → 前端草稿 store → 输入框引用块（可删/多条累加）→ 发送组装模板文本块；通知「待编辑」语义
- 主题三（探索增强）：click 前后组内 tab diff 检测新开页（~1.5s 轮询）+ 焦点跟随 + openedTab 回报；完整指针事件序列；find visible/[隐藏] 标注与 click 隐藏提示

遗留：全部需用户真机验证（重载扩展 0.3.0 + 重启应用），完整 11 条清单见共享区 20261003-step4-delivery.md；已知边界（targetHidden 判定口径、click 回包延迟 ~1.5s、通知 dedupeKey 去重）均记录在各 step 交付文档。

## 全局决策

- **manifest 版本 bump 0.2.0 → 0.3.0**：P0 期间「重载了没重载分不清」吃过亏，版本号必须能区分新旧代码
- 不新增协议帧类型、不新增 CommandErrorCode；扩展侧错误回包复用现有 13 个错误码
- 扩展侧代码无注释；`extension/src/nm-protocol.js` 与 `electron/.../nm-protocol.ts` 双副本锚点本次无协议变更、不动
- 每步真机验证由用户配合：扩展侧改动需 chrome://extensions 重载（↻）+ 观察；桌面端改动需重启应用
- 安全层（域名授权、提交确认、支付黑名单）零改动，任何 step 不得触碰
- 单文件超 300 行考虑拆分：background.js 现约 490 行，Step 1/4 的新逻辑优先放独立文件（如 connect-autoretry.js、click-watch.js），background 只留接线
