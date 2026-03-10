# 移除 SQLite 全面迁移到 JSON 文件存储 — 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 彻底移除 SQLite（better-sqlite3），将所有数据迁移到 `.dogear/` 下的 JSON 文件，简化对话管理和书籍存储。

**Architecture:** 用 JSON 文件替代 SQLite 数据库。`conversations.json` 作为对话精简索引，SDK `.jsonl` 文件作为真实对话数据源。`workspaces.json` 管理工作区列表。books/chapters 数据迁移到每本书的 `.dogear/meta.json` 和 `.dogear/chapters.json`。SDK 会话历史从 `.claude-history` 移到 `.dogear/conversations`。

**Tech Stack:** TypeScript, Electron, Node.js fs/promises, JSON 文件存储, @anthropic-ai/claude-agent-sdk, @egoist/tipc, Zustand

**Design Doc:** `docs/plans/2026-03-10-remove-sqlite-design.md`

---

## 概览

### 改动影响范围

**新建文件：**
- `electron/main/services/conversation-service.ts` — 对话索引 CRUD
- `electron/main/services/workspace-json-service.ts` — 工作区 JSON 读写

**重写文件：**
- `electron/main/tipc/conversations.ts` — 从 db 调用改为 service 调用
- `electron/main/tipc/db.ts` → 删除
- `electron/main/tipc/book.ts` — 从 db 改为文件读取
- `electron/main/tipc/workspace.ts` — 从 db 改为 JSON 读写
- `electron/main/tipc/agent.ts` — getClaudeConfigDir 路径变更 + db 引用替换
- `electron/main/services/book-service.ts` — 从 db 改为 JSON 读写
- `electron/main/services/workspace-service.ts` — 移除 db 导入
- `electron/main/agents/tools/book-qa-tools.ts` — 从 db 改为文件读取
- `electron/main/agents/tools/book-analysis-tools.ts` — 无需改（已用文件系统）
- `electron/main/index.ts` — 移除 initDatabase 调用

**前端文件：**
- `stores/conversation-store.ts` — 移除 branch 相关逻辑
- `stores/workspace-store.ts` — 适配新的 Workspace 接口
- `lib/hooks.ts` — 从 db 接口改为文件接口
- `types/electron-api.ts` — 更新类型定义
- `electron/main/tipc/index.ts` — 移除 dbRouter 注册

**删除文件：**
- `electron/main/database/` — 整个目录
- `electron/main/database/schema.sql`
- `electron/main/database/index.ts`

---

## Task 1: 创建对话索引服务 (conversation-service.ts)

**Files:**
- Create: `electron/main/services/conversation-service.ts`

**Step 1: 创建 conversation-service.ts**

