# 微信 Bot UI 改进实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 5 项 Bot UI 改进：微信 Dialog 化、会话运行状态提升、Bot 绑定标记、Bot 输入显示、自动初始化

**Architecture:** 主进程新增 3 个 renderer-handler 事件 + sessionManager 反查方法；前端将微信独立窗口改为 shadcn Dialog；conversation-store 新增运行状态和 bot 绑定状态；广播层扩展支持 conversation 级别运行状态

**Tech Stack:** Electron IPC (tipc), React, Zustand, shadcn/ui Dialog, lucide-react

---

### Task 1: 新增 renderer-handler 事件定义

**Files:**
- Modify: `electron/main/tipc/renderer-handlers.ts:169` (在 `};` 之前追加)

**Step 1: 添加 3 个新事件**

在 `renderer-handlers.ts` 文件末尾 `};` 之前，追加：

```typescript
  // 对话运行状态变化（主进程统一管理，不依赖渲染层 tab 是否打开）
  conversationRunningStateChanged: (data: {
    conversationId: string;
    isRunning: boolean;
  }) => void;

  // 微信 Bot 绑定对话变更
  wechatBotBindingChanged: (data: {
    conversationId: string | null;
  }) => void;

  // 微信 Bot 自动初始化数据（startPolling 成功后推送）
  wechatBotAutoInit: (data: {
    status: {
      workspaceId: string | null;
      workspaceName: string | null;
      conversationId: string | null;
      conversationTitle: string | null;
      debugMode: boolean;
    };
    conversations: Array<{
      index: number;
      id: string;
      title: string;
      updatedAt: string;
    }>;
  }) => void;
```

**Step 2: 编译验证**

Run: `bun run build:electron`
Expected: 编译通过

**Step 3: Commit**

```bash
git add electron/main/tipc/renderer-handlers.ts
git commit -m "feat: 新增 conversationRunningState / botBinding / botAutoInit 事件定义"
```

---

### Task 2: sessionManager 新增 getConversationIdBySession 反查方法

**Files:**
- Modify: `electron/main/agents/query-based-session.ts:1629` (在 `getSessionIdByConversation` 方法之后)

**Step 1: 添加反查方法**

在 `getSessionIdByConversation` 方法之后（约第 1629 行），添加：

```typescript
  /**
   * 根据 sessionId 反查绑定的 conversationId（运行状态广播需要）
   */
  getConversationIdBySession(sessionId: string): string | undefined {
    for (const [convId, sid] of this.conversationSessionMap) {
      if (sid === sessionId) return convId;
    }
    return undefined;
  }
```

**Step 2: 编译验证**

Run: `bun run build:electron`
Expected: 编译通过

**Step 3: Commit**

```bash
git add electron/main/agents/query-based-session.ts
git commit -m "feat: sessionManager 新增 getConversationIdBySession 反查"
```

---

### Task 3: 主进程广播层 — 会话运行状态 + Bot 绑定 + Bot 输入

**Files:**
- Modify: `electron/main/tipc/agent.ts:60-74` (setBroadcaster 区域扩展)
- Modify: `electron/main/services/wechat/wechat-bot-controller.ts:99-121` (handleAgentMessage 增加广播)
- Modify: `electron/main/services/wechat/wechat-bot-controller.ts:261-288` (switchBotSession 增加绑定广播)

**Step 1: 扩展 agent.ts 的广播层 — 运行状态**

在 `agent.ts` 文件顶部（`const t = tipc.create()` 之前），添加辅助函数：

```typescript
/** 广播对话运行状态变化给所有渲染层窗口 */
function broadcastConversationRunning(conversationId: string, isRunning: boolean): void {
  for (const win of electron.BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      const h = getRendererHandlers<RendererHandlers>(win.webContents);
      h.conversationRunningStateChanged.send({ conversationId, isRunning });
    } catch { /* 窗口已销毁 */ }
  }
}
```

然后修改 `setBroadcaster` 回调，在 `complete` 事件处理中加入运行状态广播：

在原有的 `setBroadcaster` 回调内，`event === 'complete'` 分支中追加：

```typescript
} else if (event === 'complete') {
  h.queryBasedSessionComplete.send({ sessionId, result: payload });
}
```

