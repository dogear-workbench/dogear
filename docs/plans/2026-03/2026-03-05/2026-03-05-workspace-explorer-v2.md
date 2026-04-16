# WorkspaceExplorer v2: headless-tree 重构 + 拖拽 + 可折叠 Section

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 用 `@headless-tree/react` 重构 WorkspaceExplorer 组件，支持拖拽移动文件、可折叠的文章/文件区域、更便捷的文件夹创建。

**Architecture:** 将当前的手写递归树替换为 headless-tree 管理的扁平列表渲染。数据从后端获取的 `WorkspaceFileNode[]` 树形结构转换为 `Record<string, FlatNode>` 扁平映射供 headless-tree 消费。文章区和文件区通过两个虚拟根节点（`__articles__` / `__files__`）实现可折叠 Section Header。拖拽 onDrop 回调调用后端 moveItem IPC 完成真正的文件移动。

**Tech Stack:** @headless-tree/core + @headless-tree/react, shadcn/ui ContextMenu, Zustand 5, Tailwind CSS 4

**依赖已安装:** `@headless-tree/core@1.6.3`, `@headless-tree/react@1.6.3`

---

## 数据模型说明

headless-tree 需要一个扁平的 `Record<string, T>` 数据映射 + `getChildren(id) => string[]`。我们需要将后端返回的嵌套 `WorkspaceFileNode[]` 转换为：

```typescript
interface FlatNode {
  id: string;          // 节点 ID = path，虚拟节点用特殊前缀
  name: string;        // 显示名称
  isFolder: boolean;   // 是否可展开
  childrenIds: string[]; // 子节点 ID 列表
  nodeType: 'article' | 'file' | 'directory' | 'section-header';
  originalNode?: WorkspaceFileNode; // 原始节点引用
}
```

树结构：
```
root (隐藏)
├── __articles__  (Section: 文章, 可折叠)
│   ├── .dogear/articles/xxx  (article)
│   └── .dogear/articles/分类1  (directory)
│       └── ...
└── __files__  (Section: 文件, 可折叠)
    ├── docs  (directory)
    └── readme.txt  (file)
```

---

### Task 1: 创建数据转换工具函数

**目的:** 将后端 `WorkspaceFileNode[]` 树形数据转换为 headless-tree 需要的扁平映射。

**Files:**
- Modify: `components/WorkspaceExplorer.tsx`

**Step 1: 编写 flattenTree 和 buildFlatNodeMap 函数**

在 `WorkspaceExplorer.tsx` 顶部（工具函数区域），替换现有的 `countNodes` 函数，新增：