```typescript
// electron/main/services/conversation-service.ts
/**
 * 对话索引服务
 * 管理 .dogear/conversations.json 的读写
 * 只存储精简索引，实际对话内容由 SDK 的 .jsonl 管理
 */
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import electron from 'electron';

const { app } = electron;

// ============================================================
// 类型定义
// ============================================================

export interface ConversationIndex {
  id: string;
  title: string;
  sdkSessionId: string | null;
  workspaceId: string;
  bookId: string | null;
  parentConversationId: string | null;
  forkMessageSdkUuid: string | null;
  createdAt: string;  // ISO timestamp
  updatedAt: string;  // ISO timestamp
}

interface ConversationsFile {
  version: number;
  conversations: Record<string, ConversationIndex>;
}

// ============================================================
// 路径函数
// ============================================================

function getConfigDir(): string {
  if (app.isPackaged) {
    return path.join(path.dirname(app.getPath('exe')), '.dogear');
  }
  return path.join(process.cwd(), '.dogear');
}

function getConversationsPath(): string {
  return path.join(getConfigDir(), 'conversations.json');
}

// ============================================================
// 读写函数
// ============================================================

async function loadConversationsFile(): Promise<ConversationsFile> {
  try {
    const raw = await fs.readFile(getConversationsPath(), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { version: 1, conversations: {} };
  }
}

async function saveConversationsFile(data: ConversationsFile): Promise<void> {
  const configDir = getConfigDir();
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(getConversationsPath(), JSON.stringify(data, null, 2), 'utf-8');
}

// ============================================================
// CRUD 操作
// ============================================================

export async function getByWorkspaceId(workspaceId: string): Promise<ConversationIndex[]> {
  const file = await loadConversationsFile();
  return Object.values(file.conversations)
    .filter(c => c.workspaceId === workspaceId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function getByBookId(bookId: string): Promise<ConversationIndex[]> {
  const file = await loadConversationsFile();
  return Object.values(file.conversations)
    .filter(c => c.bookId === bookId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function getById(id: string): Promise<ConversationIndex | null> {
  const file = await loadConversationsFile();
  return file.conversations[id] || null;
}

export async function create(workspaceId: string, title?: string, bookId?: string): Promise<string> {
  const file = await loadConversationsFile();
  const id = uuidv4();
  const now = new Date().toISOString();

  file.conversations[id] = {
    id,
    title: title || '新对话',
    sdkSessionId: null,
    workspaceId,
    bookId: bookId || null,
    parentConversationId: null,
    forkMessageSdkUuid: null,
    createdAt: now,
    updatedAt: now,
  };

  await saveConversationsFile(file);
  return id;
}

export async function createFork(
  workspaceId: string,
  title: string,
  parentConversationId: string,
  forkMessageSdkUuid: string,
  bookId?: string,
): Promise<string> {
  const file = await loadConversationsFile();
  const id = uuidv4();
  const now = new Date().toISOString();

  file.conversations[id] = {
    id,
    title,
    sdkSessionId: null,
    workspaceId,
    bookId: bookId || null,
    parentConversationId,
    forkMessageSdkUuid,
    createdAt: now,
    updatedAt: now,
  };

  await saveConversationsFile(file);
  return id;
}

export async function updateTitle(id: string, title: string): Promise<void> {
  const file = await loadConversationsFile();
  if (file.conversations[id]) {
    file.conversations[id].title = title;
    file.conversations[id].updatedAt = new Date().toISOString();
    await saveConversationsFile(file);
  }
}

export async function updateSdkSessionId(id: string, sdkSessionId: string): Promise<void> {
  const file = await loadConversationsFile();
  if (file.conversations[id]) {
    file.conversations[id].sdkSessionId = sdkSessionId;
    file.conversations[id].updatedAt = new Date().toISOString();
    await saveConversationsFile(file);
  }
}

export async function touch(id: string): Promise<void> {
  const file = await loadConversationsFile();
  if (file.conversations[id]) {
    file.conversations[id].updatedAt = new Date().toISOString();
    await saveConversationsFile(file);
  }
}

export async function deleteConversation(id: string): Promise<void> {
  const file = await loadConversationsFile();

  // 子 fork 对话断链（parentConversationId 设为 null）
  for (const conv of Object.values(file.conversations)) {
    if (conv.parentConversationId === id) {
      conv.parentConversationId = null;
      conv.forkMessageSdkUuid = null;
    }
  }

  delete file.conversations[id];
  await saveConversationsFile(file);
}

export async function getAll(): Promise<ConversationIndex[]> {
  const file = await loadConversationsFile();
  return Object.values(file.conversations)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}
```

**Step 2: 验证文件编译**

Run: `npx tsc -p tsconfig.electron.json --noEmit 2>&1 | head -20`
Expected: 无与 conversation-service 相关的错误（可能有其他已知错误）

**Step 3: Commit**

```bash
git add electron/main/services/conversation-service.ts
git commit -m "feat: add conversation-service for JSON-based conversation index"
```

---

## Task 2: 创建工作区 JSON 服务 (workspace-json-service.ts)

**Files:**
- Create: `electron/main/services/workspace-json-service.ts`

**Step 1: 创建 workspace-json-service.ts**

