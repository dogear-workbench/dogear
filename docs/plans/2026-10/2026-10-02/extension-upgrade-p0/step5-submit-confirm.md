---
step: 5
title: 提交类动作确认与支付黑名单
status: done
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
  1. human-intervention 未用「reason == guard_submit 即双按钮」的隐式判定，而是 raise 新增 `confirmMode?: boolean` 显式标记——内嵌通道 guard_submit（本 step 未升级、仍硬拦截）复用同一渲染组件，若按 reason 隐式判定会让内嵌用户看到无放行效果的确认按钮；显式标记后仅扩展链路传 true，将来内嵌升级直接复用。广播结构向后兼容（可选字段）。
  2. submitTarget 透传链路需扩三处既有结构：extension fail() 支持 data → CommandError.data → runCommand 返回值 data（原错误路径丢 data，只有 error/errorCode/currentUrl）。
  3. 设置页选择「只读展示」形态：新增 tipc RPC `getBrowserActionPolicy` 返回分级说明与黑名单域名列表（单点在 site-policy.ts），不做全局开关（确认放行已含用户控制语义，再加「永远拦截」开关属 P1 per-site 配置范畴）。
  4. waiter 等待加 5 分钟超时兜底（`SUBMIT_CONFIRM_TIMEOUT_MS`），超时自动返回未执行文案；原 human-intervention 无超时机制，工具永久挂起不可接受。等待期间扩展通道独占锁无冲突（IDLE_RELEASE_MS 10 分钟 > 5 分钟超时）。
- 改动文件清单：
  - `extension/src/dom-actions.js`：clickFn(ref, confirmed)，confirmed !== true 且命中提交类拦截，附 submitTarget（按钮文本/aria-label/value 等，截断 60 字）；文案改「需用户确认后执行」
  - `extension/src/background.js`：click args 传 `[p.ref, p.confirmed]`；fail() 支持附加 data，guard_submit 时透传 `{submitTarget}`
  - `extension/src/nm-protocol.js` + `electron/main/services/browser/nm-protocol.ts`：双副本同步 click params `{ ref, confirmed? }`（ts 侧新增 `ClickCommandParams`）
  - `electron/main/services/browser/site-policy.ts`：`PAYMENT_BLOCKED_HOSTS`（25 域：支付宝/微信支付/PayPal/Stripe/Adyen/12 家主要银行等，hostname 后缀匹配）+ `isPaymentBlocked` / `paymentBlockedMessage` / `ACTION_LEVEL_NOTES` / `paymentBlockedHosts`
  - `electron/main/services/browser/browser-gateway.ts`：`CommandError.data?` 透传
  - `electron/main/agents/tools/extension-command-shared.ts`：`ERROR_MESSAGES.guard_submit` 与 `SHARED_SCOPE_NOTE` 文案更新；runCommand 错误返回透传 data
  - `electron/main/agents/tools/extension-tools.ts`：click 工具 catch guard_submit → raiseHumanIntervention(confirmMode) → `waitForInterventionResult`（5 分钟）→ approved 重发 `{ref, confirmed:true}` / denied 与 timeout 返回未执行文案；navigate 入口支付黑名单前置；fill 尾部文案更新
  - `electron/main/agents/tools/extension-tab-tools.ts`：open_tab 入口支付黑名单前置
  - `electron/main/services/browser/human-intervention.ts`：`InterventionResult`（approved/denied）、`resolveHumanIntervention(id, by, result?)` 三参、`waitForInterventionResult(id, timeout)`（waiter 注册/唤醒/超时/missing）、返回值加 `waiterConsumed`；同 tab 刷新清 result
  - `electron/main/tipc/browser.ts`：resolveHumanIntervention input 加 `result?`，waiterConsumed 时跳过 resumeConversation（避免双重唤醒）；新 RPC `getBrowserActionPolicy`
  - `components/companion/BrowserInterventions.tsx`：confirmMode 请求渲染「确认提交/拒绝」双按钮，其余保持「完成后继续」
  - `app/settings/ExtensionStatusLine.tsx`：新增 `ExtensionActionPolicyNote` 只读展示（分级 4 条 + 黑名单域名）
  - `app/settings/BehaviorTab.tsx`：「浏览器扩展」区块引入展示组件

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `waitForInterventionResult(id, timeoutMs): Promise<'approved' | 'denied' | 'auto' | 'timeout' | 'missing'>`；resolve 时有 waiter 则唤醒并 waiterConsumed=true（tipc 层不再 resume）
  - 扩展通道等待人工 tabId 约定 `ext-{tabId}`，与内嵌 tabId 空间隔离
  - confirmed 只在桌面端工具内部追加重发，agent 工具 schema 不暴露该参数（安全默认）
- 下个 step 该从哪里继续：P0 五步全部完成；内嵌通道（browser-action-tools 的 ActionGuardError guard_submit）如需同样「确认后放行」，可直接复用 confirmMode + waitForInterventionResult 基建
- 待办或已知限制：
  - 真机手测未做（无浏览器环境）：①已授权域表单页提交 → 确认卡出现（含按钮文本）→ 确认后提交成功/拒绝后返回文案；②支付宝等黑名单域 navigate/open_tab/click 直接拒绝；③不传 confirmed 时扩展侧仍拦截（安全默认回归）
  - 支付黑名单仅内置 25 域，settings 扩展黑名单留 P1（isPaymentBlocked 单点可扩）
  - 内嵌通道 guard_submit 仍为硬拦截（「完成后继续」单按钮），未在 P0 范围