改为：

```typescript
} else if (event === 'complete') {
  h.queryBasedSessionComplete.send({ sessionId, result: payload });
}
```

注意：`complete` 事件是在所有窗口循环中，但运行状态广播只需要一次（不在循环内）。所以实际实现是在 `setBroadcaster` 回调中，循环之外处理：

将整个 setBroadcaster 回调改为：

```typescript
getQueryBasedSessionManager().setBroadcaster((sessionId, event, payload) => {
  // 会话完成时，广播对话运行状态 → not running
  if (event === 'complete') {
    const convId = getQueryBasedSessionManager().getConversationIdBySession(sessionId);
    if (convId) broadcastConversationRunning(convId, false);
  }

  for (const win of electron.BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      const h = getRendererHandlers<RendererHandlers>(win.webContents);
      if (event === 'message') {
        h.queryBasedSessionMessage.send({ sessionId, message: payload as ExtendedSessionMessage });
      } else if (event === 'complete') {
        h.queryBasedSessionComplete.send({ sessionId, result: payload });
      } else if (event === 'error') {
        h.queryBasedSessionMessage.send({ sessionId, message: payload as ExtendedSessionMessage });
      }
    } catch { /* 窗口已销毁，忽略 */ }
  }
});
```

然后修改 `sendQueryBasedSessionMessage` 路由（约第 433 行），在调用 `session.sendMessage()` 之前广播 running=true：

在 `await session.sendMessage(...)` 之前（有两个分支：hasMultiBlocks 和 else），各自之前加：

```typescript
// 广播运行状态 → running
const convId = sessionManager.getConversationIdBySession(input.sessionId);
if (convId) broadcastConversationRunning(convId, true);
```

这行放在 `if (hasMultiBlocks)` 判断之前即可（只需一处，两个分支共享）。

**Step 2: wechat-bot-controller — handleAgentMessage 增加广播**

修改 `wechat-bot-controller.ts` 的 `handleAgentMessage` 方法（行 99-121）。

在 `session.sendMessage(text)` 调用之前，增加两个广播：
1. 广播运行状态 → running
2. 广播 user 消息给前端（需求 4）

需要先导入 `electron` 和 `getRendererHandlers`：

在文件顶部 imports 中添加：

```typescript
import electron from 'electron';
import { getRendererHandlers } from '@egoist/tipc/main';
import type { RendererHandlers } from '../../tipc/renderer-handlers.js';
```

修改 `handleAgentMessage` 方法：

```typescript
private handleAgentMessage(text: string, ctx: ReplyCtx): void {
  if (!this.state.activeSessionId) {
    this.reply('当前没有激活的对话。\n用 /ls 查看对话列表，/use <编号> 选择对话，或 /new 新建对话。', ctx).catch(
      (err: unknown) => log.error('[bot] 回复失败:', err),
    );
    return;
  }

  const sessionManager = getQueryBasedSessionManager();
  const session = sessionManager.getSession(this.state.activeSessionId);
  if (!session) {
    this.reply('Agent 会话已断开，请重新选择对话: /use <编号>', ctx).catch(
      (err: unknown) => log.error('[bot] 回复失败:', err),
    );
    return;
  }

  // 广播运行状态 → running
  if (this.state.activeConversationId) {
    this.broadcastConversationRunning(this.state.activeConversationId, true);
  }

  // 广播 user 消息给前端（实时显示 bot 输入）
  this.broadcastBotUserMessage(this.state.activeSessionId, text);

  this.waitingForAgent = true;
  session.sendMessage(text).catch((err: unknown) => {
    log.error('[bot] 发送消息给 Agent 失败:', err);
    this.waitingForAgent = false;
  });
}
```

在类中新增两个私有广播方法：

