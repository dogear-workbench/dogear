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
- [ ] [Step 3: 交互适配](./step3-interaction-adaptation.md) — 搜索跳转、Minimap、compact 折叠、自动跟随适配虚拟滚动

## 全局决策

- **渲染粒度**：按 Turn（一轮用户提问 + AI 回复）而非逐条消息，与现有 `buildTurns` 对齐
- **缓冲范围**：可视区域内 + 上下各 1 轮缓冲
- **高度缓存**：`Map<number, number>`（turnId → px），首次渲染测量后缓存，后续直接用
- **预估高度**：默认 400px/轮，实施时按实际数据校准
- **占位方式**：空 div `style={{ height: cachedHeight }}` 撑住滚动条总高度
- **会话切换**：每个 tab 是独立 AgentChat 实例（display:none），hook state 天然保留，不需要额外 conversationId 隔离
- **不动后端**：所有改动纯前端渲染层