```typescript
// electron/main/services/workspace-json-service.ts
/**
 * 工作区 JSON 存储服务
 * 管理 .dogear/workspaces.json 的读写
 * 替代原有的 SQLite workspaces 表
 */
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import electron from 'electron';

const { app } = electron;

// ============================================================
// 类型定义
// ============================================================

export interface WorkspaceData {
  id: string;
  name: string;
  path: string;
  isDefault: boolean;
  createdAt: string;  // ISO timestamp
}

interface WorkspacesFile {
  version: number;
  workspaces: WorkspaceData[];
}

// 兼容旧接口（供 tipc 和 workspace-service 使用）
export interface Workspace {
  id: string;
  name: string;
  path: string;
  is_default: number;
  created_at: number;
}

// ============================================================
// 路径函数
// ============================================================

function getConfigDir(): string {
  if (app.isPackaged) {
    return path.join(path.dirname(app.getPath('exe')), '.dogear');
  }
  return path.join(process.cwd(), '.dogear');
}

function getWorkspacesPath(): string {
  return path.join(getConfigDir(), 'workspaces.json');
}

// ============================================================
// 转换函数
// ============================================================

function toWorkspace(data: WorkspaceData): Workspace {
  return {
    id: data.id,
    name: data.name,
    path: data.path,
    is_default: data.isDefault ? 1 : 0,
    created_at: new Date(data.createdAt).getTime(),
  };
}

function toWorkspaceData(ws: Workspace): WorkspaceData {
  return {
    id: ws.id,
    name: ws.name,
    path: ws.path,
    isDefault: ws.is_default === 1,
    createdAt: new Date(ws.created_at).toISOString(),
  };
}

// ============================================================
// 读写函数
// ============================================================

async function loadWorkspacesFile(): Promise<WorkspacesFile> {
  try {
    const raw = await fs.readFile(getWorkspacesPath(), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { version: 1, workspaces: [] };
  }
}

async function saveWorkspacesFile(data: WorkspacesFile): Promise<void> {
  const configDir = getConfigDir();
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(getWorkspacesPath(), JSON.stringify(data, null, 2), 'utf-8');
}

// ============================================================
// CRUD 操作（返回兼容旧接口的 Workspace 类型）
// ============================================================

export async function getAll(): Promise<Workspace[]> {
  const file = await loadWorkspacesFile();
  return file.workspaces
    .sort((a, b) => {
      if (a.isDefault !== b.isDefault) return b.isDefault ? 1 : -1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    })
    .map(toWorkspace);
}

export async function getDefault(): Promise<Workspace | undefined> {
  const file = await loadWorkspacesFile();
  const defaultWs = file.workspaces.find(w => w.isDefault);
  return defaultWs ? toWorkspace(defaultWs) : undefined;
}

export async function getById(id: string): Promise<Workspace | undefined> {
  const file = await loadWorkspacesFile();
  const ws = file.workspaces.find(w => w.id === id);
  return ws ? toWorkspace(ws) : undefined;
}

export async function add(workspace: Omit<Workspace, 'id'> | Workspace): Promise<string> {
  const file = await loadWorkspacesFile();
  const id = (workspace as Workspace).id || uuidv4();
  const data: WorkspaceData = {
    id,
    name: workspace.name,
    path: workspace.path,
    isDefault: workspace.is_default === 1,
    createdAt: new Date(workspace.created_at).toISOString(),
  };
  file.workspaces.push(data);
  await saveWorkspacesFile(file);
  return id;
}

export async function setDefault(id: string): Promise<void> {
  const file = await loadWorkspacesFile();
  for (const ws of file.workspaces) {
    ws.isDefault = ws.id === id;
  }
  await saveWorkspacesFile(file);
}
```

**Step 2: 验证编译**

Run: `npx tsc -p tsconfig.electron.json --noEmit 2>&1 | head -20`

**Step 3: Commit**

```bash
git add electron/main/services/workspace-json-service.ts
git commit -m "feat: add workspace-json-service for JSON-based workspace storage"
```

---

## Task 3: 重写 workspace-service.ts（移除 db 依赖）

**Files:**
- Modify: `electron/main/services/workspace-service.ts`

**Step 1: 修改 workspace-service.ts**

修改导入，将 `dbWorkspaces` 替换为新的 workspace-json-service：

```typescript
// 旧：import { dbWorkspaces, Workspace } from '../database/index.js';
// 新：
import * as workspaceJsonService from './workspace-json-service.js';
import type { Workspace } from './workspace-json-service.js';
// 重新导出供其他模块使用
export type { Workspace };
```

修改 `getCurrentWorkspace()` 函数：

```typescript
// 旧：return dbWorkspaces.getDefault() || null;
// 新（注意：这里变成 async 调用）：
export async function getCurrentWorkspace(): Promise<Workspace | null> {
  return (await workspaceJsonService.getDefault()) || null;
}
```

**Step 2: 验证编译**

Run: `npx tsc -p tsconfig.electron.json --noEmit 2>&1 | head -20`

**Step 3: Commit**

```bash
git add electron/main/services/workspace-service.ts
git commit -m "refactor: workspace-service uses workspace-json-service instead of SQLite"
```

---

## Task 4: 重写 book-service.ts（移除 db 依赖）

**Files:**
- Modify: `electron/main/services/book-service.ts`

**Step 1: 重写 book-service.ts**

核心改动：
1. 移除 `import { dbBooks, dbChapters, Book, Chapter, ChapterMetadata } from '../database/index.js'`
2. 在本文件内定义 Book / Chapter / ChapterMetadata 接口（或从 types/ 导入）
3. 所有 `dbBooks.add()` → 写 meta.json
4. 所有 `dbBooks.update()` → 更新 meta.json
5. 所有 `dbBooks.getById()` → 读 meta.json
6. 所有 `dbChapters.bulkInsert()` → 写 chapters.json
7. 所有 `dbChapters.getChapterMetadata()` → 读 chapters.json
8. 所有 `dbChapters.getById()` → 从 chapters.json 读取

