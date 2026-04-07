# UX 改进 V2 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 8 项 UX 改进：删除编辑重发、修复分叉 UUID、优化滚动行为、系统托盘最小化、工作区切换重置、子代理实时展示

**Architecture:** 按复杂度从低到高实施，先清理代码（删除重发），再修复 bug（分叉 UUID），然后增加新功能（滚动/托盘/重置/子代理）。子代理实时展示需要后端消息转发 + 前端右侧面板新 tab + 复用主会话渲染组件。

**Tech Stack:** Electron (Tray API), React 19, Zustand 5, tipc IPC, Claude Agent SDK

---

## Task 1: 删除编辑重发功能

从 6 个文件中移除 editResend/resendDraft 相关代码，保留 fork 功能完整。

**Files:**
- Modify: `stores/conversation-store.ts`
- Modify: `components/agent-chat/hooks/useSendMessage.ts`
- Modify: `components/agent-chat/hooks/useAgentSession.ts`
- Modify: `components/agent-chat/MessageItem.tsx`
- Modify: `components/agent-chat/ChatInputArea.tsx`
- Modify: `components/agent-chat/AgentChat.tsx`

**Step 1: 清理 conversation-store.ts**

删除 `ResendDraft` 类型定义（第 21-26 行）：
```typescript
// 删除这段
export interface ResendDraft {
  messageIndex: number;
  forkPointSdkUuid: string;
  originalContent: string;
}
```

从 `ForkParams` 中删除仅服务 editResend 的字段（第 9-19 行），修改为：
```typescript
export interface ForkParams {
  sdkSessionIdToResume: string;
  forkSession: boolean;
  resumeSessionAt: string;
  editedMessage?: string;       // fork_pending 首次发送时仍需要
  /** 目标对话 ID，useAgentSession 仅处理与自身 conversationId 匹配的 forkParams */
  targetConversationId?: string;
}
```
删除 `branchCount` 和 `isForkNewConversation` 字段。

从 `ConversationState` 接口（第 41-84 行）中删除：
- 第 52 行：`resendDraftMap: Record<string, ResendDraft>;`
- 第 53 行：`setResendDraft: (conversationId: string, draft: ResendDraft | null) => void;`
- 第 68-69 行：`editResend` action 声明

从 store 实现中删除：
- 初始状态中的 `resendDraftMap: {},`
- `setResendDraft` action 实现（第 200-206 行）
- `editResend` action 完整实现（第 369-399 行）

**Step 2: 清理 useSendMessage.ts**

删除 resend 相关的 store 订阅（第 46-53 行），保留 fork 相关：
```typescript
// 删除这些行
const editResendAction = useConversationStore((s) => s.editResend);
const setResendDraftAction = useConversationStore((s) => s.setResendDraft);
const resendDraftMap = useConversationStore((s) => s.resendDraftMap);
const resendDraft = conversationId ? resendDraftMap[conversationId] || null : null;
const setResendDraft = (draft: import('@/stores/conversation-store').ResendDraft | null) => {
  if (conversationId) setResendDraftAction(conversationId, draft);
};

// 保留这一行
const forkConversation = useConversationStore((s) => s.forkConversation);
```

删除 `handleEditResend` 函数（第 158-183 行）整段。

删除 `handleSend` 中的重发草稿分支（第 318-345 行）：
```typescript
// 删除从 "// 重发模式：截断历史" 到 "return;" 的整段代码
```

从返回对象中删除 `handleEditResend`（第 538 行）。

**Step 3: 清理 useAgentSession.ts**

修改第 56-66 行的日志，移除 "编辑重发" 引用：
```typescript
if (forkParams) {
  sdkSessionId = forkParams.sdkSessionIdToResume;
  forkSessionFlag = forkParams.forkSession;
  resumeSessionAtFlag = forkParams.resumeSessionAt;
  console.log('🔀 Fork 模式启动:', { sdkSessionId, forkSession: forkSessionFlag, resumeSessionAt: resumeSessionAtFlag });
}
```

