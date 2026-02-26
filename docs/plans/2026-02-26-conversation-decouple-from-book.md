# 对话与书籍解耦 - 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将对话从"必须绑定书籍"改为"直接属于工作区"，用户选择工作区后可以直接开始对话，无需先导入书籍。

**Architecture:** 对话表新增 `workspace_id` 字段，`book_id` 改为可空。左侧列表从书籍分组树形结构改为按时间排序的平铺对话列表。MCP Tools 从根据单本书籍加载改为根据工作区加载所有已导入书籍。

**Tech Stack:** Electron + Next.js + shadcn/ui + better-sqlite3 + @egoist/tipc + @anthropic-ai/claude-agent-sdk

---

### Task 1: 数据库迁移 - conversations 表结构变更

**Files:**
- Modify: `electron/main/database/index.ts:201-240` (迁移逻辑区域)
- Modify: `electron/main/database/index.ts:109-119` (Conversation 接口)
- Modify: `electron/main/database/schema.sql:95-105` (conversations 建表语句)

**Step 1: 修改 Conversation 接口，book_id 改为可选，新增 workspace_id**

在 `electron/main/database/index.ts` 中修改 `Conversation` 接口：

```typescript
export interface Conversation {
  id: string;
  book_id?: string;                  // 改为可选，可为 null
  workspace_id: string;              // 新增：关联的工作区ID
  title: string;
  model: string;
  sdk_session_id?: string;
  parent_conversation_id?: string;
  fork_message_sdk_uuid?: string;
  created_at: number;
  updated_at: number;
}
```

**Step 2: 在 schema.sql 中更新 conversations 表定义**

将 `book_id TEXT NOT NULL` 改为 `book_id TEXT`，新增 `workspace_id TEXT`：

```sql
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  book_id TEXT,                                   -- 可选：关联的书籍ID
  workspace_id TEXT,                              -- 关联的工作区ID
  title TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT 'claude-sonnet-4-5-20250929',
  sdk_session_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE SET NULL
);
```

注意：外键约束从 `ON DELETE CASCADE` 改为 `ON DELETE SET NULL`（删除书籍时不删除对话，而是清空 book_id）。

**Step 3: 在 initDatabase 的 v4 迁移区域添加 v5 迁移**

在 `electron/main/database/index.ts` 的 `initDatabase` 函数中，v4 迁移块之后添加：

```typescript
// ==================== v5 迁移：对话与书籍解耦 ====================
// 给 conversations 表添加 workspace_id 字段
try { db.exec(`ALTER TABLE conversations ADD COLUMN workspace_id TEXT`); } catch { /* 列已存在 */ }

// 为现有对话补充 workspace_id（从关联的 book 获取）
db.exec(`
  UPDATE conversations
  SET workspace_id = (
    SELECT workspace_id FROM books WHERE books.id = conversations.book_id
  )
  WHERE workspace_id IS NULL AND book_id IS NOT NULL
`);

// 创建索引
db.exec(`CREATE INDEX IF NOT EXISTS idx_conversations_workspace_id ON conversations(workspace_id)`);
```

**Step 4: 验证**

启动应用，检查数据库迁移是否成功执行，现有对话是否正确补充了 workspace_id。

---

### Task 2: 数据库操作层 - dbConversations 适配

**Files:**
- Modify: `electron/main/database/index.ts:553-656` (dbConversations 操作集合)

**Step 1: 修改 create 方法，接收 workspaceId，bookId 改为可选**

