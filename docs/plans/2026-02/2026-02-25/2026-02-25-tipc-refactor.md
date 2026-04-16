# tipc IPC 重构实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 用 `@egoist/tipc` 替换全部手写 IPC 层，实现端到端类型安全，消除 `types/electron-api.ts`（480行）和 `preload/index.ts`（357行）的手写冗余。

**Architecture:** 主进程各域 router 文件作为唯一类型来源，渲染层通过 `client` 和 `rendererEvents` 两个对象访问所有 IPC，preload 简化为透传 ipcRenderer。

**Tech Stack:** `@egoist/tipc`, Electron, TypeScript, Next.js

---

## Task 1: 安装依赖

**Files:**
- Modify: `package.json`

**Step 1: 安装 @egoist/tipc**

```bash
cd c:/dogear && npm install @egoist/tipc
```

**Step 2: 确认安装成功**

```bash
ls node_modules/@egoist/tipc
```

Expected: 输出目录内容，包含 `main.js`、`renderer.js` 等文件

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install @egoist/tipc"
```

---

## Task 2: 创建 renderer-handlers.ts（main→renderer 事件定义）

**Files:**
- Create: `electron/main/tipc/renderer-handlers.ts`

**Step 1: 创建文件**

```typescript
// electron/main/tipc/renderer-handlers.ts
import { tipc } from '@egoist/tipc/main';
import type { AgentTaskUpdate } from '../../agents/task-types.js';
import type { ExtendedSessionMessage } from '../../agents/main-process-session.js';

const t = tipc.create();

export const rendererHandlers = {
  // 书籍分析进度更新
  analysisUpdate: t.renderer<{
    bookId: string;
    taskId?: string;
    status?: string;
    result?: unknown;
    error?: string;
    toolName?: string;
    toolInput?: unknown;
    chapterSaved?: boolean;
    chapterTitle?: string;
    message?: string;
    statusMessage?: string;
  }>(),

  // Agent 任务状态更新
  agentTaskUpdate: t.renderer<{
    taskId: string;
    status: string;
    result?: unknown;
    error?: string;
  }>(),

  // Agent 流式文本块
  agentStreamChunk: t.renderer<{
    taskId: string;
    chunk: string;
  }>(),

  // 旧版 Agent 会话消息
  agentSessionMessage: t.renderer<{
    sessionId: string;
    message: string;
  }>(),

  // 主进程会话消息（SDK v2）
  mainProcessSessionMessage: t.renderer<{
    sessionId: string;
    message: ExtendedSessionMessage;
  }>(),

  // 基于 Query 的会话消息
  queryBasedSessionMessage: t.renderer<{
    sessionId: string;
    message: ExtendedSessionMessage;
  }>(),

  // 基于 Query 的会话完成
  queryBasedSessionComplete: t.renderer<{
    sessionId: string;
    result: unknown;
  }>(),
};

export type RendererHandlers = typeof rendererHandlers;
```

**Step 2: Commit**

```bash
git add electron/main/tipc/renderer-handlers.ts
git commit -m "feat(tipc): add renderer-handlers event definitions"
```

---

## Task 3: 创建 db router

**Files:**
- Create: `electron/main/tipc/db.ts`

**Step 1: 创建文件**

```typescript
// electron/main/tipc/db.ts
import { tipc } from '@egoist/tipc/main';
import { dbBooks } from '../database/index.js';
import type { Book } from '../../../types/books.js';

const t = tipc.create();

export const dbRouter = {
  getBooks: t.procedure
    .action(async () => {
      return dbBooks.getAll();
    }),

  getBookById: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
      return dbBooks.getById(input.id);
    }),

  addBook: t.procedure
    .input<{ book: Book }>()
    .action(async ({ input }) => {
      return dbBooks.add(input.book);
    }),

  updateBook: t.procedure
    .input<{ id: string; data: Partial<Book> }>()
    .action(async ({ input }) => {
      return dbBooks.update(input.id, input.data);
    }),

  deleteBook: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
      return dbBooks.delete(input.id);
    }),
};
```

**Step 2: Commit**

```bash
git add electron/main/tipc/db.ts
git commit -m "feat(tipc): add db router"
```

---

## Task 4: 创建 book router

**Files:**
- Create: `electron/main/tipc/book.ts`

**Step 1: 创建文件**

注意：`openBookInFolder` 对应原 `book:openInFolder`，命名已修正以避免冲突。

```typescript
// electron/main/tipc/book.ts
import { tipc } from '@egoist/tipc/main';
import electron from 'electron';
const { shell } = electron;
import { dbBooks } from '../database/index.js';
import * as bookService from '../services/book-service.js';
import * as workspaceService from '../services/workspace-service.js';
import path from 'path';

const t = tipc.create();

