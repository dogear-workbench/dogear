# 会话管理优化实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复重发/分叉 bug，改造重发交互，增强分叉体验，新增自动标题和文件引用功能。

**Architecture:** 分 5 个任务按依赖顺序实施。Task 1 修复核心 bug（`useAgentSession.ts` 硬编码 `forkSessionFlag=true`）。Task 2 改造重发交互为"放回输入框"模式。Task 3 为分叉添加延迟 SDK 创建 + 来源 banner。Task 4/5 独立，分别是自动标题和文件引用。

**Tech Stack:** React 19, Zustand 5, TypeScript, Electron IPC (tipc), Claude Agent SDK

---

### Task 1: Bug 修复 — 重发/分叉 forkSession 标记错误

**根因：** `useAgentSession.ts:64` 在 forkParams 存在时硬编码 `forkSessionFlag = true`，导致编辑重发（`forkParams.forkSession === false`）也走了 SDK 分叉模式。

**Files:**
- Modify: `components/agent-chat/hooks/useAgentSession.ts:61-66`

**Step 1: 修复 forkSessionFlag 赋值**

将第 61-66 行从：

```typescript
if (forkParams) {
  // Fork 模式：使用父对话的 sdk_session_id + fork 参数
  sdkSessionId = forkParams.sdkSessionIdToResume;
  forkSessionFlag = true;
  resumeSessionAtFlag = forkParams.resumeSessionAt;
  console.log('🔀 Fork 模式启动:', { sdkSessionId, resumeSessionAt: resumeSessionAtFlag });
}
```

改为：

```typescript
if (forkParams) {
  sdkSessionId = forkParams.sdkSessionIdToResume;
  forkSessionFlag = forkParams.forkSession;  // 使用实际值，而非硬编码 true
  resumeSessionAtFlag = forkParams.resumeSessionAt;
  console.log(forkParams.forkSession ? '🔀 Fork 模式启动:' : '✏️ 编辑重发模式启动:', { sdkSessionId, forkSession: forkSessionFlag, resumeSessionAt: resumeSessionAtFlag });
}
```

**Step 2: 验证编译**

Run: `cd c:/dogear && bun run build:electron`

**Step 3: Commit**

```bash
git add components/agent-chat/hooks/useAgentSession.ts
git commit -m "fix: use forkParams.forkSession instead of hardcoded true in useAgentSession"
```

---

### Task 2: 重发交互改造 — 放回输入框 + 重发芯片

**Files:**
- Modify: `stores/conversation-store.ts` — 新增 resendDraft 状态
- Modify: `components/agent-chat/hooks/useSendMessage.ts` — handleEditResend 改为设置 draft；handleSend 增加重发分支
- Modify: `components/agent-chat/ChatInputArea.tsx` — 重发指示芯片 UI
- Modify: `components/agent-chat/AgentChat.tsx` — 传递 resendDraft 相关 props
- Modify: `components/agent-chat/MessageItem.tsx` — 调整编辑重发触发方式

**Step 1: conversation-store.ts 新增 resendDraft 状态**

在 `ForkParams` 接口后面新增：

```typescript
/** 重发草稿（用户点击"重新发送"后暂存到输入框） */
export interface ResendDraft {
  messageIndex: number;       // 原消息在消息列表中的索引
  forkPointSdkUuid: string;   // 截断点（原消息前的 assistant UUID）
  originalContent: string;    // 原始消息内容
}
```

在 ConversationState 接口中新增：

```typescript
resendDraft: ResendDraft | null;
setResendDraft: (draft: ResendDraft | null) => void;
```

在 store 初始状态中新增：

```typescript
resendDraft: null,
setResendDraft: (draft) => set({ resendDraft: draft }),
```

**Step 2: useSendMessage.ts — 改造 handleEditResend**

将 `handleEditResend`（第149-177行）从"直接截断+自动发送"改为"设置 draft + 填充输入框"：

