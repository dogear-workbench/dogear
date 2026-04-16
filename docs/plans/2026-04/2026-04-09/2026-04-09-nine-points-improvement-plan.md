# 九点改进完整实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复 2 个遗留 Bug（滚动跟随、排队消息）+ 1 个 Bug 调查修复（工具权限）+ 4 个 UI 优化（分页布局、脉冲样式、系统消息圆点、会话引用）+ 2 个新功能（会话树修复、独立会话窗口）

**Architecture:** 分 9 个独立 Task，按优先级排序。Bug 修复优先（Task 1-3），UI 优化其次（Task 4-7），新功能最后（Task 8-9）。每个 Task 独立可提交。

**Tech Stack:** React 19, Zustand 5, Electron IPC (tipc), @anthropic-ai/claude-agent-sdk, Tailwind CSS 4, shadcn/ui, lucide-react

---

## Task 1: 修复会话滚动回到底部后不恢复自动跟随 (Bug #6)

**问题根因：** `ResizeObserver` 中 `el.scrollTo({ behavior: 'smooth' })` 触发平滑滚动动画，动画过渡帧会连续触发 `handleScroll`，中间某帧 `scrollHeight - scrollTop - clientHeight > 50`，导致 `scrollModeRef` 被错误切回 `'user'`。用户手动回到底部后，下一次 ResizeObserver 触发的 smooth scrollTo 又被误判为用户滚动。

**解决方案：** 添加 `programmaticScrollRef` 标志位，区分程序化滚动和用户手动滚动。

**Files:**
- Modify: `components/agent-chat/AgentChat.tsx:96-157`

**Step 1: 添加程序化滚动标志 ref**

在 `AgentChat.tsx` 行 103（`scrollModeRef` 声明之后）添加：

```typescript
  // 程序化滚动标志：scrollTo 调用期间为 true，防止 handleScroll 误判为用户滚动
  const programmaticScrollRef = useRef(false);
```

**Step 2: 修改 scrollToBottom — 设标志位**

替换 `AgentChat.tsx` 行 111-120 的 `scrollToBottom`：

```typescript
  // 滚到底部
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = getViewportEl();
    if (el) {
      programmaticScrollRef.current = true;
      el.scrollTo({ top: el.scrollHeight, behavior });
      setNewMsgCount(0);
      scrollModeRef.current = 'auto';
      isAtBottomRef.current = true;
      setIsAtBottom(true);
      // instant 没有动画，立即清除标志；smooth 需等动画结束
      if (behavior === 'instant') {
        programmaticScrollRef.current = false;
      }
    }
  }, [getViewportEl]);
```

**Step 3: 修改 handleScroll — 区分程序化/用户滚动**

替换 `AgentChat.tsx` 行 122-136 的 `handleScroll`：

```typescript
  // 用户滚动检测
  const handleScroll = useCallback(() => {
    const el = getViewportEl();
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    isAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);

    if (programmaticScrollRef.current) {
      // 程序化滚动中：到达底部时清除标志，不切换模式
      if (atBottom) {
        programmaticScrollRef.current = false;
        setNewMsgCount(0);
        // scrollModeRef 已在 scrollToBottom/ResizeObserver 中设为 auto，无需重复
      }
      // 未到底部时忽略（动画过渡帧），不切 user
      return;
    }

    // 用户手动滚动
    if (atBottom) {
      setNewMsgCount(0);
      scrollModeRef.current = 'auto';
    } else {
      scrollModeRef.current = 'user';
    }
  }, [getViewportEl]);
```

**Step 4: 修改 ResizeObserver — 自动滚动时设标志位**

替换 `AgentChat.tsx` 行 147-152 的 ResizeObserver 回调：

```typescript
    const observer = new ResizeObserver(() => {
      if (scrollModeRef.current === 'auto') {
        programmaticScrollRef.current = true;
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
        // smooth 动画结束后 handleScroll 检测到 atBottom 会清除 programmaticScrollRef
      } else if (messages.length > 0) {
        setNewMsgCount(prev => prev + 1);
      }
    });
```

**Step 5: 编译验证**

Run: `cd c:/dogear && bun run build:electron`
Expected: 编译成功，无类型错误

**Step 6: Commit**

```bash
git add components/agent-chat/AgentChat.tsx
git commit -m "fix: 滚动回到底部后恢复自动跟随 — programmaticScrollRef 区分程序化/用户滚动"
```

---

## Task 2: 排队消息悬浮预览 + 取消功能 (Bug #7)

**问题根因：** 缓冲区机制中排队消息不显示在 UI 上（`return` 太早），用户发送后看不到任何反馈。且 `result` 事件中立即发送下一条排队消息，SDK 内部状态可能未就绪导致静默失败。

**解决方案：** 排队消息悬浮在输入框上方（不进 messages 列表），带取消按钮。Agent 完成当前轮后延迟 100ms 再消费下一条，消费时才插入 messages。

**Files:**
- Modify: `components/agent-chat/hooks/useSendMessage.ts:10-16,38-50,405-416`
- Modify: `components/agent-chat/hooks/useSessionMessages.ts:52-84`
- Modify: `components/agent-chat/AgentChat.tsx:92-94,340-388`
- Modify: `components/agent-chat/ChatInputArea.tsx:60-89`

**Step 1: useSendMessage — 添加 queuedMessages state 和 removeQueuedMessage**

在 `useSendMessage.ts` 行 38（`export function useSendMessage` 函数体开头）添加 state：

```typescript
  // 排队消息的 React state（用于 UI 渲染），与 queuedMessagesRef 同步
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessageEntry[]>([]);
```

在 `useSendMessage` 的返回对象中（文件末尾 `return { ... }` 处），添加：

```typescript
    queuedMessages,
    removeQueuedMessage: useCallback((index: number) => {
      queuedMessagesRef.current.splice(index, 1);
      setQueuedMessages([...queuedMessagesRef.current]);
    }, [queuedMessagesRef]),
```

**Step 2: useSendMessage — 排队时同步更新 state**

替换 `useSendMessage.ts` 行 405-416（`if (isLoading)` 分支）：

```typescript
    if (isLoading) {
      // Agent 运行中 → 消息存入缓冲区，不插入 messages 列表，不立即发送
      const entry: QueuedMessageEntry = {
        content: messageToSend,
        ...(textBlocks.length > 1 && { textBlocks }),
        ...(imagesToSend.length > 0 && {
          images: imagesToSend.map(img => ({ base64: img.base64, mediaType: img.mediaType })),
        }),
        displayMessage: newUserMessage,
      };
      queuedMessagesRef.current.push(entry);
      setQueuedMessages([...queuedMessagesRef.current]);
      return;  // 直接返回，等待上一轮完成
    }
```

