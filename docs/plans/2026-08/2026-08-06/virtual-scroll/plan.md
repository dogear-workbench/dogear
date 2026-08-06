# 轮次级虚拟滚动 + 输入框隔离 实施计划

**目标**：解决长会话场景下渲染层卡顿（滚动卡、输入卡、流式输出全量重渲染），使超长会话也能流畅操作。

**架构思路**：分三步递进——先 memo + 输入框隔离（立即解决最高频痛点，改动最小），再实现虚拟滚动调度器（核心），最后适配滚动/搜索/Minimap 等交互。

**涉及模块**：
- `components/agent-chat/AgentChat.tsx` — 渲染逻辑改造 + 输入框隔离
- `components/agent-chat/MessageItem.tsx` — 加 React.memo
- `components/agent-chat/ChatInputArea.tsx` — 隔离 props
- `components/agent-chat/hooks/useVirtualTurns.ts` — 新增，虚拟化调度
- `components/agent-chat/hooks/useChatScroll.ts` — 搜索跳转适配
- `components/agent-chat/MessageMinimap.tsx` — 视口指示适配

## 步骤索引

- [x] [Step 1: React.memo + 输入框隔离](./step1-memo-input-isolation.md) — MessageItem 加 memo、ChatInputArea 隔离渲染边界，立即解决输入和流式重渲染卡顿
- [x] [Step 2: useVirtualTurns 虚拟滚动调度](./step2-virtual-turns.md) — 新建 hook 实现轮次级虚拟滚动 + 高度缓存
- [x] [Step 3: 交互适配](./step3-interaction-adaptation.md) — 搜索跳转、Minimap、compact 折叠、自动跟随适配虚拟滚动

## 全局决策

- **渲染粒度**：按 Turn（一轮用户提问 + AI 回复）而非逐条消息，与现有 `buildTurns` 对齐
- **缓冲范围**：可视区域内 + 上下各 1 轮缓冲
- **高度缓存**：`Map<number, number>`（turnId → px），首次渲染测量后缓存，后续直接用
- **预估高度**：默认 400px/轮，实施时按实际数据校准
- **占位方式**：空 div `style={{ height: cachedHeight }}` 撑住滚动条总高度
- **会话切换**：每个 tab 是独立 AgentChat 实例（display:none），hook state 天然保留，不需要额外 conversationId 隔离
- **不动后端**：所有改动纯前端渲染层

## 完成总结

三步全部完成，共改动 6 个文件（1 新建 + 5 修改）：

| Step | 文件 | 改动 |
|------|------|------|
| 1 | `MessageItem.tsx` / `ChatInputArea.tsx` | React.memo 包裹 |
| 1 | `AgentChat.tsx` | 4 个行内函数 useCallback 稳定化 |
| 1 | `hooks/useSendMessage.ts` | handleSend/handleKeyPress 改 useCallback + messagesRef 解耦 |
| 2 | `hooks/useVirtualTurns.ts`（新建） | rAF 节流调度 + ResizeObserver 测量 + getTurnRef 缓存 |
| 2 | `AgentChat.tsx` | buildTurns 提升到 useMemo，渲染逻辑改为 section + 占位 div |
| 3 | `hooks/useChatScroll.ts` | scrollToMessage 新增 ensureTurnVisible 虚拟轮次处理 |
| 3 | `AgentChat.tsx` | 搜索跳转/折叠展开跳转适配 + scrollToMessageRef 解 stale closure |
| 3 | `MessageMinimap.tsx` | recomputeCurrentTurn 改为扫描 [data-virtual-turn-id] section |

**关键工程决策**：
- 缓冲范围从计划的「上下各 1 轮」调整为「上下各 1 屏」，避免高频滚动空白闪烁
- 高度测量用 getBoundingClientRect 首测 + ResizeObserver 持续监听双保险
- rAF 统一合并节流：scroll / resize / turns 变化共用一个调度入口
- display:none / compact 折叠展开经分析确认不需要额外代码（Chromium 自愈 + useEffect 自动清理缓存）

**遗留**：搜索跳转到预估值轮次可能有轻微偏移（下一帧 ResizeObserver 测量真实高度后不自动微调 scroll），实际使用中影响很小。