export const bookRouter = {
  getChapterMetadata: t.procedure
    .input<{ bookId: string }>()
    .action(async ({ input }) => {
      return bookService.getChapterMetadata(input.bookId);
    }),

  getChapter: t.procedure
    .input<{ chapterId: string }>()
    .action(async ({ input }) => {
      return bookService.getChapter(input.chapterId);
    }),

  saveProgress: t.procedure
    .input<{ bookId: string; chapterId: string }>()
    .action(async ({ input }) => {
      return bookService.saveReadingProgress(input.bookId, input.chapterId);
    }),

  getBookByFilePath: t.procedure
    .input<{ filePathOrBookId: string }>()
    .action(async ({ input }) => {
      const books = dbBooks.getAll();
      const byId = books.find(book => book.id === input.filePathOrBookId);
      if (byId) return byId;
      const byPath = books.find(book =>
        book.file_path === input.filePathOrBookId ||
        book.original_file_path === input.filePathOrBookId
      );
      if (byPath) return byPath;
      const baseName = path.basename(input.filePathOrBookId, path.extname(input.filePathOrBookId));
      return books.find(book => book.title === baseName) ?? undefined;
    }),

  getWorkspaceFilePath: t.procedure
    .input<{ bookId: string }>()
    .action(async ({ input }) => {
      const book = dbBooks.getById(input.bookId);
      if (!book) return { path: null, error: '书籍不存在' };
      const workspace = await workspaceService.getCurrentWorkspace();
      if (!workspace) return { path: null, error: '未设置默认工作区' };
      const workspaceFilePath = await workspaceService.getBookFilePath(workspace, input.bookId, book.file_path);
      return { path: workspaceFilePath };
    }),

  // 原 book:openInFolder，改名避免与 file router 冲突
  openBookInFolder: t.procedure
    .input<{ bookId: string }>()
    .action(async ({ input }) => {
      const workspace = await workspaceService.getCurrentWorkspace();
      if (!workspace) return { success: false, error: '未设置默认工作区' };
      const workspaceFilePath = await workspaceService.getBookFilePath(workspace, input.bookId);
      await shell.openPath(workspaceFilePath);
      return { success: true };
    }),

  jumpToPosition: t.procedure
    .input<{ chapterId: string; position?: { start: number; end: number } }>()
    .action(async ({ input }) => {
      // 由渲染层处理跳转，主进程仅做转发
      return { chapterId: input.chapterId, position: input.position };
    }),
};
```

**Step 2: Commit**

```bash
git add electron/main/tipc/book.ts
git commit -m "feat(tipc): add book router"
```

---

## Task 5: 创建 ai router

**Files:**
- Create: `electron/main/tipc/ai.ts`

**Step 1: 创建文件**

```typescript
// electron/main/tipc/ai.ts
import { tipc } from '@egoist/tipc/main';
import * as aiService from '../services/ai-service.js';
import type { AIMessage } from '../../../types/ai.js';

const t = tipc.create();

export const aiRouter = {
  chat: t.procedure
    .input<{ messages: AIMessage[] }>()
    .action(async ({ input }) => {
      return aiService.chat(input.messages);
    }),

  summarize: t.procedure
    .input<{ text: string }>()
    .action(async ({ input }) => {
      return aiService.summarize(input.text);
    }),
};
```

**Step 2: Commit**

```bash
git add electron/main/tipc/ai.ts
git commit -m "feat(tipc): add ai router"
```

---

## Task 6: 创建 file router

**Files:**
- Create: `electron/main/tipc/file.ts`

**Step 1: 创建文件**

注意：`openFileInFolder` 对应原 `file:openInFolder`，已改名避免冲突。

```typescript
// electron/main/tipc/file.ts
import { tipc } from '@egoist/tipc/main';
import electron from 'electron';
const { shell } = electron;
import * as bookService from '../services/book-service.js';

const t = tipc.create();

export const fileRouter = {
  selectFile: t.procedure
    .action(async () => {
      return bookService.selectBookFile();
    }),

  importBook: t.procedure
    .input<{ filePath: string; workspaceId?: string }>()
    .action(async ({ input }) => {
      return bookService.importBook(input.filePath, input.workspaceId);
    }),

  // 原 file:openInFolder，改名避免与 book router 冲突
  openFileInFolder: t.procedure
    .input<{ filePath: string }>()
    .action(async ({ input }) => {
      if (!input.filePath) return { success: false, error: '文件路径为空' };
      await shell.openPath(input.filePath);
      return { success: true };
    }),
};
```

**Step 2: Commit**

```bash
git add electron/main/tipc/file.ts
git commit -m "feat(tipc): add file router"
```

---

## Task 7: 创建 workspace router

**Files:**
- Create: `electron/main/tipc/workspace.ts`

**Step 1: 创建文件**

```typescript
// electron/main/tipc/workspace.ts
import { tipc } from '@egoist/tipc/main';
import electron from 'electron';
const { dialog } = electron;
import { dbWorkspaces, dbBooks } from '../database/index.js';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';

const t = tipc.create();