**Step 3: useSessionMessages — result 事件中延迟消费 + 同步 state**

在 `useSessionMessages.ts` 的接口 `UseSessionMessagesParams` 中添加回调：

```typescript
interface UseSessionMessagesParams {
  sessionId: string | null;
  showReplayMessages: boolean;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setHistoryLoaded: Dispatch<SetStateAction<boolean>>;
  queuedMessagesRef: MutableRefObject<QueuedMessageEntry[]>;
  /** 缓冲区变化时同步 UI state */
  onQueueChanged?: () => void;
}
```

替换行 52-84 的 `type === 'result'` 处理块：

```typescript
      // 收到结果消息时结束加载状态，或消费缓冲区中的下一条排队消息
      if (extendedMsg.type === 'result') {
        const queued = queuedMessagesRef.current;
        if (queued.length > 0) {
          // 延迟 100ms 确保 SDK 状态完全就绪后再消费下一条
          setTimeout(() => {
            const next = queued.shift()!;
            onQueueChanged?.();
            // 将排队消息插入到 messages 列表（用户消息 + assistant 占位）
            setMessages(prev => [...prev, next.displayMessage, {
              role: 'assistant' as const,
              content: '' as string,
              timestamp: Date.now(),
              isStreaming: true,
              contentBlocks: [] as ContentBlock[],
            }]);
            // 发送到后端
            client.sendQueryBasedSessionMessage({
              sessionId: data.sessionId,
              content: next.content,
              ...(next.textBlocks && { textBlocks: next.textBlocks }),
              ...(next.images && {
                images: next.images.map(img => ({
                  media_type: img.mediaType,
                  data: img.base64,
                })),
              }),
            }).catch(err => {
              console.error('发送排队消息失败:', err);
              setIsLoading(false);
            });
            // 不设置 setIsLoading(false)，新消息立即开始处理
          }, 100);
        } else {
          setIsLoading(false);
        }
        setHistoryLoaded(true);
      }
```

**Step 4: AgentChat — 传递 onQueueChanged 回调 + 渲染排队消息预览区**

修改 `AgentChat.tsx` 中 `useSessionMessages` 调用（约行 230 附近），添加 `onQueueChanged`：

```typescript
  useSessionMessages({
    sessionId,
    showReplayMessages,
    setMessages,
    setIsLoading,
    setHistoryLoaded,
    queuedMessagesRef,
    onQueueChanged: () => {
      // 缓冲区消费后同步 React state
      sendMessage.setQueuedMessages?.([...queuedMessagesRef.current]);
    },
  });
```

注意：需要在 `useSendMessage` 的返回值中也暴露 `setQueuedMessages`。

在 `AgentChat.tsx` 的 `</ScrollArea>` 和 `<ChatInputArea>` 之间（行 342-360 区域），插入排队消息预览区：

```tsx
      {/* 排队消息悬浮预览区 */}
      {sendMessage.queuedMessages.length > 0 && (
        <div className="border-t bg-muted/20 px-4 py-2 space-y-1">
          <div className="text-xs text-muted-foreground mb-1">
            {sendMessage.queuedMessages.length} 条消息排队中
          </div>
          {sendMessage.queuedMessages.map((entry, index) => (
            <div
              key={index}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-background border text-sm"
            >
              <Send size={12} className="flex-shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-muted-foreground">
                {entry.displayMessage.content.length > 60
                  ? entry.displayMessage.content.slice(0, 60) + '...'
                  : entry.displayMessage.content}
              </span>
              <button
                onClick={() => sendMessage.removeQueuedMessage(index)}
                className="flex-shrink-0 p-0.5 rounded hover:bg-muted transition-colors"
                title="取消排队"
              >
                <X size={14} className="text-muted-foreground" />
              </button>
            </div>
          ))}
        </div>
      )}
```

需要在 `AgentChat.tsx` 顶部导入 `Send` 图标（如果尚未导入）。

**Step 5: ChatInputArea — 添加 queuedCount prop 显示**

在 `ChatInputArea.tsx` 的 `ChatInputAreaProps` 接口中添加（约行 60-89）：

```typescript
  /** 排队消息数量 */
  queuedCount?: number;
```

发送按钮的 title 已在之前的修改中支持了 `isLoading ? "排队发送"` 提示，无需额外修改。

在 `AgentChat.tsx` 中传递 prop：

```typescript
      <ChatInputArea
        // ... 现有 props
        queuedCount={sendMessage.queuedMessages.length}
      />
```

**Step 6: 编译验证**

Run: `cd c:/dogear && bun run build:electron`
Expected: 编译成功，无类型错误

**Step 7: Commit**

```bash
git add components/agent-chat/hooks/useSendMessage.ts components/agent-chat/hooks/useSessionMessages.ts components/agent-chat/AgentChat.tsx components/agent-chat/ChatInputArea.tsx
git commit -m "fix: 排队消息悬浮预览区 + 取消功能 — 替代不可见的缓冲区机制"
```

---

## Task 3: 工具权限设置无效的调查与修复 (Bug #3)

**问题分析：** 设置页面的 `permissionRules.allow/deny` 写入到 `AppSettings` 顶层。后端 `query-based-session.ts:180` 用 `(appSettings as any).permissionRules` 读取——路径正确。但 `canUseTool` 回调的检查逻辑（行 342-348）只在 SDK **决定调用** `canUseTool` 时才生效。

**关键发现：** SDK 有两层权限机制：
1. `allowedTools: string[]` — SDK 内部直接自动允许，**不调用** `canUseTool`
2. `canUseTool` 回调 — 仅对 `allowedTools` 之外的工具调用

当前代码（行 198-206）只将 `['Read', 'Glob', 'Grep', 'AskUserQuestion']` 等传给 `allowedTools`。用户在设置页设的 `permissionRules.allow`（如 `Bash`）存在 `canUseTool` 回调中检查——但如果 SDK 的权限判断逻辑在调用 `canUseTool` 之前就 allow 了某些工具（基于 `permissionMode`），那 `permissionRules.allow` 的效果取决于 SDK 内部行为。

**真正的修复方案：** 将 `permissionRules.allow` 合并到 SDK 的 `allowedTools` 中，这是 SDK 提供的正规机制，绕过 `canUseTool` 直接自动允许。

**Files:**
- Modify: `electron/main/agents/query-based-session.ts:176-206`
- Modify: `types/settings.ts:53-57`（移除 `as any` 类型转换）

**Step 1: 在 AppSettings 类型中正式声明 permissionRules**