修改第 170-208 行。删除 `isForkNewConversation` 分支判断，简化为 fork 统一处理：
```typescript
// 原来是：if (forkParams?.editedMessage && !forkParams?.isForkNewConversation && newSessionId)
// 改为：fork 时自动发送 editedMessage（fork_pending 首次发送场景）
if (forkParams?.editedMessage && newSessionId) {
  console.log('🔀 Fork 模式: 自动发送消息:', forkParams.editedMessage);
  setTimeout(async () => {
    if (cancelled) return;
    try {
      setMessages(prev => [
        ...prev,
        {
          role: 'user',
          content: forkParams.editedMessage!,
          timestamp: Date.now(),
        },
        {
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          isStreaming: true,
          contentBlocks: [],
        }
      ]);
      setIsLoading(true);
      await client.sendQueryBasedSessionMessage({
        sessionId: newSessionId,
        content: forkParams.editedMessage!
      });
    } catch (error) {
      console.error('Fork 模式自动发送失败:', error);
    }
  }, 500);
}
```

删除 `isForkNewConversation` 的 else if 分支。

从 SDK 调用参数（第 116-129 行）中移除 `isForkNewConversation`：
```typescript
const response = await client.createQueryBasedSession({
  // ... 其他配置
  resume: sdkSessionId,
  forkSession: forkSessionFlag,
  resumeSessionAt: resumeSessionAtFlag,
  // 删除: isForkNewConversation
  personaId,
  tempPrompt,
});
```

**Step 4: 清理 MessageItem.tsx**

从 props 中删除 `onEditResend`（第 13-29 行）：
```typescript
export function MessageItem({
  message,
  messageIndex,
  onFork,           // 保留
  // 删除: onEditResend,
  sessionId,
  onPermissionResolved,
  onAskUserResolved,
}: {
  message: Message;
  messageIndex: number;
  onFork?: (assistantSdkUuid: string) => void;
  // 删除: onEditResend?: (index: number, newContent: string) => void;
  sessionId?: string | null;
  onPermissionResolved?: (requestId: string, behavior: 'allow' | 'deny' | 'always_allow', denyMessage?: string) => void;
  onAskUserResolved?: (requestId: string, answers: Record<string, string>) => void;
})
```

删除重发按钮 UI（第 163-173 行）整段。

删除 `Pencil` 图标的 import（如果不再被其他地方使用）。

**Step 5: 清理 ChatInputArea.tsx**

删除 `ResendDraft` 类型 import：
```typescript
// 删除: import type { ResendDraft } from '@/stores/conversation-store';
```

从 `ChatInputAreaProps` 中删除：
```typescript
// 删除:
resendDraft: ResendDraft | null;
onCancelResend: () => void;
```

删除重发指示芯片 UI（第 224-240 行）整段。

删除 `CornerDownLeft` 图标的 import（如果不再被其他地方使用）。

**Step 6: 清理 AgentChat.tsx**

删除 resendDraft 相关状态（第 53-55 行）：
```typescript
// 删除:
const resendDraftMap = useConversationStore((s) => s.resendDraftMap);
const setResendDraftAction = useConversationStore((s) => s.setResendDraft);
const resendDraft = conversationId ? resendDraftMap[conversationId] || null : null;
```

修改 `renderMessage`（第 204-214 行），移除 `onEditResend` 传递：
```typescript
const renderMessage = (message: typeof messages[0], index: number) => (
  <MessageItem
    key={index}
    message={message}
    messageIndex={index}
    onFork={sendMessage.handleFork}
    sessionId={sessionId}
    onPermissionResolved={sendMessage.handlePermissionResolved}
    onAskUserResolved={sendMessage.handleAskUserResolved}
  />
);
```

从 ChatInputArea props 中移除 resendDraft 和 onCancelResend（第 340-347 行区域）。

**Step 7: 编译验证**

Run: `bun run build:electron && bun run lint`
Expected: 编译成功，无类型错误

**Step 8: 提交**

```bash
git add stores/conversation-store.ts components/agent-chat/hooks/useSendMessage.ts components/agent-chat/hooks/useAgentSession.ts components/agent-chat/MessageItem.tsx components/agent-chat/ChatInputArea.tsx components/agent-chat/AgentChat.tsx
git commit -m "refactor: 删除编辑重发功能，仅保留 fork 分叉"
```

---

## Task 2: 修复分叉 UUID

分叉时需要把点击位置及之前的完整会话都带走，包括该轮 assistant 回答。

**Files:**
- Modify: `components/agent-chat/MessageItem.tsx`
- Modify: `components/agent-chat/hooks/useSendMessage.ts`

**Step 1: 检查当前分叉按钮的 UUID 传递**