```typescript
create: (workspaceId: string, title: string, bookId?: string, model: string = 'claude-sonnet-4-5-20250929'): string => {
  const newId = uuidv4();
  const now = Date.now();
  const stmt = getDb().prepare(`
    INSERT INTO conversations (id, workspace_id, book_id, title, model, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(newId, workspaceId, bookId || null, title, model, now, now);
  return newId;
},
```

**Step 2: 新增 getByWorkspaceId 方法**

```typescript
getByWorkspaceId: (workspaceId: string): Conversation[] => {
  const stmt = getDb().prepare('SELECT * FROM conversations WHERE workspace_id = ? ORDER BY updated_at DESC');
  return stmt.all(workspaceId) as Conversation[];
},
```

**Step 3: 修改 createFork 方法，bookId 改为可选**

```typescript
createFork: (
  workspaceId: string,
  title: string,
  parentConversationId: string,
  forkMessageSdkUuid: string,
  bookId?: string,
  model: string = 'claude-sonnet-4-5-20250929'
): string => {
  const newId = uuidv4();
  const now = Date.now();
  const stmt = getDb().prepare(`
    INSERT INTO conversations (id, workspace_id, book_id, title, model, parent_conversation_id, fork_message_sdk_uuid, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(newId, workspaceId, bookId || null, title, model, parentConversationId, forkMessageSdkUuid, now, now);
  return newId;
},
```

---

### Task 3: TIPC 路由层适配

**Files:**
- Modify: `electron/main/tipc/conversations.ts:14-214`

**Step 1: 修改 create 接口，接收 workspaceId**

```typescript
create: t.procedure
  .input<{ workspaceId: string; bookId?: string; title?: string }>()
  .action(async ({ input }) => {
    try {
      const conversationId = dbConversations.create(
        input.workspaceId,
        input.title || '新对话',
        input.bookId
      );
      return { conversationId, error: undefined };
    } catch (error) {
      console.error('创建对话失败:', error);
      return { conversationId: null, error: error instanceof Error ? error.message : String(error) };
    }
  }),
```

注意：去掉了原来的 `dbBooks.getById` 校验，因为 bookId 现在是可选的。

**Step 2: 新增 getByWorkspaceId 接口**

```typescript
getByWorkspaceId: t.procedure
  .input<{ workspaceId: string }>()
  .action(async ({ input }) => {
    try {
      const conversations = dbConversations.getByWorkspaceId(input.workspaceId);
      return { conversations, error: undefined };
    } catch (error) {
      console.error('获取工作区对话列表失败:', error);
      return { conversations: [], error: error instanceof Error ? error.message : String(error) };
    }
  }),
```

**Step 3: 修改 createFork 接口**

```typescript
createFork: t.procedure
  .input<{ workspaceId: string; title: string; parentConversationId: string; forkMessageSdkUuid: string; bookId?: string }>()
  .action(async ({ input }) => {
    try {
      const conversationId = dbConversations.createFork(
        input.workspaceId,
        input.title,
        input.parentConversationId,
        input.forkMessageSdkUuid,
        input.bookId
      );
      return { conversationId, error: undefined };
    } catch (error) {
      console.error('创建分叉对话失败:', error);
      return { conversationId: null, error: error instanceof Error ? error.message : String(error) };
    }
  }),
```

**Step 4: getBooksWithConversations 可保留（用于书籍管理页面）但不再作为主列表接口**

无需删除，保留向后兼容。

---

### Task 4: MCP Tools 改为基于工作区加载所有书籍

**Files:**
- Modify: `electron/main/agents/tools/book-qa-tools.ts:178-443`
- Modify: `electron/main/tipc/agent.ts:377-384` (MCP Server 构建逻辑)

**Step 1: 修改 createBookQATools，支持工作区下所有书籍**

将 `createBookQATools(workspacePath: string, bookId: string)` 签名改为 `createBookQATools(workspacePath: string, workspaceId: string)`。

内部的 `SearchBookContent` 工具中，`bookId` 参数变为必填（由 AI 自行从 `ListBooks` 工具获取），同时新增一个 `ListBooks` 工具返回当前工作区下所有已导入的书籍列表。

在 `book-qa-tools.ts` 中新增 `ListBooks` 工具：

```typescript
tool(
  'ListBooks',
  '列出当前工作区中所有已导入的书籍\n返回书籍ID、书名、作者等信息，用于确定要搜索的书籍。',
  {
    workspaceId: z.string().optional().describe('工作区ID（可选，不提供则使用当前工作区）'),
  },
  async (args, extra) => {
    try {
      const { dbBooks } = await import('../../database/index.js');
      const allBooks = dbBooks.getAll();
      const targetWorkspaceId = args.workspaceId ?? workspaceId;
      const books = allBooks.filter(b => b.workspace_id === targetWorkspaceId);

      if (books.length === 0) {
        return {
          content: [{ type: 'text', text: '当前工作区没有已导入的书籍。' }],
        };
      }

      const list = books.map((b, i) =>
        `${i + 1}. 《${b.title}》${b.author ? ` - ${b.author}` : ''}\n   ID: ${b.id}\n   章节数: ${b.total_chapters}, 字符数: ${b.total_characters}\n   分析状态: ${b.analysis_status || 'none'}`
      ).join('\n\n');

      return {
        content: [{ type: 'text', text: `📚 工作区书籍列表（共 ${books.length} 本）：\n\n${list}` }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `❌ 获取书籍列表失败: ${error}` }],
        isError: true,
      };
    }
  }
),
```

**Step 2: 修改 agent.ts 中的 MCP Server 构建逻辑**

```typescript
// 构建 MCP Servers 配置
const mcpServers: Record<string, any> = {};
if ((input.enableSkills ?? true) && workspacePath) {
  // 改为传递 workspaceId，不再依赖单本书籍的 bookId
  const { dbWorkspaces } = await import('../database/index.js');
  const defaultWorkspace = dbWorkspaces.getDefault();
  const workspaceId = defaultWorkspace?.id || 'default';
  const bookQATools = createBookQATools(workspacePath, workspaceId);
  mcpServers['dogear-book-qa'] = bookQATools;
  console.log('已添加 book-qa MCP tools, workspaceId:', workspaceId);
}
```

**Step 3: 更新 BOOK_QA_SYSTEM_PROMPT**

在提示中添加 `ListBooks` 工具的说明，让 AI 知道可以列出所有书籍。

---

### Task 5: 前端 - 新建 ConversationList 组件（替代 BookConversationList）

**Files:**
- Modify: `components/BookConversationList.tsx` → 重构为平铺对话列表

**Step 1: 重构 BookConversationList.tsx**

将文件内容完全重写为 `ConversationList` 组件。保留原文件路径避免影响 git 历史。

组件接口：
```typescript
export interface Conversation {
  id: string;
  book_id?: string;          // 改为可选
  workspace_id: string;      // 新增
  title: string;
  model: string;
  sdk_session_id?: string;
  parent_conversation_id?: string;
  fork_message_sdk_uuid?: string;
  created_at: number;
  updated_at: number;
}

interface ConversationListProps {
  conversations: Conversation[];
  selectedConversationId?: string | null;
  onConversationSelect?: (conversation: Conversation) => void;
  onNewConversation?: () => void;          // 不再需要 bookId 参数
  onDeleteConversation?: (conversationId: string) => void;
  loading?: boolean;
}
```

UI 布局：
- 顶部：`+ 新建对话` 按钮
- 列表区域：平铺的对话列表，按 updated_at 倒序
- 每个对话项：图标 + 标题 + 相对时间 + hover 时显示删除按钮
- 分叉对话使用 GitBranch 图标
- 空状态：提示"暂无对话，点击上方按钮开始"

---

### Task 6: 前端 - page.tsx 主界面适配

**Files:**
- Modify: `app/page.tsx`

**Step 1: 状态管理变更**

- 去掉 `bookNodes` 状态，改为 `conversations: Conversation[]`
- 去掉 `handleToggleExpand` 回调
- `loadBooksWithConversations` 改为 `loadConversations`，调用新的 `client.getByWorkspaceId({ workspaceId })`
- `handleNewConversation` 不再需要 `bookId` 参数，改为 `handleNewConversation()`，调用 `client.create({ workspaceId: workspace.id })`

**Step 2: 左侧栏变更**

- 标题从"书籍列表"改为"对话列表"
- 替换 `BookConversationList` 为新的 `ConversationList`
- 导入按钮保留在顶部导航栏

**Step 3: 对话选择后的行为变更**

- `handleConversationSelect` 中不再强制加载书籍信息
- 如果对话有 `book_id`，可选加载书籍信息用于右侧预览

**Step 4: AgentChat 的 context 传递变更**

- `context.bookId` 不再是必须的，改为可选传递
- 新增传递 `workspaceId` 到 AgentChat（如果需要）

**Step 5: 右侧预览区域变更**

- 当没有选中书籍时，显示"选择一个对话开始聊天"或者书籍管理入口
- 保留书籍预览功能（当对话有关联书籍时）
- 增加"书籍管理"入口按钮（打开书籍导入/删除等功能）

**Step 6: 分叉和编辑重发的适配**

- `handleForkConversation` 中获取父对话的 `workspace_id` 而不仅是 `book_id`
- `createFork` 传递 `workspaceId`

---

### Task 7: 前端 - AgentChat 组件适配

**Files:**
- Modify: `components/AgentChat.tsx:59-67` (AgentChatProps.context)
- Modify: `components/AgentChat.tsx:821-945` (startSession)

**Step 1: context 接口变更**

```typescript
context?: {
  bookId?: string;        // 保持可选
  workspaceId?: string;   // 新增：工作区ID
  chapterId?: string;
  selectedText?: string;
};
```

**Step 2: startSession 中不再强制依赖 bookId**

会话创建时 `context.bookId` 可以为 undefined，MCP Tools 根据 workspaceId 加载。

---

### Task 8: 构建验证

**Step 1: 运行构建**

```bash
npm run build
```

修复所有类型错误。

**Step 2: 手动测试**

1. 启动应用，选择工作区
2. 验证可以直接创建对话（不需要先导入书籍）
3. 验证对话列表按时间排序正确
4. 验证导入书籍后 MCP Tools 可以正常搜索
5. 验证分叉和编辑重发功能正常
6. 验证已有的对话数据能正确迁移

**Step 3: 提交**

```bash
git add -A
git commit -m "feat: decouple conversations from books, allow free chat in workspace"
```