关键新增函数：

```typescript
// ============================================================
// JSON 文件操作（替代 SQLite）
// ============================================================

/** 从 meta.json 读取书籍信息 */
export async function getBookById(bookId: string): Promise<Book | undefined> {
  const workspace = await workspaceService.getCurrentWorkspace();
  if (!workspace) return undefined;
  const meta = await workspaceService.loadBookMeta(workspace, bookId);
  return meta ? (meta as Book) : undefined;
}

/** 获取工作区所有书籍（扫描子目录的 meta.json） */
export async function getAllBooks(workspaceId?: string): Promise<Book[]> {
  const workspace = workspaceId
    ? await workspaceJsonService.getById(workspaceId)
    : await workspaceService.getCurrentWorkspace();
  if (!workspace) return [];

  const entries = await fs.promises.readdir(workspace.path, { withFileTypes: true });
  const books: Book[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const meta = await workspaceService.loadBookMeta(workspace, entry.name);
    if (meta && meta.id) {
      books.push(meta as Book);
    }
  }

  return books.sort((a, b) =>
    new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  );
}

/** 保存章节到 chapters.json */
async function saveChapters(workspace: any, bookId: string, chapters: Chapter[]): Promise<void> {
  const dogearDir = workspaceService.getDogearDir(workspace, bookId);
  const chaptersPath = path.join(dogearDir, 'chapters.json');
  await fs.promises.mkdir(dogearDir, { recursive: true });
  await fs.promises.writeFile(chaptersPath, JSON.stringify({ bookId, chapters }, null, 2), 'utf-8');
}

/** 从 chapters.json 读取章节元数据 */
export async function getChapterMetadataFromFile(bookId: string): Promise<ChapterMetadata[]> {
  const workspace = await workspaceService.getCurrentWorkspace();
  if (!workspace) return [];
  const dogearDir = workspaceService.getDogearDir(workspace, bookId);
  const chaptersPath = path.join(dogearDir, 'chapters.json');
  try {
    const raw = await fs.promises.readFile(chaptersPath, 'utf-8');
    const data = JSON.parse(raw);
    return (data.chapters || []).map((ch: Chapter) => ({
      id: ch.id,
      book_id: ch.book_id,
      chapter_index: ch.chapter_index,
      title: ch.title,
      character_count: ch.character_count,
      preview_text: ch.preview_text,
    }));
  } catch {
    return [];
  }
}

/** 从 chapters.json 读取完整章节 */
export async function getChapterFromFile(chapterId: string, bookId?: string): Promise<Chapter | undefined> {
  // 需要遍历工作区找到包含此 chapterId 的 chapters.json
  const workspace = await workspaceService.getCurrentWorkspace();
  if (!workspace) return undefined;

  // 如果提供了 bookId，直接读取
  if (bookId) {
    const dogearDir = workspaceService.getDogearDir(workspace, bookId);
    const chaptersPath = path.join(dogearDir, 'chapters.json');
    try {
      const raw = await fs.promises.readFile(chaptersPath, 'utf-8');
      const data = JSON.parse(raw);
      return (data.chapters || []).find((ch: Chapter) => ch.id === chapterId);
    } catch {
      return undefined;
    }
  }

  // 没有 bookId，遍历所有书籍目录
  const entries = await fs.promises.readdir(workspace.path, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dogearDir = workspaceService.getDogearDir(workspace, entry.name);
    const chaptersPath = path.join(dogearDir, 'chapters.json');
    try {
      const raw = await fs.promises.readFile(chaptersPath, 'utf-8');
      const data = JSON.parse(raw);
      const chapter = (data.chapters || []).find((ch: Chapter) => ch.id === chapterId);
      if (chapter) return chapter;
    } catch {
      continue;
    }
  }

  return undefined;
}
```

`importBook()` 改动要点：
- 原：`const bookId = dbBooks.add(bookData)` → 新：`const bookId = uuidv4()` + 写 meta.json
- 原：`const book = dbBooks.getById(bookId)!` → 新：直接构造 book 对象
- 原：`dbBooks.update(bookId, {...})` → 新：读 meta.json + merge + 写 meta.json

`processTxtBook()` 改动要点：
- 原：`dbChapters.bulkInsert(chapters)` → 新：`saveChapters(workspace, bookId, chapters)`
- 原：`dbBooks.update(bookId, { total_chapters, total_characters })` → 新：更新 meta.json

