# Step 3 交付：UI 布局调整

## 改动文件

### 1. `stores/ui-store.ts`
- **删除** `leftPanelTab: 'conversations' | 'explorer'` 及 `setLeftPanelTab`（interface 声明 + 初始值 + reset 内引用）
- **修改** `rightPanelTab` 类型：`'preview' | 'shared'` → `'files' | 'additional' | 'shared'`
- **修改** `rightPanelTab` 默认值：`'preview'` → `'files'`（初始值 + reset 内同步）
- `openRightPanel` / `closeRightPanel` 保留在 store 中未删除（其他组件可能引用）

### 2. `app/page.tsx`
- **左栏**：删除 Tab 切换栏（两个 button），直接渲染 `<ConversationList />`
- **右栏 Tab 栏**：三个按钮（文件 / 附加 / 共享区），替换原预览 / 共享区
- **右栏 Tab 内容**：
  - `'files'` → `<WorkspaceExplorer />`（从左栏移过来）
  - `'additional'` → 占位 `<div>附加文件</div>`（Step 4 替换为 `<AdditionalFilesPanel />`）
  - `'shared'` → `<SharedAreaPanel />`（不变）
- **删除** `rightPanelTab === 'preview'` 分支的整个渲染（ArticlePreview / 文件预览 / 空状态提示）
- **删除** `selectedArticle` 自动展开右栏的 effect + `openRightPanel` 订阅
- **清理** 未使用变量/import：
  - `selectedFile`（workspace-store）
  - `FileIcon`（lucide-react import）
  - `ScrollArea`（import）
  - `leftPanelTab` / `setLeftPanelTab`（ui-store 订阅）
- **保留** `ArticlePreview` import（按计划要求，代码保留不渲染）

## 验证
- `bun run build:electron` ✅ 通过
- `npx vite build` ✅ 通过
- `npx tsc --noEmit` 中 page.tsx / ui-store.ts 无报错（预存错误在 AboutTab / DigestsPanel / ReviewPanel，与本改动无关）
- 全局搜索 `leftPanelTab` / `setLeftPanelTab` 在 `*.{ts,tsx}` 中零匹配

## 遗留 / 注意事项
- `openRightPanel` / `closeRightPanel` 仍在 ui-store 中导出但 page.tsx 不再订阅，如确认无其他组件使用可在后续 step 清理
- 右栏 `'additional'` Tab 为占位，等 Step 4 `AdditionalFilesPanel` 组件就绪后替换
