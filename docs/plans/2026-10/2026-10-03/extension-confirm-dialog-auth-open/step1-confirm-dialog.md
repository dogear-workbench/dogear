---
step: 1
title: 确认弹窗与三按钮 outcome
status: done
---

## 目标

人工等待（提交确认/登录类）以应用级模态弹窗直接打扰用户；「已手动操作」成为第三种确认结果；超时后 pending 自动清理、弹窗收起。

## 依赖上下文（接力棒输入）

- 现状链路（均已验证工作正常）：
  - raise：`services/browser/human-intervention.ts` `raiseHumanIntervention` 按 tabId 去重、broadcast 全量 pending 列表
  - 广播注入：`tipc/browser.ts:70` `setHumanInterventionBroadcaster((pending) => broadcastToWindows((h) => h.humanInterventionChanged.send({ pending })))`
  - 渲染层 store：`stores/browser-store.ts:30` `humanInterventions`（tipc 事件 + 主动拉取两路 setState）
  - 既有 UI：`components/companion/BrowserInterventions.tsx`（伴随面板横幅，保留不动）
  - 工具等待：`agents/tools/extension-tools.ts:368` `waitForInterventionResult` + approved/denied/timeout/missing 分支
- 关键决策：纯 service（human-intervention.ts）不碰 BrowserWindow；置前逻辑放 tipc 注入处

## 计划改动

- [x] `services/browser/human-intervention.ts`：
  - `InterventionResult` 加 `'manual'`；`resolveHumanIntervention` 的 result 参数类型同步
  - `waitForInterventionResult` 超时 settle 前**不在此处清 pending**（避免双重 resolve），改为：timeout settle 时若 pendingById 仍有该 id 且无其他 waiter，调 `resolveHumanIntervention(id, 'auto')`（清 pending + broadcast → 渲染层弹窗收起）；注意递归安全（auto resolve 不会再触发 waiter）
- [x] `tipc/browser.ts` broadcaster 注入处：模块级记录上次 pending id 集合，本次出现新 id 时 `getMainWindow()`（main-app.ts 体系，若无导出 getter 则补）`show() + focus()`；窗口销毁/异常静默
- [x] `components/HumanInterventionDialog.tsx`（新）：
  - App 根挂载，shadcn Dialog 模态，取 `humanInterventions[0]` 渲染
  - guard_submit + confirmMode：标题「提交需确认」，正文 message + url，三按钮——确认执行（绿）/ 拒绝（红）/ 已手动操作（灰，次级样式，说明文案「我已在浏览器中完成该操作」）
  - 其他 reason：标题按 label（需登录/需人工验证/密码需手动填写），正文 message + url，单按钮「完成后继续」
  - 按钮 handler：`client.resolveHumanIntervention({ id, result })`（完成后继续不传 result，走既有 approved 语义）
  - Dialog 不可点击遮罩关闭（必须按按钮，防误触丢失）
- [x] `agents/tools/extension-tools.ts`：guard_submit 等待分支加 `if (outcome === 'manual')` → textResult（非 error）：「用户已在浏览器手动完成提交。请重新 observe_page 确认当前页面状态后继续任务」
- [x] 其他 `waitForInterventionResult` 调用点（内嵌通道 `browser-atom-tools.ts` 等）：manual 不在 confirmMode 出现则不会收到，无需改动（确认一遍即可）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - manual 分支补了 `emitAction(taskMeta, 'click', { result: 'manual_submitted' })`（计划未明说，但对齐 denied/timeout 分支的动作流完整性，result 为自由 string 无需 UI 配套）
  - `record()` 的 resultNote 由二元改三值映射（`RESULT_NOTES`），否则 manual 会误记为「已拒绝」（计划未提及但必要）
  - `window-factories.ts` 补导出 `getMainWindow()`（main-app 自身副本不导出，setMainWindow 注入处最可靠）
- 改动文件清单：
  - `electron/main/services/browser/human-intervention.ts`：`InterventionResult` +`'manual'`（:6）；`RESULT_NOTES` 三值映射 + `record()` 同步（:29-:39）；`waitForInterventionResult` timeout settle 后 auto resolve 清 pending（:110-:126）
  - `electron/main/window-factories.ts`：新增导出 `getMainWindow()`（:65-:67）
  - `electron/main/tipc/browser.ts`：broadcaster 注入处接 `focusMainWindowOnNewIntervention`（:73-:76）；模块级 `lastPendingInterventionIds` + 置前函数（:151-:166）
  - `electron/main/agents/tools/extension-tools.ts`：guard_submit 等待分支 `outcome === 'manual'` → emitAction + textResult（:376-:379）
  - `components/HumanInterventionDialog.tsx`（新）：应用级模态弹窗，confirmMode 三按钮/其余单按钮，ESC 与遮罩关闭被禁、resolving 防双击
  - `src/App.tsx`：根挂载 `<HumanInterventionDialog />`（ConfirmDialog 与 Toaster 之间）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `InterventionResult = 'approved' | 'denied' | 'manual'`；`InterventionWaitOutcome = InterventionResult | 'auto' | 'timeout' | 'missing'`
  - `resolveHumanIntervention(id, resolvedBy: 'user' | 'auto', result?: InterventionResult)`：outcome = result ?? (auto ? 'auto' : 'approved')；manual 传 result='manual' 时 waiter 被唤醒（waiterConsumed=true，tipc 层不 resume）
  - `waitForInterventionResult(id, timeoutMs)`：timeout settle 时若 pendingById 仍有 id 且无其他 waiter → `resolveHumanIntervention(id, 'auto')`（弹窗收起）；递归安全已核实（settled 先置位 + waiter 先删）
  - 渲染层：`useBrowserStore(s => s.humanInterventions)`；resolve 走 `client.resolveHumanIntervention({ id, result? })`
- 下个 step 该从哪里继续：Step 2 授权机制退役（三处校验/授权 UI/permission_state 停发），本 step 改动与其无交叠；step2 涉及 `extension-command-shared.ts` 文案与 gateway，注意不要动本 step 的置前与 manual 分支
- 待办或已知限制：
  - 置前无 dedup 节流：同卡刷新（同 id）不触发，但多卡连发会多次 show+focus（可接受，人工介入本身低频）
  - 弹窗在所有窗口渲染（App 根挂载全局路由共用），主窗口置前后用户就近可操作；所有窗口 resolve 走同一广播，状态一致
  - 真机验证（三按钮/超时收口/置前）留给 Step 4
