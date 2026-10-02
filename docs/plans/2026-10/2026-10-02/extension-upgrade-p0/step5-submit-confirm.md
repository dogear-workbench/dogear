---
step: 5
title: 提交类动作确认与支付黑名单
status: pending
---

## 目标
提交类操作从「永远硬拦截」升级为「确认后放行」，支付/网银域黑名单直接拒绝；动作分级（读放行 / 点击填表自动 / 提交确认 / 支付拒绝）完整落地。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step3-agent-tools.md] 工具层模板稳定，tab 循环可用。
- 当前关键文件状态：`extension/src/dom-actions.js` click 有 `guard_submit` 硬拦截（提交类按钮识别），回 `guard_submit` 错误码；`electron/main/services/browser/human-intervention.ts` 已有 raise/resolve/自动解除 + 全量广播的等待人工基建（内嵌阅读登录墙在用，内存态）；`site-policy.ts` 是内嵌/扩展共用的策略门控（navigateGate/policyGate/风控扫描）。
- 关键决策回顾：安全默认在扩展侧——confirmed 参数缺省仍拦截，桌面端确认后重发放行；支付/网银域确认也不放。

## 计划改动
- [ ] `extension/src/dom-actions.js` + `background.js`：click 命中 guard_submit 时若 `params.confirmed === true` 则直接执行；否则保持拦截，但错误 data 附 `{submitTarget: 按钮文本/描述}`（供确认卡展示）。
- [ ] `electron/main/services/browser/nm-protocol.ts` + `extension/src/nm-protocol.js`：click params 文档加 `confirmed?: boolean`（双副本同步）。
- [ ] `site-policy.ts`：新增支付/网银域名黑名单（内置常见域：银行/支付宝/微信支付/Stripe/PayPal 等，可后续在 settings 扩展）；命中域的 navigate/open_tab/click 一律拒绝，文案「支付与网银类站点已禁用 agent 操作」。
- [ ] `extension-tools.ts` click 工具：catch `guard_submit` → `raiseHumanIntervention`（附 submitTarget 与页面 url，等待用户在等待人工卡确认/拒绝，复用 BrowserInterventions 渲染）→ 用户确认后重发 `{ref, confirmed: true}`；用户拒绝则返回「用户已拒绝提交」文案。超时/自动解除按 human-intervention 现有语义。
- [ ] `human-intervention.ts`：确认现状是否支持「确认/拒绝」双分支（登录墙场景是 resolve 单分支）——若只有 resolve，扩一个 result 字段（approved/denied），广播结构向后兼容。
- [ ] 设置页（现场定位 browser 相关区块）：动作分级只读展示或全局开关「提交类：确认后放行（默认）/ 永远拦截」；P0 不做 per-site 配置。
- [ ] 验证：已授权域表单页触发提交按钮 → 等待人工卡出现（含按钮描述）→ 确认后提交成功 / 拒绝后返回文案；支付域任意操作直接拒绝；confirmed 缺省时旧链路行为不变（安全默认回归测试）。

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