```typescript
/** 广播对话运行状态 */
private broadcastConversationRunning(conversationId: string, isRunning: boolean): void {
  for (const win of electron.BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      const h = getRendererHandlers<RendererHandlers>(win.webContents);
      h.conversationRunningStateChanged.send({ conversationId, isRunning });
    } catch { /* ignore */ }
  }
}

/** 广播 bot 发送的 user 消息给前端 */
private broadcastBotUserMessage(sessionId: string, text: string): void {
  for (const win of electron.BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      const h = getRendererHandlers<RendererHandlers>(win.webContents);
      h.queryBasedSessionMessage.send({
        sessionId,
        message: {
          type: 'human',
          message: { role: 'user', content: text },
          source: 'wechat-bot',
        } as any,
      });
    } catch { /* ignore */ }
  }
}
```

**Step 3: wechat-bot-controller — switchBotSession 增加绑定广播**

修改 `switchBotSession` 方法（行 261-288），在成功切换后广播绑定变更：

在方法末尾（`log.info(...)` 之后）添加：

```typescript
// 广播 bot 绑定变更
this.broadcastBotBinding(conversationId);
```

在 detach 旧 attachment 的代码块中（约行 263-268），detach 后广播 null：

不需要额外广播 null，因为紧接着就会广播新的 conversationId。但如果只是 detach 而不 attach（不会发生在当前逻辑），可以不处理。

新增广播方法：

```typescript
/** 广播 bot 绑定的对话变更 */
private broadcastBotBinding(conversationId: string | null): void {
  for (const win of electron.BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      const h = getRendererHandlers<RendererHandlers>(win.webContents);
      h.wechatBotBindingChanged.send({ conversationId });
    } catch { /* ignore */ }
  }
}
```

**Step 4: 编译验证**

Run: `bun run build:electron`
Expected: 编译通过

**Step 5: Commit**

```bash
git add electron/main/tipc/agent.ts electron/main/services/wechat/wechat-bot-controller.ts
git commit -m "feat: 主进程广播运行状态、bot绑定、bot用户消息"
```

---

### Task 4: wechat-bot-controller — 自动初始化数据 + botUseConversation IPC

**Files:**
- Modify: `electron/main/services/wechat/wechat-bot-controller.ts` (新增 getAutoInitData 方法)
- Modify: `electron/main/tipc/wechat.ts:88-178` (startPolling 成功后推送 + 新增 botUseConversation)

**Step 1: wechat-bot-controller 新增 getAutoInitData()**

在 `init()` 方法之后（约行 338），添加：

```typescript
/** 获取自动初始化数据（startPolling 后推送给前端） */
async getAutoInitData(): Promise<{
  status: {
    workspaceId: string | null;
    workspaceName: string | null;
    conversationId: string | null;
    conversationTitle: string | null;
    debugMode: boolean;
  };
  conversations: Array<{
    index: number;
    id: string;
    title: string;
    updatedAt: string;
  }>;
}> {
  // 状态信息
  const ws = this.state.activeWorkspaceId
    ? await workspaceJsonService.getById(this.state.activeWorkspaceId)
    : null;

  let convTitle: string | null = null;
  if (this.state.activeConversationId && this.state.activeWorkspaceId) {
    const conv = await conversationService.getById(
      this.state.activeWorkspaceId,
      this.state.activeConversationId,
    );
    convTitle = conv?.title || '未命名对话';
  }

  const status = {
    workspaceId: this.state.activeWorkspaceId,
    workspaceName: ws?.name || null,
    conversationId: this.state.activeConversationId,
    conversationTitle: convTitle,
    debugMode: this.state.debugMode,
  };

  // 对话列表
  let conversations: Array<{ index: number; id: string; title: string; updatedAt: string }> = [];
  if (this.state.activeWorkspaceId) {
    const convList = await conversationService.getByWorkspaceId(this.state.activeWorkspaceId);
    conversations = convList.map((conv, i) => ({
      index: i + 1,
      id: conv.id,
      title: conv.title || '未命名对话',
      updatedAt: conv.updatedAt,
    }));
  }

  return { status, conversations };
}
```

同时新增 `useConversationByIndex` 供前端点击"使用"时调用：

```typescript
/** 通过序号切换 bot 对话（前端 Dialog 中的"使用"按钮） */
async useConversationByIndex(index: number): Promise<{ success: boolean; error?: string }> {
  if (!this.state.activeWorkspaceId) {
    return { success: false, error: '请先选择工作区' };
  }
  const conversations = await conversationService.getByWorkspaceId(this.state.activeWorkspaceId);
  const idx = index - 1;
  if (idx < 0 || idx >= conversations.length) {
    return { success: false, error: `无效编号。可选: 1-${conversations.length}` };
  }
  const target = conversations[idx];
  await this.switchBotSession(target.id, target.sdkSessionId || undefined);
  return { success: true };
}
```