检查 `types/settings.ts` 行 42-60，确认 `permissionRules` 已在 `AppSettings` 顶层声明（根据调查已存在于行 53-57）。如果 `query-based-session.ts` 中仍用 `(appSettings as any).permissionRules`，则去掉 `as any`：

```typescript
// query-based-session.ts 行 180-183
// 修改前：
if ((appSettings as any).permissionRules) {
  this.permissionRules = (appSettings as any).permissionRules;

// 修改后：
if (appSettings.permissionRules) {
  this.permissionRules = appSettings.permissionRules;
```

**Step 2: 将 permissionRules.allow 合并到 SDK allowedTools**

修改 `query-based-session.ts` 行 195-206（工具列表配置区域），在设置 `queryOptions.allowedTools` 时合并 `permissionRules.allow`：

```typescript
      // 配置工具列表
      let allowedTools = this.config.allowedTools || ['Read', 'Glob', 'Grep', 'AskUserQuestion'];

      // 如果启用 Skill，将 'Skill' 工具放在第一位
      if (this.config.enableSkills) {
        allowedTools = ['Skill', ...allowedTools];
        this.logger.info('Skill 功能已启用，已添加 Skill 工具到 allowedTools 第一位:', allowedTools);
      }

      // 合并设置页面的声明式 allow 规则到 SDK allowedTools（SDK 级别自动允许）
      if (this.permissionRules?.allow?.length) {
        const merged = new Set([...allowedTools, ...this.permissionRules.allow]);
        allowedTools = [...merged];
        this.logger.info('已合并 permissionRules.allow 到 allowedTools:', this.permissionRules.allow);
      }

      // 合并设置页面的声明式 deny 规则到 SDK disallowedTools
      if (this.permissionRules?.deny?.length) {
        queryOptions.disallowedTools = this.permissionRules.deny;
        this.logger.info('已设置 disallowedTools:', this.permissionRules.deny);
      }

      queryOptions.allowedTools = allowedTools;
```

**Step 3: canUseTool 中保留兜底检查**

行 342-348 的 `canUseTool` 中 `permissionRules` 检查保留不变作为兜底（双保险）。这样即使 SDK 内部行为变化，`canUseTool` 中的声明式规则仍然生效。

**Step 4: 编译验证**

Run: `cd c:/dogear && bun run build:electron`
Expected: 编译成功

**Step 5: Commit**

```bash
git add electron/main/agents/query-based-session.ts types/settings.ts
git commit -m "fix: 工具权限设置生效 — permissionRules.allow 合并到 SDK allowedTools"
```

---

## Task 4: 系统消息脉冲改为固定圆点 (Point #5)

**需求：** 系统提示消息（status、compacting）不再使用脉冲动画，改为固定圆点。

**Files:**
- Modify: `components/agent-chat/ContentBlockItem.tsx:93,233`

**Step 1: 移除 status 块的 animate-pulse**

修改 `ContentBlockItem.tsx` 行 93（`case 'status'` 分支中的 div）：

```typescript
// 修改前：
<div className="w-2 h-2 bg-muted-foreground rounded-full animate-pulse"></div>

// 修改后：
<div className="w-2 h-2 bg-muted-foreground rounded-full"></div>
```

**Step 2: 移除 compacting 块的 animate-pulse**

修改 `ContentBlockItem.tsx` 行 233（`case 'compacting'` 分支中的 div）：

```typescript
// 修改前：
<div className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-pulse"></div>

// 修改后：
<div className="w-1.5 h-1.5 bg-muted-foreground rounded-full"></div>
```

**Step 3: Commit**

```bash
git add components/agent-chat/ContentBlockItem.tsx
git commit -m "feat: 系统消息圆点改为静态 — 移除 status/compacting 的 animate-pulse"
```

---

## Task 5: 会话列表运行/确认状态脉冲样式 (Point #4)

**需求：**
- 正常运行：橙色脉冲圆点（替代现有的 Loader2 转圈）
- 需要用户确认（权限/AskUser）：蓝色脉冲圆点
- 空闲：无特殊图标

**Files:**
- Modify: `stores/conversation-store.ts:43-46,465-472`
- Modify: `components/BookConversationList.tsx:228-290`

**Step 1: conversation-store 添加 pendingActionConversationIds**

在 `stores/conversation-store.ts` 的 state 定义区域（行 43 附近），添加：

```typescript
  /** 当前有待处理操作（权限/AskUser）的对话 ID 集合 */
  pendingActionConversationIds: Set<string>;
```

初始值（行 195 附近）：

```typescript
  pendingActionConversationIds: new Set<string>(),
```

添加 action（行 465 附近，`setRunningState` 后面）：

```typescript
  setPendingActionState: (conversationId: string, isPending: boolean) => {
    set((state) => {
      const newSet = new Set(state.pendingActionConversationIds);
      if (isPending) newSet.add(conversationId);
      else newSet.delete(conversationId);
      return { pendingActionConversationIds: newSet };
    });
  },
```

**Step 2: 从 renderer-handlers 中广播 pending action 状态**

需要在 `useSessionEvents.ts` 的权限请求和 AskUser 事件中更新 pendingAction 状态。

在 `useSessionEvents.ts` 的权限请求 handler（行 60-93）末尾添加：

```typescript
      // 标记该会话有待处理操作
      // 需要从 sessionId 反查 conversationId
      // 注意：这里可以通过 props 传入 conversationId
```

**更好的方案**：在 `useSessionEvents` 的接口中添加 `conversationId` prop：

```typescript
interface UseSessionEventsParams {
  sessionId: string | null;
  conversationId: string | null;  // ← 新增
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setPermissionMode: Dispatch<SetStateAction<PermissionMode>>;
  onScrollToAction?: () => void;
}
```

在权限请求 handler 末尾（行 92 后）添加：

```typescript
      // 标记该会话有待处理的权限操作
      if (conversationId) {
        useConversationStore.getState().setPendingActionState(conversationId, true);
      }
```

在 AskUser handler 末尾（行 132 后）添加类似代码。

在 `useSendMessage` 的 `handlePermissionResolved` 和 `handleAskUserResolved` 中，解除 pending 状态：

```typescript
      if (conversationId) {
        useConversationStore.getState().setPendingActionState(conversationId, false);
      }
```

**Step 3: BookConversationList — 替换 Loader2 为脉冲圆点**

修改 `BookConversationList.tsx` 行 228-229 添加 pending 状态读取：

```typescript
const pendingIds = useConversationStore((s) => s.pendingActionConversationIds);
const isPending = pendingIds.has(conv.id);
```

替换行 280-290 的图标渲染：

