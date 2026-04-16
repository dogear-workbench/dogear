# UX 改进实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现 4 项 UX 改进：工作区切换按钮、新建对话自动打开、自选股独立窗口、隐藏菜单栏

**Architecture:**
- 工作区切换：主页顶栏添加 Popover 下拉菜单，复用已有 IPC 接口
- 新建对话：优化 newConversation 的异步时序，先选中再刷新列表
- 自选股窗口：复制 createAgentMonitorWindow 模式，用独立 BrowserWindow 打开
- 菜单栏：app ready 时 Menu.setApplicationMenu(null) 完全隐藏

**Tech Stack:** React, Zustand, shadcn/ui (Popover), Electron BrowserWindow, tipc

---

### Task 1：隐藏 Electron 默认菜单栏

**Files:**
- Modify: `electron/main/index.ts:177`

**Step 1: 在 app.whenReady 中添加 Menu.setApplicationMenu(null)**

在 `electron/main/index.ts` 的 `app.whenReady()` 回调中，`createWindow()` 之前添加：

```typescript
// 顶部 import 添加 Menu
import electron, { type BrowserWindow as BrowserWindowType } from 'electron';
const { app, BrowserWindow, Menu } = electron;

// app.whenReady() 回调中，createWindow() 之前
Menu.setApplicationMenu(null);
```

**Step 2: 编译并验证**

运行 `bun run build:electron` 编译，然后 `bun run dev` 检查菜单栏已消失。

---

### Task 2：工作区删除功能（后端）

**Files:**
- Modify: `electron/main/services/workspace-json-service.ts`
- Modify: `electron/main/tipc/workspace.ts`

**Step 1: 在 workspace-json-service.ts 中添加 remove 函数**

在 `setDefault` 函数之后添加：

```typescript
/**
 * 删除工作区（仅从索引中移除，不删除文件夹）
 * @param id - 要删除的工作区 ID
 */
export async function remove(id: string): Promise<void> {
  const file = await loadWorkspacesFile();
  const idx = file.workspaces.findIndex((w) => w.id === id);
  if (idx === -1) return;

  const wasDefault = file.workspaces[idx].isDefault;
  file.workspaces.splice(idx, 1);

  // 如果删除的是默认工作区，将第一个设为默认
  if (wasDefault && file.workspaces.length > 0) {
    file.workspaces[0].isDefault = true;
  }

  await saveWorkspacesFile(file);
}
```

**Step 2: 在 tipc/workspace.ts 中添加 deleteWorkspace 路由**

在 `setDefault` 路由之后添加：

```typescript
deleteWorkspace: t.procedure
  .input<{ workspaceId: string }>()
  .action(async ({ input }) => {
    try {
      await workspaceJsonService.remove(input.workspaceId);
      return { success: true };
    } catch (error) {
      console.error('删除工作区失败:', error);
      return { success: false, error: String(error) };
    }
  }),
```

---

### Task 3：工作区选择页添加删除按钮

**Files:**
- Modify: `components/workspace-selector.tsx`

**Step 1: 在工作区列表项中添加删除按钮**

导入 `Trash2` 图标和 `showConfirm`：

```typescript
import { FolderOpen, Home, Loader2, Plus, Trash2 } from 'lucide-react';
import { showConfirm } from '@/stores/confirm-store';
```

添加删除处理函数：

```typescript
const handleDeleteWorkspace = async (workspace: Workspace, e: React.MouseEvent) => {
  e.stopPropagation();
  if (!await showConfirm('删除工作区', `确定要移除工作区「${workspace.name}」吗？（不会删除文件夹内容）`)) return;
  try {
    await client.deleteWorkspace({ workspaceId: workspace.id });
    // 如果删除的是当前选中的，清除选中
    if (selectedWorkspace?.id === workspace.id) {
      setSelectedWorkspace(null);
    }
    await loadWorkspaces();
  } catch (error) {
    toast.error('删除工作区失败', { description: (error as Error).message });
  }
};
```

在工作区列表项中，`默认` 标签旁边添加删除按钮：

```tsx
<Button
  variant="ghost"
  size="sm"
  className="text-muted-foreground hover:text-destructive"
  onClick={(e) => handleDeleteWorkspace(workspace, e)}
>
  <Trash2 className="w-4 h-4" />
</Button>
```

---

### Task 4：主页顶栏添加工作区切换按钮

**Files:**
- Modify: `app/page.tsx:104-111`
- Modify: `stores/workspace-store.ts`

**Step 1: 在 workspace-store 中添加切换工作区方法**

添加 `switchWorkspace` action 和 `clearWorkspace` action：

```typescript
// 接口中添加
/** 切换到另一个工作区（回到选择页） */
clearWorkspace: () => void;

// 实现
clearWorkspace: () => {
  set({ workspace: null, files: [], selectedFile: null, selectedBook: null, workspaceFilePath: null });
},
```

**Step 2: 在 page.tsx 顶栏中用 Popover 替换工作区名称**

导入需要的组件：

```typescript
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ChevronsUpDown } from 'lucide-react';
```

从 store 获取 clearWorkspace：

```typescript
const clearWorkspace = useWorkspaceStore((s) => s.clearWorkspace);
```

将顶栏中的工作区名称区域替换为：

```tsx
<div className="flex items-center gap-2 text-sm text-muted-foreground">
  <FolderOpen className="w-4 h-4" />
  <span>{workspace.name}</span>
  <Button
    variant="ghost"
    size="sm"
    className="h-6 w-6 p-0"
    onClick={clearWorkspace}
    title="切换工作区"
  >
    <ChevronsUpDown className="w-3.5 h-3.5" />
  </Button>
</div>
```