```typescript
/**
 * 编辑重发处理 — 新版：内容放回输入框，发送时才截断
 */
const handleEditResend = useCallback((messageIndex: number, newContent: string) => {
  if (!conversationId) return;

  // 找到该用户消息前面最近的 assistant 消息的 sdkUuid 作为截断点
  let targetAssistantUuid: string | undefined;
  for (let i = messageIndex - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant' && messages[i].sdkUuid) {
      targetAssistantUuid = messages[i].sdkUuid;
      break;
    }
  }

  if (!targetAssistantUuid) {
    console.warn('编辑的是第一条消息，无法使用 resumeSessionAt，暂不支持');
    return;
  }

  // 设置重发草稿（不截断历史，不触发 forkParams）
  setResendDraft({
    messageIndex,
    forkPointSdkUuid: targetAssistantUuid,
    originalContent: newContent,
  });
  // 填充输入框
  setInput(newContent);
}, [conversationId, messages, setResendDraft, setInput]);
```

需要从 store 获取 `setResendDraft`：

```typescript
const setResendDraft = useConversationStore((s) => s.setResendDraft);
const resendDraft = useConversationStore((s) => s.resendDraft);
```

**Step 3: useSendMessage.ts — handleSend 增加重发分支**

在 `handleSend` 函数中，在 `setIsLoading(true);`（约第383行）之后、`try {` 之前，增加重发分支检测：

```typescript
// 重发模式：截断历史 + 通过 editResendAction 触发 resume
if (resendDraft) {
  // 截断消息到截断点 assistant（含）
  const truncateIdx = messages.findIndex(
    (m, i) => i < resendDraft.messageIndex && m.role === 'assistant' && m.sdkUuid === resendDraft.forkPointSdkUuid
  );
  if (truncateIdx >= 0) {
    setMessages(messages.slice(0, truncateIdx + 1));
  }
  // 清除 draft
  setResendDraft(null);
  // 触发 editResend action（设置 forkParams，useAgentSession 会重建会话并自动发送）
  editResendAction({
    forkPointSdkUuid: resendDraft.forkPointSdkUuid,
    editedMessage: userMessage,
  });
  setIsLoading(false); // editResend 流程会重建会话，不在这里等待
  return;
}
```

注意：因为 `editResendAction` 会设置 `forkParams`，触发 `useAgentSession` 重建会话，会话 ready 后自动发送 `editedMessage`，所以这里直接 return。

**Step 4: ChatInputArea.tsx — 新增重发指示芯片**

新增 props：

```typescript
interface ChatInputAreaProps {
  // ... 已有 ...
  resendDraft: ResendDraft | null;
  onCancelResend: () => void;
}
```

在 `InputGroupAddon align="block-start"` 中，引用芯片后面新增重发芯片：

```typescript
{/* 重发指示芯片 */}
{resendDraft && (
  <div className="flex flex-wrap gap-1.5">
    <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-50 border border-amber-200 rounded-full text-xs text-amber-700">
      <CornerDownLeft className="w-3 h-3" />
      <span>重新发送</span>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onCancelResend}
        className="flex-shrink-0 h-4 w-4 p-0 rounded-full hover:bg-amber-200"
      >
        <X className="w-3 h-3" />
      </Button>
    </span>
  </div>
)}
```

需要 import `CornerDownLeft` from lucide-react。

更新 `InputGroupAddon` 的显示条件，加入 `resendDraft`：

```typescript
{(referencedArticles.length > 0 || quotedSnippets.length > 0 || pendingImages.length > 0 || resendDraft) && (
```

**Step 5: AgentChat.tsx — 传递 resendDraft props**

从 store 获取：

```typescript
const resendDraft = useConversationStore((s) => s.resendDraft);
const setResendDraft = useConversationStore((s) => s.setResendDraft);
```

传给 ChatInputArea：

```typescript
<ChatInputArea
  // ... 已有 props ...
  resendDraft={resendDraft}
  onCancelResend={() => {
    setResendDraft(null);
    sendMessage.setInput('');
  }}
/>
```

**Step 6: MessageItem.tsx — 调整编辑重发触发**

当前 MessageItem 中用户点击"重新发送"按钮时（第92-96行），直接调用 `onEditResend(messageIndex, editContent.trim())`。这会触发新版 `handleEditResend` 设置 draft 而非直接截断，所以 MessageItem 不需要修改按钮逻辑。