export const workspaceRouter = {
  getAll: t.procedure
    .action(async () => {
      const workspaces = dbWorkspaces.getAll();
      return { workspaces };
    }),

  getDefault: t.procedure
    .action(async () => {
      return dbWorkspaces.getDefault() ?? null;
    }),

  selectFolder: t.procedure
    .action(async () => {
      const result = await dialog.showOpenDialog({
        properties: ['openDirectory'],
        title: '选择工作区文件夹',
      });
      if (result.canceled || result.filePaths.length === 0) return { canceled: true };

      const selectedPath = result.filePaths[0];
      const existingWorkspaces = dbWorkspaces.getAll();
      const existing = existingWorkspaces.find(w => w.path === selectedPath);

      if (existing) {
        dbWorkspaces.setDefault(existing.id);
        return { workspace: { ...existing, is_default: 1 }, existed: true };
      }

      const workspace = {
        id: uuidv4(),
        name: selectedPath.split(/[/\\]/).filter(Boolean).pop() || '工作区',
        path: selectedPath,
        is_default: 1,
        created_at: Date.now(),
      };
      dbWorkspaces.add(workspace);
      await fs.mkdir(selectedPath, { recursive: true });
      return { workspace, existed: false };
    }),

  setDefault: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      dbWorkspaces.setDefault(input.workspaceId);
      return { success: true };
    }),

  getFiles: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      const workspace = dbWorkspaces.getById(input.workspaceId);
      if (!workspace) return { files: [], error: '工作区不存在' };
      const allBooks = dbBooks.getAll();
      const files = allBooks
        .filter(book => book.workspace_id === input.workspaceId)
        .map(book => ({
          name: book.title,
          path: book.id,
          type: 'file' as const,
          ext: '.' + (book.file_type || 'txt'),
          bookId: book.id,
          originalFilePath: book.original_file_path,
        }));
      return { files };
    }),
};
```

**Step 2: Commit**

```bash
git add electron/main/tipc/workspace.ts
git commit -m "feat(tipc): add workspace router"
```

---

## Task 8: 创建 conversations router

**Files:**
- Create: `electron/main/tipc/conversations.ts`

**Step 1: 创建文件**

```typescript
// electron/main/tipc/conversations.ts
import { tipc } from '@egoist/tipc/main';
import {
  dbConversations,
  dbConversationMessages,
  dbConversationBranches,
  dbBranchMessages,
  dbBooks,
} from '../database/index.js';
import type { ConversationMessage, BranchMessage } from '../database/index.js';

const t = tipc.create();

export const conversationsRouter = {
  getByBookId: t.procedure
    .input<{ bookId: string }>()
    .action(async ({ input }) => {
      const conversations = dbConversations.getByBookId(input.bookId);
      return { conversations };
    }),

  getById: t.procedure
    .input<{ conversationId: string }>()
    .action(async ({ input }) => {
      const conversation = dbConversations.getById(input.conversationId);
      return { conversation: conversation ?? null };
    }),

  create: t.procedure
    .input<{ bookId: string; title?: string }>()
    .action(async ({ input }) => {
      const book = dbBooks.getById(input.bookId);
      if (!book) return { conversationId: null, error: '书籍不存在' };
      const conversationId = dbConversations.create(input.bookId, input.title || '新对话');
      return { conversationId };
    }),

  updateTitle: t.procedure
    .input<{ conversationId: string; title: string }>()
    .action(async ({ input }) => {
      dbConversations.updateTitle(input.conversationId, input.title);
      return { success: true };
    }),

  updateSdkSessionId: t.procedure
    .input<{ conversationId: string; sdkSessionId: string }>()
    .action(async ({ input }) => {
      dbConversations.updateSdkSessionId(input.conversationId, input.sdkSessionId);
      return { success: true };
    }),

  deleteConversation: t.procedure
    .input<{ conversationId: string }>()
    .action(async ({ input }) => {
      dbConversations.delete(input.conversationId);
      return { success: true };
    }),

  getMessages: t.procedure
    .input<{ conversationId: string }>()
    .action(async ({ input }) => {
      const messages = dbConversationMessages.getByConversationId(input.conversationId);
      return { messages };
    }),

  addMessage: t.procedure
    .input<{ message: Omit<ConversationMessage, 'id'> }>()
    .action(async ({ input }) => {
      const messageId = dbConversationMessages.add(input.message);
      return { messageId };
    }),

  addMessages: t.procedure
    .input<{ messages: Omit<ConversationMessage, 'id'>[] }>()
    .action(async ({ input }) => {
      dbConversationMessages.bulkAdd(input.messages);
      return { success: true };
    }),

  getBooksWithConversations: t.procedure
    .input<{ workspaceId?: string }>()
    .action(async ({ input }) => {
      let books = dbBooks.getAll();
      if (input.workspaceId && input.workspaceId !== 'default') {
        books = books.filter(b => b.workspace_id === input.workspaceId);
      }
      const booksWithConversations = books.map(book => ({
        book,
        conversations: dbConversations.getByBookId(book.id!),
      }));
      return { booksWithConversations };
    }),

  createFork: t.procedure
    .input<{ bookId: string; title: string; parentConversationId: string; forkMessageSdkUuid: string }>()
    .action(async ({ input }) => {
      const book = dbBooks.getById(input.bookId);
      if (!book) return { conversationId: null, error: '书籍不存在' };
      const conversationId = dbConversations.createFork(
        input.bookId, input.title, input.parentConversationId, input.forkMessageSdkUuid
      );
      return { conversationId };
    }),

  createBranch: t.procedure
    .input<{ conversationId: string; forkPointSdkUuid: string; sdkSessionId: string }>()
    .action(async ({ input }) => {
      const branchIndex = dbConversationBranches.getNextBranchIndex(
        input.conversationId, input.forkPointSdkUuid
      );
      const branchId = dbConversationBranches.create(
        input.conversationId, input.forkPointSdkUuid, branchIndex, input.sdkSessionId
      );
      return { branchId, branchIndex };
    }),

  getBranches: t.procedure
    .input<{ conversationId: string; forkPointSdkUuid?: string }>()
    .action(async ({ input }) => {
      const branches = input.forkPointSdkUuid
        ? dbConversationBranches.getByConversationAndForkPoint(input.conversationId, input.forkPointSdkUuid)
        : dbConversationBranches.getByConversationId(input.conversationId);
      return { branches };
    }),

  getBranchMessages: t.procedure
    .input<{ branchId: string }>()
    .action(async ({ input }) => {
      const messages = dbBranchMessages.getByBranchId(input.branchId);
      return { messages };
    }),

  addBranchMessage: t.procedure
    .input<{ message: Omit<BranchMessage, 'id'> }>()
    .action(async ({ input }) => {
      const messageId = dbBranchMessages.add(input.message);
      return { messageId };
    }),
};
```

**Step 2: Commit**

```bash
git add electron/main/tipc/conversations.ts
git commit -m "feat(tipc): add conversations router"
```

---

## Task 9: 创建 agent router

**Files:**
- Create: `electron/main/tipc/agent.ts`

**Step 1: 读取 agents.ts 的剩余部分（约 250-905 行）了解所有 handler**

重点关注：`book:analyze`、`book:getAnalysisStatus`、`book:getChapterAnalyses`、`book:chatWithAnalysis`、`agent:createMainProcessSession`、`agent:createQueryBasedSession` 等。

**Step 2: 创建文件**

agent router 包含旧版 agent 任务、书籍分析（v2）、主进程会话（SDK v2）、基于 Query 的会话四组 procedure。关键点：`event.sender` 通过 action 的 `{ input, event }` 获取，用于调用 `createRendererHandlers(rendererHandlers).xxx.send(event.sender, data)`。

```typescript
// electron/main/tipc/agent.ts
import { tipc, createRendererHandlers } from '@egoist/tipc/main';
import { getAgentManager } from '../agents/agent-manager.js';
import { AgentTask, TaskType, ChatSessionPayload } from '../agents/task-types.js';
import { sendToDebugWindow } from '../index.js';
import { getMainProcessSessionManager } from '../agents/main-process-session.js';
import { getQueryBasedSessionManager } from '../agents/query-based-session.js';
import type { QueryBasedSessionConfig } from '../agents/query-based-session.js';
import { createBookQATools } from '../agents/tools/book-qa-tools.js';
import { rendererHandlers } from './renderer-handlers.js';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../../');

