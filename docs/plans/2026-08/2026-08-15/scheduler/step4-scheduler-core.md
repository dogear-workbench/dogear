---
step: 4
title: 调度核心 + 启动集成
status: pending
---

## 目标

实现 scheduler-service（分钟级 tick、窗口状态机、条件事件、错过判定、触发分发）并在主进程启动时接线，使计划真正按时间跑起来。

## 依赖上下文（接力棒输入）

- 前置 step 产出：step1 的 time-rule-engine / plan-store（签名以其实施回填为准）、step2 的 plan-runner（`runPlan` / `requestStop` / `plan_done` 事件 / `getActivity`）、step3 的自定义任务链路已通
- 现有启动时序：`electron/main/index.ts` app.whenReady → migration → `getAgentManager(...).start()` → createWindow；调度器初始化放在 agentManager.start() 之后（后台任务依赖 Worker 池）
- 关键决策回顾：触发 OR + 防重入（runner 层已做）；错过只记最近一条 missed；window 开→runPlan、关→requestStop；on_window_close 到窗口 end 时刻触发；lastFiredAt 写回 plans.json

## 计划改动

- [ ] 新建 `electron/main/services/scheduler/scheduler-service.ts`（单例 `getSchedulerService()`）：
  - `init(deps: { onMissed?: (entries) => void })` — `seedDefaultPlans()` → 启动错过判定 → 发 `on_app_start` 条件 → 启动 tick
  - `tick()`（`setInterval` 60s + `unref()`）遍历 enabled 计划的每条 trigger：
    - `daily_at` / `interval` / `once`：`nextDueAt` 到点且未被 runner 防重入拦截 → `fireTimeTrigger`（runPlan + `touchTriggerFired`；once 额外 `markOnceFired`）
    - `window`：本地缓存「本窗口已触发」标记（内存 Map，key=planId:triggerId:窗口起始时刻），窗口开且未触发 → runPlan；窗口闭 → `planRunner.requestStop(planId)`
    - `on_window_close`：`windowCloseAt` 到点 → runPlan + touchTriggerFired
  - `handleAppStart()` / `handleSessionClose(workspaceId?)` — 遍历含对应条件规则的计划 → runPlan（triggerReason: 'condition'，triggerDesc 写明条件类型）
  - `handlePlanDone` — 订阅 runner `plan_done`，遍历 `on_plan_done` 且 planId 匹配的计划 → runPlan
  - 启动错过判定：`detectMissed` → 对每条 missed 调 `run-history-store.appendHistoryEntry`（kind: 'missed'）；once 同时 markOnceFired；**注意在 on_app_start 触发之前跑**，避免历史顺序颠倒
  - `firePlan` 统一封装：查最新 plan（防删除后仍触发）→ enabled 校验 → `runPlan`
  - `getActivity()` — 汇总 runner.getActivity + lastTickAt
  - `stop()` — 清 interval（app 退出调用）
  - tick 里的重复触发防护：`touchTriggerFired` 后同分钟内 tick 不重复（lastFiredAt 对齐判断）
- [ ] `electron/main/index.ts`：agentManager.start() 之后 `getSchedulerService().init(...)`（错过记录直接进 run-history，console.error 兜底）；`before-quit` 里调 `schedulerService.stop()`
- [ ] 派发器细节：interval 规则的 `touchTriggerFired` 用「本次 due 时刻」而非 now，避免延迟 tick 造成漂移（time-rule-engine 的 nextDueAt 已按 lastFiredAt 推算，确认闭环）

## 验证

- `bun run build:electron` 通过
- 开发模式实测：造一个 `interval: 1 分钟` 的计划（任务=自定义「往某文件 append 一行时间戳」），观察每分钟追加；中途改 end 窗口测 requestStop；关应用重开，确认 missed 不误报（interval 因 lastFiredAt 持续推进，只对真正错过的 daily_at/once 报）
- 出厂计划：删掉 plans.json 重启 → 播种「夜间维护」→ 把窗口改成当前时间附近验证窗口开触发

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