但需要调整一点：用户点击编辑按钮后进入编辑态、点击"重新发送"时，应该关闭编辑态：

```typescript
onClick={() => {
  if (editContent.trim() && onEditResend) {
    onEditResend(messageIndex, editContent.trim());
  }
  setIsEditing(false);
}}
```

这部分**不变**，已经是正确的。但需要在 `handleEditResend` 外额外导出 `resendDraft` 给组件使用（已在 Step 5 处理）。

**Step 7: useSendMessage.ts — 返回值新增 resendDraft**

在 return 对象中添加：

```typescript
return {
  // ... 已有 ...
  resendDraft,
};
```

**Step 8: 验证编译**

Run: `cd c:/dogear && bun run build:electron`

**Step 9: Commit**

```bash
git add stores/conversation-store.ts components/agent-chat/hooks/useSendMessage.ts components/agent-chat/ChatInputArea.tsx components/agent-chat/AgentChat.tsx
git commit -m "feat: resend puts content back to input box with indicator chip"
```

---

### Task 3: 分叉增强 — 延迟 SDK 创建 + 来源 Banner

**Files:**
- Modify: `types/electron-api.ts:141-154` — Conversation 新增 `fork_pending`
- Modify: `electron/main/services/conversation-service.ts` — createFork 设 `fork_pending: true`；新增 `clearForkPending`
- Modify: `electron/main/tipc/conversations.ts` — 新增 clearForkPending IPC
- Modify: `stores/conversation-store.ts` — forkConversation 不再设 forkParams；新增 fork_pending 处理
- Modify: `components/agent-chat/hooks/useAgentSession.ts` — fork_pending 时不启动 SDK；首次发送时启动
- Modify: `components/agent-chat/hooks/useMessageHistory.ts` — fork_pending 时加载父对话截断历史
- Modify: `components/agent-chat/AgentChat.tsx` — 分叉来源 Banner

**Step 1: types/electron-api.ts — Conversation 新增字段**

在 Conversation 接口（第141-154行）中，`temp_prompt` 后面新增：

```typescript
fork_pending?: boolean;            // 分叉已创建但 SDK 会话未建立
```

**Step 2: conversation-service.ts — createFork 设 fork_pending**

在 `createFork` 方法中（约第233-258行），创建新对话记录时新增字段：

```typescript
forkPending: true,  // 标记为待分叉状态
```

新增 `clearForkPending` 方法：

```typescript
/**
 * 清除分叉待定状态（SDK 会话创建成功后调用）
 */
export async function clearForkPending(workspaceId: string, id: string): Promise<void> {
  const file = await loadWorkspaceConversations(workspaceId);
  const conv = file.conversations[id];
  if (!conv) return;
  conv.forkPending = false;
  conv.updatedAt = new Date().toISOString();
  await saveWorkspaceConversations(workspaceId, file);
}
```

更新 `toCompat` 函数，添加 `fork_pending` 字段的转换：

```typescript
fork_pending: c.forkPending || false,
```

**Step 3: conversations.ts — 新增 clearForkPending IPC**

```typescript
clearForkPending: t.procedure
  .input<{ conversationId: string; workspaceId: string }>()
  .action(async ({ input }) => {
    try {
      await conversationService.clearForkPending(input.workspaceId, input.conversationId);
      return { success: true, error: undefined };
    } catch (error) {
      console.error('清除 fork_pending 失败:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }),
```

**Step 4: conversation-store.ts — forkConversation 不再设 forkParams**

修改 `forkConversation` 方法（第289-344行）：

移除设置 `forkParams` 的部分（第322-330行），改为只创建对话记录并切换：

```typescript
// 刷新对话列表
await get().loadConversations();

// 切换到新创建的分叉对话（fork_pending=true，不启动 SDK）
const newConvResult = await client.getById({ conversationId: forkResult.conversationId, workspaceId: workspace.id });
if (newConvResult.conversation) {
  set({ selectedConversation: newConvResult.conversation, forkParams: null });
  // 打开标签页
  const { useSessionStore } = await import('./session-store');
  useSessionStore.getState().openTab(forkResult.conversationId, newConvResult.conversation.title || '新对话');
}
```

