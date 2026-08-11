---
step: 5
title: 引用机制扩展
status: done
---

## 目标

扩展引用机制支持文件和文件夹引用；主工作区文件树 + 附加路径文件树都支持引用交互；ChatInputArea 显示引用芯片；发送消息时注入路径。

## 依赖上下文（接力棒输入）

- 前置 step：[step3-layout.md] WorkspaceExplorer 已在右栏「文件」Tab 渲染
- 前置 step：[step4-additional-panel.md] 附加路径文件树就绪
- `reference-store.ts` 当前引用类型：article（`{ id, title, ... }`）+ quoteSnippet（`{ articleId, text, ... }`）
- `ChatInputArea.tsx` 当前展示 article 引用芯片
- `useSendMessage.ts` 当前在发送时把 article 引用注入消息

## 计划改动

### 5.1 reference-store 扩展引用类型

- [ ] `stores/reference-store.ts`
  - 新增 `FileReference { type: 'file'; path: string; name: string }`
  - 新增 `FolderReference { type: 'folder'; path: string; name: string }`
  - 新增 `fileFolderRefs: FileReference[] | FolderReference[]`（或统一的 `pathRefs: PathReference[]`）
  - 新增 actions：`addPathRef(ref)` / `removePathRef(path)` / `clearPathRefs()`
  - 去重：`addPathRef` 时检查 path 是否已存在，已存在则跳过
  - 发送后清理：与现有 article 引用一致，发送消息后清空 pathRefs

### 5.2 ChatInputArea 引用芯片

- [ ] `components/agent-chat/ChatInputArea.tsx`
  - 在现有引用芯片区域（article 芯片旁边）渲染 path 引用芯片
  - 文件芯片：📄 图标 + 文件名，点击 ✕ 移除
  - 文件夹芯片：📁 图标 + 文件夹名，点击 ✕ 移除
  - 统一用 lucide `File` / `Folder` 图标

### 5.3 文件树引用交互

- [ ] `components/WorkspaceExplorer.tsx`
  - 文件节点：右键 ContextMenu 加「引用」项，或点击文件时调 `referenceStore.addPathRef({ type: 'file', path, name })`
  - 文件夹节点：右键 ContextMenu 加「引用文件夹」项
  - 引用后给视觉反馈（toast 提示或节点高亮）
- [ ] `components/AdditionalFilesPanel.tsx`（或其内部文件树组件）
  - 同上：文件和文件夹节点都支持引用交互

### 5.4 消息注入

- [ ] `components/agent-chat/hooks/useSendMessage.ts`
  - 发送消息前，读 `referenceStore.pathRefs`
  - 非空时拼到消息内容前部：
    ```
    [用户引用了以下路径]
    - D:\projectB\src\utils.ts
    - D:\projectB\src\components\

    <用户实际输入的消息>
    ```
  - 拼接后作为完整消息文本传给 `piSession.sendMessage(text)`
  - 发送后 `referenceStore.clearPathRefs()`（与 article 引用清理一致）

### 5.5 session-window 页面兼容（可选）

- [ ] 如果独立会话窗口也有 ChatInputArea，确认 path 引用芯片和注入逻辑能复用（通常 AgentChat 组件是共享的，应该自动兼容）

## 实施回填（做完后填）

### 实际改动

#### 1. `stores/reference-store.ts`
- `FileReference` 接口新增 `type?: 'file' | 'folder'` 字段（默认 'file'，向后兼容）
- 复用现有 `referencedFiles` / `addReferencedFile` / `removeReferencedFile` / `clearReferencedFiles`，无需新增独立数组

#### 2. `components/agent-chat/ChatInputArea.tsx`
- 文件/文件夹引用芯片根据 `file.type` 显示不同图标：`FileText`（文件）/ `Folder`（文件夹）
- 注释从「文件引用芯片」改为「文件/文件夹引用芯片」

#### 3. `components/WorkspaceExplorer.tsx`
- 新增 `import { toast } from 'sonner'`
- 文件节点右键菜单「引用到对话」添加 `toast.success` 反馈
- 文件夹节点右键菜单新增「引用文件夹到对话」，调用 `addReferencedFile({ ..., type: 'folder' })`

#### 4. `components/AdditionalFilesPanel.tsx`
- `AdditionalFileTree` 的 `onReference` 回调根据 `node.type === 'directory'` 传入 `type: 'folder'`
- `FileTreeNode` 的 hover 引用按钮不再限制为仅文件，文件夹也可引用，tooltip 区分「引用文件夹到对话」/「引用到对话」

#### 5. `components/agent-chat/hooks/useSendMessage.ts`
- 文件引用注入 XML 标签中，文件夹路径添加 `type="folder"` 属性

### 给下一步的接力棒
- `FileReference` 的 `type` 是可选字段，现有调用方均不需要修改
- 所有引用类型共用 `referencedFiles` 数组，发送时统一在 `<referenced_files>` 标签内注入
- session-window 页面通过共享的 `AgentChat` 组件自动获得引用功能，无需额外改动