```typescript
/** headless-tree 节点数据 */
interface FlatNode {
  id: string;
  name: string;
  isFolder: boolean;
  childrenIds: string[];
  nodeType: 'article' | 'file' | 'directory' | 'section-header';
  originalNode?: WorkspaceFileNode;
}

/** 虚拟节点 ID 常量 */
const ROOT_ID = '__root__';
const ARTICLES_SECTION_ID = '__articles__';
const FILES_SECTION_ID = '__files__';

/**
 * 将 WorkspaceFileNode 树递归展平为 Record<string, FlatNode>
 */
function flattenNodes(
  nodes: WorkspaceFileNode[],
  map: Record<string, FlatNode>,
): string[] {
  const ids: string[] = [];
  for (const node of nodes) {
    const id = node.path;
    const childrenIds = node.children ? flattenNodes(node.children, map) : [];
    map[id] = {
      id,
      name: node.name,
      isFolder: node.type === 'directory',
      childrenIds,
      nodeType: node.type,
      originalNode: node,
    };
    ids.push(id);
  }
  return ids;
}

/**
 * 从后端文件列表构建 headless-tree 数据映射
 * 返回 { nodeMap, articleCount, fileCount }
 */
function buildNodeMap(files: WorkspaceFileNode[]): {
  nodeMap: Record<string, FlatNode>;
  articleCount: number;
  fileCount: number;
} {
  const articleNodes = files.filter(f => f.path.startsWith('.dogear/articles'));
  const fileNodes = files.filter(f => !f.path.startsWith('.dogear/articles'));

  const nodeMap: Record<string, FlatNode> = {};

  // 展平文章和文件节点
  const articleChildIds = flattenNodes(articleNodes, nodeMap);
  const fileChildIds = flattenNodes(fileNodes, nodeMap);

  // 创建 Section Header 虚拟节点
  nodeMap[ARTICLES_SECTION_ID] = {
    id: ARTICLES_SECTION_ID,
    name: '文章',
    isFolder: true,
    childrenIds: articleChildIds,
    nodeType: 'section-header',
  };
  nodeMap[FILES_SECTION_ID] = {
    id: FILES_SECTION_ID,
    name: '文件',
    isFolder: true,
    childrenIds: fileChildIds,
    nodeType: 'section-header',
  };

  // 创建根节点
  const rootChildIds: string[] = [];
  if (articleChildIds.length > 0) rootChildIds.push(ARTICLES_SECTION_ID);
  if (fileChildIds.length > 0) rootChildIds.push(FILES_SECTION_ID);

  nodeMap[ROOT_ID] = {
    id: ROOT_ID,
    name: 'root',
    isFolder: true,
    childrenIds: rootChildIds,
    nodeType: 'section-header',
  };

  // 统计叶子节点数
  const countLeaves = (ids: string[]): number => {
    let count = 0;
    for (const id of ids) {
      const n = nodeMap[id];
      if (!n) continue;
      if (n.isFolder) count += countLeaves(n.childrenIds);
      else count++;
    }
    return count;
  };

  return {
    nodeMap,
    articleCount: countLeaves(articleChildIds),
    fileCount: countLeaves(fileChildIds),
  };
}
```

**Step 2: 验证编译通过**

Run: `npx next build`
Expected: 编译成功（此时 buildNodeMap 还未被使用，但类型检查应通过）

**Step 3: Commit**

```bash
git add components/WorkspaceExplorer.tsx
git commit -m "feat: 添加 headless-tree 数据转换工具函数"
```

---

### Task 2: 集成 useTree hook，替换手写树逻辑

**目的:** 用 headless-tree 的 `useTree` hook 替代手写的 expandedPaths + ExplorerNode 递归渲染。

**Files:**
- Modify: `components/WorkspaceExplorer.tsx`

**Step 1: 替换导入和主组件核心逻辑**

在文件顶部新增 headless-tree 导入：

```typescript
import { useTree } from '@headless-tree/react';
import {
  syncDataLoaderFeature,
  selectionFeature,
  hotkeysCoreFeature,
  dragAndDropFeature,
  renamingFeature,
  propMemoizationFeature,
  createOnDropHandler,
} from '@headless-tree/core';
```

重写 `WorkspaceExplorer` 主组件，使用 `useTree` hook：

- `useMemo` 调用 `buildNodeMap(files)` 生成 nodeMap
- `useTree<FlatNode>` 配置：
  - `rootItemId: ROOT_ID`
  - `dataLoader: { getItem: (id) => nodeMap[id], getChildren: (id) => nodeMap[id]?.childrenIds ?? [] }`
  - `getItemName: (item) => item.getItemData().name`
  - `isItemFolder: (item) => item.getItemData().isFolder`
  - `indent: 16`
  - `features: [syncDataLoaderFeature, selectionFeature, hotkeysCoreFeature, dragAndDropFeature, renamingFeature, propMemoizationFeature]`
  - `onDrop`: 调用后端 moveItem，详见 Task 3
  - `onRename`: 调用后端 renameItem
  - `onPrimaryAction`: 打开文章/文件
  - `initialState: { expandedItems: [ARTICLES_SECTION_ID, FILES_SECTION_ID] }` — 默认展开两个 Section