const t = tipc.create();

export const agentRouter = {
  // ── 旧版 Agent 任务 ──────────────────────────────────────
  submitTask: t.procedure
    .input<{ task: AgentTask }>()
    .action(async ({ input, event }) => {
      const agentManager = getAgentManager();
      const handlers = createRendererHandlers(rendererHandlers);
      const taskId = await agentManager.submitTask(input.task, (taskId, status, result, error) => {
        if (event.sender) {
          handlers.agentTaskUpdate.send(event.sender, { taskId, status, result, error });
        }
        sendToDebugWindow('debug:taskUpdate', { taskId, status, result, error });
        if (result?.message) {
          sendToDebugWindow('debug:agentMessage', { role: 'assistant', content: result.message, timestamp: Date.now() });
        }
      });
      if (input.task.type === TaskType.CHAT_SESSION && input.task.payload?.action === 'start') {
        agentManager.registerSessionCallback(taskId, (sessionId, message) => {
          if (event.sender) {
            handlers.agentSessionMessage.send(event.sender, { sessionId, message });
          }
          sendToDebugWindow('debug:agentMessage', { role: 'assistant', content: message, timestamp: Date.now() });
        });
      }
      return { taskId };
    }),

  sendSessionMessage: t.procedure
    .input<{ sessionId: string; message: { role: string; content: string } }>()
    .action(async ({ input, event }) => {
      const agentManager = getAgentManager();
      const handlers = createRendererHandlers(rendererHandlers);
      const task: AgentTask = {
        id: `msg-${Date.now()}`,
        type: TaskType.CHAT_SESSION,
        status: 'pending' as any,
        payload: { action: 'message', sessionId: input.sessionId, message: input.message } as ChatSessionPayload,
        createdAt: Date.now(),
      };
      const taskId = await agentManager.submitTask(task, (taskId, status, result, error) => {
        if (event.sender) {
          handlers.agentTaskUpdate.send(event.sender, { taskId, status, result, error });
        }
      });
      return { taskId };
    }),

  closeSession: t.procedure
    .input<{ sessionId: string }>()
    .action(async ({ input }) => {
      const agentManager = getAgentManager();
      const task: AgentTask = {
        id: `close-${Date.now()}`,
        type: TaskType.CHAT_SESSION,
        status: 'pending' as any,
        payload: { action: 'close', sessionId: input.sessionId } as ChatSessionPayload,
        createdAt: Date.now(),
      };
      const taskId = await agentManager.submitTask(task);
      agentManager.unregisterSessionCallbacks(input.sessionId);
      return { taskId, success: true };
    }),

  cancelTask: t.procedure
    .input<{ taskId: string }>()
    .action(async ({ input }) => {
      getAgentManager().cancelTask(input.taskId);
      return { success: true };
    }),

  getStatus: t.procedure
    .action(async () => getAgentManager().getStatus()),

  getDetailedStatus: t.procedure
    .action(async () => getAgentManager().getDetailedStatus()),

  openMonitorWindow: t.procedure
    .action(async () => {
      const { createAgentMonitorWindow } = await import('../index.js');
      createAgentMonitorWindow();
      return { success: true };
    }),

  // ── 书籍分析 v2 ──────────────────────────────────────────
  analyzeBook: t.procedure
    .input<{ bookId: string }>()
    .action(async ({ input, event }) => {
      // 迁移自 agents.ts 中的 book:analyze handler
      // 保持原有逻辑不变，仅将 event.sender.send 替换为 tipc handlers
      const agentManager = getAgentManager();
      const handlers = createRendererHandlers(rendererHandlers);
      const task: AgentTask = {
        id: '',
        type: TaskType.ANALYZE_BOOK,
        status: 'pending' as any,
        payload: { bookId: input.bookId },
        createdAt: Date.now(),
      };
      const taskId = await agentManager.submitTask(task, (taskId, status, result, error) => {
        if (event.sender) {
          handlers.analysisUpdate.send(event.sender, {
            bookId: input.bookId,
            taskId,
            status,
            result,
            error,
          });
        }
      });
      return { taskId };
    }),

  getAnalysisStatus: t.procedure
    .input<{ bookId: string }>()
    .action(async ({ input }) => {
      // 迁移自 agents.ts book:getAnalysisStatus
      // 保持原有逻辑
      return { bookId: input.bookId };
    }),

  getChapterAnalyses: t.procedure
    .input<{ bookId: string }>()
    .action(async ({ input }) => {
      // 迁移自 agents.ts book:getChapterAnalyses
      return { bookId: input.bookId };
    }),

  chatWithAnalysis: t.procedure
    .input<{ bookId: string; chapterId?: string; message: string; conversationId?: string; sessionId?: string }>()
    .action(async ({ input, event }) => {
      // 迁移自 agents.ts book:chatWithAnalysis
      const handlers = createRendererHandlers(rendererHandlers);
      // 保持原有逻辑，event.sender 用于推送消息
      return { sessionId: input.sessionId || `session-${Date.now()}` };
    }),

  getBookFilePath: t.procedure
    .input<{ bookId: string }>()
    .action(async ({ input }) => {
      // 迁移自 agents.ts book:getFilePath
      return { bookId: input.bookId };
    }),

  // ── 主进程会话（SDK v2）──────────────────────────────────
  createMainProcessSession: t.procedure
    .input<{
      model?: string;
      allowedTools?: string[];
      context?: { bookId?: string; chapterId?: string; selectedText?: string };
    }>()
    .action(async ({ input, event }) => {
      const handlers = createRendererHandlers(rendererHandlers);
      const manager = getMainProcessSessionManager();
      const sessionId = await manager.createSession({
        ...input,
        onMessage: (msg) => {
          if (event.sender) {
            handlers.mainProcessSessionMessage.send(event.sender, { sessionId: sessionId as string, message: msg });
          }
        },
      });
      return { sessionId };
    }),

  sendMainProcessSessionMessage: t.procedure
    .input<{ sessionId: string; content: string }>()
    .action(async ({ input }) => {
      const manager = getMainProcessSessionManager();
      await manager.sendMessage(input.sessionId, input.content);
      return { success: true };
    }),

  closeMainProcessSession: t.procedure
    .input<{ sessionId: string }>()
    .action(async ({ input }) => {
      const manager = getMainProcessSessionManager();
      await manager.closeSession(input.sessionId);
      return { success: true };
    }),

  // ── 基于 Query 的会话（支持 Skills）────────────────────────
  createQueryBasedSession: t.procedure
    .input<{
      model?: string;
      allowedTools?: string[];
      context?: { bookId?: string; chapterId?: string; selectedText?: string };
      enableSkills?: boolean;
      projectRoot?: string;
      conversationId?: string;
      resume?: string;
      forkSession?: boolean;
      resumeSessionAt?: string;
      isForkNewConversation?: boolean;
    }>()
    .action(async ({ input, event }) => {
      const handlers = createRendererHandlers(rendererHandlers);
      const manager = getQueryBasedSessionManager();
      const config: QueryBasedSessionConfig = {
        ...input,
        onMessage: (sessionId, msg) => {
          if (event.sender) {
            handlers.queryBasedSessionMessage.send(event.sender, { sessionId, message: msg });
          }
        },
        onComplete: (sessionId, result) => {
          if (event.sender) {
            handlers.queryBasedSessionComplete.send(event.sender, { sessionId, result });
          }
        },
      };
      const sessionId = await manager.createSession(config);
      return { sessionId };
    }),

  sendQueryBasedSessionMessage: t.procedure
    .input<{ sessionId: string; content: string }>()
    .action(async ({ input }) => {
      const manager = getQueryBasedSessionManager();
      await manager.sendMessage(input.sessionId, input.content);
      return { success: true };
    }),

  closeQueryBasedSession: t.procedure
    .input<{ sessionId: string }>()
    .action(async ({ input }) => {
      const manager = getQueryBasedSessionManager();
      await manager.closeSession(input.sessionId);
      return { success: true };
    }),

  getSdkSessionHistory: t.procedure
    .input<{ sdkSessionId: string; projectPath?: string }>()
    .action(async ({ input }) => {
      const projectPath = input.projectPath || PROJECT_ROOT;
      const projectsDir = path.join(projectPath, '.claude', 'projects');
      // 保持原有逻辑
      try {
        const sessionFile = path.join(projectsDir, `${input.sdkSessionId}.json`);
        const content = await fs.readFile(sessionFile, 'utf-8');
        return { messages: JSON.parse(content) };
      } catch {
        return { messages: [] };
      }
    }),

  getSdkSessions: t.procedure
    .input<{ projectPath?: string }>()
    .action(async ({ input }) => {
      const projectPath = input.projectPath || PROJECT_ROOT;
      const projectsDir = path.join(projectPath, '.claude', 'projects');
      try {
        const files = await fs.readdir(projectsDir);
        return { sessions: files.filter(f => f.endsWith('.json')).map(f => f.replace('.json', '')) };
      } catch {
        return { sessions: [] };
      }
    }),
};
```

> **注意：** `analyzeBook`、`getAnalysisStatus`、`getChapterAnalyses`、`chatWithAnalysis`、`getBookFilePath` 的完整逻辑需参考 `electron/main/ipc/agents.ts` 第 235–905 行逐一迁移，上面的 stub 仅示意结构，实际 action 中需粘贴原有完整逻辑。

**Step 3: Commit**

```bash
git add electron/main/tipc/agent.ts
git commit -m "feat(tipc): add agent router"
```

---

## Task 10: 创建 tipc/index.ts（合并所有 router）

**Files:**
- Create: `electron/main/tipc/index.ts`

**Step 1: 创建文件**

```typescript
// electron/main/tipc/index.ts
import { registerIpcMain } from '@egoist/tipc/main';
import { dbRouter } from './db.js';
import { bookRouter } from './book.js';
import { aiRouter } from './ai.js';
import { fileRouter } from './file.js';
import { workspaceRouter } from './workspace.js';
import { agentRouter } from './agent.js';
import { conversationsRouter } from './conversations.js';