当前 `MessageItem.tsx` 第 234-245 行，分叉按钮在 assistant 消息上，点击时传 `message.sdkUuid`。这是 assistant 消息自己的 UUID。

`handleFork`（useSendMessage.ts 第 188-194 行）将其作为 `forkMessageSdkUuid` 传给 `forkConversation`。

`forkConversation`（conversation-store.ts 第 320-367 行）将其传给后端 `createFork`，存为 `fork_message_sdk_uuid`。

首次发送时（useSendMessage.ts 第 347-388 行），`selectedConv.fork_message_sdk_uuid` 作为 `resumeSessionAt` 传给 SDK。

**SDK 的 `resumeSessionAt` 语义**：截断到该 UUID 的消息（含）。如果传的是 assistant 的 UUID，应该包含该 assistant 回答。

**需要验证**：在 `useSendMessage.ts` 第 371 行，`resumeSessionAt` 使用的是 `selectedConv.fork_message_sdk_uuid`，这个值来自分叉按钮传的 assistant `sdkUuid`。理论上这应该是正确的。

问题可能出在 `query-based-session.ts` 或 SDK 调用处。需要加日志排查，确认传给 SDK 的实际 UUID 值以及 SDK 返回的历史是否完整。

**Step 2: 在 query-based-session.ts 中加强日志**

在 SDK 会话创建处（`query-based-session.ts` 中调用 `query()` 或 `createSession()` 时），添加日志打印 `resumeSessionAt` 的值，以及 fork 返回的会话消息数量。

**Step 3: 实际测试验证**

手动测试：
1. 创建一个对话，发送 2-3 轮对话
2. 在某个 assistant 回复上点击分叉
3. 检查新对话是否包含该 assistant 回复
4. 如果缺少，对比日志中的 UUID 确认问题所在

**Step 4: 修复（根据排查结果）**

如果 UUID 传递正确但 SDK 行为不符预期，可能需要调整传递的 UUID（例如传该 assistant 之后的下一条 user 消息的 UUID，或该 assistant 消息本身）。

**Step 5: 提交**

```bash
git add -A
git commit -m "fix: 修复分叉时遗漏最后一轮 assistant 回答的问题"
```

---

## Task 3: 滚动行为优化

实现：消息生成时在底部则自动跟随，用户上滑则停止，回到底部恢复跟随。

**Files:**
- Modify: `components/agent-chat/AgentChat.tsx`

**Step 1: 修改滚动逻辑**

当前代码（第 145-149 行）只在 `messages.length` 变化时增加 newMsgCount，不做自动滚动。

替换为：
```typescript
// 消息变化时自动跟随滚动（throttle 避免频繁触发）
const lastScrollTime = useRef(0);
useEffect(() => {
  if (isAtBottom) {
    const now = Date.now();
    if (now - lastScrollTime.current > 100) { // 100ms throttle
      lastScrollTime.current = now;
      const el = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]');
      if (el) {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      }
    }
  } else if (messages.length > 0) {
    setNewMsgCount(prev => prev + 1);
  }
}, [messages]); // 监听整个 messages 引用变化（streamReducer 每次返回新引用）
```

注意：`messages` 在流式更新时引用会变（streamReducer 返回新数组），所以可以直接监听 `messages`。但如果 `messages` 是引用相同的数组但内容变了（不太可能，因为 streamReducer 返回新对象），则需要监听 `messages.length` 加上最后一条消息的 `contentBlocks?.length`。

**Step 2: 确保初始加载时滚到底部**

添加 useEffect 在历史消息加载完成后滚到底部：
```typescript
// 历史消息加载完毕后滚到底部（无动画）
const prevMessageCount = useRef(0);
useEffect(() => {
  if (prevMessageCount.current === 0 && messages.length > 0) {
    // 从0到有消息：历史加载完成
    const el = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]');
    if (el) {
      requestAnimationFrame(() => {
        el.scrollTo({ top: el.scrollHeight, behavior: 'instant' });
      });
    }
  }
  prevMessageCount.current = messages.length;
}, [messages.length]);
```

**Step 3: 编译验证**

Run: `bun run build:electron && bun run lint`

**Step 4: 提交**

```bash
git add components/agent-chat/AgentChat.tsx
git commit -m "feat: 优化聊天滚动行为，消息生成时自动跟随"
```

---

## Task 4: 系统托盘最小化

关闭窗口时隐藏到系统托盘，双击托盘恢复，右键菜单可退出。

