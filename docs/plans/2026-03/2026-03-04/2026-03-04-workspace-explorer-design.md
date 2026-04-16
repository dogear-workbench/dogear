# 工作区资源管理器设计

> 将左侧文章列表升级为完整的工作区文件浏览器，支持文件夹分类、文件管理操作

## 1. 整体概念

把左侧边栏的 **文章列表区域** 替换为一个 **完整的工作区文件浏览器**：

```
左侧边栏
┌─────────────────────┐
│  对话列表            │
│  ─────────────────  │
│  工作区资源管理器     │
│  ├── 📁 技术/        │  ← 文章文件夹（.dogear/articles/ 下）
│  │   └── 📄 文章A    │  ← 文章节点，显示标题而非 UUID
│  ├── 📄 文章B        │  ← 未分类文章
│  ├── ── 分隔线 ──    │
│  ├── 📕 book1.epub   │  ← 工作区普通文件
│  └── 📁 notes/       │  ← 普通文件夹
└─────────────────────┘
```

**核心规则：**

- `.dogear` 目录整体隐藏
- `.dogear/articles/` 的内容提升到树的根层级，作为文章区域展示
- 文章目录（UUID 目录，含 meta.json）识别后显示为文章标题
- 用户创建的分类文件夹正常显示
- 工作区根目录下的其他文件和文件夹正常展示
- 文章区域在前，普通文件在后，中间用分隔线区分
- 所有节点支持文件管理操作（新建文件夹、重命名、删除、移动）

---

## 2. 数据结构

### WorkspaceFileNode 扩展

```typescript
// types/electron-api.ts
export interface WorkspaceFileNode {
  name: string;           // 显示名称（文章用标题，普通文件用文件名）
  path: string;           // 相对于工作区的路径
  type: 'file' | 'directory' | 'article';  // 新增 article 类型
  ext?: string;
  children?: WorkspaceFileNode[];
  // 文章专属字段（type='article' 时存在）
  articleMeta?: {
    id: string;
    url: string;
    siteName: string | null;
    fetchedAt: number;
    wordCount: number;
  };
}
```

### 文件系统布局

```
.dogear/articles/
  ├── .folders.json        ← 文件夹顺序元数据
  ├── 技术/                 ← 用户创建的文件夹
  │   └── uuid-1/          ← 文章（含 meta.json, content.md, raw.html）
  ├── 设计/
  │   └── uuid-4/
  └── uuid-2/              ← 未分类文章
```

`.folders.json` 仅维护文件夹显示顺序：

```json
{
  "version": 1,
  "folders": [
    { "name": "技术", "children": ["前端", "后端"] },
    { "name": "设计", "children": [] }
  ]
}
```

---

## 3. UI 组件与交互

### 组件结构

```
WorkspaceExplorer (新组件，替代 ArticleList)
  ├── 工具栏：新建文件夹 | 导入文章 | 导入书籍 | 刷新
  ├── 文章区域 ── ArticleTreeSection
  │   └── TreeNode (递归)
  ├── ── 分隔线 ──
  └── 文件区域 ── FileTreeSection
      └── TreeNode (递归)
```

### 节点渲染规则

| 节点类型 | 图标 | 显示内容 | 点击行为 |
|---------|------|---------|---------|
| `article` | Globe (绿色) | 文章标题 + 站点名/时间 | 右侧打开文章预览 |
| `directory`（articles 下） | FolderOpen (蓝色) | 文件夹名称 | 展开/折叠 |
| `file`（.epub/.pdf） | BookOpen (橙色) | 文件名 | 右侧打开书籍预览 |
| `file`（其他） | File (灰色) | 文件名 | 右侧显示文件信息 |
| `directory`（普通） | Folder (蓝色) | 文件夹名称 | 展开/折叠 |

### 右键菜单（Radix UI ContextMenu）

**文章节点：**
- 引用到对话
- 移动到文件夹...
- 删除

**文章区域的文件夹：**
- 新建子文件夹
- 重命名
- 删除

**普通文件/文件夹：**
- 新建文件夹
- 重命名
- 移动到...
- 复制
- 删除
- 在系统文件管理器中打开

### 拖拽

第一版不做拖拽，用右键菜单"移动到..."实现分类，后续可加 HTML5 原生拖拽。

---

## 4. 后端服务

### article-service.ts 改造

```
listArticles → listArticleTree：递归扫描返回树形 WorkspaceFileNode[]
saveArticle：新增可选 folderPath 参数
新增：createArticleFolder / renameArticleFolder / moveArticleItem / deleteArticleFolder
```

### 新增 workspace-fs-service.ts

工作区级别的文件操作（限定在工作区目录内）：

```
createFolder / renameItem / moveItem / copyItem / deleteItem / openInSystemExplorer
```

### IPC 路由

改造现有路由：
- `getFiles` → `getWorkspaceTree`：合并文章树 + 普通文件树返回

新增路由：

| 路由 | 输入 | 用途 |
|------|------|------|
| `createFolder` | `{workspaceId, parentPath, name, isArticleFolder}` | 创建文件夹 |
| `renameItem` | `{workspaceId, itemPath, newName}` | 重命名 |
| `moveItem` | `{workspaceId, sourcePath, targetPath}` | 移动 |
| `copyItem` | `{workspaceId, sourcePath, targetPath}` | 复制 |
| `deleteItem` | `{workspaceId, itemPath}` | 删除 |
| `openInExplorer` | `{workspaceId, itemPath}` | 系统文件管理器打开 |

所有路由做路径安全校验，确保操作不超出工作区范围。

---

## 5. Store 改造

### workspace-store.ts

新增文件操作 actions 和展开状态管理：

```typescript
// 新增状态
expandedPaths: Set<string>;
contextMenuTarget: WorkspaceFileNode | null;

// 新增 actions
createFolder / renameItem / moveItem / copyItem / deleteItem / toggleExpand
```

### article-store.ts

精简，移除 `articles: ArticleMeta[]` 和 `loadArticles()`（移入 workspace tree），只保留：
- `selectedArticle` — 当前预览的文章
- `selectArticle()` — 加载文章详情
- URL 输入相关状态

---

## 6. 实现顺序

| 步骤 | 内容 | 涉及文件 |
|------|------|---------|
| 1 | 扩展 `WorkspaceFileNode` 类型 | `types/electron-api.ts` |
| 2 | 新增 `workspace-fs-service.ts` | `electron/main/services/` |
| 3 | 改造 `article-service.ts`（树形扫描 + 文件夹 CRUD） | `electron/main/services/` |
| 4 | 改造 `getFiles` IPC + 新增文件操作 IPC 路由 | `electron/main/tipc/` |
| 5 | 改造 `workspace-store.ts` | `stores/` |
| 6 | 精简 `article-store.ts` | `stores/` |
| 7 | 新建 `WorkspaceExplorer` 组件（树渲染 + 右键菜单） | `components/` |
| 8 | 改造 `page.tsx`（替换 ArticleList） | `app/page.tsx` |