```tsx
{isRunning ? (
  isPending ? (
    // 需要用户确认 → 蓝色脉冲
    <span className="relative flex w-4 h-4 items-center justify-center flex-shrink-0">
      <span className="absolute w-2.5 h-2.5 rounded-full bg-blue-400 animate-pulse" />
      <span className="w-2 h-2 rounded-full bg-blue-500" />
    </span>
  ) : (
    // 正常运行 → 橙色脉冲
    <span className="relative flex w-4 h-4 items-center justify-center flex-shrink-0">
      <span className="absolute w-2.5 h-2.5 rounded-full bg-orange-400 animate-pulse" />
      <span className="w-2 h-2 rounded-full bg-orange-500" />
    </span>
  )
) : isFork ? (
  <GitBranch className={cn('w-4 h-4 flex-shrink-0',
    isSelected ? 'text-purple-600' : 'text-purple-400'
  )} />
) : (
  <MessageSquare className={cn('w-4 h-4 flex-shrink-0',
    isSelected ? 'text-blue-600' : 'text-muted-foreground'
  )} />
)}
```

**Step 4: AgentChat — 传入 conversationId 到 useSessionEvents**

```typescript
  useSessionEvents({
    sessionId,
    conversationId,  // ← 新增
    setMessages,
    setIsLoading,
    setPermissionMode,
    onScrollToAction: () => {
      setTimeout(() => scrollToBottom('smooth'), 100);
    },
  });
```

**Step 5: 编译验证**

Run: `cd c:/dogear && bun run build:electron`
Expected: 编译成功

**Step 6: Commit**

```bash
git add stores/conversation-store.ts components/BookConversationList.tsx components/agent-chat/hooks/useSessionEvents.ts components/agent-chat/AgentChat.tsx components/agent-chat/hooks/useSendMessage.ts
git commit -m "feat: 会话列表脉冲样式 — 运行中橙色脉冲/需确认蓝色脉冲替代 Loader2 转圈"
```

---

## Task 6: 左侧面板分页布局 (Point #1)

**需求：** 会话列表和工作区文件树改为分页 Tab 切换，替代上下堆叠。

**Files:**
- Modify: `stores/ui-store.ts`
- Modify: `app/page.tsx:213-226`

**Step 1: ui-store 添加 leftPanelTab state**

在 `stores/ui-store.ts` 的 `UIState` 接口中添加：

```typescript
  // 左侧面板 tab
  leftPanelTab: 'conversations' | 'explorer';
  setLeftPanelTab: (tab: 'conversations' | 'explorer') => void;
```

在 create 实现中添加初始值和 action：

```typescript
  leftPanelTab: 'conversations',
  setLeftPanelTab: (tab) => set({ leftPanelTab: tab }),
```

**Step 2: page.tsx 左侧栏改为 Tab 分页**

替换 `app/page.tsx` 行 213-226 的左侧栏代码：

```tsx
{/* 左侧：Tab 分页（对话列表 / 工作区文件树） */}
<aside className="w-64 border-r bg-muted/30 flex flex-col">
  {/* Tab 切换栏 */}
  <div className="flex border-b">
    <button
      onClick={() => setLeftPanelTab('conversations')}
      className={cn(
        'flex-1 py-2 text-xs font-medium text-center transition-colors',
        leftPanelTab === 'conversations'
          ? 'text-foreground border-b-2 border-primary'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      对话
    </button>
    <button
      onClick={() => setLeftPanelTab('explorer')}
      className={cn(
        'flex-1 py-2 text-xs font-medium text-center transition-colors',
        leftPanelTab === 'explorer'
          ? 'text-foreground border-b-2 border-primary'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      文件
    </button>
  </div>

  {/* Tab 内容 */}
  <div className="flex-1 overflow-hidden">
    {leftPanelTab === 'conversations' ? (
      <ConversationList />
    ) : (
      <WorkspaceExplorer />
    )}
  </div>
</aside>
```

在 `page.tsx` 组件函数开头添加 store 读取：

```typescript
const leftPanelTab = useUIStore((s) => s.leftPanelTab);
const setLeftPanelTab = useUIStore((s) => s.setLeftPanelTab);
```

确保 `useUIStore` 已在 import 中。

**Step 3: 编译验证**

Run: `cd c:/dogear && bun run build:electron`
Expected: 编译成功

**Step 4: Commit**

```bash
git add stores/ui-store.ts app/page.tsx
git commit -m "feat: 左侧面板分页布局 — 对话列表/文件树 Tab 切换替代上下堆叠"
```

---

## Task 7: 会话引用功能 (Point #2)

**需求：** 新对话中可以引用之前的对话，让 Agent 去读取历史会话的记忆。在会话列表中右键菜单添加"引用到当前对话"，引用后在输入框上方显示引用芯片。

**Files:**
- Modify: `stores/reference-store.ts`
- Modify: `components/agent-chat/hooks/useSendMessage.ts`（引用组装）
- Modify: `components/agent-chat/ChatInputArea.tsx`（引用芯片渲染）
- Modify: `components/BookConversationList.tsx`（右键菜单）

**Step 1: reference-store 添加 conversation 引用**

在 `stores/reference-store.ts` 中添加类型和 state：

```typescript
export interface ConversationReference {
  conversationId: string;
  title: string;
  sdkSessionId: string | null;
}
```

在 `ReferenceState` 接口中添加：

```typescript
  referencedConversations: ConversationReference[];
  addReferencedConversation: (conv: ConversationReference) => void;
  removeReferencedConversation: (conversationId: string) => void;
  clearReferencedConversations: () => void;
```

在 store 实现中添加初始值和 actions：

```typescript
  referencedConversations: [],
  addReferencedConversation: (conv) => {
    set((state) => {
      if (state.referencedConversations.some(c => c.conversationId === conv.conversationId)) return state;
      return { referencedConversations: [...state.referencedConversations, conv] };
    });
  },
  removeReferencedConversation: (conversationId) => {
    set((state) => ({
      referencedConversations: state.referencedConversations.filter(c => c.conversationId !== conversationId),
    }));
  },
  clearReferencedConversations: () => set({ referencedConversations: [] }),
```

在 `reset` action 中也清空 `referencedConversations`。

**Step 2: useSendMessage — 组装 conversation 引用 XML 标签**

在 `useSendMessage.ts` 的引用读取区域（行 61-67 附近）添加：

```typescript
const referencedConversations = useReferenceStore((s) => s.referencedConversations);
const clearReferencedConversations = useReferenceStore((s) => s.clearReferencedConversations);
```

在消息组装区域（行 339 附近，文章引用之前）添加会话引用 block：

