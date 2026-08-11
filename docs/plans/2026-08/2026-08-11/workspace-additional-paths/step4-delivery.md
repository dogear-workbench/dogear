# Step 4 交付：附加文件面板

## 改动文件清单

### 后端 IPC
- **`electron/main/tipc/workspace.ts`**
  - 新增 `pickDirectory` procedure：打开文件夹选择对话框，返回 `{ canceled: boolean, path?: string }`
  - 新增 `scanAdditionalPath` procedure：输入 `{ dirPath: string }`，递归扫描绝对路径目录，返回 `{ files: WorkspaceFileNode[] }`；路径不存在时返回空数组
  - 新增模块级 `scanAbsDirectory(dirPath)` 函数：递归扫描，跳过隐藏文件和 `node_modules`，返回绝对路径节点

### workspace-store
- **`stores/workspace-store.ts`**
  - 新增 `addAdditionalPath(path: string) → Promise<void>`
  - 新增 `removeAdditionalPath(path: string) → Promise<void>`
  - 新增 `toggleAdditionalPath(path: string, enabled: boolean) → Promise<void>`
  - 三个 action 均调 IPC 后用返回的 `workspace` 更新本地状态；失败时 toast

### UI 组件
- **`components/ui/switch.tsx`**（新增）：基于 `radix-ui` 统一包的 Switch 组件
- **`components/AdditionalFilesPanel.tsx`**（新增）：
  - `AdditionalFilesPanel({ workspaceId })` 主面板
  - `AdditionalPathCard`：路径卡片（Switch + 路径信息 + 移除按钮）
  - `AdditionalFileTree`：展开时调 `client.scanAdditionalPath` 扫描
  - `FileTreeNode`：递归树节点（展开/折叠 + 点击引用）
  - 空状态 / 加载中 / 目录不存在 提示

### 页面接入
- **`app/page.tsx`**：右栏 `'additional'` Tab 替换占位为 `<AdditionalFilesPanel workspaceId={workspace.id} />`；顺手清理了一个预存的未使用导入 `ArticlePreview`

## 关键签名
```typescript
// IPC
client.pickDirectory() → { canceled: boolean, path?: string }
client.scanAdditionalPath({ dirPath: string }) → { files: WorkspaceFileNode[] }

// workspace-store
addAdditionalPath(path: string) → Promise<void>
removeAdditionalPath(path: string) → Promise<void>
toggleAdditionalPath(path: string, enabled: boolean) → Promise<void>

// 组件
<AdditionalFilesPanel workspaceId={string} />
```

## 编译验证
- `bun run build:electron` ✅
- `npx eslint` 四个文件无错误 ✅
- `npx tsc --noEmit` 改动文件无新增错误 ✅

## 遗留问题
- `workspaceId` prop 目前未直接使用（workspace 从 store 获取），但保留以匹配 Step 3 的调用签名和未来扩展
- 文件树采用递归组件渲染（非 headless-tree），保持简单只读；后续如需拖拽/重命名可升级为 headless-tree
- `scanAdditionalPath` 全量递归扫描，大量文件时可能慢（本期不做虚拟滚动，设计文档已接受）
