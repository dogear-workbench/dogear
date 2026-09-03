---
step: 4
title: 前端暂停交互与回归
status: done
---

## 目标

前端会话 UI 支持「暂停」操作与 paused 状态展示，全量回归 pi 会话主流程。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step3-session-pause-integration.md] IPC 已有 pause 路由与 sessionState.paused 字段（以回填的实际签名为准）
- 当前关键文件状态：会话输入区 / 状态展示组件（执行时先在 `components/agent-chat/` 与相关 store 里定位现有 running/idle 展示点）
- 关键决策回顾：pause 是 turn 粒度，文案必须写「完成当前步骤后暂停」；paused 时发送消息即恢复

## 计划改动

- [ ] 会话输入区（运行中）：加「暂停」按钮，点击调 pause IPC；请求已发出但未到 turn 边界期间显示「暂停中…」（复用现有 pendingAction / 状态机制，不新造状态层）
- [ ] paused 状态展示：会话状态区显示「已暂停 · 发送消息继续」（对齐现有 idle/running 展示样式）
- [ ] 输入框在 paused 态正常可用（发送 = 恢复，无需额外确认）
- [ ] 插话提示措辞顺带修正（可选，同一片 UI）：插话发送后的提示改为「将在当前步骤（含全部工具调用）完成后送达」
- [ ] 回归：
  - `bun test electron/main/agents/pi-session/` 全绿
  - `bun run dev` 手工过：新建会话 / 长任务运行中暂停与恢复 / 插话（暂停前 + 运行中）/ 中断（abort）/ compact / 关闭会话
  - 主进程与渲染层各一遍 `bun run lint`
- [ ] 收尾：`docs/codebase-map.md` 同步（pi-session 新增 pause 能力 + IPC 路由），触发 /doc-sync

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 「暂停中…」用 ChatInputArea 本地 `pauseRequested` state（pendingState 离开 running 即复位），未动全局 pendingAction 机制——全局层无对应概念，本地态最小且自清理
  - paused 展示放输入区下方状态行（sessionId 旁，对齐「● 就绪」样式），消息流内 StreamingIndicator 不动（paused 时 running 已 false，指示器自然消失；暂停前插话遗留时仍显示队列提示，语义正确）
  - 插话提示：插话发送路径加 toast.info「将在当前步骤（含全部工具调用）完成后送达」（原无任何发送后提示，非改写）
  - paused 态发送消息无需前端分支：isLoading=false 自然走空闲路径（模型 reconcile 可用，paused 期间换模型合法），主进程 sendMessage paused 分支清标志 + prompt
- 改动文件清单：
  - `stores/conversation-store.ts`：`pausedConversationIds` Set + `setPausedState`；sessionStateChanged/sessionClosed 订阅同步 paused；PreAttachedSession.sessionState 类型与预 attach 兑底补 paused；reset() 补初始值
  - `components/agent-chat/hooks/useAgentSession.ts`：pre-attach 与正常 attach 两处同步 pausedConversationIds
  - `components/agent-chat/AgentChat.tsx`：读 isPausedInStore 传 ChatInputArea
  - `components/agent-chat/ChatInputArea.tsx`：暂停按钮（running 时，受理后「暂停中…」disabled）+ 状态行 paused 徽标「已暂停 · 发送消息继续」
  - `components/agent-chat/hooks/useSendMessage.ts`：插话发送 toast.info
  - `docs/codebase-map.md`：pi-session pause 能力 + pauseQueryBasedSession 路由 + conversation-store 三 Set + ChatInputArea 暂停交互

### 给下一步的接力棒
- 本计划全部 step 完成；0.84 迁移时整体作废（全局决策 5）
- 未人工验证项：dev 手工场景链以代码级推演 + 类型检查代替（详见共享区 step4-delivery.md）