```typescript
    // 会话引用
    if (referencedConversations.length > 0) {
      const convLines = referencedConversations.map(c =>
        `<conversation title="${sanitize(c.title)}" conversationId="${c.conversationId}" sdkSessionId="${c.sdkSessionId || ''}" />`
      ).join('\n');
      textBlocks.push({
        text: `<referenced_conversations>\n${convLines}\n</referenced_conversations>`,
      });
    }
```

在发送后的清除区域添加：

```typescript
    clearReferencedConversations();
```

**Step 3: ChatInputArea — 渲染会话引用芯片**

在 `ChatInputArea.tsx` 的引用 store 读取区域（行 119-126）添加：

```typescript
const referencedConversations = useReferenceStore((s) => s.referencedConversations);
const removeReferencedConversation = useReferenceStore((s) => s.removeReferencedConversation);
```

在引用芯片渲染区域（行 154-216 中的 `<div className="flex flex-wrap gap-1.5">` 内），现有文件引用芯片之后添加：

```tsx
{/* 会话引用芯片 — 淡紫 */}
{referencedConversations.map(conv => (
  <span
    key={conv.conversationId}
    className="inline-flex items-center gap-1 px-2 py-1 bg-purple-50 border border-purple-200 rounded-full text-xs text-purple-700"
    title={`引用会话: ${conv.title}`}
  >
    <MessageSquare className="w-3 h-3 flex-shrink-0" />
    <span className="max-w-[160px] truncate">{conv.title}</span>
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={() => removeReferencedConversation(conv.conversationId)}
      className="flex-shrink-0 h-4 w-4 p-0 rounded-full hover:bg-purple-100"
    >
      <X className="w-3 h-3" />
    </Button>
  </span>
))}
```

同时更新条件渲染的判断（行 154），添加 `referencedConversations.length > 0`：

```tsx
{(referencedArticles.length > 0 || quotedSnippets.length > 0 || referencedFiles.length > 0 || referencedConversations.length > 0 || pendingImages.length > 0) && (
```

以及内层判断：

```tsx
{(referencedArticles.length > 0 || quotedSnippets.length > 0 || referencedFiles.length > 0 || referencedConversations.length > 0) && (
```

**Step 4: BookConversationList — 右键菜单"引用到当前对话"**

在 `BookConversationList.tsx` 的对话项上添加右键菜单或在已有的编辑/删除按钮旁添加引用按钮。

如果已有右键菜单（ContextMenu），添加 item：

```tsx
<ContextMenuItem onClick={() => {
  const { addReferencedConversation } = useReferenceStore.getState();
  addReferencedConversation({
    conversationId: conv.id,
    title: getConversationTitle(conv),
    sdkSessionId: conv.sdk_session_id || null,
  });
}}>
  引用到当前对话
</ContextMenuItem>
```

如果没有右键菜单，在 hover 按钮区域（行 326-347 附近的编辑/删除按钮旁）添加引用按钮：

```tsx
<button
  onClick={(e) => {
    e.stopPropagation();
    const { addReferencedConversation } = useReferenceStore.getState();
    addReferencedConversation({
      conversationId: conv.id,
      title: getConversationTitle(conv),
      sdkSessionId: conv.sdk_session_id || null,
    });
  }}
  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-muted transition-all"
  title="引用到当前对话"
>
  <Quote size={14} className="text-muted-foreground" />
</button>
```

需要从 lucide-react 导入 `Quote` 图标。

**Step 5: 编译验证**

Run: `cd c:/dogear && bun run build:electron`
Expected: 编译成功

**Step 6: Commit**

```bash
git add stores/reference-store.ts components/agent-chat/hooks/useSendMessage.ts components/agent-chat/ChatInputArea.tsx components/BookConversationList.tsx
git commit -m "feat: 会话引用功能 — 引用历史对话到新对话，Agent 可读取上下文"
```

---

## Task 8: 导入丢失的会话（合并模式）+ conversation-tree 来源记录 (Point #8)

**场景：** 用户意外删除了 `workspaces.json` 中的工作区索引 → 新建了工作区 → 但 `.dogear/workspaces/` 下旧的数据文件夹还在 → 需要把旧会话"导入"到当前工作区。同一个实际工作区可能因多次操作产生多个孤儿文件夹，所以用合并模式而非认领。

**解决方案（合并导入）：**
1. 扫描 `.dogear/workspaces/` 下未被注册的孤儿文件夹
2. 展示列表让用户选择要导入的文件夹
3. 将选中文件夹的 `conversations.json` 中的对话索引合并到当前工作区（ID 是 UUID，天然不冲突）
4. 将 `conversation-tree.json` 中的对话 ID 追加到当前 tree 的 `__root__` children 末尾（旧文件夹结构也带过来）
5. 导入完成后清理空的孤儿文件夹（可选）

**数据结构简析（合并为什么简单）：**
- `conversations.json` = `{ version, conversations: Record<id, ConversationIndex> }` — 直接 `Object.assign` 合并，UUID 不冲突
- `conversation-tree.json` = `{ version, folders: Record<id, Folder>, children: Record<parentId, childIds[]> }` — 旧 folders 全部拷入，旧 `__root__` 下的 children 追加到当前 `__root__` 末尾，旧非根 children 照搬
- SDK 会话历史在 `.dogear/conversations/` 全局目录下（按 sdkSessionId 命名），不在 workspaces 子目录中，无需移动

**辅助措施：** `conversation-tree.json` 新增 `sourceWorkspace` 顶层字段记录来源工作区名称+路径，导入时显示"这可能是之前的 XXX 工作区"。

**Files:**
- Modify: `electron/main/services/conversation-tree-service.ts:17-29`（添加 sourceWorkspace 字段 + merge 方法）
- Create: `electron/main/services/workspace-recovery-service.ts`（孤儿扫描 + 合并导入）
- Modify: `electron/main/services/workspace-json-service.ts`（创建工作区时写入 sourceWorkspace）
- Modify: `electron/main/tipc/workspace.ts`（新增扫描/导入 RPC）
- Modify: `components/workspace-selector.tsx`（添加"导入丢失的会话"入口 + 选择 UI）

**Step 1: conversation-tree.json 添加 sourceWorkspace 字段**

在 `conversation-tree-service.ts` 行 17-29，扩展类型：

```typescript
/** 来源工作区信息（创建时写入，用于恢复时识别） */
export interface SourceWorkspaceInfo {
  name: string;      // 工作区名称
  path: string;      // 工作区文件系统路径
}

export interface ConversationTreeFile {
  version: number;
  folders: Record<string, ConversationFolder>;
  children: Record<string, string[]>;
  /** 创建此 tree 时的工作区信息（用于丢失后识别来源） */
  sourceWorkspace?: SourceWorkspaceInfo;
}
```