**Files:**
- Modify: `electron/main/index.ts`

**Step 1: 添加 Tray import 和图标**

在 `electron/main/index.ts` 顶部添加：
```typescript
import { Tray, Menu } from 'electron';
```
（BrowserWindow 和 app 应该已经 import 了，确认 Tray 和 Menu 也在）

**Step 2: 创建托盘逻辑**

在文件顶部变量声明区域添加：
```typescript
let tray: Tray | null = null;
let isQuitting = false;
```

在 `app.whenReady()` 回调中，`createWindow()` 之后添加 `createTray()`：
```typescript
function createTray() {
  // 使用应用图标（Windows 需要 .ico）
  const iconPath = isDev
    ? path.join(process.cwd(), 'resources/icon.ico')
    : path.join(process.resourcesPath, 'icon.ico');

  tray = new Tray(iconPath);
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setToolTip('Dogear');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}
```

**Step 3: 拦截主窗口关闭事件**

修改主窗口的 `close` 事件处理（第 287-288 行），从：
```typescript
mainWindow!.on('close', () => {
  closeAllChildWindows();
});
```
改为：
```typescript
mainWindow!.on('close', (event) => {
  if (!isQuitting) {
    event.preventDefault();
    mainWindow!.hide();
    // 子窗口也一起隐藏
    closeAllChildWindows();
  } else {
    closeAllChildWindows();
  }
});
```

**Step 4: 修改 before-quit 事件**

修改第 310-313 行：
```typescript
app.on('before-quit', async () => {
  isQuitting = true;
  await shutdownAgentManager();
});
```

**Step 5: 确保图标文件存在**

检查 `resources/icon.ico` 是否存在。如果只有 PNG 图标，在 Windows 上需要转换为 `.ico`。也可以先用 `nativeImage.createFromPath()` 加载 PNG。

备选方案（如果没有 .ico）：
```typescript
import { nativeImage } from 'electron';
const icon = nativeImage.createFromPath(
  isDev
    ? path.join(process.cwd(), 'resources/icon.png')
    : path.join(process.resourcesPath, 'icon.png')
);
tray = new Tray(icon);
```

**Step 6: 编译验证**

Run: `bun run build:electron`

**Step 7: 提交**

```bash
git add electron/main/index.ts
git commit -m "feat: 添加系统托盘，关闭时最小化到托盘"
```

---

## Task 5: 工作区切换全状态重置

切换工作区时重置所有 store 到初始状态（软重启）。

**Files:**
- Modify: `stores/conversation-store.ts`
- Modify: `stores/article-store.ts`
- Modify: `stores/reference-store.ts`
- Modify: `stores/analysis-store.ts`
- Modify: `stores/ui-store.ts`
- Modify: `stores/slash-command-store.ts`
- Modify: `stores/session-store.ts`
- Modify: `stores/workspace-store.ts`

**Step 1: 为 conversation-store 添加 reset()**

在 `ConversationState` 接口中新增：
```typescript
/** 重置到初始状态（工作区切换时） */
reset: () => void;
```

在 store 实现中添加：
```typescript
reset: () => set({
  conversations: [],
  selectedConversation: null,
  loadingConversations: false,
  forkParams: null,
  treeData: null,
  nodeMap: {},
  sessionRestartTrigger: 0,
}),
```

**Step 2: 为 article-store 添加 reset()**

```typescript
reset: () => set({
  selectedArticle: null,
  articleUrl: '',
  isLoadingArticle: false,
}),
```

**Step 3: 为 reference-store 添加 reset()**

```typescript
reset: () => set({
  referencedArticles: [],
  quotedSnippets: [],
  referencedFiles: [],
}),
```

**Step 4: 为 analysis-store 添加 reset()**

```typescript
reset: () => set({
  isAnalyzing: false,
  analysisProgress: 0,
  totalChapters: 0,
  processedChapters: 0,
  currentChapter: '',
  toolExecutions: [],
  analysisError: null,
}),
```

**Step 5: 为 ui-store 添加 reset()**

```typescript
reset: () => set({
  settingsOpen: false,
  promptSidebarOpen: false,
  rightPanelOpen: true,
  subAgents: {},
  selectedSubAgentId: null,
}),
```

**Step 6: 为 slash-command-store 添加 reset()**