`updateProgress()` 改动要点：
- 原：`dbBooks.update(bookId, {...})` → 新：更新 meta.json

导出函数改动：
- `getChapterMetadata(bookId)` → 调用 `getChapterMetadataFromFile(bookId)`
- `getChapter(chapterId)` → 调用 `getChapterFromFile(chapterId)`
- `saveReadingProgress(bookId, chapterId)` → 更新 meta.json

**Step 2: 验证编译**

Run: `npx tsc -p tsconfig.electron.json --noEmit 2>&1 | head -20`

**Step 3: Commit**

```bash
git add electron/main/services/book-service.ts
git commit -m "refactor: book-service uses JSON files instead of SQLite"
```

---

## Task 5: 重写 tipc/conversations.ts

**Files:**
- Modify: `electron/main/tipc/conversations.ts`

**Step 1: 重写对话路由**

核心改动：
1. 移除所有 `db*` 导入
2. 导入 `conversation-service`
3. 所有处理函数改为调用 conversation-service
4. 移除 branch 相关 RPC（createBranch, getBranches, getBranchMessages, addBranchMessage）
5. 移除 message 相关 RPC（getMessages, addMessage, addMessages）— 消息由 SDK 管理
6. 移除 getBooksWithConversations（不再需要）

保留的 RPC：
- `getByBookId` → `conversationService.getByBookId()`
- `getById` → `conversationService.getById()`
- `create` → `conversationService.create()`
- `updateTitle` → `conversationService.updateTitle()`
- `updateSdkSessionId` → `conversationService.updateSdkSessionId()`
- `deleteConversation` → `conversationService.deleteConversation()`
- `getByWorkspaceId` → `conversationService.getByWorkspaceId()`
- `createFork` → `conversationService.createFork()`

**Step 2: 验证编译**

**Step 3: Commit**

```bash
git add electron/main/tipc/conversations.ts
git commit -m "refactor: conversations router uses conversation-service instead of SQLite"
```

---

## Task 6: 重写 tipc/workspace.ts

**Files:**
- Modify: `electron/main/tipc/workspace.ts`

**Step 1: 重写工作区路由**

核心改动：
1. 移除 `import { dbWorkspaces, dbBooks } from '../database/index.js'`
2. 导入 `workspace-json-service` 和 `book-service`
3. `getAll()` → `workspaceJsonService.getAll()`
4. `getDefault()` → `workspaceJsonService.getDefault()`
5. `selectFolder()` → `workspaceJsonService.getAll()` + `workspaceJsonService.add()` + `workspaceJsonService.setDefault()`
6. `setDefault()` → `workspaceJsonService.setDefault()`
7. `getFiles()` → `workspaceJsonService.getById()` + `bookService.getAllBooks()` 代替 `dbBooks.getAll()`

**Step 2: 验证编译**

**Step 3: Commit**

```bash
git add electron/main/tipc/workspace.ts
git commit -m "refactor: workspace router uses workspace-json-service instead of SQLite"
```

---

## Task 7: 重写 tipc/book.ts

**Files:**
- Modify: `electron/main/tipc/book.ts`

**Step 1: 重写书籍路由**

核心改动：
1. 移除 `import { dbBooks } from '../database/index.js'`
2. 改为导入 `bookService` 中的新函数
3. `getChapterMetadata` → `bookService.getChapterMetadata()` (已改为读 JSON)
4. `getChapter` → `bookService.getChapter()` (已改为读 JSON)
5. `saveProgress` → `bookService.saveReadingProgress()` (已改为写 meta.json)
6. `getBookByFilePath` → `bookService.getAllBooks()` 代替 `dbBooks.getAll()` 进行查找
7. `getWorkspaceFilePath` → `bookService.getBookById()` 代替 `dbBooks.getById()`

**Step 2: 验证编译**

**Step 3: Commit**

```bash
git add electron/main/tipc/book.ts
git commit -m "refactor: book router uses book-service JSON instead of SQLite"
```

---

## Task 8: 重写 tipc/db.ts → 删除并创建兼容路由

**Files:**
- Modify: `electron/main/tipc/db.ts` — 重写为使用 book-service
- Modify: `electron/main/tipc/index.ts` — 保持 dbRouter 注册（RPC 名称不变）

**Step 1: 重写 db.ts**

将所有 `dbBooks.*` 调用替换为 `bookService` 函数：

