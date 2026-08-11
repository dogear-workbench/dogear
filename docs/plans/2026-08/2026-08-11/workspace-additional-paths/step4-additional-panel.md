---
step: 4
title: 附加文件面板
status: done
---

## 目标

新增 `AdditionalFilesPanel` 组件：管理附加路径的增删开关 + 每个路径的文件树浏览；接入 Step 2 的 IPC 路由。

## 依赖上下文（接力棒输入）

- 前置 step：[step2-session-ipc.md] IPC 路由 `addAdditionalPath` / `removeAdditionalPath` / `toggleAdditionalPath` 就绪，client 方法已映射
- 前置 step：[step3-layout.md] 右栏 `'additional'` Tab 已占位
- `WorkspaceExplorer` 在 `components/WorkspaceExplorer.tsx`，用 `@headless-tree/react` 渲染文件树，可作为附加路径文件树的参考
- workspace-store 持有当前 workspace 对象

## 计划改动

### 4.1 workspace-store 扩展

- [ ] `stores/workspace-store.ts`
  - `workspace` 对象已带 `additional_paths`（Step 1 数据模型改了类型）
  - 新增 actions：
    - `addAdditionalPath(path: string)`：调 `client.addAdditionalPath`，更新本地 workspace
    - `removeAdditionalPath(path: string)`：调 IPC，更新本地
    - `toggleAdditionalPath(path: string, enabled: boolean)`：调 IPC，更新本地

### 4.2 AdditionalFilesPanel 组件

- [ ] `components/AdditionalFilesPanel.tsx`（新增）
  - Props：`workspaceId: string`
  - 从 workspace-store 读 `workspace.additional_paths`
  - 渲染路径卡片列表：
    - 每个卡片：Switch 开关 + 路径文字 + 移除按钮（✕）
    - 开启的路径：正常显示 + 可折叠文件树（懒加载，点击展开时扫描目录）
    - 关闭的路径：灰显（`opacity-50`），文件树不展开
  - 底部「+ 添加文件夹」按钮：
    - 调 Electron 文件夹选择对话框（`window.ipcRenderer` 或 tipc 的 `showOpenDialog`）
    - 选完后调 `workspaceStore.addAdditionalPath(path)`
  - 空状态：无附加路径时显示提示文案

### 4.3 文件树懒加载

- [ ] 附加路径的文件树可复用 `@headless-tree/react`（与 WorkspaceExplorer 一致）
  - 数据源：调 `client.getFiles` 或新增一个扫描附加路径的 IPC（复用 `workspace-fs-service.ts` 的 `scan` 方法，传附加路径作为根）
  - 或者直接用 `client.scanDirectory(path)` 之类的方法按需扫描
  - 注意：附加路径的文件树不需要文章节点合并（纯文件系统）

### 4.4 接入页面

- [ ] `app/page.tsx`
  - 右栏 `'additional'` Tab 内容从占位替换为 `<AdditionalFilesPanel workspaceId={workspace.id} />`

## 实施回填（做完后填）

### 实际改动

#### 后端 IPC（`electron/main/tipc/workspace.ts`）
- 新增 `pickDirectory` procedure：打开文件夹选择对话框，返回 `{ canceled, path }`
- 新增 `scanAdditionalPath` procedure：输入 `{ dirPath }`，递归扫描绝对路径目录，返回 `{ files: WorkspaceFileNode[] }`；路径不存在时返回空数组
- 新增模块级 `scanAbsDirectory(dirPath)` 辅助函数：递归扫描目录，跳过隐藏文件和 `node_modules`，返回绝对路径的 `WorkspaceFileNode[]`

#### workspace-store（`stores/workspace-store.ts`）
- 新增三个 actions：
  - `addAdditionalPath(path: string) → Promise<void>`：调 `client.addAdditionalPath`，成功后更新本地 `workspace`
  - `removeAdditionalPath(path: string) → Promise<void>`：调 `client.removeAdditionalPath`，更新本地
  - `toggleAdditionalPath(path: string, enabled: boolean) → Promise<void>`：调 `client.toggleAdditionalPath`，更新本地
- 失败时 toast 提示

#### UI 组件
- **新增 `components/ui/switch.tsx`**：基于 `radix-ui` 的 Switch 组件（shadcn/ui 风格）
- **新增 `components/AdditionalFilesPanel.tsx`**：
  - `AdditionalFilesPanel({ workspaceId })`：主面板，从 workspace-store 读 `additional_paths`
  - `AdditionalPathCard`：路径卡片（Switch 开关 + 路径信息 + 移除按钮）
  - `AdditionalFileTree`：展开时调 `client.scanAdditionalPath` 扫描目录，显示递归文件树
  - `FileTreeNode`：递归树节点，支持展开/折叠、点击文件引用到对话
  - 空状态提示、加载状态、目录不存在提示

#### 页面接入（`app/page.tsx`）
- 右栏 `'additional'` Tab 内容从 `<div>附加文件</div>` 替换为 `<AdditionalFilesPanel workspaceId={workspace.id} />`
- 清理了一个预存的未使用导入 `ArticlePreview`

### 给下一步的接力棒
- `pickDirectory` IPC 可复用于任何需要文件夹选择器的场景
- `scanAdditionalPath` IPC 返回绝对路径的 `WorkspaceFileNode[]`，可复用于其他需要扫描外部目录的场景
- `AdditionalFilesPanel` 组件只读 workspace-store，不维护自己的路径列表状态，路径变更全走 IPC + store
- 文件引用通过 `reference-store.addReferencedFile({ name, path })` 注入，path 为绝对路径，与设计文档一致
- Switch 组件位于 `components/ui/switch.tsx`，可复用
