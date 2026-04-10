# 状态脉冲统一 + 排队消息修复 + 独立窗口优化

日期: 2026-04-10

## 需求概览

1. **Tab 和列表状态指示器统一** — 提取共享 StatusPulse 组件，Tab 区脉冲替代转圈
2. **Tab 转圈改脉冲** — 与需求1合并，同时处理
3. **排队消息 Bug 修复** — 前端缓冲区不发后端 → 改为直接发后端排队，悬浮区保留，等 Agent 处理到时才渲染
4. **独立窗口移动语义** — 弹出时移除主窗口 Tab，关闭时恢复

---

## 第1+2点：StatusPulse 共享组件

### 现状
- 列表（BookConversationList.tsx:283-296）：蓝色/橙色脉冲，内联实现
- Tab（app/page.tsx:270-272）：`Loader2 animate-spin text-blue-500`，不区分等待确认/运行中

### 设计
提取 `components/StatusPulse.tsx`：
```tsx
interface StatusPulseProps {
  isPending: boolean; // true=蓝色（等待确认）, false=橙色（运行中）
  size?: 'sm' | 'md'; // sm=Tab(12px), md=列表(16px, 默认)
}
```

Tab 渲染时从 `conversation-store.pendingActionConversationIds` 获取待确认状态。

### 改动文件
- 新建 `components/StatusPulse.tsx`
- 修改 `app/page.tsx` — 替换 Loader2 为 StatusPulse + 读取 pendingActionConversationIds
- 修改 `components/BookConversationList.tsx` — 内联脉冲替换为 StatusPulse

---

## 第3点：排队消息 Bug 修复

### 问题分析
当前实现：前端缓冲区（queuedMessagesRef）暂存消息，等 Agent 完成后才发给后端。  
bug 表现：悬浮预览区加入后消费逻辑失效，排队消息既没渲染也没发后端。

后端本身支持排队：`sendMessage()` → `pendingMessages` 队列 → `createMessageStream()` 自动消费。

### 新设计

**核心变更**：Agent 运行中发消息时直接发后端，前端不再缓冲发送逻辑。

#### 发送流程（useSendMessage.ts）

```
isLoading=false 时（Agent 空闲）：
  → 插入用户消息到 messages + assistant 占位
  → setIsLoading(true)
  → client.sendQueryBasedSessionMessage()
  （不变）

isLoading=true 时（Agent 运行中）：
  → 直接 client.sendQueryBasedSessionMessage()  ← 改动！
  → 加入 queuedMessages 悬浮区（仅用于 UI 显示，不再缓冲发送）
  → 不插入 messages，不插入 assistant 占位
```

#### 消费渲染流程（useSessionMessages.ts）

当后端 Agent 处理到排队消息时，SDK 会推送 `type=user` 事件。

```
收到 type=user 事件：
  → 检查 queuedMessagesRef 是否有内容
  → 如果有：
    - shift 第一条 → 插入对应的 displayMessage 到 messages
    - onQueueChanged() 更新悬浮区
    - 后续的 assistant 消息流会自然渲染
  → 如果没有：
    - 走 streamReducer 正常逻辑（bot 消息渲染等）

收到 type=result 事件：
  → 如果 queuedMessagesRef 为空：setIsLoading(false)
  → 如果有排队：保持 isLoading=true（后端会继续处理下一条）
```

#### 悬浮预览区（AgentChat.tsx）
- 保留悬浮区 UI（显示排队消息预览和取消按钮）
- 取消排队消息时：除了从悬浮区移除，还需通知后端中断该消息（或标记为已取消）
- **简化**：取消功能暂时移除（后端已收到消息无法简单取消），悬浮区仅做只读展示

#### 移除的代码
- `useSessionMessages.ts` 中的 `setTimeout(100ms)` 消费 + `sendQueryBasedSessionMessage` 调用
- `useSendMessage.ts` 中的 `return`（改为发送后端）
- `queuedMessagesRef` 仍保留用于 UI 显示匹配，但不再用于缓冲发送

### 改动文件
- 修改 `components/agent-chat/hooks/useSendMessage.ts` — 排队时直接发后端
- 修改 `components/agent-chat/hooks/useSessionMessages.ts` — result 不再消费队列，user 事件渲染排队消息
- 修改 `components/agent-chat/AgentChat.tsx` — 悬浮区取消按钮改为只读展示（或保留但标注"已发送"）
- 可能修改 `components/agent-chat/transformers.ts` — streamReducer user 分支配合

---

## 第4点：独立窗口移动语义

### 现状
- 弹出按钮创建新窗口但不关闭主窗口 Tab → 两个窗口操作同一会话
- 独立窗口关闭后主窗口无感知

### 新设计

#### 弹出流程
```
点击弹出按钮：
  → client.openSessionWindow({ conversationId, title })
  → 主窗口 closeTab(conversationId)  ← 新增
  → 主进程创建独立窗口（不变）
```

#### 关闭恢复流程
```
独立窗口关闭：
  → 主进程 win.on('closed') 回调
  → 通过 renderer-handlers 事件通知主窗口：sessionWindowClosed({ conversationId, title })
  → 主窗口收到事件 → openTab(conversationId, title)
```

### 改动文件
- 修改 `app/page.tsx` — 弹出时 closeTab
- 修改 `electron/main/index.ts` — 窗口关闭时发事件到主窗口
- 修改 `electron/main/tipc/renderer-handlers.ts` — 新增 sessionWindowClosed 事件
- 修改 `app/page.tsx`（或新 hook）— 监听 sessionWindowClosed 事件并 openTab

---

## 实施顺序

1. StatusPulse 共享组件（第1+2点）— 纯 UI，风险最低
2. 排队消息修复（第3点）— 核心 Bug，改动较大
3. 独立窗口优化（第4点）— IPC + 窗口管理