点击按钮后 `workspace` 被设为 `null`，`page.tsx:97-98` 的判断 `if (!workspace) return <WorkspaceSelector />` 会自动切换到工作区选择页面。这是最简单且一致的方案——复用已有的 WorkspaceSelector 组件，用户在那里可以新增、删除、切换工作区。

---

### Task 5：新建对话自动打开（优化时序）

**Files:**
- Modify: `stores/conversation-store.ts:222-245`

**Step 1: 优化 newConversation 函数**

问题：当前 `newConversation` 先 `loadConversations()`（列表刷新），再 `selectConversation()`（选中新对话），中间有异步间隔导致用户看到列表更新但 AI 面板没反应。

同时，`selectConversation` 只是设置了 `selectedConversation` 状态，但多标签页模式下 AgentChat 依赖 `session-store.openTab` 来创建标签页。当前流程中 `selectConversation` 没有调用 `openTab`。

修改 `newConversation` 函数，创建后**先打开标签页**，再刷新列表：

```typescript
newConversation: async () => {
  const workspace = await getWorkspace();
  if (!workspace) return;

  try {
    const result = await client.create({ workspaceId: workspace.id });
    if (result.error || !result.conversationId) {
      toast.error('创建对话失败', { description: result.error || '未知错误' });
      return;
    }

    // 先获取新对话详情并选中（让 UI 立即响应）
    const newConversation = await client.getById({ conversationId: result.conversationId, workspaceId: workspace.id });
    if (newConversation.conversation) {
      get().selectConversation(newConversation.conversation);
    }

    // 后台刷新对话列表（列表更新不阻塞用户）
    get().loadConversations();
  } catch (error) {
    console.error('创建对话失败:', error);
    toast.error('创建对话失败', { description: error instanceof Error ? error.message : String(error) });
  }
},
```

**Step 2: 检查 selectConversation 是否自动打开标签页**

查看 `BookConversationList.tsx` 中点击对话时的处理逻辑。如果点击对话时是先调用 `selectConversation` 然后手动 `openTab`，那么 `newConversation` 中也需要同样操作。

在 `selectConversation` 末尾添加自动打开标签页：

```typescript
selectConversation: async (conversation) => {
  set({ forkParams: null, selectedConversation: conversation });

  // 自动打开标签页
  const { useSessionStore } = await import('./session-store');
  useSessionStore.getState().openTab(conversation.id, conversation.title || '新对话');

  // 如果对话有关联书籍，加载书籍信息
  // ... 原有逻辑不变
},
```

> **注意**：需要检查 BookConversationList 中的点击处理是否也调用了 `openTab`，如果是，需要防止重复打开（openTab 中已有防重逻辑 `if (existing) { set({ activeTabId }); return true; }`）。

---

### Task 6：自选股独立窗口

**Files:**
- Modify: `electron/main/index.ts` — 添加 createStockWindow 函数
- Modify: `electron/main/tipc/agent.ts` — 添加 openStockWindow 路由
- Modify: `stores/workspace-store.ts` — 添加 openStockWindow 方法
- Modify: `app/page.tsx:121-124` — 改为调用 openStockWindow

**Step 1: 在 electron/main/index.ts 中添加自选股窗口**

在 `agentMonitorWindow` 变量声明后添加：

```typescript
// 自选股窗口实例
let stockWindow: BrowserWindowType | null = null;
```

在 `createAgentMonitorWindow` 函数后添加：

```typescript
/**
 * 创建自选股窗口
 */
export function createStockWindow() {
  if (stockWindow) {
    stockWindow.focus();
    return;
  }

  stockWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: '自选股行情',
    parent: mainWindow || undefined,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const stockUrl = isDev
    ? 'http://localhost:3000/#/stocks'
    : `file://${path.join(__dirname, '../../out/index.html')}#/stocks`;
  stockWindow.loadURL(stockUrl);

  stockWindow.on('closed', () => {
    stockWindow = null;
  });
}
```

**Step 2: 在 tipc/agent.ts 中添加 openStockWindow 路由**

在 `openMonitorWindow` 路由后添加：

```typescript
openStockWindow: t.procedure
  .action(async () => {
    const { createStockWindow } = await import('../index.js');
    createStockWindow();
    return { success: true };
  }),
```

**Step 3: 在 workspace-store.ts 中添加 openStockWindow 方法**

在接口中添加：

```typescript
/** 打开自选股窗口 */
openStockWindow: () => Promise<void>;
```

在实现中添加：

```typescript
openStockWindow: async () => {
  try {
    await client.openStockWindow();
  } catch (error) {
    console.error('打开自选股窗口失败:', error);
  }
},
```

**Step 4: 修改 page.tsx 中的自选股按钮**

从 store 获取：

```typescript
const openStockWindow = useWorkspaceStore((s) => s.openStockWindow);
```

修改按钮：

```tsx
<Button variant="outline" size="sm" onClick={openStockWindow}>
  <TrendingUp className="w-4 h-4 mr-2" />
  自选股
</Button>
```

删除顶部的 `useNavigate` 导入（如果不再需要）和 `navigate` 变量。

---

### Task 7：编译验证

**Step 1: 编译主进程**

```bash
bun run build:electron
```

**Step 2: 启动开发环境验证**

```bash
bun run dev
```

验证清单：
- [ ] 菜单栏已隐藏
- [ ] 顶栏工作区名称旁有切换按钮，点击后跳转到工作区选择页
- [ ] 工作区选择页有删除按钮，可以删除工作区
- [ ] 新建对话后自动打开并显示在标签页中
- [ ] 自选股按钮打开独立窗口，不中断主页面会话