```typescript
// electron/main/tipc/db.ts
import { tipc } from '@egoist/tipc/main';
import * as bookService from '../services/book-service.js';

const t = tipc.create();

export const dbRouter = {
  getBooks: t.procedure
    .action(async () => {
      return bookService.getAllBooks();
    }),

  getBookById: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
      return bookService.getBookById(input.id);
    }),

  addBook: t.procedure
    .input<{ book: any }>()
    .action(async ({ input }) => {
      // 用户通过 importBook 导入，此 RPC 保留兼容性
      return bookService.importBook(input.book.original_file_path, input.book.workspace_id);
    }),

  updateBook: t.procedure
    .input<{ id: string; data: any }>()
    .action(async ({ input }) => {
      return bookService.updateBookMeta(input.id, input.data);
    }),

  deleteBook: t.procedure
    .input<{ id: string }>()
    .action(async ({ input }) => {
      return bookService.deleteBook(input.id);
    }),
};
```

注意：`bookService` 需要导出 `updateBookMeta()` 和 `deleteBook()` 函数。在 Task 4 中确保这些函数存在。

**Step 2: 验证编译**

**Step 3: Commit**

```bash
git add electron/main/tipc/db.ts
git commit -m "refactor: db router delegates to book-service JSON instead of SQLite"
```

---

## Task 9: 重写 tipc/agent.ts（路径变更 + db 引用替换）

**Files:**
- Modify: `electron/main/tipc/agent.ts`

**Step 1: 修改 getClaudeConfigDir()**

```typescript
// 旧：
export function getClaudeConfigDir(): string {
  const appDir = app.isPackaged
    ? path.dirname(app.getPath('exe'))
    : process.cwd();
  return path.join(appDir, '.claude-history');
}

// 新：
export function getClaudeConfigDir(): string {
  const appDir = app.isPackaged
    ? path.dirname(app.getPath('exe'))
    : process.cwd();
  return path.join(appDir, '.dogear', 'conversations');
}
```

**Step 2: 替换所有 db 引用**

1. `createMainProcessSession` 中的 `dbWorkspaces.getDefault()` → `workspaceJsonService.getDefault()`
2. `createQueryBasedSession` 中的 `dbWorkspaces.getDefault()` → `workspaceJsonService.getDefault()`
3. `session_init` 事件处理中的 `dbConversationBranches.updatePendingSdkSessionId()` → 移除分支逻辑
4. `session_init` 事件处理中的 `dbConversations.updateSdkSessionId()` → `conversationService.updateSdkSessionId()`
5. `getBookFilePath` 中的 `dbBooks.getById()` → `bookService.getBookById()`
6. `getSdkSessionHistory` 中的 `dbWorkspaces.getDefault()` → `workspaceJsonService.getDefault()`
7. `getSdkSessions` 中的 `dbWorkspaces.getDefault()` → `workspaceJsonService.getDefault()`

**session_init 事件处理简化：**

```typescript
// 旧（包含分支逻辑）：
session.on('session_init', async (data: { session_id: string }) => {
  if (input.conversationId) {
    if (input.forkSession && !input.isForkNewConversation) {
      const { dbConversationBranches } = await import('../database/index.js');
      dbConversationBranches.updatePendingSdkSessionId(input.conversationId, data.session_id);
    } else {
      const { dbConversations } = await import('../database/index.js');
      dbConversations.updateSdkSessionId(input.conversationId, data.session_id);
    }
  }
  context.sender.send('agent:queryBasedSessionInit', {...});
});

// 新（统一为 conversationService）：
session.on('session_init', async (data: { session_id: string }) => {
  if (input.conversationId) {
    const conversationService = await import('../services/conversation-service.js');
    await conversationService.updateSdkSessionId(input.conversationId, data.session_id);
  }
  context.sender.send('agent:queryBasedSessionInit', {...});
});
```

**Step 3: 验证编译**

**Step 4: Commit**

```bash
git add electron/main/tipc/agent.ts
git commit -m "refactor: agent router uses JSON services, move config dir to .dogear/conversations"
```

---

## Task 10: 重写 book-qa-tools.ts（移除 db 依赖）

**Files:**
- Modify: `electron/main/agents/tools/book-qa-tools.ts`

**Step 1: 替换 db 调用**

1. `searchInFullContent()` 中的 `dbChapters.getChapterMetadata()` + `dbChapters.getById()` → 读 chapters.json
2. `ListBooks` 工具中的 `dbBooks.getAll()` → `bookService.getAllBooks()`
3. `GetCitationContext` 工具中的 `dbChapters.getById()` → `bookService.getChapterFromFile()`
4. `GetBookInfo` 工具中的 `dbBooks.getById()` → `bookService.getBookById()`

```typescript
// 旧：
const { dbChapters } = await import('../../database/index.js');
const chapters = dbChapters.getChapterMetadata(bookId);
// 新：
const bookService = await import('../../services/book-service.js');
const chapters = await bookService.getChapterMetadataFromFile(bookId);
```

