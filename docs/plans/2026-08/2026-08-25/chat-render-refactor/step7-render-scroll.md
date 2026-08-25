---
step: 7
title: 渲染边界拆分与滚动修复
status: pending
---

## 目标

抽出 StableHistory / LiveTail 组件，高频更新收敛到 LiveTail 子树，AgentChat 本体只在结构变化时渲染；修复滚动条拖拽被自动跟随拉回的 bug；useVirtualTurns 收窄到历史区。

## 依赖上下文（接力棒输入）

- 前置 step：[step4/5/6] transcript 结构、批处理、合并协议就绪；合成视图 `messages` 仍存在（本 step 拆掉它）。
- 关键现状（已核实）：
  - `AgentChat.tsx` 590 行单组件，messages 合成视图驱动整树重渲染；buildTurns/lastCompactBoundaryIdx/搜索自动展开 effect 均依赖 messages。
  - `useChatScroll.ts`：只监听 wheel/touch/keydown 判用户介入（:110-160），scrollbar 拖拽不触发任何监听 → auto 模式下 ResizeObserver（:76-84）把用户拖走的位置拉回。
  - 续滚 ResizeObserver 监听 `vp.firstElementChild`（:82，现为 `<div className="px-6">`）。
  - `useVirtualTurns.ts`：measureElement 对最后一个 turn 高度变化不触发 flush（:150-158），交给续滚 observer；turnId 已 string 化（step 2）。

## 计划改动

- [ ] `useChatScroll.ts` scrollbar 拖拽识别：在现有 wheel/touch/keydown 之外，scroll 事件里判「非 programmatic 且 scrollTop 相对上次减小」→ setFollowMode('manual')（用户把内容往上拉只有拖滚动条/键盘/滚轮三种途径，后两者已覆盖；向上滚动一定意味着用户主动离开底部）。同步保留「滚回距底 ≤64px 重新 auto」。
- [ ] 新建 `components/agent-chat/StableHistory.tsx`（memo）：
  - props：`turns`（AgentChat 算好的结构）、`messagesById`、`visibleTurnIds`、`turnHeights`、`getTurnRef`、回调（onFork/onPermissionResolved/onAskUserResolved/onInterrupt——全部 useCallback 稳定引用）、`searchQuery`/`activeMatchId`、`readOnly`、`sessionId`、`isAgentConversation`、compact 折叠 UI props。
  - 内部渲染现有 `chatTurns.map(section...)` + CollapsedHistoryBanner/CollapseControlBar 逻辑，从 AgentChat 平移。
- [ ] 新建 `components/agent-chat/LiveTail.tsx`：
  - props：`liveTail: Message[]`、`pendingActions`、同样的回调集 + StreamingIndicator 所需状态。
  - 渲染 live 消息（MessageItem 复用）+ StreamingIndicator。
  - 不虚拟化、常驻渲染（内容天然只有当前 run）。
- [ ] `AgentChat.tsx`：
  - 删除合成视图 `messages`；派生链全部改依赖 `stableHistory` + `structuralVersion`：buildTurns、lastCompactBoundaryIdx、搜索自动展开 effect、messagesById。
  - AgentChat 重渲染触发源收敛为：stableHistory 变化（append/promote/折叠）、structuralVersion、sessionMeta、UI 状态。liveTail 的每帧更新只进 LiveTail 子树。
  - LiveTail 自身的每帧 state 更新发生在 useTranscriptState 里——注意：transcript hook 在 AgentChat 内，liveTail state 变化仍会重渲染 AgentChat！**必须把 liveTail state 下沉**：方案 A：useTranscriptState 内部用 store 模式（useSyncExternalStore）让只有 LiveTail 订阅 liveTail 引用；方案 B：LiveTail 组件内部持有 tail state，AgentChat 只持句柄。以 step 4 回填的实际结构选侵入最小的（倾向 A：外部小 store + selector，transcript 内聚不散）。
  - 搜索：query 变化时仍全表扫（依赖 stableHistory + liveTail 只读快照经 ref 获取）；matchId 已是稳定 id。
- [ ] DOM 结构：保持 `<div className="px-6">` 包裹节点为 scroll viewport 的 firstElementChild，StableHistory/LiveTail 作为其子树平铺（续滚 observer 依赖此结构，破坏即静默失效——纲领已列注意事项）。
- [ ] `useVirtualTurns.ts` 收窄：turns 参数即历史 turns（不含 live），删除「最后一个 turn 特殊豁免 flush」逻辑（live 不再在其管辖内，历史区高度低频变化正常 flush）。
- [ ] `useChatScroll` 滚动锚点：历史高度变化（折叠展开、图片加载回流）时保持视口锚定——现有 sticky header + scrollToElement 的 static 探测保留；锚点逻辑本 step 仅做「折叠展开不跳位」验证，复杂锚定（缩放/窗口 resize）视 step 9 基准决定是否追加，避免过度工程。

## 验证

- React Profiler：流式期间 AgentChat/StableHistory 零提交，仅 LiveTail 子树更新。
- 手动全场景（纲领阶段 6 列表的前置抽查）：滚动条拖拽不被拉回；流式中向上滚读历史平滑；搜索跳转、minimap 跳转正常；compact 折叠/展开不跳位；权限卡片交互正常。
- `bun run build:renderer` 通过。

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- liveTail state 下沉的最终方案：
- StableHistory/LiveTail 的 props 契约：
- 待办或已知限制：