```typescript
reset: () => set({
  sdkCommands: [],
  capabilities: null,
}),
```
（保留 CUSTOM_COMMANDS 不变，它们是静态的）

**Step 7: 为 session-store 添加 reset()**

```typescript
reset: () => set({
  tabs: [],
  activeTabId: null,
}),
```

**Step 8: 修改 workspace-store 的 clearWorkspace**

将当前 `clearWorkspace`（第 189-191 行）改为级联重置：
```typescript
clearWorkspace: async () => {
  // 1. 关闭所有打开的 Agent 会话
  const { useSessionStore } = await import('./session-store');
  const tabs = useSessionStore.getState().tabs;
  for (const tab of tabs) {
    if (tab.sessionId) {
      try {
        await client.closeQueryBasedSession({ sessionId: tab.sessionId });
      } catch (e) {
        console.warn('关闭会话失败:', tab.sessionId, e);
      }
    }
  }

  // 2. 重置所有相关 store
  const { useConversationStore } = await import('./conversation-store');
  const { useArticleStore } = await import('./article-store');
  const { useReferenceStore } = await import('./reference-store');
  const { useAnalysisStore } = await import('./analysis-store');
  const { useUIStore } = await import('./ui-store');
  const { useSlashCommandStore } = await import('./slash-command-store');

  useConversationStore.getState().reset();
  useArticleStore.getState().reset();
  useReferenceStore.getState().reset();
  useAnalysisStore.getState().reset();
  useUIStore.getState().reset();
  useSlashCommandStore.getState().reset();
  useSessionStore.getState().reset();

  // 3. 最后清除自身状态
  set({ workspace: null, files: [], selectedFile: null, selectedBook: null, workspaceFilePath: null });
},
```

**Step 9: 编译验证**

Run: `bun run build:electron && bun run lint`

**Step 10: 提交**

```bash
git add stores/conversation-store.ts stores/article-store.ts stores/reference-store.ts stores/analysis-store.ts stores/ui-store.ts stores/slash-command-store.ts stores/session-store.ts stores/workspace-store.ts
git commit -m "feat: 工作区切换时重置所有 store 到初始状态"
```

---

## Task 6: 子代理实时展示 — 后端消息转发

建立从 SDK 子代理到前端的实时消息通道。

**Files:**
- Modify: `electron/main/tipc/renderer-handlers.ts`
- Modify: `electron/main/agents/query-based-session.ts`
- Modify: `electron/main/agents/task-types.ts`

**Step 1: 新增 IPC 事件定义**

在 `renderer-handlers.ts` 中新增事件类型：
```typescript
// 子代理实时消息事件
subAgentMessage: (data: {
  parentSessionId: string;
  agentId: string;
  message: import('../agents/task-types.js').ExtendedSessionMessage;
}) => void;

// 子代理生命周期事件
subAgentStarted: (data: {
  parentSessionId: string;
  agentId: string;
  description: string;
  subagentType?: string;
}) => void;

subAgentCompleted: (data: {
  parentSessionId: string;
  agentId: string;
  status: string;
  durationMs?: number;
  tokens?: number;
  toolUseCount?: number;
  resultText?: string;
}) => void;
```

**Step 2: 在 query-based-session.ts 中拦截子代理事件**

当前 SDK 在执行子代理时，子代理的消息通过 `tool_use_result` 返回。但我们需要实时流。

在 `query-based-session.ts` 中找到 SDK query 执行循环（`for await (const event of session.query(...))`），在处理 `tool_use` 类型中检测 Agent 工具调用：

当 SDK 返回 `tool_use` 且 `toolName === 'Agent'` 时，记录该子代理的 `agentId`（从后续 `tool_use_result` 中获取）。

**关键问题**：SDK 的子代理消息事件流是否可以被外部监听？需要查看 SDK 是否暴露了子代理的 `sessionMessage` 事件。

如果 SDK 没有暴露子代理的实时流（当前 SDK 将子代理作为内部 tool 执行，只返回最终结果），则需要：

**方案 A（推荐）**：利用 SDK 的 JSONL 日志文件 — 子代理会话的 JSONL 文件会实时写入磁盘。用 `fs.watch` 或轮询监听 `<sessionsDir>/<sessionId>/subagents/agent-<agentId>.jsonl`，将新增行解析后转发给前端。

**方案 B**：查找 SDK 是否有子代理事件钩子。

先实现方案 A：

