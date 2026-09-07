---
step: 1
title: A1 扩展通道会话独占
status: pending
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
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
