---
step: 5
title: 流事件批处理
status: done
---

## 目标

delta 类流事件进入 pending buffer 按 rAF 合并提交，消除每 token 一次 React 更新；终态/交互事件直通；隐藏 tab 降频提交。

## 依赖上下文（接力棒输入）

- 前置 step：[step4-transcript-state.md] 全部写入口已收敛到 useTranscriptState，`applyStreamEvent` 是唯一分流点。
- 关键现状（已核实）：
  - `useSessionMessages.ts`：每个 IPC 事件同步调 setMessages（step 4 后为同步调 applyStreamEvent）。
  - `app/page.tsx:288` 多 tab 下所有 AgentChat 保持挂载（display:none），隐藏 tab 的流式更新全量驱动 React reconciliation。
  - 旁路状态：result → setIsLoading(false)（useSessionMessages 内）、permissionRequest → onScrollToAction，均在 setMessages 之外同步执行。

## 计划改动

- [ ] `useTranscriptState` 内建 buffer（或新建 `useTranscriptEvents` 包装层，放哪以 step 4 回填的实际结构为准）：
  - `enqueue(e)`：终态/交互类（`result`、`message_id`、`compact_boundary`、`permission_request`、`ask_user_question`、error）直接 flush 当前 buffer 后立即 apply 该事件；delta 类（text/thinking/tool_use/tool_result）入 buffer。
  - flush 调度：`requestAnimationFrame` + `setTimeout(flush, 50)` 竞速（rAF 在窗口最小化/隐藏时不触发，setTimeout 兜底防积压；50ms 上限意味着最坏 ~20fps 的提交频率，肉眼流畅）。
  - flush 时逐事件 apply（streamReducer 逐条 reduce，保持语义）。
- [ ] 旁路状态一致：result 的 setIsLoading(false)、complete 的 tryPromote 挂到 flush 尾部同批执行（维护一个 sideEffects 队列，flush 时先 apply 事件再跑副作用）——避免「isLoading 已 false 而 result 仍在 buffer」错位。
- [ ] 隐藏 tab 降频：AgentChat 增加 `visible: boolean` prop（app/page.tsx 按 activeTabId 传，session-window 恒 true，debug 页 true）；transcript 收到 visible=false 时把调度器从 rAF 切到 `setTimeout(flush, 500)`（隐藏 tab 无渲染意义，500ms 粒度足够保持状态最终一致；visible 恢复 true 时立即 flush 一次）。
- [ ] `useSessionMessages.ts` 事件监听改为 enqueue；useSessionEvents 的权限/AskUser 监听保持直通（不走 buffer，其交互延迟需为 0）。

## 验证

- `bun run build:renderer` 通过。
- Chrome://tracing 或 React Profiler（开发模式）观察流式期间 AgentChat 提交频率：应从每 token 一次降到每帧一次。
- 手动：长回复流式输出肉眼平滑；流式中触发权限请求，卡片立即出现（不被 buffer 延迟）；流式期间切走 tab 再切回，内容完整无跳变；窗口最小化期间流式继续，恢复后内容完整、无一次性长卡顿。
- 插话后 pendingCount 指示与实际一致（buffer 不吞 pendingCountChanged 事件——该事件走独立监听，确认未受影响）。

## 实施回填

### 实际改动
- `useTranscriptState.ts` 内建流事件 buffer：`text`/`thinking`/`tool_use`/`tool_result` 入队，其他终态/交互事件先 flush 后直通；队列逐事件 reduce，side effect 在对应事件提交后执行。
- 可见 tab 用 `requestAnimationFrame`，`setTimeout(50ms)` 兜底；隐藏 tab 取消 rAF 并使用 `setTimeout(500ms)`，恢复可见立即 flush。补充了切换可见性时清除旧定时器，避免沿用 50ms 调度。
- `useSessionMessages.ts` 改用 `enqueueStreamEvent`，user/result 的 history/loading 副作用作为队列项 side effect；permission/AskUser 仍由 `useSessionEvents` 独立直通。
- `AgentChat.tsx` 增加 `visible` prop，`app/page.tsx` 按 activeTabId 和 sessionWindowIds 传递；`app/session-window/page.tsx` 与 `app/debug/page.tsx` 显式传 true；types.ts 增加可选 visible。
- 测试补充 delta/终态分类、队列顺序、副作用顺序。
- 与计划差异：批处理直接内建在 `useTranscriptState`，未新增包装 hook；未做 step6 去重、step7 渲染边界或 step8 订阅收窄。
- 验证：build:renderer ✓ / lint 0 errors（74 个存量 warnings）/ turns.test.ts + useTranscriptState.test.ts 共 14 pass / 无 TODO/FIXME。

### 给下一步的接力棒
- buffer 分流：入队 `text`、`thinking`、`tool_use`、`tool_result`；直通（先 flush）`result`、`message_id`、`compact_boundary`、`permission_request`、`ask_user_question`、`error` 及其他未列出的事件；permission/AskUser 另有独立 rendererEvents 监听，未进入 buffer。
- side effect：`enqueueStreamEvent(event, sideEffect?)`，队列 drain 时先 apply 事件再执行 side effect；result 的 setIsLoading(false)/setHistoryLoaded 与 result 同批。complete 仍由独立 complete 广播调用 onSessionComplete。
- visible 传递链：`app/page.tsx` activeTabId/sessionWindowIds → `AgentChat.visible`；session-window/debug 页面恒 true；`AgentChat` → `useTranscriptState(showReplayMessages, visible)`。
- 待办或已知限制：
  - 尚未做 Chrome tracing/React Profiler 或 Electron GUI 长回复、权限、切 tab、最小化窗口人工回归。
  - rAF/50ms/500ms 真实浏览器时序未用 fake timer 测试。
  - step6 前仍保留 history/snapshot 重叠与竞态限制；兼容期 messages 仍每次合成。
