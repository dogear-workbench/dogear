---
step: 3
title: UI 布局调整
status: done
---

## 目标

左栏去掉 Tab 切换只留对话列表；右栏 Tab 改为 文件 / 附加 / 共享区；文章预览隐藏（代码保留不渲染）。

## 依赖上下文（接力棒输入）

- 前置 step：无强依赖（纯前端改动），但 IPC 路由需就绪才能让附加 Tab 有数据交互（Step 2）
- 当前布局在 `app/page.tsx`：左栏 `leftPanelTab` 切换「对话 / 文件」，右栏 `rightPanelTab` 切换「预览 / 共享区」
- `ui-store.ts` 持有 `leftPanelTab` / `rightPanelTab` / `leftPanelOpen` / `rightPanelOpen`

## 计划改动

### 3.1 ui-store Tab 类型调整

- [ ] `stores/ui-store.ts`
  - 删除 `leftPanelTab` / `setLeftPanelTab`（左栏不再需要 Tab 切换）
  - `rightPanelTab` 类型从 `'preview' | 'shared'` 改为 `'files' | 'additional' | 'shared'`
  - `rightPanelTab` 默认值改为 `'files'`

### 3.2 主页面布局

- [ ] `app/page.tsx`
  - 左栏：删除 Tab 切换栏（`leftPanelTab` 的两个 button），直接渲染 `<ConversationList />`
  - 左栏 import：移除 `leftPanelTab` / `setLeftPanelTab` 的 useUIStore 订阅
  - 右栏 Tab 栏：三个 button（文件 / 附加 / 共享区），替换原来的预览 / 共享区
  - 右栏 Tab 内容：
    - `'files'` → `<WorkspaceExplorer />`（从左栏移过来）
    - `'additional'` → `<AdditionalFilesPanel />`（Step 4 新增，这里先占位 `<div>附加文件</div>`）
    - `'shared'` → `<SharedAreaPanel />`（不变）
  - 文章预览：删除右栏 `rightPanelTab === 'preview'` 分支的渲染（代码注释掉或条件设为 false），ArticlePreview import 保留
  - 顶部导航栏：删除 `selectedArticle` 自动展开右栏的 effect，或改为选中文件时展开

### 3.3 清理无用的 leftPanelTab 引用

- [ ] 全局搜索 `leftPanelTab` / `setLeftPanelTab`，清理所有引用（可能只有 `app/page.tsx`）

## 实施回填（做完后填）

### 实际改动
- `stores/ui-store.ts`：删除 `leftPanelTab` / `setLeftPanelTab`（interface + 初始值 + reset）；`rightPanelTab` 类型 `'preview' | 'shared'` → `'files' | 'additional' | 'shared'`，默认值 `'preview'` → `'files'`
- `app/page.tsx`：
  - 左栏：删除 Tab 切换栏，直接渲染 `<ConversationList />`
  - 右栏：Tab 改为三按钮（文件 / 附加 / 共享区），`'files'` → `<WorkspaceExplorer />`，`'additional'` → 占位 `<div>附加文件</div>`，`'shared'` → `<SharedAreaPanel />`
  - 删除 `rightPanelTab === 'preview'` 分支（ArticlePreview import 保留但不再渲染）
  - 删除 `selectedArticle` 自动展开右栏的 effect + `openRightPanel` 订阅
  - 清理未使用变量/import：`selectedFile`、`FileIcon`、`ScrollArea`

### 给下一步的接力棒
- 右栏 `'additional'` Tab 当前为占位 `<div>附加文件</div>`，Step 4 替换为 `<AdditionalFilesPanel />`
- `ArticlePreview` import 保留（按计划要求），如 Step 4+ 不再需要可一并移除
- `openRightPanel` / `closeRightPanel` 仍在 ui-store 中导出，当前 page.tsx 不再订阅，但 AgentChat 或其他组件可能使用，未删除