**Step 2: tipc/wechat.ts — startPolling 成功后自动推送**

在 `wechat.ts` 的 `startPolling` 路由中，`await wechatBotController.init()` 之后（约行 98），添加：

```typescript
// 自动获取 bot 状态和对话列表，推送给前端
try {
  const autoInitData = await wechatBotController.getAutoInitData();
  safeSend(() => handlers.wechatBotAutoInit.send(autoInitData));
} catch (err) {
  console.warn('[wechat] 自动初始化数据获取失败:', err);
}
```

注意：`safeSend` 在 `wechatPoller.start()` 调用之前定义（行 144-146），但 `handlers` 在行 95 已定义。需要把 `safeSend` 的定义提前到 `wechatBotController.init()` 之前。

实际上看代码，`safeSend` 定义在行 144（`wechatPoller.start` 之前），而 `init()` 在行 98。需要把 `safeSend` 定义移到 `init()` 之前。

**Step 3: tipc/wechat.ts — 新增 botUseConversation IPC**

在 `wechat.ts` 的路由对象中（在最后一个路由之后，`};` 之前），添加：

```typescript
/** 前端 Dialog 中点击"使用"按钮，执行 bot 的 /use 命令 */
'wechat:botUseConversation': t.procedure
  .input<{ index: number }>()
  .action(async ({ input }) => {
    return await wechatBotController.useConversationByIndex(input.index);
  }),
```

同时新增获取 bot 状态的 IPC（前端 Dialog 打开时需要查询当前状态）：

```typescript
/** 获取 bot 当前状态和对话列表 */
'wechat:getBotStatus': t.procedure
  .action(async () => {
    return await wechatBotController.getAutoInitData();
  }),
```

**Step 4: 编译验证**

Run: `bun run build:electron`
Expected: 编译通过

**Step 5: Commit**

```bash
git add electron/main/services/wechat/wechat-bot-controller.ts electron/main/tipc/wechat.ts
git commit -m "feat: bot 自动初始化数据 + botUseConversation IPC"
```

---

### Task 5: 前端 conversation-store — 新增运行状态和 bot 绑定状态

**Files:**
- Modify: `stores/conversation-store.ts` (新增状态 + 事件监听)

**Step 1: 新增状态字段和事件监听**

在 `conversation-store.ts` 的 interface 中（状态类型定义区域），添加：

```typescript
// Bot 相关状态
runningConversationIds: Set<string>;
botBoundConversationId: string | null;
```

在 store 初始状态中添加：

```typescript
runningConversationIds: new Set<string>(),
botBoundConversationId: null,
```

在 store 中添加初始化函数（在文件底部，store 创建之后）。由于需要监听 rendererEvents，而 conversation-store 可能在 SSR 环境加载，需要判断 `window` 是否存在：

```typescript
// 在 store 定义外部，初始化事件监听
if (typeof window !== 'undefined') {
  import('@/lib/events').then(({ rendererEvents }) => {
    // 对话运行状态
    rendererEvents.conversationRunningStateChanged.listen((data) => {
      useConversationStore.setState((state) => {
        const newSet = new Set(state.runningConversationIds);
        if (data.isRunning) newSet.add(data.conversationId);
        else newSet.delete(data.conversationId);
        return { runningConversationIds: newSet };
      });
    });

    // Bot 绑定变更
    rendererEvents.wechatBotBindingChanged.listen((data) => {
      useConversationStore.setState({ botBoundConversationId: data.conversationId });
    });
  });
}
```

**Step 2: 编译验证**

Run: `bun run dev:renderer`（确保前端编译通过）
Expected: 编译通过，无类型错误

**Step 3: Commit**

```bash
git add stores/conversation-store.ts
git commit -m "feat: conversation-store 新增运行状态和 bot 绑定状态"
```

---

