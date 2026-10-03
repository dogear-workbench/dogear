# 扩展通道 P1.5：确认弹窗 + 授权放开 实施计划

**目标**：人工等待以应用级模态弹窗直接打扰用户（三按钮：确认执行/拒绝/已手动操作）；域名授权机制整体退役（动作级护栏成为唯一防线）；支付黑名单 settings 化。

**架构思路**：呈现层改造（渲染层 dialog + 主进程置前）+ outcome 扩展（manual），拦截链路零改动；授权三处校验/授权 UI/permission_state 发送与消费整体退役（协议帧定义保留防破坏）；黑名单用户列表与内置默认并集。详见 [design.md](./design.md)。

**涉及模块**：
- 渲染层：`components/HumanInterventionDialog.tsx`（新）、`stores/browser-store.ts`
- 主进程：`electron/main/tipc/browser.ts`（置前）、`services/browser/human-intervention.ts`（manual/超时清 pending）、`services/browser/browser-gateway.ts`（授权退役）、`agents/tools/extension-command-shared.ts` + `extension-tools.ts`（文案/manual 分支）、`services/browser/site-policy.ts`（黑名单注入）
- 扩展：`extension/src/tab-commands.js`、`background.js`、`popup.html/js`、`manifest.json`
- 设置：`settings.json` schema、设置页

## 步骤索引

- [x] [Step 1: 确认弹窗与三按钮 outcome](./step1-confirm-dialog.md) — 模态弹窗 + 主窗口置前 + manual outcome + 超时清 pending
- [ ] [Step 2: 授权机制退役](./step2-auth-teardown.md) — 三处校验退役 + 授权 UI/存储清理 + permission_state 停发 + 扩展 0.4.0
- [ ] [Step 3: 支付黑名单 settings 化](./step3-payment-settings.md) — settings 用户列表与默认并集 + 设置页编辑区
- [ ] [Step 4: 真机验证](./step4-manual-verify.md) — 弹窗三按钮/超时收口/授权放开/黑名单拦截全清单

## 全局决策

- **协议零新增/零删除**：nm-protocol 双副本不动；permission_state 只停发停消费；`permission_denied`/`navigation_blocked` 错误码与映射保留不删
- **拦截链路零改动**：guard_submit 的 raise/waitFor/executeClick(true) 链路保持，只加 manual 分支
- **审计日志保留**：人工等待上报/解除、确认操作到达主进程、click 命令结果、焦点页面导航四点 WARN 日志是既有资产，改动不得移除
- **扩展版本 0.4.0**，manifest bump 与 popup UI 改动同步
- lint 标准：`bun run lint` 0 errors；扩展侧 js 过 `node --check`
- 每步完成：step 文档回填 + plan.md 打勾 + 独立 commit；主进程改动需 `bun run build:electron`