修改 `emptyTree()`（行 52-54）也包含 sourceWorkspace 占位：

```typescript
function emptyTree(): ConversationTreeFile {
  return { version: 1, folders: {}, children: { [ROOT_ID]: [] } };
}
```

添加来源信息读写方法：

```typescript
/** 设置来源工作区信息（创建工作区时调用一次） */
export async function setSourceWorkspace(workspaceId: string, info: SourceWorkspaceInfo): Promise<void> {
  const tree = await loadTree(workspaceId);
  tree.sourceWorkspace = info;
  await saveTree(workspaceId, tree);
}
```

**Step 2: 添加 tree 合并方法**

在 `conversation-tree-service.ts` 中添加：

```typescript
/**
 * 将另一个 tree 的内容合并到当前工作区的 tree。
 * - 旧 folders 全部拷入（ID 冲突时跳过，实际不会冲突因为是 UUID）
 * - 旧 __root__ 下的 children 追加到当前 __root__ 末尾
 * - 旧非根 parent-children 关系照搬
 * - 维护分区不变量：文件夹在前、对话在后
 */
export async function mergeTree(workspaceId: string, sourceTree: ConversationTreeFile): Promise<void> {
  const tree = await loadTree(workspaceId);

  // 合并 folders
  for (const [id, folder] of Object.entries(sourceTree.folders)) {
    if (!tree.folders[id]) {
      tree.folders[id] = folder;
    }
  }

  // 合并 children
  for (const [parentId, childIds] of Object.entries(sourceTree.children)) {
    if (parentId === ROOT_ID) {
      // 旧根节点的 children 追加到当前根节点末尾
      const existing = new Set(tree.children[ROOT_ID] || []);
      const newIds = childIds.filter(id => !existing.has(id));
      tree.children[ROOT_ID] = [...(tree.children[ROOT_ID] || []), ...newIds];
    } else {
      // 非根 parent-children 关系照搬（如果当前 tree 没有这个 parent）
      if (!tree.children[parentId]) {
        tree.children[parentId] = [...childIds];
      }
    }
  }

  // 维护分区不变量：根节点下文件夹在前、对话在后
  const rootChildren = tree.children[ROOT_ID] || [];
  const folderIds = rootChildren.filter(id => tree.folders[id]);
  const convIds = rootChildren.filter(id => !tree.folders[id]);
  tree.children[ROOT_ID] = [...folderIds, ...convIds];

  await saveTree(workspaceId, tree);
}
```

**Step 3: 创建工作区时写入 sourceWorkspace**

在 `workspace-json-service.ts` 的创建工作区流程中，创建成功后调用：

```typescript
import { setSourceWorkspace } from './conversation-tree-service.js';

// 创建工作区后记录来源信息
await setSourceWorkspace(newWorkspace.id, {
  name: newWorkspace.name,
  path: newWorkspace.path,
});
```

**Step 4: 创建 workspace-recovery-service.ts**

```typescript
// electron/main/services/workspace-recovery-service.ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { getConfigDir } from './settings-service.js';
import { safeJsonRead } from './safe-json.js';
import type { ConversationIndex } from './conversation-service.js';
import type { ConversationTreeFile, SourceWorkspaceInfo } from './conversation-tree-service.js';

/** 孤儿工作区信息（扫描结果） */
export interface OrphanWorkspace {
  /** .dogear/workspaces/ 下的文件夹名（即 workspaceId） */
  id: string;
  /** 来源工作区名称（从 conversation-tree.json 读取） */
  sourceName?: string;
  /** 来源工作区路径 */
  sourcePath?: string;
  /** 对话数量 */
  conversationCount: number;
  /** 对话标题列表（前 5 条，帮助用户识别） */
  sampleTitles: string[];
  /** 最后更新时间（ISO 8601） */
  lastUpdated: string | null;
}

/**
 * 扫描 .dogear/workspaces/ 目录，找出未被 workspaces.json 注册的孤儿文件夹。
 */
export async function scanOrphanWorkspaces(): Promise<OrphanWorkspace[]> {
  const configDir = getConfigDir();
  const workspacesDir = path.join(configDir, 'workspaces');

  // 读取 workspaces.json 中已注册的 ID
  const workspacesFile = await safeJsonRead<{ workspaces: Array<{ id: string }> }>(
    path.join(configDir, 'workspaces.json'),
    { workspaces: [] },
  );
  const registeredIds = new Set(workspacesFile.workspaces.map(w => w.id));

  // 列出 .dogear/workspaces/ 下所有子目录
  let entries: string[] = [];
  try {
    const dirEntries = await fs.readdir(workspacesDir, { withFileTypes: true });
    entries = dirEntries.filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return [];
  }

  const orphanIds = entries.filter(id => !registeredIds.has(id));

  const orphans: OrphanWorkspace[] = [];
  for (const id of orphanIds) {
    const wsDir = path.join(workspacesDir, id);

    // 读取 conversation-tree.json 中的 sourceWorkspace
    const tree = await safeJsonRead<{ sourceWorkspace?: SourceWorkspaceInfo }>(
      path.join(wsDir, 'conversation-tree.json'), {},
    );

    // 读取 conversations.json
    const convFile = await safeJsonRead<{
      conversations: Record<string, ConversationIndex>;
    }>(path.join(wsDir, 'conversations.json'), { conversations: {} });

    const convEntries = Object.values(convFile.conversations || {});
    if (convEntries.length === 0) continue; // 跳过空文件夹

    // 按 updatedAt 倒序排列，取前 5 条标题
    const sorted = convEntries.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    const sampleTitles = sorted.slice(0, 5).map(c => c.title);
    const lastUpdated = sorted[0]?.updatedAt || null;

    orphans.push({
      id,
      sourceName: tree.sourceWorkspace?.name,
      sourcePath: tree.sourceWorkspace?.path,
      conversationCount: convEntries.length,
      sampleTitles,
      lastUpdated,
    });
  }

  orphans.sort((a, b) => (b.lastUpdated || '').localeCompare(a.lastUpdated || ''));
  return orphans;
}

/**
 * 将孤儿工作区的会话合并导入到目标工作区。
 *
 * 步骤：
 * 1. 读取孤儿的 conversations.json，所有对话索引 merge 到目标（更新 workspaceId）
 * 2. 读取孤儿的 conversation-tree.json，调用 mergeTree 合并层级结构
 * 3. 导入完成后可选删除孤儿文件夹（或保留）
 *
 * 返回导入的对话数量。
 */
export async function importOrphanToWorkspace(
  orphanId: string,
  targetWorkspaceId: string,
  deleteAfterImport: boolean = false,
): Promise<{ importedCount: number }> {
  const configDir = getConfigDir();
  const orphanDir = path.join(configDir, 'workspaces', orphanId);

  // 1. 读取孤儿 conversations
  const orphanConvFile = await safeJsonRead<{
    version: number;
    conversations: Record<string, ConversationIndex>;
  }>(path.join(orphanDir, 'conversations.json'), { version: 1, conversations: {} });

  const orphanConversations = orphanConvFile.conversations;
  const importedCount = Object.keys(orphanConversations).length;

  if (importedCount === 0) {
    return { importedCount: 0 };
  }

  // 动态导入避免循环依赖
  const conversationService = await import('./conversation-service.js');
  const conversationTreeService = await import('./conversation-tree-service.js');

  // 2. 合并对话索引到目标工作区
  // 读取目标工作区的 conversations
  const targetConversations = await conversationService.getByWorkspaceId(targetWorkspaceId);
  const targetConvMap = new Map(targetConversations.map(c => [c.id, c]));

  // 逐条合并（跳过已存在的 ID）
  let actualImported = 0;
  for (const [id, conv] of Object.entries(orphanConversations)) {
    if (!targetConvMap.has(id)) {
      // 更新 workspaceId 指向目标工作区
      const updatedConv = { ...conv, workspaceId: targetWorkspaceId };
      await conversationService.importConversation(targetWorkspaceId, updatedConv);
      actualImported++;
    }
  }

  // 3. 合并 tree 结构
  const orphanTree = await safeJsonRead<ConversationTreeFile>(
    path.join(orphanDir, 'conversation-tree.json'),
    { version: 1, folders: {}, children: {} },
  );
  await conversationTreeService.mergeTree(targetWorkspaceId, orphanTree);

  // 4. 可选清理
  if (deleteAfterImport) {
    try {
      await fs.rm(orphanDir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响导入结果
    }
  }

  return { importedCount: actualImported };
}
```