**Step 5: useAgentSession.ts — fork_pending 处理**

在 `startSession` 中，`conversationId` 存在的分支里，检查 `fork_pending`：

```typescript
} else if (conversationId) {
  try {
    const convResult = await client.getById({ conversationId, workspaceId: useWorkspaceStore.getState().workspace?.id || '' });
    if (cancelled) return;
    const conv = convResult.conversation;

    if (conv?.fork_pending) {
      // fork_pending 状态：不启动 SDK 会话，等用户发送第一条消息
      console.log('⏳ fork_pending 对话，不启动 SDK 会话，等待用户输入');
      setIsSessionReady(false); // 暂不允许发送（Task 3 Step 7 会改为允许特殊发送）
      return;
    }

    if (conv?.sdk_session_id) {
      sdkSessionId = conv.sdk_session_id;
      console.log('✅ 找到 sdk_session_id，将 resume 会话:', sdkSessionId);
    } else {
      console.log('⚠️ 该对话没有 sdk_session_id，将创建新会话');
    }
  } catch (error) {
    console.error('❌ 获取 sdk_session_id 失败:', error);
  }
}
```

**Step 6: useMessageHistory.ts — fork_pending 时加载父对话截断历史**

在 `loadHistory` 函数中，`forkParams` 检查之后、`useSdkResume` 检查之前，新增 fork_pending 分支：

```typescript
// fork_pending 模式：加载父对话的截断历史（只读展示）
if (!forkParams) {
  try {
    const convResult = await client.getById({ conversationId, workspaceId: useWorkspaceStore.getState().workspace?.id || '' });
    const conv = convResult.conversation;

    if (conv?.fork_pending && conv.parent_conversation_id) {
      console.log('⏳ fork_pending 模式，加载父对话截断历史');
      // 获取父对话的 sdk_session_id
      const parentResult = await client.getById({ conversationId: conv.parent_conversation_id, workspaceId: useWorkspaceStore.getState().workspace?.id || '' });
      const parentSdkSessionId = parentResult.conversation?.sdk_session_id;

      if (parentSdkSessionId) {
        const historyResult = await client.getSdkSessionHistory({ sdkSessionId: parentSdkSessionId, projectPath: workspacePath || undefined });
        if (!historyResult.error) {
          // 复用现有的历史消息解析逻辑，但截断到 fork_message_sdk_uuid
          // ... （复用下方 SDK history 解析代码，添加 uuid 截断逻辑）
          // 标记所有消息为只读
        }
      }
      setHistoryLoaded(true);
      setIsResumeMode(false);
      return;
    }
  } catch (error) {
    console.error('检查 fork_pending 状态失败:', error);
  }
}
```

> **注意**：历史解析逻辑复杂（useMessageHistory 第65-381行），不应重复。应提取为公共函数 `parseSessionHistory(messages, options?: { truncateAtUuid?: string })`。

**Step 7: useAgentSession.ts — fork_pending 对话首次发送时启动 SDK**

在 useSendMessage.ts 的 `handleSend` 中，检测 fork_pending 状态：

```typescript
// fork_pending 模式：首次发送消息时启动 SDK fork 会话
const selectedConv = useConversationStore.getState().selectedConversation;
if (selectedConv?.fork_pending && selectedConv.parent_conversation_id) {
  // 获取父对话 sdk_session_id
  const parentResult = await client.getById({
    conversationId: selectedConv.parent_conversation_id,
    workspaceId: useWorkspaceStore.getState().workspace?.id || '',
  });
  const parentSdkSessionId = parentResult.conversation?.sdk_session_id;

  if (!parentSdkSessionId) {
    toast.warning('无法启动分叉会话', { description: '父对话缺少 SDK session' });
    setIsLoading(false);
    return;
  }

  // 通过 editResendAction 触发 fork 会话创建
  useConversationStore.getState().setForkParams({
    sdkSessionIdToResume: parentSdkSessionId,
    forkSession: true,
    resumeSessionAt: selectedConv.fork_message_sdk_uuid || '',
    editedMessage: userMessage,
    isForkNewConversation: true,
  });

  // 清除 fork_pending 状态
  await client.clearForkPending({
    conversationId: selectedConv.id,
    workspaceId: selectedConv.workspace_id,
  });

  // forkParams 变化会触发 useAgentSession 重建会话
  setIsLoading(false);
  return;
}
```

