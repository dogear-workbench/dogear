---
step: 5
title: 共享区右侧面板 Tab
status: pending
---

## 目标

在现有右侧预览面板（文件树/文章预览所在位置）新增"共享区" Tab，跟随当前打开的会话所在组自动显示。Tab 内分两段：**原生项**（带 CRUD）+ **引用项**（带 ↗ 角标和添加入口）。

## 依赖上下文（执行时填）

- 前置 step 产出：[step4] group-shared-service IPC API；[step2] group-store
- 当前关键文件状态：执行前读 `app/page.tsx`（三栏布局/右侧面板挂载点）/ `components/WorkspaceExplorer.tsx`（参考文件树面板的 Tab 切换 if 有）/ `components/ArticlePreview.tsx`（参考预览类组件结构）
- 关键决策回顾：会话切换时右侧共享区自动跟着切（不需要用户手动选组）

## 计划改动

### 新组件 `components/SharedAreaPanel.tsx`
- props: `{ workspaceId: string; groupId: string | null }`
- 内部：
  - 顶部：当前组标题（按 deriveGroupTitle 推导）+ 「+ 新建文件」/「+ 添加引用」两个按钮
  - 中部：分两段折叠区：
    - **原生项**：调 `client.listSharedFiles` 拿列表，点行预览（用 MarkdownRenderer 渲染 .md 或纯文本块），右键改名/删除
    - **引用项**：调 `client.listSharedReferences` 拿列表，每项显示文件名 + 路径 + ↗ 角标，点击调 `client.readReferencedFile` 预览（或跳到 WorkspaceExplorer 高亮）
  - 空状态：组为 null 或没有任何文件时显示"暂无共享内容"
- 内部状态用 useState 管刷新触发器；预览选中用 useState

### 右侧面板挂载
- 修改 `app/page.tsx`（或右侧面板的容器组件）：
  - 右侧面板新增 Tab 切换：当前的文件树/文章预览 + 新的「共享区」Tab
  - 「共享区」Tab 默认选中状态：当用户选中了某会话且会话所在组有 sharedReferences 或原生项时自动选中（否则保持上次选择）
  - 跟随会话切换：用 `useEffect` 监听 `currentGroupId`，传给 `<SharedAreaPanel groupId={currentGroupId} />`

### 新建/添加交互
- "+ 新建文件" 按钮：弹 confirm-store 输入相对路径（如 `notes.md`），调 `client.writeSharedFile` 写空内容
- "+ 添加引用" 按钮：弹一个 workspace 文件选择器（可复用现有 WorkspaceExplorer 的文件选择模式，或简单的 input + 工作区目录树弹窗），选中后调 `client.addReference`

### 内部联动
- 任何 CRUD 后自增 refresh 计数器触发 list 重拉
- 删除时弹 confirm-store 二次确认
- 错误（路径越界等）用 toast 提示

## 验证

- `bun run dev` 启动后：
  - 选中任意会话，右侧面板能切换到「共享区」Tab，显示该组的共享内容
  - 切换到另一组的会话，共享区内容自动跟着换
  - 点 "+ 新建文件" → 输入 `test.md` → 文件出现在原生项列表，能预览
  - 点 "+ 添加引用" → 选 workspace 内某文件 → 引用项列表多一条，能预览
  - 右键删除任意项有 confirm
  - 切回"文件树" Tab 旧功能保持

## 实施回填（做完后填）

### 实际改动

### 给下一步的接力棒
- SharedAreaPanel props：
- 右侧面板 Tab state 形式：
- 待办或已知限制：