**Step 2: 验证编译**

**Step 3: Commit**

```bash
git add electron/main/agents/tools/book-qa-tools.ts
git commit -m "refactor: book-qa-tools uses book-service JSON instead of SQLite"
```

---

## Task 11: 修改 Electron 入口文件（移除 initDatabase）

**Files:**
- Modify: `electron/main/index.ts`

**Step 1: 移除数据库初始化**

```typescript
// 移除：import { initDatabase } from './database/index.js';

// 在 app.whenReady() 中移除：
// await initDatabase();
```

**Step 2: 验证编译**

**Step 3: Commit**

```bash
git add electron/main/index.ts
git commit -m "refactor: remove initDatabase from electron entry point"
```

---

## Task 12: 修改 tipc/index.ts（保持 dbRouter 兼容）

**Files:**
- Modify: `electron/main/tipc/index.ts`

**Step 1: 确认 dbRouter 仍注册（因为 Task 8 已重写为使用 book-service）**

保留现有注册不变。dbRouter 已在 Task 8 中重写，RPC 名称不变，前端无需改动。

验证 index.ts 不再间接依赖 database/index.js（通过路由文件的新导入链）。

**Step 2: 验证编译**

**Step 3: Commit（如有改动）**

---

## Task 13: 更新前端类型定义

**Files:**
- Modify: `types/electron-api.ts`

**Step 1: 更新类型**

1. 更新 `Conversation` 接口，添加 `workspace_id` 字段
2. 移除 `ConversationBranch` 和 `BranchMessage` 接口（不再需要）
3. 移除 `ConversationMessage` 接口（消息由 SDK 管理，前端不直接操作）

```typescript
// 更新 Conversation 接口
export interface Conversation {
  id: string;
  title: string;
  sdkSessionId?: string | null;       // 改为 camelCase
  sdk_session_id?: string;             // 保留兼容
  workspaceId?: string;                // 改为 camelCase
  workspace_id?: string;               // 保留兼容
  bookId?: string | null;              // 改为 camelCase
  book_id?: string;                    // 保留兼容
  parentConversationId?: string | null;
  parent_conversation_id?: string;     // 保留兼容
  forkMessageSdkUuid?: string | null;
  fork_message_sdk_uuid?: string;      // 保留兼容
  model?: string;
  createdAt?: string;
  created_at?: number;                 // 保留兼容
  updatedAt?: string;
  updated_at?: number;                 // 保留兼容
}
```

**Step 2: Commit**

```bash
git add types/electron-api.ts
git commit -m "refactor: update electron-api types for JSON storage migration"
```

---

## Task 14: 更新前端 conversation-store.ts

**Files:**
- Modify: `stores/conversation-store.ts`

**Step 1: 简化 store**

1. 移除 `editResend` action（编辑重发改为 resume + resumeSessionAt 截断）
2. 简化 `forkConversation`（不再创建 branch）
3. 适配 `Conversation` 类型字段（兼容 camelCase + snake_case）

新增编辑重发逻辑（使用 resume 截断）：

```typescript
editResend: async (params) => {
  const { selectedConversation } = get();
  if (!selectedConversation) return;

  const sdkSessionId = selectedConversation.sdkSessionId || selectedConversation.sdk_session_id;
  if (!sdkSessionId) {
    alert('该对话不支持编辑重发（缺少 SDK session）');
    return;
  }

  // 直接设置 forkParams，使用 resume + resumeSessionAt 截断（不 fork）
  set({
    forkParams: {
      sdkSessionIdToResume: sdkSessionId,
      forkSession: false,  // 不创建新会话，直接截断重写
      resumeSessionAt: params.forkPointSdkUuid,
      editedMessage: params.editedMessage,
    },
  });
},
```

**Step 2: Commit**

```bash
git add stores/conversation-store.ts
git commit -m "refactor: conversation-store uses JSON service, simplify edit-resend"
```

---

## Task 15: 更新前端 lib/hooks.ts

**Files:**
- Modify: `lib/hooks.ts`

**Step 1: 适配新的 RPC 调用**

hooks.ts 使用 `client.getBooks()`, `client.getBookById()`, `client.addBook()`, `client.deleteBook()`, `client.updateBook()` — 这些 RPC 名称不变（Task 8 保持了兼容），所以 hooks.ts 理论上不需要改动。

验证一下即可。如果有类型不匹配则调整。

**Step 2: Commit（如有改动）**

---

## Task 16: 删除 SQLite 相关文件和依赖