- 渲染 `tree.getItems().map(item => ...)` 扁平列表
- Section Header 节点（`nodeType === 'section-header'`）渲染为特殊样式的行：加粗标题 + 数量徽章 + 折叠箭头 + 操作按钮
- 保留 shadcn ContextMenu 右键菜单（在渲染的每个 item 上包裹 ContextMenu）
- 删除旧的 `ExplorerNode` 子组件和手动递归逻辑
- 删除 `InlineRenameInput` 组件（headless-tree 的 `renamingFeature` 提供 `item.getRenameInputProps()`）

**Step 2: 完整的新渲染结构**

```tsx
export function WorkspaceExplorer() {
  const files = useWorkspaceStore(s => s.files);
  const loadWorkspaceFiles = useWorkspaceStore(s => s.loadWorkspaceFiles);
  const loadingFiles = useWorkspaceStore(s => s.loadingFiles);
  const wsRenameItem = useWorkspaceStore(s => s.renameItem);
  const wsCreateFolder = useWorkspaceStore(s => s.createFolder);
  const wsDeleteItem = useWorkspaceStore(s => s.deleteItem);
  const wsMoveItem = useWorkspaceStore(s => s.moveItem);
  const wsOpenInExplorer = useWorkspaceStore(s => s.openInExplorer);
  const selectFile = useWorkspaceStore(s => s.selectFile);
  const selectArticle = useArticleStore(s => s.selectArticle);
  const toggleReferenceArticle = useReferenceStore(s => s.toggleReferenceArticle);

  const { nodeMap, articleCount, fileCount } = useMemo(() => buildNodeMap(files), [files]);

  // 新建文件夹状态
  const [creatingFolderAt, setCreatingFolderAt] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState('');
  const newFolderInputRef = useRef<HTMLInputElement>(null);

  const tree = useTree<FlatNode>({
    rootItemId: ROOT_ID,
    dataLoader: {
      getItem: (id) => nodeMap[id],
      getChildren: (id) => nodeMap[id]?.childrenIds ?? [],
    },
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => item.getItemData().isFolder,
    indent: 16,
    canReorder: false,  // 不需要排序，只需要拖入文件夹
    features: [
      syncDataLoaderFeature,
      selectionFeature,
      hotkeysCoreFeature,
      dragAndDropFeature,
      renamingFeature,
      propMemoizationFeature,
    ],
    // 拖拽放下时调用后端移动
    onDrop: async (items, target) => {
      const sourceNode = items[0]?.getItemData();
      const targetNode = target.item.getItemData();
      if (!sourceNode || !targetNode) return;
      // 不允许拖到 Section Header
      if (targetNode.nodeType === 'section-header') return;
      // 目标必须是文件夹
      if (!targetNode.isFolder) return;
      await wsMoveItem(sourceNode.id, targetNode.id);
    },
    // 拖拽限制
    canDrag: (items) => {
      // Section Header 不可拖拽
      return items.every(i => i.getItemData().nodeType !== 'section-header');
    },
    canDrop: (items, target) => {
      const targetData = target.item.getItemData();
      // 不能拖到 section header 上
      if (targetData.nodeType === 'section-header') return false;
      // 目标必须是文件夹
      if (!targetData.isFolder) return false;
      // 不能把项拖到自己里面
      return !items.some(i => target.item.isDescendentOf(i.getId()));
    },
    // 重命名
    onRename: async (item, newName) => {
      const data = item.getItemData();
      if (data.nodeType === 'section-header') return;
      await wsRenameItem(data.id, newName);
    },
    canRename: (item) => item.getItemData().nodeType !== 'section-header',
    // 点击叶子节点打开
    onPrimaryAction: (item) => {
      const data = item.getItemData();
      if (data.nodeType === 'article' && data.originalNode?.articleMeta) {
        selectArticle(buildArticleMeta(data.originalNode)!);
      } else if (data.nodeType === 'file' && data.originalNode) {
        selectFile(data.originalNode);
      }
    },
    // 拖到文件夹上 800ms 后自动展开
    openOnDropDelay: 800,
    initialState: {
      expandedItems: [ARTICLES_SECTION_ID, FILES_SECTION_ID],
    },
  });

  // 渲染每个 item
  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-sm font-medium">工作区</span>
        <div className="flex items-center gap-1">
          <button
            className="p-1 rounded hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setCreatingFolderAt('.')}
            title="新建文件夹"
          >
            <FolderPlus className="w-4 h-4" />
          </button>
          <button
            className={cn(
              'p-1 rounded hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors',
              loadingFiles && 'animate-spin',
            )}
            onClick={loadWorkspaceFiles}
            title="刷新"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 树内容 */}
      <div
        {...tree.getContainerProps('工作区文件树')}
        className="flex-1 overflow-y-auto relative"
      >
        {tree.getItems().map(item => {
          const data = item.getItemData();
          const meta = item.getItemMeta();
          const isSectionHeader = data.nodeType === 'section-header';

          // Section Header 渲染
          if (isSectionHeader) {
            const count = data.id === ARTICLES_SECTION_ID ? articleCount : fileCount;
            return (
              <div
                key={item.getId()}
                {...item.getProps()}
                className="flex items-center gap-1 px-3 py-1 cursor-pointer select-none hover:bg-muted/30"
              >
                {item.isExpanded()
                  ? <ChevronDown className="w-3 h-3 text-muted-foreground" />
                  : <ChevronRight className="w-3 h-3 text-muted-foreground" />}
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {data.name}
                </span>
                {count > 0 && (
                  <span className="text-xs text-muted-foreground bg-muted rounded-full px-1.5 py-0.5 ml-auto">
                    {count}
                  </span>
                )}
                {/* 文章区 Section Header 的新建文件夹按钮 */}
                {data.id === ARTICLES_SECTION_ID && (
                  <button
                    className="p-0.5 rounded hover:bg-muted text-muted-foreground ml-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      setCreatingFolderAt('.dogear/articles');
                    }}
                    title="新建分类文件夹"
                  >
                    <FolderPlus className="w-3 h-3" />
                  </button>
                )}
              </div>
            );
          }

          // 普通节点渲染（含右键菜单）
          return (
            <ContextMenu key={item.getId()}>
              <ContextMenuTrigger asChild>
                <div
                  {...item.getProps()}
                  className={cn(
                    'flex items-center gap-1 py-1 pr-2 cursor-pointer select-none',
                    'hover:bg-muted/50 transition-colors',
                    item.isSelected() && 'bg-primary/20',
                    item.isDragTarget() && item.isFolder() && 'bg-blue-500/20 ring-1 ring-blue-500/50',
                  )}
                  style={{ paddingLeft: `${meta.level * 16}px` }}
                >
                  {/* 折叠箭头 */}
                  {data.isFolder ? (
                    item.isExpanded()
                      ? <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
                      : <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <span className="w-4 h-4 shrink-0" />
                  )}

                  {/* 图标 */}
                  {renderNodeIcon(data)}

                  {/* 内容：重命名输入框或文本 */}
                  {item.isRenaming() ? (
                    <input
                      {...item.getRenameInputProps()}
                      className="flex-1 min-w-0 bg-background border border-primary rounded px-1 py-0 text-sm outline-none"
                    />
                  ) : (
                    <div className="flex-1 min-w-0 ml-1">
                      <div className="text-sm truncate">{data.name}</div>
                      {data.nodeType === 'article' && data.originalNode?.articleMeta && (
                        <div className="text-xs text-muted-foreground truncate">
                          {data.originalNode.articleMeta.siteName && (
                            <span>{data.originalNode.articleMeta.siteName}</span>
                          )}
                          {data.originalNode.articleMeta.siteName && data.originalNode.articleMeta.fetchedAt && (
                            <span> · </span>
                          )}
                          {data.originalNode.articleMeta.fetchedAt && (
                            <span>{getRelativeTime(data.originalNode.articleMeta.fetchedAt)}</span>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </ContextMenuTrigger>
              {renderContextMenu(item, data)}
            </ContextMenu>
          );
        })}

        {/* 拖拽指示线 */}
        <div
          style={tree.getDragLineStyle()}
          className="h-[2px] bg-blue-500 rounded pointer-events-none"
        />

        {/* 新建文件夹内联输入 */}
        {creatingFolderAt !== null && (
          <div className="flex items-center gap-1 px-3 py-1">
            <FolderPlus className="w-4 h-4 shrink-0 text-blue-500" />
            <input
              ref={newFolderInputRef}
              className="flex-1 min-w-0 bg-background border border-primary rounded px-1 py-0 text-sm outline-none"
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              placeholder="文件夹名称"
              autoFocus
              onKeyDown={async (e) => {
                if (e.key === 'Enter' && newFolderName.trim()) {
                  await wsCreateFolder(creatingFolderAt, newFolderName.trim());
                  setCreatingFolderAt(null);
                  setNewFolderName('');
                } else if (e.key === 'Escape') {
                  setCreatingFolderAt(null);
                  setNewFolderName('');
                }
              }}
              onBlur={() => {
                setCreatingFolderAt(null);
                setNewFolderName('');
              }}
            />
          </div>
        )}
      </div>

      {/* 空状态 */}
      {files.length === 0 && !loadingFiles && (
        <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
          暂无内容
        </div>
      )}
    </div>
  );
}
```

