# 会话 UI 加载修复（假空会话 + 空白感知） 设计

**背景**：根因调查见共享区 `investigate/session-ui-load.md`。症状：程序创建的会话或长会话首次在 UI 打开时长时间空白，需关闭重开或久等。归因：

1. 【bug·高】运行中会话的 JSONL 持续 append，读取方全量 read + 逐行 parse 撞上写到一半的尾行 → `invalid_entry` 抛错（上游 pi-agent-core jsonl-storage.js:78-105 无容错）→ `getConversationHistory` 返回 error → 前端 `useMessageHistory.ts:46-49` 静默 `loadHistory([])` → 显示成假空会话。稍后写入完成，重开即成功——完美匹配「关闭再打开就好」。
2. 【体验·高】初始化屏障要求 history 与 attach snapshot 两者齐才渲染（useTranscriptState.ts:562-583），期间零 loading 指示，纯空白；程序创建会话首开必走全量 resume（重读同一 JSONL + skills 扫描 + prompt 拼装），轻松超 2s 兜底。

**目标**：消灭「假空会话」（读盘竞态 + 静默清空）；打开等待期间有明确反馈；history 到达即渲染。

**范围界定**：本期只做 bug 类 + 骨架屏；性能优化（双倍读盘缓存、IPC 瘦身、O(n²) 重放、虚拟滚动、start() 拆分）不在本期，后续按需立项。

**架构**（核心做法 + 排除的选项及原因）：

1. **尾行容错（根治读盘竞态）**
   - 在我们的共享 reader 层（electron/main/agents/pi-session/session-history-reader.ts，既有「JSONL 只能经共享 reader」决策）对解析失败做尾部处理：仅当失败行是文件最后一行时丢弃/重读（append-only 文件末行必然最新，丢弃不损历史正确性）；非末行失败仍然抛错（真数据损坏）
   - 排除「改上游 pi-agent-core / patches」：容错是读取侧策略，属调用方职责，不动上游
   - 排除「200ms 退避重试」：尾行丢弃更确定，重试仍可能撞上下一次 append

2. **error 不静默清空**
   - `useMessageHistory` error 分支不再 `loadHistory([])`；history 状态区分 `empty` / `error`
   - AgentChat 消息区对 `error` 渲染错误卡片 + 重试按钮（重新发起 getConversationHistory）
   - 空态文案「开始与 Agent 对话...」只在真空会话（empty）显示

3. **屏障降级：history 先到先渲染**
   - useTranscriptState 初始化屏障从「两者齐才 ready」改为「history 到达即 ready」；snapshot 后到走既有 timedOut 增量 merge 路径（该路径已支持顺序颠倒，仅改判定条件）
   - attach 失败不阻塞 history 渲染（现状 attach 失败只 toast，历史区空白）

4. **加载骨架屏**
   - `historyStatus === 'loading'` 或屏障未 ready 时渲染 skeleton（先例：输入区「正在检查话题状态…」AgentChat.tsx:492-495），消除「空白卡死」感知

**模块边界**：
- electron/main/agents/pi-session/session-history-reader.ts（尾行容错）
- hooks/useMessageHistory.ts（error 状态化、不清空）
- hooks/useTranscriptState.ts（屏障降级）
- components/agent-chat/AgentChat.tsx（错误卡片、骨架屏、空态条件收紧）

**数据流**：打开会话 → getConversationHistory（reader 尾行容错）→ 成功：history 即渲染（骨架屏期间替换）；snapshot 后到增量 merge → 失败：错误卡片 + 重试，不渲染假空态。

**错误处理 / 边界情况**：
- 尾行丢弃后恰好该行写完：下次重开/重试读到完整历史，无损
- 非末行 JSON 损坏（真实数据问题）：维持抛错 → 错误卡片呈现，不再伪装成空会话
- reader 容错对 getLiveSnapshot / resume 路径的影响：resume 走上游 repository.open，不经我们的 reader——上游读到半行仍会炸，属 attach 慢路径失败（toast），不在 history 关键路径上，本期不处理，列入后续性能项（存活 session 直出历史）一并解决

**未决问题**：
- 骨架屏形态（整页 vs 消息区占位条数）——实施时取轻量版
- 重试按钮的自动重试策略（是否尾行容错失败后 reader 内部静默重读一次再报 error）
