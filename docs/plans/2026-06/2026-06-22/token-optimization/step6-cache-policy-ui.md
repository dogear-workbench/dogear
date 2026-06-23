---
step: 6
title: cachePolicy UI + skill 提示
status: done
---

## 目标
输入框工具栏加缓存策略徽章（5m / 1h 下拉），切换走 Step 5 的 setSessionCachePolicy → triggerSessionRestart；brainstorming skill 顶部加 1h 缓存建议。

## 依赖上下文（接力棒输入）
- Step 5 产出：`setSessionCachePolicy` RPC 可用，返回 `{ ok, needsRestart }`
- Step 4 产出：conversation-store 已有 setConversationCachePolicy action
- 当前模型切换器实现：`components/agent-chat/ChatInputArea.tsx` 集成 ModelSelector（按 Profile 分组，inline 触发器）
- 当前 pendingState 派生：`hooks/usePendingState.ts` → 'idle' | 'running' | 'flushing'
- 当前会话重启触发：`conversation-store.sessionRestartTrigger`，前端 useSendMessage 监听

## 计划改动
- [ ] 新增 `components/agent-chat/CachePolicySelector.tsx`：
  - 小徽章样式，显示当前 policy（'5m' / '1h'）
  - 点击展开下拉两选项
  - 与默认 5m 不同时徽章高亮（例：1h 时加边框或色调）
  - pendingState !== 'idle' 时 disabled + hover 提示"对话进行中无法切换"
  - 切换时：
    1. 调用 `client.setSessionCachePolicy({ sessionId, policy })`
    2. 后端写库 + 返回 needsRestart
    3. 若 needsRestart → 走 confirm-store 二次确认"将重启会话以应用缓存策略" → 触发 sessionRestartTrigger
    4. conversation-store 同步本地镜像
- [ ] `ChatInputArea.tsx` 工具栏插入 CachePolicySelector（放 ModelSelector 旁）
- [ ] `.claude/skills/brainstorming/SKILL.md` 顶部追加：
  ```markdown
  > 💡 长对话提示：本次进入头脑风暴模式，可能持续 10+ 分钟。
  > 如果当前会话是 5min 缓存策略，建议关闭后重开会话并切到 1h
  > （输入框工具栏的缓存徽章可切换）。
  ```

## 不在本步范围
- 缓存类型计费维度展示已在 Step 3 处理
- Phase 4 大文件 Read 截断 → 等 Step 3 数据出来后另起规划

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - CachePolicySelector 用 lucide 的 `Clock` 图标 + 当前 policy 文字（"5min" / "1h"）。1h 时文字着色为 amber 区分；不再单独加边框，保持工具栏视觉一致。
  - 无 active session（fresh 对话尚未发送）的切换直接走 `setConversationCachePolicy` 不弹确认对话框（无需重启）；只在有 sessionId 时才弹确认 + 调 `setSessionCachePolicy`。
- 改动文件清单：
  - 新建 `components/agent-chat/CachePolicySelector.tsx`（~110 行）：DropdownMenuRadioGroup 切换 + confirm-store 二次确认 + 调 `client.setSessionCachePolicy` + 同步 store + `needsRestart` 时调 `triggerSessionRestart`
  - `components/agent-chat/ChatInputArea.tsx`：props 加 `cachePolicy / workspaceId`；工具栏 ModelSelector 之后插入 CachePolicySelector
  - `components/agent-chat/AgentChat.tsx`：透传 `cachePolicy={selectedConv?.cachePolicy}` 和 `workspaceId={selectedConv?.workspace_id ?? null}`
  - `components/ConversationList.tsx`：Conversation 类型加 `cachePolicy?: '5m' | '1h'`
  - `.claude/skills/brainstorming/SKILL.md`：标题下方追加长对话 1h 缓存提示（含 2x 写入计费的提示）
- 切换确认 UI 实际形态：`showConfirm('切换缓存策略', ...)`（与模型切换重启同款 AlertDialog）；按是否切到 1h 给两种描述文案。

### 给下一步的接力棒
- 整体完成验证清单：
  - 新建对话 → 工具栏出现「Clock 5min」徽章（默认 5m）
  - 切换到 1h（无 session）→ 不弹确认，直接生效，徽章变 amber「1h」
  - 发送消息后再切换 → 弹 confirm → 确认 → 会话重启 → 新会话 env 注入 ENABLE_PROMPT_CACHING_1H=1
  - 对话运行中（pendingState !== 'idle'）→ 徽章 disabled，hover 提示「对话进行中无法切换缓存策略」
  - 触发 /brainstorming skill 后能看到顶部 1h 缓存提示
- Phase 4 何时触发：等 Step 3 的 Read 文件清单 + permissionWaits 数据在真实会话中跑 1-2 周后，再依据「最大重复读取文件 + 平均上下文占用」决定是否对大文件 Read 做截断。届时新起一个 plan 目录。