**Step 8: AgentChat.tsx — 分叉来源 Banner**

在消息区域顶部（`messages.length === 0` 空状态提示之前），添加 Banner：

```typescript
{/* 分叉来源 Banner */}
{selectedConv?.fork_pending && selectedConv?.parent_conversation_id && (
  <div className="flex items-center gap-2 px-3 py-2 my-2 rounded-lg bg-purple-50 border border-purple-200 text-xs text-purple-700">
    <GitBranch size={14} />
    <span>分叉自: </span>
    <button
      onClick={() => {
        // 跳转到父对话
        const parentId = selectedConv.parent_conversation_id!;
        const parentConv = conversations.find(c => c.id === parentId);
        if (parentConv) {
          selectConversation(parentConv);
        }
      }}
      className="font-medium text-purple-800 hover:underline cursor-pointer"
    >
      {parentTitle}
    </button>
  </div>
)}
```

需要获取父对话标题。在 AgentChat 中：

```typescript
const conversations = useConversationStore((s) => s.conversations);
const selectedConv = useConversationStore((s) => s.selectedConversation);
const selectConversation = useConversationStore((s) => s.selectConversation);
const parentTitle = useMemo(() => {
  if (!selectedConv?.parent_conversation_id) return '';
  const parent = conversations.find(c => c.id === selectedConv.parent_conversation_id);
  return parent?.title || '未知对话';
}, [selectedConv?.parent_conversation_id, conversations]);
```

**Step 9: 验证编译**

Run: `cd c:/dogear && bun run build:electron`

**Step 10: Commit**

```bash
git add types/electron-api.ts electron/main/services/conversation-service.ts electron/main/tipc/conversations.ts stores/conversation-store.ts components/agent-chat/hooks/useAgentSession.ts components/agent-chat/hooks/useMessageHistory.ts components/agent-chat/AgentChat.tsx
git commit -m "feat: fork enhancement - deferred SDK session + source banner + fork_pending state"
```

---

### Task 4: 新对话自动标题

**Files:**
- Modify: `components/agent-chat/hooks/useSendMessage.ts`

**Step 1: 添加自动标题逻辑**

在 `useSendMessage` 中获取 store actions：

```typescript
const updateConversationTitle = useConversationStore((s) => s.updateConversationTitle);
const conversationTitle = useConversationStore((s) => s.selectedConversation?.title);
```

在 `handleSend` 中，`setMessages(prev => [...prev, newUserMessage]);`（第369行）之后，添加：

```typescript
// 新对话自动标题：首条消息截取前 30 字
if (conversationTitle === '新对话' && messages.length === 0 && conversationId) {
  const titleText = userMessage.replace(/<[^>]+>/g, '').trim();
  const autoTitle = titleText.length > 30
    ? titleText.slice(0, 30) + '...'
    : titleText;
  if (autoTitle) {
    updateConversationTitle(conversationId, autoTitle);
  }
}
```

**Step 2: 验证编译**

Run: `cd c:/dogear && bun run build:electron`

**Step 3: Commit**

```bash
git add components/agent-chat/hooks/useSendMessage.ts
git commit -m "feat: auto-set conversation title from first message"
```

---

### Task 5: 工作区文件引用

**Files:**
- Modify: `stores/reference-store.ts` — 新增 file 引用状态
- Modify: `components/agent-chat/ChatInputArea.tsx` — 渲染文件引用芯片
- Modify: `components/agent-chat/hooks/useSendMessage.ts` — 发送时组装 XML
- Modify: `components/WorkspaceExplorer.tsx` — 右键菜单"引用到对话"

**Step 1: reference-store.ts — 新增文件引用**

新增类型和状态：

```typescript
/** 文件引用 */
export interface FileReference {
  name: string;      // 文件名
  path: string;      // 绝对路径
}
```

在 ReferenceState 接口中新增：

```typescript
referencedFiles: FileReference[];
addReferencedFile: (file: FileReference) => void;
removeReferencedFile: (filePath: string) => void;
clearReferencedFiles: () => void;
```