**Step 3: 添加 renderNodeIcon 和 renderContextMenu 辅助函数**

将图标渲染和右键菜单抽取为独立函数，放在组件内部作为闭包函数，以便访问 store actions。

`renderNodeIcon(data: FlatNode)` — 根据 nodeType 返回对应图标。
`renderContextMenu(item, data)` — 根据 nodeType 返回 ContextMenuContent。

（具体代码在现有 ExplorerNode 中已有，基本逻辑不变，只是改为接收 headless-tree 的 item 实例。）

**Step 4: 删除旧组件和无用代码**

- 删除 `ExplorerNode` 组件（整个 interface + function）
- 删除 `InlineRenameInput` 组件（headless-tree renamingFeature 替代）
- 删除 `countNodes` 函数（被 `buildNodeMap` 中的计数逻辑替代）
- 从 workspace-store 中可以保留 `expandedPaths` 和 `toggleExpand`，但不再在 WorkspaceExplorer 中使用
- 删除 `movingPath` / `copyingPath` 状态和相关的内联输入框（移动改为拖拽，复制暂时只保留右键菜单的功能但改为拖拽 + Ctrl 或在 Task 4 中进一步处理）

**Step 5: 验证编译通过**

Run: `npx next build`
Expected: 编译成功

**Step 6: Commit**