```typescript
// 在 QueryBasedSession 类中新增方法
private watchSubAgentFiles(sessionDir: string, parentSessionId: string) {
  const subagentsDir = path.join(sessionDir, 'subagents');
  // 监听目录变化，检测新文件
  const watcher = fs.watch(subagentsDir, { persistent: false }, (eventType, filename) => {
    if (filename && filename.startsWith('agent-') && filename.endsWith('.jsonl')) {
      const agentId = filename.replace('agent-', '').replace('.jsonl', '');
      this.tailSubAgentFile(path.join(subagentsDir, filename), parentSessionId, agentId);
    }
  });
  return watcher;
}

private subAgentTails = new Map<string, { offset: number; interval: NodeJS.Timeout }>();

private tailSubAgentFile(filePath: string, parentSessionId: string, agentId: string) {
  if (this.subAgentTails.has(agentId)) return; // 已在监听

  let offset = 0;
  const interval = setInterval(async () => {
    try {
      const content = await fs.promises.readFile(filePath, 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      const newLines = lines.slice(offset);
      offset = lines.length;

      for (const line of newLines) {
        try {
          const msg = JSON.parse(line);
          // 转发给前端
          this.sendToRenderer('subAgentMessage', {
            parentSessionId,
            agentId,
            message: msg,
          });
        } catch {}
      }
    } catch {}
  }, 200); // 200ms 轮询

  this.subAgentTails.set(agentId, { offset, interval });
}
```

**Step 3: 子代理生命周期事件**

在检测到 Agent tool_use 时发射 `subAgentStarted`：
```typescript
// 在 tool_use 消息处理中
if (extendedMsg.toolName === 'Agent') {
  // 发射 subAgentStarted（agentId 此时可能未知，用 toolUseId 替代）
  this.sendToRenderer('subAgentStarted', {
    parentSessionId: this.sessionId,
    agentId: extendedMsg.toolUseId || '',
    description: extendedMsg.toolInput?.description || '',
    subagentType: extendedMsg.toolInput?.subagent_type,
  });
}
```

在 tool_result 中检测子代理完成：
```typescript
if (subAgentMeta.subAgentId) {
  this.sendToRenderer('subAgentCompleted', {
    parentSessionId: this.sessionId,
    agentId: subAgentMeta.subAgentId,
    status: subAgentMeta.subAgentStatus || 'completed',
    durationMs: subAgentMeta.subAgentDurationMs,
    tokens: subAgentMeta.subAgentTokens,
    toolUseCount: subAgentMeta.subAgentToolUseCount,
    resultText: subAgentMeta.subAgentResultText,
  });
  // 停止文件监听
  this.stopTailSubAgent(subAgentMeta.subAgentId);
}
```

**Step 4: 清理**

在会话关闭时清理所有子代理文件监听：
```typescript
private cleanupSubAgentTails() {
  for (const [agentId, tail] of this.subAgentTails) {
    clearInterval(tail.interval);
  }
  this.subAgentTails.clear();
}
```

在 `close()` 方法中调用 `this.cleanupSubAgentTails()`。

**Step 5: 编译验证**

Run: `bun run build:electron`

**Step 6: 提交**

```bash
git add electron/main/tipc/renderer-handlers.ts electron/main/agents/query-based-session.ts electron/main/agents/task-types.ts
git commit -m "feat: 子代理消息实时转发通道（JSONL tail + IPC 事件）"
```

---

## Task 7: 子代理实时展示 — 前端面板

右侧面板新增"子代理" tab，两级列表（列表 → 详情），复用主会话渲染组件。

**Files:**
- Modify: `stores/ui-store.ts`
- Create: `components/agent-chat/hooks/useSubAgentMessages.ts`
- Rewrite: `components/agent-chat/SubAgentPanel.tsx`
- Modify: `components/agent-chat/SubAgentBlock.tsx`
- Modify: `app/page.tsx`

**Step 1: 扩展 ui-store**

修改 `SubAgentInfo` 接口和新增右侧面板 tab 状态：
```typescript
interface SubAgentInfo {
  agentId: string;
  description: string;
  subagentType?: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  tokens?: number;
  toolUseCount?: number;
  resultText?: string;
  // 运行中的子代理实时消息
  messages?: Message[];
}

// 在 UIState 中新增
rightPanelTab: 'preview' | 'subagents';
setRightPanelTab: (tab: 'preview' | 'subagents') => void;
```

