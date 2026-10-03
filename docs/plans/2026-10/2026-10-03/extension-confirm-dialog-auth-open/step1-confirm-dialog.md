---
step: 1
title: 确认弹窗与三按钮 outcome
status: pending
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

- [ ] `services/browser/human-intervention.ts`：
  - `InterventionResult` 加 `'manual'`；`resolveHumanIntervention` 的 result 参数类型同步
  - `waitForInterventionResult` 超时 settle 前**不在此处清 pending**（避免双重 resolve），改为：timeout settle 时若 pendingById 仍有该 id 且无其他 waiter，调 `resolveHumanIntervention(id, 'auto')`（清 pending + broadcast → 渲染层弹窗收起）；注意递归安全（auto resolve 不会再触发 waiter）
- [ ] `tipc/browser.ts` broadcaster 注入处：模块级记录上次 pending id 集合，本次出现新 id 时 `getMainWindow()`（main-app.ts 体系，若无导出 getter 则补）`show() + focus()`；窗口销毁/异常静默
- [ ] `components/HumanInterventionDialog.tsx`（新）：
  - App 根挂载，shadcn Dialog 模态，取 `humanInterventions[0]` 渲染
  - guard_submit + confirmMode：标题「提交需确认」，正文 message + url，三按钮——确认执行（绿）/ 拒绝（红）/ 已手动操作（灰，次级样式，说明文案「我已在浏览器中完成该操作」）
  - 其他 reason：标题按 label（需登录/需人工验证/密码需手动填写），正文 message + url，单按钮「完成后继续」
  - 按钮 handler：`client.resolveHumanIntervention({ id, result })`（完成后继续不传 result，走既有 approved 语义）
  - Dialog 不可点击遮罩关闭（必须按按钮，防误触丢失）
- [ ] `agents/tools/extension-tools.ts`：guard_submit 等待分支加 `if (outcome === 'manual')` → textResult（非 error）：「用户已在浏览器手动完成提交。请重新 observe_page 确认当前页面状态后继续任务」
- [ ] 其他 `waitForInterventionResult` 调用点（内嵌通道 `browser-atom-tools.ts` 等）：manual 不在 confirmMode 出现则不会收到，无需改动（确认一遍即可）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