在 store 中新增：

```typescript
referencedFiles: [],

addReferencedFile: (file) => {
  set((state) => {
    // 去重：同路径不重复添加
    if (state.referencedFiles.some(f => f.path === file.path)) return state;
    return { referencedFiles: [...state.referencedFiles, file] };
  });
},

removeReferencedFile: (filePath) => {
  set((state) => ({
    referencedFiles: state.referencedFiles.filter((f) => f.path !== filePath),
  }));
},

clearReferencedFiles: () => set({ referencedFiles: [] }),
```

**Step 2: ChatInputArea.tsx — 渲染文件引用芯片**

从 store 获取：

```typescript
const referencedFiles = useReferenceStore((s) => s.referencedFiles);
const removeReferencedFile = useReferenceStore((s) => s.removeReferencedFile);
```

更新 `InputGroupAddon` 显示条件：

```typescript
{(referencedArticles.length > 0 || quotedSnippets.length > 0 || referencedFiles.length > 0 || pendingImages.length > 0 || resendDraft) && (
```

在引用芯片区域（蓝色文章芯片和紫色片段芯片之后）新增绿色文件芯片：

```typescript
{/* 绿色芯片：文件引用 */}
{referencedFiles.map(file => (
  <span
    key={file.path}
    className="inline-flex items-center gap-1 px-2 py-1 bg-green-50 border border-green-200 rounded-full text-xs text-green-700"
    title={file.path}
  >
    <FileText className="w-3 h-3 flex-shrink-0" />
    <span className="max-w-[160px] truncate">{file.name}</span>
    <Button
      variant="ghost"
      size="icon-xs"
      onClick={() => removeReferencedFile(file.path)}
      className="flex-shrink-0 h-4 w-4 p-0 rounded-full hover:bg-green-200"
    >
      <X className="w-3 h-3" />
    </Button>
  </span>
))}
```

需要 import `FileText` from lucide-react（已存在于 MessageItem 中，ChatInputArea 需要新增 import）。

**Step 3: useSendMessage.ts — 发送时组装 `<referenced_files>` XML**

从 store 获取：

```typescript
const referencedFiles = useReferenceStore((s) => s.referencedFiles);
const clearReferencedFiles = useReferenceStore((s) => s.clearReferencedFiles);
```

在 `handleSend` 中，引用文章 XML 组装之后、用户消息之前，新增：

```typescript
// 文件引用：独立 block，agent 通过 Read 工具读取
if (referencedFiles.length > 0) {
  const refLines = referencedFiles.map(f =>
    `  <file name="${sanitize(f.name)}" path="${sanitize(f.path)}" />`
  ).join('\n');
  textBlocks.push({
    text: `<referenced_files>\n${refLines}\n</referenced_files>`
  });
  clearReferencedFiles();
}
```

**Step 4: WorkspaceExplorer.tsx — 右键菜单"引用到对话"**

在普通文件/文件夹的右键菜单中（约第410-434行），为非目录文件添加"引用到对话"选项：

```typescript
// 在"重命名"之前添加
{!node.isDir && (
  <ContextMenuItem
    onClick={() => {
      const { useReferenceStore } = require('@/stores/reference-store');
      const fileName = node.name;
      const filePath = node.fullPath || node.path;
      useReferenceStore.getState().addReferencedFile({ name: fileName, path: filePath });
    }}
  >
    <Quote className="w-4 h-4 mr-2" />
    引用到对话
  </ContextMenuItem>
)}
```

需要 import `Quote` from lucide-react。

注意：需确认 WorkspaceExplorer 文件树节点中是否有 `fullPath` 或 `path` 属性提供绝对路径。如果只有相对路径，需要结合工作区根路径拼接。

**Step 5: 验证编译**

Run: `cd c:/dogear && bun run build:electron`

**Step 6: Commit**

```bash
git add stores/reference-store.ts components/agent-chat/ChatInputArea.tsx components/agent-chat/hooks/useSendMessage.ts components/WorkspaceExplorer.tsx
git commit -m "feat: workspace file reference - quote files to agent conversation"
```