初始值 `rightPanelTab: 'preview'`。

**Step 2: 创建 useSubAgentMessages hook**

`components/agent-chat/hooks/useSubAgentMessages.ts`：

```typescript
import { useEffect, useReducer, useCallback } from 'react';
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';
import { streamReducer, historyTransformer } from '../transformers';
import type { Message } from '../types';

/**
 * 监听指定子代理的实时消息流（运行中）或加载历史（已完成）
 */
export function useSubAgentMessages(
  parentSessionId: string | null,
  agentId: string | null,
  status: 'running' | 'completed' | 'failed' | undefined,
) {
  const [messages, dispatch] = useReducer(streamReducer, []);
  const [historyMessages, setHistoryMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);

  // 运行中：监听实时事件
  useEffect(() => {
    if (!parentSessionId || !agentId || status !== 'running') return;

    const unsub = rendererEvents.subAgentMessage.listen((data) => {
      if (data.parentSessionId === parentSessionId && data.agentId === agentId) {
        dispatch(data.message);
      }
    });

    return () => unsub();
  }, [parentSessionId, agentId, status]);

  // 已完成：加载历史
  useEffect(() => {
    if (!parentSessionId || !agentId || status === 'running') return;

    setLoading(true);
    client.getSubAgentHistory({ sessionId: parentSessionId, agentId })
      .then((result) => {
        if (result.messages) {
          const transformed = historyTransformer(result.messages);
          setHistoryMessages(transformed);
        }
      })
      .finally(() => setLoading(false));
  }, [parentSessionId, agentId, status]);

  return {
    messages: status === 'running' ? messages : historyMessages,
    loading,
  };
}
```

**Step 3: 重写 SubAgentPanel**

新的 SubAgentPanel 实现两级结构：

```typescript
// components/agent-chat/SubAgentPanel.tsx
import { useUIStore } from '@/stores/ui-store';
import { useSubAgentMessages } from './hooks/useSubAgentMessages';
import { MessageItem } from './MessageItem';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Bot, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export function SubAgentPanel({ parentSessionId }: { parentSessionId: string | null }) {
  const subAgents = useUIStore((s) => s.subAgents);
  const selectedSubAgentId = useUIStore((s) => s.selectedSubAgentId);
  const selectSubAgent = useUIStore((s) => s.selectSubAgent);

  // 排序：运行中在前，已完成按 completedAt 倒序
  const sortedAgents = Object.values(subAgents).sort((a, b) => {
    if (a.status === 'running' && b.status !== 'running') return -1;
    if (a.status !== 'running' && b.status === 'running') return 1;
    return (b.completedAt || b.startedAt) - (a.completedAt || a.startedAt);
  });

  const selectedAgent = selectedSubAgentId ? subAgents[selectedSubAgentId] : null;

  if (selectedAgent) {
    // 第二级：子代理详情
    return <SubAgentDetail agent={selectedAgent} parentSessionId={parentSessionId} onBack={() => selectSubAgent(null)} />;
  }

  // 第一级：子代理列表
  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b">
        <h2 className="text-sm font-semibold">子代理</h2>
      </div>
      <ScrollArea className="flex-1">
        {sortedAgents.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">暂无子代理</div>
        ) : (
          sortedAgents.map((agent) => (
            <button
              key={agent.agentId}
              onClick={() => selectSubAgent(agent.agentId)}
              className="w-full p-3 border-b text-left hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className={cn(
                  "w-2 h-2 rounded-full",
                  agent.status === 'running' ? 'bg-blue-500 animate-pulse' : 'bg-green-500'
                )} />
                <span className="text-sm font-medium truncate">{agent.description}</span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {agent.subagentType && <span>{agent.subagentType} · </span>}
                {agent.status === 'running' ? '运行中...' : `${((agent.durationMs || 0) / 1000).toFixed(1)}s`}
              </div>
            </button>
          ))
        )}
      </ScrollArea>
    </div>
  );
}

function SubAgentDetail({
  agent,
  parentSessionId,
  onBack,
}: {
  agent: SubAgentInfo;
  parentSessionId: string | null;
  onBack: () => void;
}) {
  const { messages, loading } = useSubAgentMessages(parentSessionId, agent.agentId, agent.status);

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" onClick={onBack}>
          <ArrowLeft size={14} />
        </Button>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className={cn(
            "w-2 h-2 rounded-full flex-shrink-0",
            agent.status === 'running' ? 'bg-blue-500 animate-pulse' : 'bg-green-500'
          )} />
          <span className="text-sm font-medium truncate">{agent.description}</span>
        </div>
      </div>
      <ScrollArea className="flex-1 p-3">
        {loading ? (
          <div className="flex items-center justify-center p-4">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        ) : (
          messages.map((msg, i) => (
            <MessageItem key={i} message={msg} messageIndex={i} />
          ))
        )}
      </ScrollArea>
    </div>
  );
}
```

