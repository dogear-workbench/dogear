# 提示音与系统通知策略收敛 设计

**背景**：当前提示乱——任务执行会话（role='main', executor）每轮 complete 都弹系统通知（`agent.ts` 的 `handleSessionNotification` 只按 role 过滤）；渲染层 `useSessionEvents` 对任何挂载会话视图（含子会话独立窗口）每轮 complete 响提示音；而真正该提示的「任务完成（进入待审核）」只有站内通知中心条目，无系统通知无提示音。

**目标**：只在两类时机提示（系统通知 + 提示音）：主会话真正完成、任务终态（待审核/失败/中断）。子会话、任务阶段回合（执行会话每轮、主会话派子会话后的中间轮）、用户手动停止一律静默。等待授权保留提示。

**架构**：提示决策全部收敛到主进程单点；渲染层只负责播声音。新增 `soundCue` main→renderer 事件（只发主窗口），替代渲染层各自的 `playDogearSound` 调用。排除的选项：渲染层自行判断角色（会话元数据要额外传递、多窗口仍可能双响）；复用 notificationsChanged 广播播声音（通知中心写点 ≠ 值得提示，语义耦合）。

**模块边界**：

主进程：
- `electron/main/tipc/agent.ts` — `handleSessionNotification` complete 分支过滤链：非 role='main' → 静默；executor → 静默；`getChildrenByParent(convId)` 有 running 子会话 → 静默（中间轮）；cancelled → 静默；failed → 通知 + error 音；success → 通知 + complete 音。permission 分支维持 role='main' 即提示（含 executor，用户接管执行会话后等授权必须提示）
- `electron/main/services/session-notification-service.ts` — 加 `playCue(kind: 'complete'|'permission'|'error')`：对主窗口 webContents 发 `soundCue`，`appFocused = isForeground()`
- `electron/main/services/task-service.ts` — `notifyTaskReview` 补系统通知（kind='complete'，带 taskId 深链）+ `playCue('complete')`
- `electron/main/services/task-queue.ts` — `notifyTask`（rejected）/ `notifyTaskInterrupted` 补 `playCue('error')`
- `electron/main/tipc/renderer-handlers.ts` — 加 `soundCue: (data: { kind: 'complete'|'permission'|'error'; appFocused: boolean }) => void`；删已退役的 `manualTaskDone` 定义

渲染层：
- `components/agent-chat/hooks/useSessionEvents.ts` — 删两处 `playDogearSound`（complete/permission 音决策移交主进程）
- `app/page.tsx` — 挂全局 `soundCue` 监听：`backgroundOnly !== false && appFocused` 时静默；否则 `playDogearSound(kind, { force: backgroundOnly === false })`。音量/开关/1200ms 节流仍走 `playDogearSound` 内部逻辑
- `lib/manual-task-toasts.ts` — 删文件（发送方已退役的死代码）；`formatDurationMs` 若有外部引用则移至仍在用的位置，无引用则一并删
- `src/main.tsx` — 删 `setupManualTaskToasts` 挂载
- `app/settings/page.tsx` — 提示音说明文案改为：「主会话完成、任务完成/失败、等待授权时触发；仅应用后台时响（可关）」

**数据流**：会话/任务终态 → 主进程决策（角色 + executor + running 子会话 + subtype）→ 同点分两路：`SessionNotificationService.notify`（Windows 弹窗 + 任务栏闪烁，前台时自动跳过）与 `playCue` → 主窗口渲染层 `soundCue` 监听 → 结合 `appFocused` 与设置项播 `playDogearSound`。

**错误处理 / 边界情况**：
- `getChildrenByParent` 查询失败：抛错则整个 `handleSessionNotification` 被 catch 吞掉 → 该轮不提示。可接受（提示缺失好过误报，下轮正常对话仍提示）
- `playCue` 不做去重：`playDogearSound` 内部已有 1200ms 节流 + 音量/开关读取；多任务启动恢复连发 interrupted 时自然被节流
- 主窗口销毁时 `playCue` 直接 return（service 内已有 mainWindow 判空惯例）
- 应用重启恢复的 interrupted 任务通知照常（现状保留）

**未决问题**：`formatDurationMs` 外部引用实施时确认（预计无，随文件删）。