### Task 6: BookConversationList — 使用 conversation 级别运行状态 + bot 图标

**Files:**
- Modify: `components/BookConversationList.tsx:227-289`

**Step 1: 修改运行状态读取 + 添加 bot 图标**

在 `BookConversationList.tsx` 的对话项组件中：

1. 导入 `Bot` 图标（文件顶部 lucide-react imports）：

```typescript
import { ..., Bot } from 'lucide-react';
```

2. 修改运行状态判断（约行 227-230）：

原代码：
```typescript
const tabs = useSessionStore((s) => s.tabs);
const tab = tabs.find((t) => t.conversationId === conv.id);
const isRunning = tab?.isStreaming ?? false;
```

改为：
```typescript
const runningIds = useConversationStore((s) => s.runningConversationIds);
const isRunning = runningIds.has(conv.id);
const botBoundId = useConversationStore((s) => s.botBoundConversationId);
const isBotBound = conv.id === botBoundId;
```

3. 修改图标显示区域（约行 279-289）：

原代码：
```tsx
{isRunning ? (
  <Loader2 className="w-4 h-4 flex-shrink-0 animate-spin text-blue-500" />
) : isFork ? (
  <GitBranch className={cn('w-4 h-4 flex-shrink-0', ...)} />
) : (
  <MessageSquare className={cn('w-4 h-4 flex-shrink-0', ...)} />
)}
```

改为（增加 bot 绑定图标，放在标题右侧而非替换原图标）：
```tsx
{isRunning ? (
  <Loader2 className="w-4 h-4 flex-shrink-0 animate-spin text-blue-500" />
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

然后在标题文字后面（`<div className="flex-1 min-w-0">` 内，标题 span 之后）加 bot 图标：

在对话标题旁边添加：
```tsx
{isBotBound && (
  <Bot className="w-3 h-3 flex-shrink-0 text-green-500" title="Bot 已绑定" />
)}
```

**Step 2: 移除 AgentChat 中旧的 isStreaming 同步**

在 `components/agent-chat/AgentChat.tsx` 中，可以保留原来的 `useEffect` 同步逻辑（作为 tab 级别的备用），也可以移除。为了渐进迁移，**保留现有逻辑不动**，让两套状态并存，对话列表优先用 conversation-store 的新状态。

**Step 3: Commit**

```bash
git add components/BookConversationList.tsx
git commit -m "feat: 对话列表使用 conversation 级运行状态 + bot 绑定图标"
```

---

### Task 7: 前端处理 bot user 消息渲染

**Files:**
- Modify: `components/agent-chat/hooks/useSessionMessages.ts` (处理 human 类型消息)
- Modify: `components/agent-chat/AgentChat.tsx` (streamReducer 增加 human 消息处理)

**Step 1: 分析当前 streamReducer**

先确认 `streamReducer` 如何处理消息。它在 `AgentChat.tsx` 的 `setMessages(prev => ...)` 回调中调用。需要确保 `type: 'human'` 的消息能被正确添加到消息列表。

查看 streamReducer 的实现（可能在 `AgentChat.tsx` 或 `utils.ts` 中），确认它是否已经处理了 user 类型消息。

如果 streamReducer 不处理 `type: 'human'` 消息，需要在 `useSessionMessages.ts` 中对这种类型做特殊处理：在 streamReducer 之前拦截，直接构造一条 user Message 添加到列表。

在 `useSessionMessages.ts` 的 listen 回调中，streamReducer 调用之前，添加对 `human` 类型的特殊处理：

```typescript
const extendedMsg = data.message;

