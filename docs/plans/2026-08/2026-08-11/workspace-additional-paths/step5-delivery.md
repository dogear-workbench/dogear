# Step 5 交付：引用机制扩展

## 改动文件清单

### 1. `stores/reference-store.ts`
- `FileReference` 接口新增 `type?: 'file' | 'folder'` 字段（向后兼容，默认 'file'）
- 复用现有 `referencedFiles` / `addReferencedFile`（去重）/ `removeReferencedFile` / `clearReferencedFiles`
- **未新增** `pathRefs` / `FolderReference` 等独立类型，避免重复实现

### 2. `components/agent-chat/ChatInputArea.tsx`
- 文件/文件夹引用芯片根据 `file.type` 显示不同图标：
  - `type === 'folder'` → `Folder` 图标
  - 默认 → `FileText` 图标
- ✕ 移除按钮复用现有 `removeReferencedFile`

### 3. `components/WorkspaceExplorer.tsx`
- 新增 `import { toast } from 'sonner'`
- 文件节点右键菜单「引用到对话」：添加 toast 反馈
- **新增** 文件夹节点右键菜单「引用文件夹到对话」：调用 `addReferencedFile({ ..., type: 'folder' })`

### 4. `components/AdditionalFilesPanel.tsx`
- `AdditionalFileTree` 的 `onReference` 回调：根据 `node.type === 'directory'` 自动传入 `type: 'folder'`
- `FileTreeNode` hover 引用按钮：**不再限制为仅文件**，文件夹也可点击引用，tooltip 动态切换

### 5. `components/agent-chat/hooks/useSendMessage.ts`
- 文件引用注入 `<referenced_files>` XML 标签中，文件夹路径添加 `type="folder"` 属性区分
- 发送后 `clearReferencedFiles()` 清理（已有逻辑，无需改动）

## 关键签名

```typescript
// reference-store.ts
export interface FileReference {
  name: string;
  path: string;
  type?: 'file' | 'folder';
}

// useSendMessage.ts 注入格式
// 文件：<file name="utils.ts" path="D:\project\src\utils.ts" />
// 文件夹：<file name="components" path="D:\project\src\components" type="folder" />
```

## 设计决策

1. **不新建 `FolderReference` / `pathRefs`**：计划中提到「或统一的 `pathRefs: PathReference[]`」和「避免重复实现」。现有 `referencedFiles` + `addReferencedFile` 已经被 Step 4 使用，给 `FileReference` 加可选 `type` 字段是最小改动、完全向后兼容的方案。

2. **文件夹引用复用同一数组**：文件和文件夹引用都存在 `referencedFiles` 中，通过 `type` 区分。ChatInputArea 芯片、注入逻辑、清理逻辑都统一处理，无需拆分。

3. **session-window 自动兼容**：`ChatInputArea` 是共享组件，reference-store 是全局的，无需额外改动。

## 遗留问题

- 无。所有计划项均已实现。
- TypeScript 检查通过（我修改的 5 个文件无报错，项目中有 16 个预存错误与本次改动无关）。