**Step 5: conversation-service 添加 importConversation 方法**

在 `electron/main/services/conversation-service.ts` 的 CRUD 区域添加：

```typescript
/**
 * 导入一条对话索引（用于工作区恢复，不生成新 ID）
 */
export async function importConversation(
  workspaceId: string,
  conv: ConversationIndex,
): Promise<void> {
  const data = await loadWorkspaceConversations(workspaceId);
  // 跳过已存在的
  if (data.conversations[conv.id]) return;
  data.conversations[conv.id] = conv;
  await saveWorkspaceConversations(workspaceId, data);
}
```

**Step 6: tipc 新增扫描/导入 RPC**

在 `electron/main/tipc/workspace.ts` 中添加：

```typescript
import { scanOrphanWorkspaces, importOrphanToWorkspace } from '../services/workspace-recovery-service.js';

export const scanOrphanWorkspacesRoute = tipc.procedure
  .input(z.object({}))
  .action(async () => {
    return await scanOrphanWorkspaces();
  });

export const importOrphanWorkspaceRoute = tipc.procedure
  .input(z.object({
    orphanId: z.string(),
    targetWorkspaceId: z.string(),
    deleteAfterImport: z.boolean().optional(),
  }))
  .action(async ({ input }) => {
    return await importOrphanToWorkspace(
      input.orphanId,
      input.targetWorkspaceId,
      input.deleteAfterImport ?? false,
    );
  });
```

在 `tipc/index.ts` 中注册这两个路由。

**Step 7: workspace-selector 添加"导入丢失的会话"UI**

在 `components/workspace-selector.tsx` 的工作区列表底部添加入口按钮：

```tsx
<Button
  variant="ghost"
  size="sm"
  className="w-full justify-start text-muted-foreground"
  onClick={handleScanOrphans}
>
  <Import size={14} className="mr-2" />
  导入丢失的会话
</Button>
```

点击后弹出对话框，展示孤儿工作区列表：

```tsx
{showRecoveryDialog && (
  <Dialog open onOpenChange={() => setShowRecoveryDialog(false)}>
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>导入丢失的会话</DialogTitle>
        <DialogDescription>
          找到以下未关联的历史会话数据，点击可将其合并导入到当前工作区
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2 max-h-[400px] overflow-y-auto">
        {orphans.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            没有找到丢失的会话数据
          </p>
        ) : (
          orphans.map(orphan => (
            <div
              key={orphan.id}
              className="p-3 rounded-lg border hover:bg-muted/50 cursor-pointer"
              onClick={() => handleImportOrphan(orphan)}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-sm font-medium">
                  {orphan.sourceName || `未知来源 (${orphan.id.slice(0, 8)}...)`}
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {orphan.conversationCount} 个对话
                  </span>
                  {orphan.sourceName && (
                    <span className="text-xs px-1.5 py-0.5 bg-orange-50 border border-orange-200 rounded text-orange-600">
                      可能匹配
                    </span>
                  )}
                </div>
              </div>
              {orphan.sourcePath && (
                <div className="text-xs text-muted-foreground truncate">
                  原路径: {orphan.sourcePath}
                </div>
              )}
              {orphan.sampleTitles.length > 0 && (
                <div className="text-xs text-muted-foreground mt-1">
                  {orphan.sampleTitles.join('、')}
                  {orphan.conversationCount > 5 && '...'}
                </div>
              )}
              {orphan.lastUpdated && (
                <div className="text-xs text-muted-foreground mt-0.5">
                  最后更新: {new Date(orphan.lastUpdated).toLocaleDateString()}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </DialogContent>
  </Dialog>
)}
```

`handleImportOrphan` 调用 IPC：

```typescript
async function handleImportOrphan(orphan: OrphanWorkspace) {
  const currentWorkspaceId = useWorkspaceStore.getState().workspace?.id;
  if (!currentWorkspaceId) return;

  const result = await client.importOrphanWorkspace({
    orphanId: orphan.id,
    targetWorkspaceId: currentWorkspaceId,
    deleteAfterImport: true,  // 导入后清理孤儿文件夹
  });

  toast.success(`已导入 ${result.importedCount} 个会话`);
  setShowRecoveryDialog(false);

  // 刷新对话列表
  await useConversationStore.getState().loadConversations();
}
```

需要导入 `Import` 图标（lucide-react），`toast`（sonner），以及 Dialog 相关 shadcn 组件。

**Step 8: 编译验证**

Run: `cd c:/dogear && bun run build:electron`
Expected: 编译成功