// Bot 发送的 user 消息，直接添加到消息列表
if ((extendedMsg as any).type === 'human' && (extendedMsg as any).message?.role === 'user') {
  setMessages((prev) => [
    ...prev,
    {
      role: 'user' as const,
      content: (extendedMsg as any).message.content,
      timestamp: new Date().toISOString(),
      contentBlocks: [],
      source: (extendedMsg as any).source,
    },
  ]);
  return;
}
```

**Step 2: MessageItem 中显示 bot 来源标记**

在 `components/agent-chat/MessageItem.tsx` 中，对 user 消息渲染时，检查 `message.source === 'wechat-bot'` 并显示小 Bot 图标。

在 user 消息的头部区域（通常显示 "You" 或用户标识的地方）添加：

```tsx
{message.source === 'wechat-bot' && (
  <Bot className="w-3 h-3 text-green-500 ml-1" />
)}
```

**Step 3: types.ts 扩展 Message 类型**

在 `components/agent-chat/types.ts` 的 Message interface 中添加可选字段：

```typescript
source?: string; // 消息来源（'wechat-bot' 表示微信 bot 发送）
```

**Step 4: 编译验证**

Run: `bun run dev:renderer`
Expected: 编译通过

**Step 5: Commit**

```bash
git add components/agent-chat/hooks/useSessionMessages.ts components/agent-chat/types.ts components/agent-chat/MessageItem.tsx
git commit -m "feat: 前端渲染 bot 用户消息 + 来源标记"
```

---

### Task 8: 微信 Dialog 化 — WechatDialog + BotControlPanel

**Files:**
- Create: `components/wechat/WechatDialog.tsx`
- Create: `components/wechat/BotControlPanel.tsx`
- Modify: `stores/wechat-store.ts` (新增 autoInitData + 事件监听)
- Modify: `app/page.tsx:166-169` (按钮改为打开 Dialog)

**Step 1: wechat-store 扩展**

在 `stores/wechat-store.ts` 中：

1. 新增状态字段（interface 中）：

```typescript
// Bot 自动初始化数据
autoInitData: {
  status: {
    workspaceId: string | null;
    workspaceName: string | null;
    conversationId: string | null;
    conversationTitle: string | null;
    debugMode: boolean;
  };
  conversations: Array<{
    index: number;
    id: string;
    title: string;
    updatedAt: string;
  }>;
} | null;
```

2. 初始状态中添加：`autoInitData: null`

3. 新增 actions：

```typescript
/** 获取 bot 状态（Dialog 打开时调用） */
loadBotStatus: async () => {
  try {
    const data = await client['wechat:getBotStatus'](undefined);
    set({ autoInitData: data });
  } catch { /* ignore */ }
},

/** 前端点击"使用"按钮 */
botUseConversation: async (index: number) => {
  try {
    const result = await client['wechat:botUseConversation']({ index });
    if (result.success) {
      // 刷新 bot 状态
      get().loadBotStatus();
    }
    return result;
  } catch (error) {
    return { success: false, error: String(error) };
  }
},
```

4. 在 store 外部添加事件监听（与 conversation-store 类似模式）：

```typescript
if (typeof window !== 'undefined') {
  import('@/lib/events').then(({ rendererEvents }) => {
    rendererEvents.wechatBotAutoInit.listen((data) => {
      useWechatStore.setState({ autoInitData: data });
    });
  });
}
```

**Step 2: 创建 BotControlPanel 组件**

创建 `components/wechat/BotControlPanel.tsx`：

```tsx
import { Bot, Terminal, Wifi, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useWechatStore } from '@/stores/wechat-store';

const BOT_COMMANDS = [
  { command: '/help', description: '显示帮助信息' },
  { command: '/status', description: '查看当前状态（工作区、对话、Agent）' },
  { command: '/ws', description: '列出所有工作区' },
  { command: '/ws <n>', description: '切换到第 n 个工作区' },
  { command: '/ls', description: '列出当前工作区的对话' },
  { command: '/use <n>', description: '切换到第 n 个对话' },
  { command: '/new', description: '新建对话' },
  { command: '/stop', description: '中断当前 Agent 执行' },
  { command: '/debug', description: '开关调试模式（显示权限请求）' },
];

interface BotControlPanelProps {
  botName: string | null;
  polling: boolean;
  connectionError: string | null;
  onDisconnect: () => void;
}