**Files:**
- Delete: `electron/main/database/index.ts`
- Delete: `electron/main/database/schema.sql`
- Modify: `package.json` — 移除 better-sqlite3 相关

**Step 1: 删除数据库文件**

```bash
rm -rf electron/main/database/
```

**Step 2: 移除 package.json 依赖**

从 `package.json` 中移除：
- `dependencies` → `"better-sqlite3": "^12.6.0"`
- `devDependencies` → `"@types/better-sqlite3": "^7.6.13"`
- `scripts.postinstall` → `"electron-rebuild -f -w better-sqlite3"` （如果只为 better-sqlite3 服务）
- `scripts.build:electron` → 移除 `cpy "electron/main/database/*.sql" dist/main/database/` 部分

**Step 3: 更新 build:electron 脚本**

```json
// 旧：
"build:electron": "tsc -p tsconfig.electron.json && cpy \"electron/main/database/*.sql\" dist/main/database/"
// 新：
"build:electron": "tsc -p tsconfig.electron.json"
```

**Step 4: 删除 .claude/rules/database-changes.md（不再适用）**

```bash
rm .claude/rules/database-changes.md
```

**Step 5: 重新安装依赖**

Run: `npm install`

**Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove SQLite (better-sqlite3) dependency and database files"
```

---

## Task 17: 编译验证和修复

**Step 1: 完整编译**

Run: `npm run build:electron`
Expected: 编译成功，无错误

**Step 2: 修复所有编译错误**

如果有错误，逐一修复：
- 主要是残留的 `database/index.js` 导入
- 类型不匹配（同步 vs 异步）
- 缺少导出的函数

**Step 3: Commit 修复**

```bash
git add -A
git commit -m "fix: resolve compilation errors after SQLite removal"
```

---

## Task 18: 更新 CLAUDE.md 和内存文件

**Files:**
- Modify: `.claude/CLAUDE.md` — 更新技术栈和文件结构描述
- Modify: `C:\Users\Dreama\.claude\projects\c--dogear\memory\MEMORY.md` — 更新架构记忆

**Step 1: 更新 CLAUDE.md**

- 技术栈表移除 `better-sqlite3` 相关行
- 添加 `JSON 文件存储` 说明
- 更新项目结构概览
- 更新核心文件功能索引
- 更新关键数据流说明
- 更新禁止事项（移除数据库相关规则）

**Step 2: 更新 MEMORY.md**

- 更新"已完成的主要功能"
- 添加架构决策记录
- 更新调试排查经验

**Step 3: Commit**

```bash
git add .claude/CLAUDE.md
git commit -m "docs: update CLAUDE.md for JSON storage migration"
```

---

## Task 19: 运行时测试

**Step 1: 启动开发服务器**

Run: `npm run dev`

**Step 2: 手动测试清单**

- [ ] 应用启动无报错
- [ ] 选择/创建工作区正常
- [ ] 导入书籍正常（meta.json + chapters.json 创建）
- [ ] 书籍在文件树中显示
- [ ] 创建新对话正常（conversations.json 更新）
- [ ] 对话列表加载正常
- [ ] 发送消息正常（SDK 会话创建，sdkSessionId 回填）
- [ ] Resume 对话正常
- [ ] Fork 对话正常
- [ ] 编辑重发（resume + resumeSessionAt）正常
- [ ] 删除对话正常
- [ ] SDK 会话历史文件在 `.dogear/conversations/` 下创建

**Step 3: 修复发现的问题**

**Step 4: Final commit**

```bash
git add -A
git commit -m "fix: runtime fixes after SQLite removal migration"
```

---

## 重要注意事项

### 兼容性
- 前端 tipc client 通过 RPC 名称调用，只要 RPC 名称和返回结构不变，前端不需要大改
- `Conversation` 类型同时支持 camelCase 和 snake_case 字段，平滑过渡
- `dbRouter` 保留名称兼容（getBooks, getBookById 等），内部实现改为 JSON

### 数据迁移
- **不做自动迁移**。这是一个彻底的架构变更，旧的 SQLite 数据不自动迁移
- 用户需要重新导入书籍、创建对话
- SDK 的 `.jsonl` 会话历史可以通过索引重建功能恢复

### 风险点
1. `book-service.ts` 改动最大 — 从同步 SQLite API 改为异步文件 API，需要仔细处理 async/await
2. `agent.ts` 中 `getClaudeConfigDir()` 路径变更会影响 SDK 查找会话文件的位置
3. `book-qa-tools.ts` 中的全文搜索性能 — 从 SQLite 查询改为遍历 JSON 文件，大量章节时可能变慢