**Step 9: Commit**

```bash
git add electron/main/services/conversation-tree-service.ts electron/main/services/conversation-service.ts electron/main/services/workspace-recovery-service.ts electron/main/services/workspace-json-service.ts electron/main/tipc/workspace.ts electron/main/tipc/index.ts components/workspace-selector.tsx
git commit -m "feat: 导入丢失的会话 — 扫描孤儿数据文件夹 + 合并到当前工作区"
```

---

## Task 9: 独立会话窗口 (Point #9)

**需求：** 打开的会话 tab 可以弹出为独立窗口，包含当前会话区域 + 右侧面板 + 左侧可折叠的工作区文件树。

**Files:**
- Modify: `electron/main/index.ts:27-44,224-234`（添加 sessionWindow 管理）
- Create: `app/session-window/page.tsx`（独立会话窗口页面）
- Modify: `src/App.tsx`（添加路由）
- Modify: `electron/main/tipc/agent.ts`（添加创建会话窗口的 IPC）

**Step 1: 主进程添加 createSessionWindow**

在 `electron/main/index.ts` 中添加（参照 `createStockWindow` 模式）：

```typescript
// 会话窗口映射（支持多个独立会话窗口）
const sessionWindows = new Map<string, BrowserWindowType>();

export function createSessionWindow(conversationId: string, title: string) {
  if (sessionWindows.has(conversationId)) {
    sessionWindows.get(conversationId)!.focus();
    return;
  }

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: `会话: ${title}`,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const url = isDev
    ? `http://localhost:3000/#/session-window/${conversationId}`
    : `file://${path.join(__dirname, '../../out/index.html')}#/session-window/${conversationId}`;
  win.loadURL(url);

  sessionWindows.set(conversationId, win);
  win.on('closed', () => {
    sessionWindows.delete(conversationId);
  });
}
```

在 `closeAllChildWindows` 中添加：

```typescript
  for (const [, win] of sessionWindows) {
    if (!win.isDestroyed()) win.close();
  }
  sessionWindows.clear();
```

**Step 2: 添加路由**

在 `src/App.tsx` 的 Routes 中添加：

```tsx
<Route path="/session-window/:conversationId" element={<ErrorBoundary fallback="page"><SessionWindowPage /></ErrorBoundary>} />
```

添加 import：

```typescript
import { SessionWindowPage } from '@/app/session-window/page';
```

**Step 3: 创建 SessionWindowPage**

```tsx
// app/session-window/page.tsx
import { useParams } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { AgentChat } from '@/components/agent-chat/AgentChat';
import { WorkspaceExplorer } from '@/components/WorkspaceExplorer';
import { ArticlePreview } from '@/components/ArticlePreview';
import { cn } from '@/lib/utils';
import { PanelLeftClose, PanelLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConversationStore } from '@/stores/conversation-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

export function SessionWindowPage() {
  const { conversationId } = useParams<{ conversationId: string }>();
  const [leftPanelOpen, setLeftPanelOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const selectConversation = useConversationStore((s) => s.selectConversation);
  const conversations = useConversationStore((s) => s.conversations);
  const loadConversations = useConversationStore((s) => s.loadConversations);

  // 初始化：加载对话列表并选中指定对话
  useEffect(() => {
    async function init() {
      await loadConversations();
      const conv = conversations.find(c => c.id === conversationId);
      if (conv) {
        await selectConversation(conv);
      }
    }
    init();
  }, [conversationId]);

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* 头部栏 */}
      <header className="h-10 border-b flex items-center px-3 gap-2 drag-region">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setLeftPanelOpen(!leftPanelOpen)}
        >
          {leftPanelOpen ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}
        </Button>
        <span className="text-sm font-medium truncate">
          {conversations.find(c => c.id === conversationId)?.title || '会话窗口'}
        </span>
      </header>

      {/* 主体 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧：可折叠的工作区文件树 */}
        {leftPanelOpen && (
          <aside className="w-56 border-r bg-muted/30 overflow-hidden">
            <WorkspaceExplorer />
          </aside>
        )}

        {/* 中间：AgentChat */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {conversationId && (
            <AgentChat
              conversationIdOverride={conversationId}
              showStatusHint={false}
            />
          )}
        </main>

        {/* 右侧：文章预览面板 */}
        {rightPanelOpen && (
          <aside className="w-80 border-l overflow-hidden">
            <ArticlePreview />
          </aside>
        )}
      </div>
    </div>
  );
}
```

**Step 4: IPC — 添加创建会话窗口路由**

在 `electron/main/tipc/agent.ts` 或单独的窗口管理路由中添加：

```typescript
export const openSessionWindowRoute = tipc.procedure
  .input(z.object({
    conversationId: z.string(),
    title: z.string(),
  }))
  .action(async ({ input }) => {
    const { createSessionWindow } = await import('../index.js');
    createSessionWindow(input.conversationId, input.title);
    return { success: true };
  });
```

**Step 5: 前端 tab 上添加"弹出为独立窗口"按钮**

在 `AgentChat.tsx` 或 `page.tsx` 的 tab 栏中，每个 tab 添加弹出按钮：

```tsx
<button
  onClick={async () => {
    await client.openSessionWindow({
      conversationId: tab.id,
      title: tab.title,
    });
  }}
  className="p-1 rounded hover:bg-muted"
  title="弹出为独立窗口"
>
  <ExternalLink size={12} />
</button>
```

**Step 6: 编译验证**

Run: `cd c:/dogear && bun run build:electron`
Expected: 编译成功

**Step 7: Commit**

```bash
git add electron/main/index.ts app/session-window/page.tsx src/App.tsx electron/main/tipc/agent.ts
git commit -m "feat: 独立会话窗口 — tab 弹出为独立窗口，含可折叠文件树和预览面板"
```

---

## 实施优先级总览

| Task | 类型 | 复杂度 | 依赖 |
|------|------|--------|------|
| 1 | Bug 修复（滚动） | 低 | 无 |
| 2 | Bug 修复（排队消息） | 中 | 无 |
| 3 | Bug 修复（权限） | 中 | 无 |
| 4 | UI 微调（静态圆点） | 低 | 无 |
| 5 | UI 优化（脉冲样式） | 中 | 无 |
| 6 | UI 重构（分页布局） | 低 | 无 |
| 7 | 新功能（会话引用） | 中 | 无 |
| 8 | 导入丢失的会话（合并模式） | 中 | 无 |
| 9 | 新功能（独立窗口） | 高 | 无 |

> Task 1-6 独立无依赖，可并行开发。Task 7 独立但涉及多文件。Task 8-9 复杂度高但也独立。