```bash
git add components/WorkspaceExplorer.tsx
git commit -m "feat: 用 headless-tree useTree 重写 WorkspaceExplorer，支持拖拽和可折叠 Section"
```

---

### Task 3: 处理拖拽后的数据刷新和边界情况

**目的:** 确保拖拽移动操作后文件树正确刷新，处理跨区域拖拽（文章区 ↔ 文件区）的限制。

**Files:**
- Modify: `components/WorkspaceExplorer.tsx`

**Step 1: 完善 onDrop 回调**

```typescript
onDrop: async (items, target) => {
  const sourceNode = items[0]?.getItemData();
  const targetNode = target.item.getItemData();
  if (!sourceNode || !targetNode) return;
  // section header 不接受拖入
  if (targetNode.nodeType === 'section-header') return;
  if (!targetNode.isFolder) return;

  // 文章区内只能在文章区内移动
  const sourceIsArticle = sourceNode.id.startsWith('.dogear/articles');
  const targetIsArticle = targetNode.id.startsWith('.dogear/articles');
  if (sourceIsArticle !== targetIsArticle) return;

  // 不能拖到自己或自己的后代
  if (targetNode.id.startsWith(sourceNode.id + '/')) return;
  if (targetNode.id === sourceNode.id) return;

  await wsMoveItem(sourceNode.id, targetNode.id);
},
```