export function BotControlPanel({ botName, polling, connectionError, onDisconnect }: BotControlPanelProps) {
  const autoInitData = useWechatStore((s) => s.autoInitData);
  const botUseConversation = useWechatStore((s) => s.botUseConversation);

  return (
    <div className="flex flex-col gap-4">
      {/* 连接状态 */}
      <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
        <Bot className="w-8 h-8 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm">{botName || '微信 Bot'}</div>
          {connectionError ? (
            <div className="flex items-center gap-1 text-xs text-destructive">
              <WifiOff className="w-3 h-3" />
              <span>连接断开: {connectionError}</span>
            </div>
          ) : polling ? (
            <div className="flex items-center gap-1 text-xs text-green-600">
              <Wifi className="w-3 h-3" />
              <span>已连接，正在监听消息</span>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">连接中...</div>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onDisconnect} className="text-xs">
          断开
        </Button>
      </div>

      {/* 当前状态 */}
      {autoInitData?.status && (
        <div className="text-xs text-muted-foreground px-1">
          <span>工作区: {autoInitData.status.workspaceName || '未选择'}</span>
          {autoInitData.status.conversationTitle && (
            <span className="ml-3">对话: {autoInitData.status.conversationTitle}</span>
          )}
        </div>
      )}

      {/* 对话列表 */}
      {autoInitData?.conversations && autoInitData.conversations.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground px-1">对话列表</div>
          <div className="max-h-40 overflow-y-auto space-y-0.5">
            {autoInitData.conversations.map((conv) => (
              <div
                key={conv.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted/50 text-sm"
              >
                <span className="text-muted-foreground w-5 text-right text-xs">{conv.index}.</span>
                <span className="flex-1 truncate">{conv.title}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={async () => {
                    await botUseConversation(conv.index);
                  }}
                >
                  使用
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bot 命令参考 */}
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground px-1">
          <Terminal className="w-3 h-3" />
          Bot 命令参考
        </div>
        <div className="space-y-0 text-xs">
          {BOT_COMMANDS.map((cmd) => (
            <div key={cmd.command} className="flex gap-2 px-2 py-1 rounded hover:bg-muted/30">
              <code className="text-primary font-mono w-20 flex-shrink-0">{cmd.command}</code>
              <span className="text-muted-foreground">{cmd.description}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground px-2 pt-1">
          直接发送文本消息将转发给当前对话的 Agent。
        </p>
      </div>
    </div>
  );
}
```

**Step 3: 创建 WechatDialog 组件**

创建 `components/wechat/WechatDialog.tsx`：

```tsx
import { useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useWechatStore } from '@/stores/wechat-store';
import { rendererEvents } from '@/lib/events';
import { QRCodeAuth } from './QRCodeAuth';
import { BotControlPanel } from './BotControlPanel';

interface WechatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WechatDialog({ open, onOpenChange }: WechatDialogProps) {
  const {
    authState,
    qrCode,
    botName,
    polling,
    connectionError,
    loadAuthStatus,
    startAuth,
    disconnect,
    startPolling,
    loadBotStatus,
    handleAuthStatusChange,
    handleConnectionStatusChange,
  } = useWechatStore();

  // Dialog 打开时加载状态
  useEffect(() => {
    if (open) {
      loadAuthStatus();
      if (authState === 'connected') {
        loadBotStatus();
      }
    }
  }, [open, loadAuthStatus, loadBotStatus, authState]);

  // 认证成功后启动轮询
  useEffect(() => {
    if (authState === 'connected') {
      startPolling();
    }
  }, [authState, startPolling]);

  // 监听 renderer events
  useEffect(() => {
    const unsubs = [
      rendererEvents.wechatAuthStatus.listen((data) => {
        handleAuthStatusChange(data.state, data.botName, data.errorMessage);
      }),
      rendererEvents.wechatConnectionStatus.listen((data) => {
        handleConnectionStatusChange(data.polling, data.lastPollAt, data.errorMessage);
      }),
    ];
    return () => unsubs.forEach(fn => fn());
  }, [handleAuthStatusChange, handleConnectionStatusChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>微信 Bot 控制</DialogTitle>
        </DialogHeader>
        {authState !== 'connected' ? (
          <QRCodeAuth authState={authState} qrCode={qrCode} onStartAuth={startAuth} />
        ) : (
          <BotControlPanel
            botName={botName}
            polling={polling}
            connectionError={connectionError}
            onDisconnect={disconnect}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
```

**Step 4: 修改 app/page.tsx — 按钮改为打开 Dialog**

在 `app/page.tsx` 中：

1. 添加 imports：

```typescript
import { useState } from 'react';
import { WechatDialog } from '@/components/wechat/WechatDialog';
```

2. 在组件内添加 Dialog 状态（注意如果 useState 已经导入，不重复导入）：

```typescript
const [wechatDialogOpen, setWechatDialogOpen] = useState(false);
```

3. 替换微信按钮（约行 166-169）：

原代码：
```tsx
<Button variant="outline" size="sm" onClick={openWechatWindow}>
  <MessageCircle className="w-4 h-4 mr-2" />
  微信
</Button>
```

改为：
```tsx
<Button variant="outline" size="sm" onClick={() => setWechatDialogOpen(true)}>
  <MessageCircle className="w-4 h-4 mr-2" />
  微信
</Button>
```

4. 在组件 return 的最后（`</div>` 闭合之前），添加 Dialog：

```tsx
<WechatDialog open={wechatDialogOpen} onOpenChange={setWechatDialogOpen} />
```

5. 移除 `openWechatWindow` 的导入和使用（从 workspace-store 的解构中移除）。

**Step 5: Commit**

```bash
git add components/wechat/WechatDialog.tsx components/wechat/BotControlPanel.tsx stores/wechat-store.ts app/page.tsx
git commit -m "feat: 微信 Dialog 化 — WechatDialog + BotControlPanel + 命令参考"
```

---

### Task 9: 清理独立窗口相关代码

**Files:**
- Modify: `electron/main/index.ts:46,225-250,259-261` (移除 createWechatWindow + 变量 + closeAll 中的微信部分)
- Modify: `electron/main/tipc/agent.ts:162-167` (移除 openWechatWindow 路由)
- Modify: `stores/workspace-store.ts:233-238` (移除 openWechatWindow action)
- Optionally modify: `src/App.tsx:26` (可以保留 /wechat 路由作为历史兼容或删除)

**Step 1: 移除 createWechatWindow**

在 `electron/main/index.ts` 中：
- 删除行 46 的 `let wechatWindow: BrowserWindowType | null = null;`
- 删除行 225-250 的 `createWechatWindow()` 函数
- 修改行 259-261 的 `closeAllChildWindows()`，移除微信窗口关闭逻辑

**Step 2: 移除 openWechatWindow IPC 路由**

在 `electron/main/tipc/agent.ts` 中，删除行 162-167 的 `openWechatWindow` 路由。

**Step 3: 移除 workspace-store 中的 action**

在 `stores/workspace-store.ts` 中，删除行 233-238 的 `openWechatWindow` action。

**Step 4: 编译验证**

Run: `bun run build:electron && bun run dev:renderer`
Expected: 编译通过（如果有其他地方引用了 openWechatWindow，需要同步移除）

**Step 5: Commit**

```bash
git add electron/main/index.ts electron/main/tipc/agent.ts stores/workspace-store.ts
git commit -m "refactor: 移除微信独立窗口相关代码（Dialog 替代）"
```

---

### Task 10: 集成测试和最终验证

**Step 1: 编译主进程**

Run: `bun run build:electron`
Expected: 编译通过，无错误

**Step 2: 编译前端**

Run: `bun run build`
Expected: 完整构建通过

**Step 3: 运行 lint**

Run: `bun run lint`
Expected: 无新增 lint 错误

**Step 4: 功能验证清单**

手动测试：
1. [ ] 主窗口点击"微信"按钮 → Dialog 弹出（非独立窗口）
2. [ ] Dialog 中显示 QR 码扫描界面
3. [ ] 扫码连接后 → Dialog 自动切换到控制面板
4. [ ] 控制面板显示：连接状态 + 对话列表 + 命令参考
5. [ ] 点击对话列表的"使用"按钮 → bot 切换对话
6. [ ] 对话列表中被 bot 绑定的对话 → 显示绿色 Bot 图标
7. [ ] bot 在微信中发消息 → 对话列表显示转圈
8. [ ] desktop 端打开对应 tab → 能看到 bot 的输入消息（带 Bot 图标标记）
9. [ ] agent 完成后 → 对话列表转圈消失

**Step 5: 最终 Commit**

如果有修复，提交修复 commit。
