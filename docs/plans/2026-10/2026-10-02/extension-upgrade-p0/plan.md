# 扩展通道升级 P0 实施计划

**目标**：把扩展通道从「单标签页手动连接」升级为「Dogear 分组多标签页 + 一键移交 + 提交类确认后放行」，落地路线设计（`../browser-roadmap-design.md`）的 P0 五项。

**架构思路**：扩展现有 NM 架构不推翻——协议 v4 加 tab 管理命令与 page_handoff 推送帧，gateway 状态从单 tab 泛化为「焦点 tab + 分组 tab 列表」，agent 工具层加 open_tab/close_tab/list_tabs 三个工具沿用现有模板（acquireGate → 策略门控 → runCommand → emitAction）。排除的选项：optional permissions 运行时申请（需用户手势，agent 触发不了）；ownership 并行多分组（P0 维持通道级会话独占，避免回归）。

**涉及模块**：`extension/manifest.json`、`extension/src/background.js`、`extension/src/nm-protocol.js`、`extension/popup.{html,js}`、`electron/main/services/browser/nm-protocol.ts`、`browser-gateway.ts`、`site-policy.ts`、`human-intervention.ts`、`browser-action-stream.ts`、`electron/main/agents/tools/extension-tools.ts`、`stores/browser-store.ts`、`components/companion/BrowserPanel.tsx`、会话路由（pi-session 会话管理，Step 4 现场确认接口）。

## 步骤索引

- [x] [Step 1: 协议 v4 与扩展侧 tab 管理](./step1-protocol-tabs.md) — manifest 加 tabs/tabGroups/contextMenus 权限，双侧协议加 open_tab/close_tab/list_tabs 命令，SW 实现 Dogear 分组管理
- [x] [Step 2: gateway 多 tab 状态模型](./step2-gateway-tabs.md) — ExtensionStatus 泛化为焦点 tab + tabs 数组，命令帧带目标 tabId，快照按 tab 更新
- [x] [Step 3: agent 工具 open_tab/close_tab/list_tabs](./step3-agent-tools.md) — 三个新工具注册 + 焦点模型文案 + 动作流事件与面板渲染
- [x] [Step 4: 一键移交](./step4-handoff.md) — 右键菜单「发送到 Dogear」打包 URL+选中文本+正文快照，路由到最近活跃会话 + 通知
- [x] [Step 5: 提交类动作确认与支付黑名单](./step5-submit-confirm.md) — guard_submit 从硬拦截升级为确认后放行（复用 human-intervention），site-policy 加支付/网银黑名单

## 全局决策

- **现状修正**（较路线设计文档乐观）：`find`/`scroll` 工具已在 `extension-tools.ts` 注册（P1 工具补齐只剩 readArticle/wait_for）；授权列表已有扩展侧 storage.local 持久化 + 重连重推；guard_password/guard_submit 硬护栏已有。codebase-map/browser.md 完成后 doc-sync 修正。
- **焦点 tab 模型**：open_tab 开新 tab 并设为操作焦点（background 参数可选不抢用户前台焦点）；observe/click/fill/read_* 作用于焦点 tab；不引入 select_tab（list_tabs 返回焦点标记；close_tab 关焦点或指定 tab，关后焦点回落到剩余最近使用 tab）。
- **Dogear 分组**：agent 开的 tab 一律 `chrome.tabGroups` 入「Dogear」彩组，与用户 tab 区分；close_tab 只能关组内 tab；SW 休眠恢复用 `tabGroups.query({title})` 而非内存集合。
- **域名授权不变**：open_tab 目标域必须在 authorizedOrigins（复用 validateNavigateTarget 语义）；未授权域名开了也注入不了，直接在桌面端拒绝并提示。
- **协议版本** 3 → 4：新命令属于新能力；`sendExtensionCommand` 已有 stale_protocol 门控，旧扩展升级后自动提示重载，无需兼容分支。
- **双副本同步纪律**：`nm-protocol.ts` ↔ `extension/src/nm-protocol.js`、`page-state.ts` ↔ `extension/src/page-state.js` 改一边必改另一边。
- **工具命名**：`dogear__extension__open_tab` / `close_tab` / `list_tabs`；错误一律中文 isError 文案（ERROR_MESSAGES 全覆盖），不抛异常；文件末尾 registerToolGroup 模式不变。
- **工程约束**：extension/ 不进 tsc/eslint 工程；主进程改动需 `build:electron`；nm-bridge-worker.cjs 是透传桥不动；不写注释、不留 TODO、>300 行拆分。
- **动作分级落地形态**：读默认放行、点击/填表自动（现状）、提交类「确认后放行」（Step 5 新增，扩展侧默认仍拦截，仅 params.confirmed 放行——安全默认在扩展侧，桌面端确认后重发）；支付/网银黑名单域确认也不放。

## 完成总结

P0 五步全部完成（2026-10-02）：

1. **协议 v4 与扩展侧 tab 管理**（828bd39b）：双侧协议升级 v4，扩展新增 open_tab/close_tab/list_tabs 命令（Dogear 蓝组、组外拒关、焦点按 lastAccessed 回落），manifest 加 tabs/tabGroups/contextMenus 权限。
2. **gateway 多 tab 状态模型**（9f51d46a）：ExtensionStatus 泛化为焦点 tab + tabs 数组（拆 gateway-tab-state.ts 纯函数模块），命令帧可指定目标 tabId，open/close 回包与快照双链路闭环焦点切换，扩展 welcome 后推送组内 tab 快照。
3. **agent 三工具**（4f4df762）：open_tab/close_tab/list_tabs 走 acquireGate→策略门控→runCommand 模板，动作流面板渲染开页/关页/列页签卡片，组空态文案统一，共享辅助拆 extension-command-shared.ts。
4. **一键移交**（6385ea64）：网页右键/popup「发送到 Dogear」打包 URL+标题+选中文本+4000 字正文快照，路由到存活会话中 updatedAt 最新者注入用户消息，通知中心到达通知，无会话时提示。
5. **提交类确认与支付黑名单**（本次提交）：guard_submit 升级为确认后放行（human-intervention 扩双分支 confirmMode + waiter 5 分钟超时），agent schema 不暴露 confirmed 无法绕过，支付/网银 25 域黑名单 navigate/open_tab/click 一律拒绝，设置页动作分级只读展示。

**待用户真机验证**（各 step 均无浏览器环境未手测）：chrome://extensions 重载扩展后验证 tab 三命令循环、一键移交、提交确认卡、支付黑名单拒绝；步骤级验证点见各 stepN 文档「实施回填」段。

**留 P1**：内嵌通道 guard_submit 同样升级确认放行（基建已就绪）、支付黑名单 settings 动态配置、readArticle/wait_for 工具补齐。