**Step 2: 完善 canDrop 校验**

```typescript
canDrop: (items, target) => {
  const targetData = target.item.getItemData();
  if (targetData.nodeType === 'section-header') return false;
  if (!targetData.isFolder) return false;

  return items.every(i => {
    const srcData = i.getItemData();
    // 不能跨区域拖拽
    const srcArticle = srcData.id.startsWith('.dogear/articles');
    const tgtArticle = targetData.id.startsWith('.dogear/articles');
    if (srcArticle !== tgtArticle) return false;
    // 不能拖到自己的后代
    if (targetData.id.startsWith(srcData.id + '/')) return false;
    if (targetData.id === srcData.id) return false;
    return true;
  });
},
```

**Step 3: 拖拽悬停时自动展开文件夹**

已通过 `openOnDropDelay: 800` 配置，无需额外代码。

**Step 4: 拖拽视觉反馈**

在渲染节点时已添加：
```tsx
item.isDragTarget() && item.isFolder() && 'bg-blue-500/20 ring-1 ring-blue-500/50'
```

另外添加拖拽时的源项半透明效果。在 item 的 className 中增加：
```tsx
item.isDraggingOver() && 'opacity-50'
```

注意：headless-tree `isDraggingOver` 不是我们想要的（它表示"有东西拖到这个项上方"）。我们需要检查被拖动的项本身。查看 API 后发现没有直接的 `isDragging` 属性，但可以通过 selection + DnD state 判断。简单起见，先不加源项半透明效果，仅保留目标高亮和拖拽线。

**Step 5: Commit**

```bash
git add components/WorkspaceExplorer.tsx
git commit -m "feat: 完善拖拽移动逻辑，添加跨区域限制和视觉反馈"
```

---

### Task 4: 右键菜单适配

**目的:** 将 ExplorerNode 中的右键菜单逻辑适配为 headless-tree 的 item 实例调用。

**Files:**
- Modify: `components/WorkspaceExplorer.tsx`

**Step 1: 编写 renderContextMenu 函数**

在 `WorkspaceExplorer` 组件内部定义（作为闭包访问 store actions）：

```typescript
function renderContextMenu(item: ItemInstance<FlatNode>, data: FlatNode) {
  const isArticle = data.nodeType === 'article';
  const isArticleFolder = data.isFolder && data.id.startsWith('.dogear/articles');
  const isDir = data.isFolder;

  if (isArticle) {
    return (
      <ContextMenuContent>
        <ContextMenuItem onClick={() => {
          const meta = buildArticleMeta(data.originalNode!);
          if (meta) toggleReferenceArticle(meta);
        }}>
          <Quote className="w-4 h-4" />
          引用到对话
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={() => wsDeleteItem(data.id)}>
          <Trash2 className="w-4 h-4" />
          删除
        </ContextMenuItem>
      </ContextMenuContent>
    );
  }

  if (isArticleFolder) {
    return (
      <ContextMenuContent>
        <ContextMenuItem onClick={() => setCreatingFolderAt(data.id)}>
          <FolderPlus className="w-4 h-4" />
          新建子文件夹
        </ContextMenuItem>
        <ContextMenuItem onClick={() => item.startRenaming()}>
          <Pencil className="w-4 h-4" />
          重命名
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={() => wsDeleteItem(data.id)}>
          <Trash2 className="w-4 h-4" />
          删除
        </ContextMenuItem>
      </ContextMenuContent>
    );
  }

  // 普通文件/文件夹
  return (
    <ContextMenuContent>
      {isDir && (
        <ContextMenuItem onClick={() => setCreatingFolderAt(data.id)}>
          <FolderPlus className="w-4 h-4" />
          新建文件夹
        </ContextMenuItem>
      )}
      <ContextMenuItem onClick={() => item.startRenaming()}>
        <Pencil className="w-4 h-4" />
        重命名
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={() => wsOpenInExplorer(data.id)}>
        <ExternalLink className="w-4 h-4" />
        在文件管理器中打开
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onClick={() => wsDeleteItem(data.id)}>
        <Trash2 className="w-4 h-4" />
        删除
      </ContextMenuItem>
    </ContextMenuContent>
  );
}
```