export const router = {
  ...dbRouter,
  ...bookRouter,
  ...aiRouter,
  ...fileRouter,
  ...workspaceRouter,
  ...agentRouter,
  ...conversationsRouter,
};

export type Router = typeof router;

export function registerTipcHandlers() {
  registerIpcMain(router);
}
```

**Step 2: Commit**

```bash
git add electron/main/tipc/index.ts
git commit -m "feat(tipc): merge all routers and export registerTipcHandlers"
```

---

## Task 11: 更新 main/index.ts

**Files:**
- Modify: `electron/main/index.ts`

**Step 1: 替换 registerAllHandlers**

找到 `import { registerAllHandlers } from './ipc/index.js'` 这一行，改为：

```typescript
import { registerTipcHandlers } from './tipc/index.js';
```

找到调用 `registerAllHandlers()` 的位置，改为：

```typescript
registerTipcHandlers();
```

**Step 2: Commit**

```bash
git add electron/main/index.ts
git commit -m "feat(tipc): switch main process to registerTipcHandlers"
```

---

## Task 12: 简化 preload/index.ts

**Files:**
- Modify: `electron/preload/index.ts`

**Step 1: 替换全文**

删除全部现有内容，改为：

```typescript
/**
 * Electron 预加载脚本
 * 仅透传 ipcRenderer，类型安全由 @egoist/tipc 的 client/events 提供
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ipcRenderer', {
  invoke: ipcRenderer.invoke.bind(ipcRenderer),
  on:     ipcRenderer.on.bind(ipcRenderer),
  off:    ipcRenderer.off.bind(ipcRenderer),
  send:   ipcRenderer.send.bind(ipcRenderer),
});
```

**Step 2: Commit**

```bash
git add electron/preload/index.ts
git commit -m "refactor(preload): simplify to ipcRenderer passthrough via tipc"
```

---

## Task 13: 创建渲染层 client、events、类型声明

**Files:**
- Create: `lib/client.ts`
- Create: `lib/events.ts`
- Create: `types/electron.d.ts`

**Step 1: 创建 lib/client.ts**

```typescript
// lib/client.ts
import { createClient } from '@egoist/tipc/renderer';
import type { Router } from '../electron/main/tipc/index';

export const client = createClient<Router>({
  ipcInvoke: window.ipcRenderer.invoke,
});
```

**Step 2: 创建 lib/events.ts**

```typescript
// lib/events.ts
import { createEventHandlers } from '@egoist/tipc/renderer';
import type { RendererHandlers } from '../electron/main/tipc/renderer-handlers';

export const rendererEvents = createEventHandlers<RendererHandlers>({
  on:   window.ipcRenderer.on,
  send: window.ipcRenderer.send,
});
```

**Step 3: 创建 types/electron.d.ts**

```typescript
// types/electron.d.ts
export {};

declare global {
  interface Window {
    ipcRenderer: {
      invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
      on:     (channel: string, listener: (...args: unknown[]) => void) => void;
      off:    (channel: string, listener: (...args: unknown[]) => void) => void;
      send:   (channel: string, ...args: unknown[]) => void;
    };
  }
}
```

**Step 4: Commit**

```bash
git add lib/client.ts lib/events.ts types/electron.d.ts
git commit -m "feat(tipc): add renderer client, events, and window type declaration"
```

---

## Task 14: 更新渲染层调用（8 个文件）

需要更新的文件：
1. `components/reader.tsx`
2. `components/AgentChat.tsx`
3. `app/page.tsx`
4. `components/workspace-selector.tsx`
5. `components/book-analysis.tsx`
6. `components/book-list.tsx`
7. `app/agent-monitor/page.tsx`
8. `lib/hooks.ts`
9. `components/agent-test.tsx`

**通用替换规则：**

在每个文件顶部添加：
```typescript
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';
```

然后按以下映射替换（`@/` 为 Next.js 的路径别名）：

| 原调用 | 新调用 |
|--------|--------|
| `window.electronAPI.db.getBooks()` | `client.getBooks.invoke()` |
| `window.electronAPI.db.getBookById(id)` | `client.getBookById.invoke({ id })` |
| `window.electronAPI.db.addBook(book)` | `client.addBook.invoke({ book })` |
| `window.electronAPI.db.updateBook(id, data)` | `client.updateBook.invoke({ id, data })` |
| `window.electronAPI.db.deleteBook(id)` | `client.deleteBook.invoke({ id })` |
| `window.electronAPI.book.getChapter(id)` | `client.getChapter.invoke({ chapterId: id })` |
| `window.electronAPI.book.getChapterMetadata(id)` | `client.getChapterMetadata.invoke({ bookId: id })` |
| `window.electronAPI.book.saveProgress(bId, cId)` | `client.saveProgress.invoke({ bookId: bId, chapterId: cId })` |
| `window.electronAPI.book.analyze(id)` | `client.analyzeBook.invoke({ bookId: id })` |
| `window.electronAPI.book.getAnalysisStatus(id)` | `client.getAnalysisStatus.invoke({ bookId: id })` |
| `window.electronAPI.book.getChapterAnalyses(id)` | `client.getChapterAnalyses.invoke({ bookId: id })` |
| `window.electronAPI.book.openInFolder(id)` | `client.openBookInFolder.invoke({ bookId: id })` |
| `window.electronAPI.book.getBookByFilePath(p)` | `client.getBookByFilePath.invoke({ filePathOrBookId: p })` |
| `window.electronAPI.book.jumpToPosition(cId, pos)` | `client.jumpToPosition.invoke({ chapterId: cId, position: pos })` |
| `window.electronAPI.ai.chat(msgs)` | `client.chat.invoke({ messages: msgs })` |
| `window.electronAPI.ai.summarize(text)` | `client.summarize.invoke({ text })` |
| `window.electronAPI.file.selectFile()` | `client.selectFile.invoke()` |
| `window.electronAPI.file.importBook(p, wId)` | `client.importBook.invoke({ filePath: p, workspaceId: wId })` |
| `window.electronAPI.file.openInFolder(p)` | `client.openFileInFolder.invoke({ filePath: p })` |
| `window.electronAPI.workspace.getAll()` | `client.getAll.invoke()` |
| `window.electronAPI.workspace.getDefault()` | `client.getDefault.invoke()` |
| `window.electronAPI.workspace.selectFolder()` | `client.selectFolder.invoke()` |
| `window.electronAPI.workspace.setDefault(id)` | `client.setDefault.invoke({ workspaceId: id })` |
| `window.electronAPI.workspace.getFiles(id)` | `client.getFiles.invoke({ workspaceId: id })` |
| `window.electronAPI.agent.submitTask(task)` | `client.submitTask.invoke({ task })` |
| `window.electronAPI.agent.cancelTask(id)` | `client.cancelTask.invoke({ taskId: id })` |
| `window.electronAPI.agent.getStatus()` | `client.getStatus.invoke()` |
| `window.electronAPI.agent.getDetailedStatus()` | `client.getDetailedStatus.invoke()` |
| `window.electronAPI.agent.openMonitorWindow()` | `client.openMonitorWindow.invoke()` |
| `window.electronAPI.agent.sendSessionMessage(sId, m)` | `client.sendSessionMessage.invoke({ sessionId: sId, message: m })` |
| `window.electronAPI.agent.closeSession(id)` | `client.closeSession.invoke({ sessionId: id })` |
| `window.electronAPI.agent.onTaskUpdate(cb)` | `rendererEvents.agentTaskUpdate.listen(cb)` |
| `window.electronAPI.agent.onStreamChunk(cb)` | `rendererEvents.agentStreamChunk.listen(cb)` |
| `window.electronAPI.agent.onSessionMessage(cb)` | `rendererEvents.agentSessionMessage.listen(cb)` |
| `window.electronAPI.book.onAnalysisUpdate(cb)` | `rendererEvents.analysisUpdate.listen(cb)` |
| `window.electronAPI.mainProcessSession.createSession(c)` | `client.createMainProcessSession.invoke(c)` |
| `window.electronAPI.mainProcessSession.sendMessage(sId, c)` | `client.sendMainProcessSessionMessage.invoke({ sessionId: sId, content: c })` |
| `window.electronAPI.mainProcessSession.closeSession(id)` | `client.closeMainProcessSession.invoke({ sessionId: id })` |
| `window.electronAPI.mainProcessSession.onMessage(cb)` | `rendererEvents.mainProcessSessionMessage.listen(cb)` |
| `window.electronAPI.queryBasedSession.createSession(c)` | `client.createQueryBasedSession.invoke(c)` |
| `window.electronAPI.queryBasedSession.sendMessage(sId, c)` | `client.sendQueryBasedSessionMessage.invoke({ sessionId: sId, content: c })` |
| `window.electronAPI.queryBasedSession.closeSession(id)` | `client.closeQueryBasedSession.invoke({ sessionId: id })` |
| `window.electronAPI.queryBasedSession.onMessage(cb)` | `rendererEvents.queryBasedSessionMessage.listen(cb)` |
| `window.electronAPI.queryBasedSession.onComplete(cb)` | `rendererEvents.queryBasedSessionComplete.listen(cb)` |
| `window.electronAPI.queryBasedSession.getSdkSessionHistory(id, p)` | `client.getSdkSessionHistory.invoke({ sdkSessionId: id, projectPath: p })` |
| `window.electronAPI.queryBasedSession.getSdkSessions(p)` | `client.getSdkSessions.invoke({ projectPath: p })` |
| `window.electronAPI.conversations.getByBookId(id)` | `client.getByBookId.invoke({ bookId: id })` |
| `window.electronAPI.conversations.getById(id)` | `client.getById.invoke({ conversationId: id })` |
| `window.electronAPI.conversations.create(bId, t)` | `client.create.invoke({ bookId: bId, title: t })` |
| `window.electronAPI.conversations.updateTitle(id, t)` | `client.updateTitle.invoke({ conversationId: id, title: t })` |
| `window.electronAPI.conversations.updateSdkSessionId(id, s)` | `client.updateSdkSessionId.invoke({ conversationId: id, sdkSessionId: s })` |
| `window.electronAPI.conversations.delete(id)` | `client.deleteConversation.invoke({ conversationId: id })` |
| `window.electronAPI.conversations.getMessages(id)` | `client.getMessages.invoke({ conversationId: id })` |
| `window.electronAPI.conversations.addMessage(m)` | `client.addMessage.invoke({ message: m })` |
| `window.electronAPI.conversations.addMessages(ms)` | `client.addMessages.invoke({ messages: ms })` |
| `window.electronAPI.conversations.getBooksWithConversations(wId)` | `client.getBooksWithConversations.invoke({ workspaceId: wId })` |
| `window.electronAPI.conversations.createFork(p)` | `client.createFork.invoke(p)` |
| `window.electronAPI.conversations.createBranch(p)` | `client.createBranch.invoke(p)` |
| `window.electronAPI.conversations.getBranches(id, uuid)` | `client.getBranches.invoke({ conversationId: id, forkPointSdkUuid: uuid })` |
| `window.electronAPI.conversations.getBranchMessages(id)` | `client.getBranchMessages.invoke({ branchId: id })` |
| `window.electronAPI.conversations.addBranchMessage(m)` | `client.addBranchMessage.invoke({ message: m })` |

**每个文件独立 commit：**

```bash
git add components/reader.tsx && git commit -m "refactor(renderer): migrate reader.tsx to tipc client"
git add components/AgentChat.tsx && git commit -m "refactor(renderer): migrate AgentChat.tsx to tipc client"
# ... 以此类推
```

---

## Task 15: 删除旧文件

**Files to delete:**
- `electron/main/ipc/books.ts`
- `electron/main/ipc/ai.ts`
- `electron/main/ipc/files.ts`
- `electron/main/ipc/workspaces.ts`
- `electron/main/ipc/conversations.ts`
- `electron/main/ipc/agents.ts`
- `electron/main/ipc/index.ts`
- `types/electron-api.ts`
- `types/preload.d.ts`（window.electronAPI 声明，已被 electron.d.ts 替代）

**Step 1: 确认 TypeScript 编译通过**

```bash
npx tsc --noEmit -p tsconfig.electron.json
npx tsc --noEmit -p tsconfig.json
```

Expected: 无报错

**Step 2: 删除文件**

```bash
rm electron/main/ipc/books.ts electron/main/ipc/ai.ts electron/main/ipc/files.ts
rm electron/main/ipc/workspaces.ts electron/main/ipc/conversations.ts
rm electron/main/ipc/agents.ts electron/main/ipc/index.ts
rm electron/main/ipc/.gitkeep 2>/dev/null || true
rmdir electron/main/ipc
rm types/electron-api.ts types/preload.d.ts
```

**Step 3: 再次确认编译**

```bash
npx tsc --noEmit -p tsconfig.electron.json
npx tsc --noEmit -p tsconfig.json
```

**Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove legacy ipc/ handlers and hand-written type files"
```

---

## 完成验证

```bash
# 启动应用确认基础功能
npm run dev

# 检查没有残留的 window.electronAPI 调用（应只剩文档文件）
grep -r "window\.electronAPI" --include="*.ts" --include="*.tsx" . \
  --exclude-dir=node_modules --exclude-dir=docs
```

Expected: 无 `.ts`/`.tsx` 文件输出