**Step 4: 修改 SubAgentBlock**

简化 SubAgentBlock，移除内嵌详情展示，改为点击跳转右侧面板：
```typescript
// SubAgentBlock.tsx 中的"查看详情"按钮
// 改为：打开右侧面板子代理 tab + 选中该子代理
const { selectSubAgent, setRightPanelTab, openRightPanel } = useUIStore();

const handleViewDetail = () => {
  selectSubAgent(block.subAgentId || block.toolUseId || '');
  setRightPanelTab('subagents');
  openRightPanel();
};
```

**Step 5: 修改 page.tsx 右侧面板**

在右侧面板区域增加 tab 切换：
```typescript
const rightPanelTab = useUIStore((s) => s.rightPanelTab);
const setRightPanelTab = useUIStore((s) => s.setRightPanelTab);

// 面板头部增加 tab 切换
<aside className={cn(...)}>
  {/* Tab 切换栏 */}
  <div className="flex border-b">
    <button
      onClick={() => setRightPanelTab('preview')}
      className={cn("flex-1 px-3 py-2 text-xs font-medium", rightPanelTab === 'preview' ? 'border-b-2 border-primary' : 'text-muted-foreground')}
    >
      预览
    </button>
    <button
      onClick={() => setRightPanelTab('subagents')}
      className={cn("flex-1 px-3 py-2 text-xs font-medium", rightPanelTab === 'subagents' ? 'border-b-2 border-primary' : 'text-muted-foreground')}
    >
      子代理
    </button>
  </div>

  {rightPanelTab === 'subagents' ? (
    <SubAgentPanel parentSessionId={currentSessionId} />
  ) : (
    /* 原有的预览内容 */
  )}
</aside>
```

**Step 6: 监听子代理生命周期事件**

在 `page.tsx` 或 `AgentChat.tsx` 中监听 `subAgentStarted` 和 `subAgentCompleted` 事件，更新 ui-store：

```typescript
useEffect(() => {
  const unsubStart = rendererEvents.subAgentStarted.listen((data) => {
    useUIStore.getState().registerSubAgent({
      agentId: data.agentId,
      description: data.description,
      subagentType: data.subagentType,
      status: 'running',
      startedAt: Date.now(),
    });
    // 自动切换到子代理 tab
    useUIStore.getState().setRightPanelTab('subagents');
    useUIStore.getState().openRightPanel();
  });

  const unsubComplete = rendererEvents.subAgentCompleted.listen((data) => {
    useUIStore.getState().updateSubAgentStatus(data.agentId, {
      status: data.status === 'completed' ? 'completed' : 'failed',
      completedAt: Date.now(),
      durationMs: data.durationMs,
      tokens: data.tokens,
      toolUseCount: data.toolUseCount,
      resultText: data.resultText,
    });
  });

  return () => { unsubStart(); unsubComplete(); };
}, []);
```

**Step 7: 编译验证**

Run: `bun run build:electron && bun run lint`

**Step 8: 提交**

```bash
git add components/agent-chat/SubAgentPanel.tsx components/agent-chat/SubAgentBlock.tsx components/agent-chat/hooks/useSubAgentMessages.ts stores/ui-store.ts app/page.tsx
git commit -m "feat: 子代理实时展示面板（两级列表 + 复用主会话渲染组件）"
```

---

## 总览

| Task | 描述 | 复杂度 | 预估文件数 |
|------|------|--------|-----------|
| 1 | 删除编辑重发 | 低 | 6 |
| 2 | 修复分叉 UUID | 低 | 2-3 |
| 3 | 滚动行为优化 | 低 | 1 |
| 4 | 系统托盘 | 中 | 1 |
| 5 | 工作区切换重置 | 中 | 8 |
| 6 | 子代理后端转发 | 高 | 3 |
| 7 | 子代理前端面板 | 高 | 5 |
