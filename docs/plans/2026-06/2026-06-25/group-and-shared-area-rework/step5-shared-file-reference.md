---
step: 5
title: 共享文件作为消息引用
status: done
---

## 目标

把共享区里 agent 写出的文件做成可以「引用到当前消息」—— 和文章/会话引用一个语义层级。用户点共享区某行的「引用」按钮 → 输入框出现芯片 → 发送时拼 `<referenced_shared_files>` XML 块 → 接收侧 agent 拿到绝对路径自己用 Read 工具读。

## 依赖上下文（接力棒输入）

- 前置 step：Step 4 共享区瘦身完成
- 关键现状：
  - `stores/reference-store.ts` 已有四种引用：`referencedArticles` / `quotedSnippets` / `referencedFiles` / `referencedConversations`，每种都 `add* / remove* / clear*` 三件套，`reset()` 统一清空
  - `.claude/rules/message-references.md`：引用 XML 约定（标签放消息 content blocks 前面，用户输入在最后）
  - `components/agent-chat/ChatInputArea.tsx`：渲染各类型芯片，需要新增一种
  - `components/agent-chat/hooks/useSendMessage.ts`：发送时把 reference-store 内容拼成 XML，需要新增一段
  - Step 4 接力棒：共享文件绝对路径如何拿到（可能要新加 IPC 或扩展 `listSharedFiles`）

## 计划改动

### 数据流准备：暴露绝对路径

- [ ] `electron/main/tipc/group.ts`：`listSharedFiles` 返回值加 `sharedDir: string`（绝对路径），或新增 `getSharedDir` IPC。**推荐**：扩展 `listSharedFiles` 返回 `{ files, sharedDir, error }`，前端拼 `absPath = sharedDir + '/' + relPath`
- [ ] `electron/main/services/group-shared-service.ts`：`listNativeFiles` 已经拿到 sharedDir，直接顺带返回即可
- [ ] `types/electron-api.ts`：返回类型同步

### Store

- [ ] `stores/reference-store.ts`：新增
  ```ts
  interface SharedFileReference {
    groupId: string;
    relPath: string;
    absPath: string;
  }
  ```
  以及 state `referencedSharedFiles: SharedFileReference[]`，actions `addReferencedSharedFile / removeReferencedSharedFile / clearReferencedSharedFiles`，`reset()` 同步清空。去重 key 用 `absPath`。

### 共享区 UI

- [ ] `components/SharedAreaPanel.tsx`：
  - `listSharedFiles` 返回的 `sharedDir` 存到本地 state
  - 每行 row 加「引用」按钮（lucide `Link2` 或 `MessageSquarePlus`），onClick 调 `useReferenceStore.getState().addReferencedSharedFile({ groupId, relPath: f.relPath, absPath: sharedDir + '/' + f.relPath })`，toast 成功
  - 删除按钮保留

### 输入框芯片

- [ ] `components/agent-chat/ChatInputArea.tsx`：渲染 `referencedSharedFiles` 芯片
  - 复用现有芯片样式，选一个与文章/会话有视觉区分的颜色（建议绿色或青色）
  - 显示 `relPath`，点击 X 调 `removeReferencedSharedFile(absPath)`

### 发送拼 XML

- [ ] `components/agent-chat/hooks/useSendMessage.ts`：在已有引用拼装段落后追加一段
  ```ts
  if (referencedSharedFiles.length > 0) {
    const xml = '<referenced_shared_files>\n' +
      referencedSharedFiles.map(f =>
        `  <shared_file group_id="${escapeXml(f.groupId)}" rel_path="${escapeXml(f.relPath)}" abs_path="${escapeXml(f.absPath)}" />`
      ).join('\n') +
      '\n</referenced_shared_files>';
    blocks.push({ type: 'text', text: xml });
  }
  ```
  发送后 `clearReferencedSharedFiles()`

### 规则文档

- [ ] `.claude/rules/message-references.md`：补一种新引用类型说明，给后续 agent 解析参考

## 验证

- 共享区每行有「引用」按钮，点击 → 输入框出现绿色（或新颜色）芯片显示文件路径
- 发送消息后 → 在消息历史里查 raw text 能看到 `<referenced_shared_files>` 块；agent 回复中能正确 Read 这个文件
- 芯片可手动移除（点 X）
- 发送后芯片自动清空
- `bun run build:electron && bun run build && bun run lint` 通过

## 实施回填（做完后填）

### 实际改动

执行人：executor 子代理。9 处改动全部落地：

- `electron/main/services/group-shared-service.ts` — `listNativeFiles` 返回 `{ files, sharedDir }`
- `electron/main/tipc/group.ts` — `listSharedFiles` 解构后返回多 `sharedDir` 字段（错误路径补 `sharedDir: ''`）
- `electron/main/agents/group-context-builder.ts` — `natives` 改内联类型 + 解构 `result.files`
- `electron/main/agents/tools/group-tools.ts` — `ListGroupFiles` 工具内部解构 `{ files }`
- `stores/reference-store.ts` — 新增 `SharedFileReference` 接口、`referencedSharedFiles` state、add/remove/clear 三 action、`reset()` 同步
- `components/SharedAreaPanel.tsx` — 加 `Link2` import、`sharedDir` state、`SharedFileRow` 加 onReference 引用按钮（蓝绿色 hover）
- `components/agent-chat/ChatInputArea.tsx` — 加 `Folder` icon import、订阅 referencedSharedFiles，渲染淡青柠（lime）芯片
- `components/agent-chat/hooks/useSendMessage.ts` — 订阅 + 在「会话引用」XML 段后追加 `<referenced_shared_files>` 拼装 + clearReferencedSharedFiles
- `.claude/rules/message-references.md` — 追加「4. 共享文件引用」类型说明

验证：`bun run build:electron` 通过；`bun run lint` 0 errors（83 warnings 均为既有）。

### 给下一步的接力棒

- 整个重构完成，无后续 step
- 待手测：①点共享区每行 Link2 按钮 → 输入框淡青柠芯片显示 relPath；②发送后 raw text 应含 `<referenced_shared_files>` 块；③接收侧 agent 能用 Read 工具拿到 abs_path 读取文件；④芯片 X 可移除；⑤发送后芯片自动清空