**Step 2: 删除旧右键菜单中的"移动到..."和"复制到..."**

拖拽已替代移动操作。复制操作可以保留在普通文件的右键菜单中，但改为"复制到剪贴板路径"或暂时移除（功能简化）。如果用户需要复制，可以通过系统文件管理器完成。

**Step 3: Commit**

```bash
git add components/WorkspaceExplorer.tsx
git commit -m "feat: 适配右键菜单到 headless-tree，移除手动路径输入"
```

---

### Task 5: 清理 workspace-store 中的冗余代码

**目的:** 移除不再使用的 expandedPaths / toggleExpand（headless-tree 内部管理展开状态），清理移动/复制的手动路径输入相关代码。

**Files:**
- Modify: `stores/workspace-store.ts`

**Step 1: 删除 expandedPaths 和 toggleExpand**

从 `WorkspaceState` interface 和实现中删除：
- `expandedPaths: string[]`
- `toggleExpand: (path: string) => void`

以及初始值 `expandedPaths: []` 和实现中的 `toggleExpand` 方法。

注意：需确认没有其他地方引用了这两个属性。搜索 `expandedPaths` 和 `toggleExpand` 的引用，确保只在被替换的 WorkspaceExplorer 旧代码中使用。

**Step 2: Commit**

```bash
git add stores/workspace-store.ts
git commit -m "refactor: 移除 workspace-store 中已被 headless-tree 取代的 expandedPaths"
```

---

### Task 6: 构建验证和手动测试

**目的:** 确保整体编译通过，运行应用验证功能。

**Files:**
- 所有之前修改的文件

**Step 1: TypeScript 编译检查**

Run: `npx tsc --noEmit -p tsconfig.electron.json`
Expected: 无错误

Run: `npx next build`
Expected: 编译成功

**Step 2: 功能验证清单**

启动 `npm run dev` 后依次验证：

1. 文件树正常显示，分为"文章"和"文件"两个 Section
2. 点击 Section Header 可以折叠/展开该区域
3. 点击文章节点可以预览文章
4. 点击文件节点可以预览书籍
5. 拖拽文件到文件夹中，文件被移动
6. 拖拽文章到文章分类文件夹中，文章被移动
7. 不能将文章拖到文件区，不能将文件拖到文章区
8. 拖拽时悬停在折叠的文件夹上，800ms 后自动展开
9. 拖拽时有蓝色目标高亮和拖拽指示线
10. 右键菜单正常工作：新建文件夹、重命名、删除、在文件管理器中打开
11. F2 快捷键触发重命名
12. 工具栏的新建文件夹和刷新按钮正常工作

**Step 3: 最终 Commit**

```bash
git add -A
git commit -m "feat: WorkspaceExplorer v2 完成 - headless-tree 拖拽 + 可折叠 Section"
```

---

## 文件变更总结

| 文件 | 操作 | 说明 |
|------|------|------|
| `components/WorkspaceExplorer.tsx` | 重写 | headless-tree 重构，拖拽+Section |
| `stores/workspace-store.ts` | 修改 | 删除 expandedPaths/toggleExpand |

**不需要修改的文件：**
- `types/electron-api.ts` — WorkspaceFileNode 类型不变
- `electron/main/tipc/explorer.ts` — 后端 IPC 路由不变
- `electron/main/services/workspace-fs-service.ts` — 文件操作不变
- `app/page.tsx` — WorkspaceExplorer 接口不变（无 props）
