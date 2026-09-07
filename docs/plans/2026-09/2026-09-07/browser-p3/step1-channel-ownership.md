---
step: 1
title: A1 扩展通道会话独占
status: done
---

## 目标

并行子会话互踩单 tab 的根因修复：同一时刻只允许一个 conversation 持有扩展通道，后来者收明确报错。

## 依赖上下文（接力棒输入）

- 当前关键文件状态：`electron/main/agents/tools/extension-tools.ts` 的 `createExtensionToolDefs(opts?: { conversationId?: string })` 给 5 个工具闭包注入 conversationId；每个工具 handler 已有 policyGate / navigateGate 前置模式可对齐
- `getExtensionStatus()`（browser-gateway.ts:79）返回连接状态，可判断断连
- 关键决策回顾：不做排队（随机延迟下等待不可预期）；无 conversationId 的 adhoc 调用不参与独占；空闲 10 分钟自动释放防误锁死

## 计划改动

- [ ] 新建 `electron/main/services/browser/extension-ownership.ts`：纯逻辑模块（无 IO，便于冒烟）
  - `acquireChannel(conversationId, now): { ok: true } | { ok: false; busy: true }`——同 owner 续期 / 空闲超时释放后新 owner 可获取 / 不同 owner 返回 busy
  - `releaseChannel(conversationId)` / `resetChannel()`（断连清零）
  - 模块级常量 `IDLE_RELEASE_MS = 10 * 60 * 1000`
- [ ] `electron/main/agents/tools/extension-tools.ts`：5 个工具 handler 入口（policyGate 之前）统一调 `acquireChannel`；busy → `emitAction(result: 'busy')` + isError 文案「扩展通道正被另一个会话使用（已空闲 N 分钟），请等它完成后再试；若需并行调研，请改串行派遣或使用受控浏览器工具」；`currentUrl()`/status 为 disconnected 时调 `resetChannel()`
- [ ] `electron/main/agents/tools/extension-tools.ts` 顶部 `SHARED_SCOPE_NOTE` 加一句「扩展通道同一时间仅一个会话可用」
- [ ] `electron/main/services/settings-types.ts:263` 浏览器解析 description 更新（加独占提示 + 后续步骤的 read_state 能力说明可一并预留）
- [ ] `electron/main/services/settings-service.ts:294` 附近：browser-parse 的 description 做「已知旧值 → 新值」迁移（旧值字符串 `'挂载扩展工具包在用户真实浏览器（登录态站点如小红书）执行只读调研，或用受控浏览器读取公开网页'` 精确匹配才替换，用户自定义描述不动）
- [ ] `resources/browser-eval/extension-ownership-smoke.mjs`：三断言组——不同 owner busy / 空闲超时后可夺取 / 同 owner 续期与显式 release；`node` 执行过 dist 编译产物
- [ ] `bun run build:electron` 编译通过 + 现有 `site-policy-smoke.mjs` 不回归

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - `acquireChannel` busy 返回值扩展为 `{ ok: false; busy: true; idleMs: number }`（idleMs 供 busy 文案拼「已空闲 N 分钟」，N = max(1, floor(idleMs/60000))）
  - 断连清零除 handler 入口检查外，另在 `browser-gateway.ts` `handleDisconnect` 直接调 `resetChannel()`（否则「断连→重连」窗口内通道粘滞在新连接上，handler 入口检查永远检测不到 disconnected）
  - `site-policy-smoke.mjs` 在 CONV_RISK / CONV_PLAIN 场景切换前加 `resetChannel()`（独占语义下多会话交替需显式释放，属新语义适配非回归）
  - description 更新未预留 read_state 能力说明（工具未实现前描述不超前；read_state step 自行再做一次旧值→新值迁移）
- 改动文件清单：
  - `electron/main/services/browser/extension-ownership.ts`（新建，纯逻辑）
  - `electron/main/agents/tools/extension-tools.ts`（acquireGate 前置 + busy 文案 + SHARED_SCOPE_NOTE）
  - `electron/main/services/browser/browser-gateway.ts`（handleDisconnect 接线 resetChannel）
  - `electron/main/services/settings-types.ts`（browser-parse description 加独占提示）
  - `electron/main/services/settings-service.ts`（LEGACY_BROWSER_PARSE_DESCRIPTION 精确匹配迁移）
  - `resources/browser-eval/extension-ownership-smoke.mjs`（新建，18 断言）
  - `resources/browser-eval/site-policy-smoke.mjs`（场景切换处 resetChannel）
- 验证：`bun run build:electron` 通过；`node extension-ownership-smoke.mjs` 18 PASS；`node site-policy-smoke.mjs` 35 PASS；`node profile-migration-smoke.mjs` 3 PASS；description 迁移四路径（旧值→新值 / 自定义不动 / 新值幂等 / 旧值+后缀不动）验证通过；bun test 284 pass / 1 fail（fail 为既有失败：settings-normalize「缺失内置浏览器解析 Profile 时自动补齐」期望 enabledAbilities 缺 extension 键，stash 验证与本 step 无关）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `acquireChannel(conversationId, now): { ok: true } | { ok: false; busy: true; idleMs: number }`；`releaseChannel(conversationId)`（非持有者调用无效）；`resetChannel()`；`IDLE_RELEASE_MS = 10 * 60 * 1000`（extension-ownership.ts）
  - busy 文案：`扩展通道正被另一个会话使用（已空闲 N 分钟），请等它完成后再试；若需并行调研，请改串行派遣或使用受控浏览器工具`；动作流 `result: 'busy'` + action + conversationId
  - browser-parse description 现值（下步做 read_state 迁移时的「已知旧值」）：`挂载扩展工具包在用户真实浏览器（登录态站点如小红书）执行只读调研，或用受控浏览器读取公开网页；扩展通道同一时间仅一个会话可用，并行调研请改串行派遣或使用受控浏览器`（settings-types.ts createBrowserParseSubAgentProfile）
- 下个 step 该从哪里继续：read_state 工具实现时，handler 入口同样先过 acquireGate（已在闭包内，可直接复用）；description 变更照 settings-service.ts 的 LEGACY_BROWSER_PARSE_DESCRIPTION 模式加新常量做精确匹配迁移
- 待办或已知限制：
  - `releaseChannel` 目前仅冒烟调用，生产路径只有空闲超时/断连/reset 释放；若后续需要「会话结束即释放」，在子会话生命周期钩子调 releaseChannel(conversationId)
  - 既有失败测试 settings-normalize.test.ts「缺失内置浏览器解析 Profile 时自动补齐」期望 enabledAbilities 为 `{ browser: true }`，实际已补 extension 键，需另行修正
  - busy 文案的分钟数向下取整且下限 1：持有者刚活跃（< 1 分钟）时显示「已空闲 1 分钟」为近似值
