# 会话组与共享区交互重构 设计

## 背景

当前会话组（Group）与共享区（SharedArea）的体验有三块痛点：

1. **新建对话流程多余一步**——要先点 `FolderPlus` 建空组，再「在组内新建对话」；不建组的话顶部按钮只能建无组对话，组反而像高级特性。
2. **组在 UI 上太重**——`GroupCard` 用 Layers 图标 + 较大行高，视觉抢戏，但其实组只是为了让用户「看清哪些会话是一组的」。
3. **共享区两个手动按钮基本无用**——`Plus`（新建空文件）+ `Link`（输入路径添加引用）都需要 Dialog 输入路径，体验远不如拖放/复用左侧文件树；而且共享区的真实用途是「agent 产物落地 + 给后续会话或其他组引用」，人不会去手动新建。

## 目标

- 「新建对话」一步完成（隐式建组）；组保留但视觉退到背景。
- 共享区瘦身：只承载 agent 产物展示 + 引用入口 + 「在资源管理器打开」。
- 「引用」作为统一抽象：共享区里的 agent 产物可以像文章/会话那样被引用进当前消息。
- 工作区外文件读取靠 SDK 现有权限请求流，不做静态登记机制。

## 架构

### 组（Group）

- **入口收敛**：顶部「新建对话」=「新建组 + 在组内建第一个对话」一步完成；删掉单独的 `FolderPlus` 按钮和「在当前组新建」分支。
- **组卡片视觉降级**：
  - 去 `Layers` 图标。
  - 组标题字号收一档、加淡色背景（让会话区像被框住）。
  - 组卡片右侧加 `+` 按钮 = 在该组新建对话。
- **保持 1 对话 = 1 组的常态**——多对话同组要靠组上的 `+` 显式加。组的 `title` 默认为空，显示时取「组内第一条对话的标题」做派生（已有 `deriveGroupTitle`）。

### 共享区（SharedArea）

- **砍掉「原生项 / 引用项」分段**——只展示 agent 写到组共享目录的真实文件。
- **砍掉顶部 `Plus` / `Link` 按钮**，换成：
  - 「在资源管理器打开」按钮（`shell.openPath` 打开组的共享目录）。
- **每行操作**：
  - 点击 = 预览（**仅 `.md`** 用 `MarkdownRenderer`；其他扩展名不渲染，引导用户去资源管理器看）。
  - 「引用到当前消息」按钮 = 加到 `reference-store.referencedSharedFiles`，输入框出现芯片，发送时拼 `<referenced_shared_file>` XML 块。
  - 删除按钮。
- **工作区外文件**：本轮不做共享区登记。Agent 试 Read 触发 SDK 权限请求 → `PermissionRequestCard` 弹窗 → 用户允许即可。

### 引用抽象

`reference-store.ts` 已有 `referencedArticles / quotedSnippets / referencedFiles / referencedConversations` 四种，新增 `referencedSharedFiles`：

```ts
interface SharedFileReference {
  groupId: string;
  relPath: string;   // 共享目录下相对路径
  absPath: string;   // 给 agent 读用
}
```

发送时按 `.claude/rules/message-references.md` 现有约定，拼一个 XML 标签块：

```xml
<referenced_shared_files>
  <shared_file group_id="..." rel_path="..." abs_path="..." />
</referenced_shared_files>
```

## 模块边界

### 前端

| 文件 | 改动 |
|------|------|
| `components/conversation-list/Toolbar.tsx` | 删 `FolderPlus` 按钮；「新建对话」改为「新建组 + 组内建对话」组合调用 |
| `components/group-list/GroupCard.tsx` | 去 `Layers`；视觉降级（字号 / 淡底）；右侧加 `+` 按钮新建组内对话 |
| `components/SharedAreaPanel.tsx` | 大改：删两个 Dialog 和「原生/引用项」分段；列表只剩 agent 文件；每行加「引用」按钮；顶部加「在资源管理器打开」 |
| `components/agent-chat/ChatInputArea.tsx` | 渲染 `referencedSharedFiles` 芯片 |
| `components/agent-chat/hooks/useSendMessage.ts` | 发送时拼 `<referenced_shared_files>` XML 块；发送后 clear |
| `stores/reference-store.ts` | 新增 `referencedSharedFiles` 字段 + add/remove/clear actions |
| `stores/group-store.ts` | 删 `addReference / removeReference`（共享区不再有引用项） |
| `stores/conversation-store.ts` | `newConversation` 内部改成「先 createGroup → 拿 groupId → create({ workspaceId, groupId })」 |

### 后端

| 文件 | 改动 |
|------|------|
| `electron/main/services/group-shared-service.ts` | 删引用项相关 API（`listSharedReferences / addReference / readReferencedFile / removeReference`） |
| `electron/main/tipc/group.ts` | 同步删 IPC；新增 `openSharedAreaInExplorer({ workspaceId, groupId })` |
| `electron/main/agents/group-context-builder.ts` | 移除把 `sharedReferences` 注入 system prompt 的逻辑（如有） |
| `types/group.ts` | `Group` 删 `sharedReferences` 字段；删 `SharedReference` 类型；保留 `NativeFileEntry` |
| `types/electron-api.ts` | 镜像同步 |

### 数据迁移

按项目约定**开发期不做兼容**：已落盘的 `groups.json` 里 `sharedReferences` 字段读时忽略即可，下次写时自然丢弃。

## 数据流

### 新建对话

```
用户点「新建对话」
  → conversation-store.newConversation
    → group-store.createGroup({})    // 隐式建组，title 空
    → client.create({ workspaceId, groupId })
    → loadConversations + openTab
  → 列表自动出现一张新组卡片，里面挂着这个新对话
```

### 共享区引用 agent 产物

```
Agent 在某组里跑工具，写出 .md 报告到组共享目录
  → 用户切到「共享区」Tab 看到这个文件
  → 点「引用」按钮 → reference-store.addReferencedSharedFile({ groupId, relPath, absPath })
  → ChatInputArea 出现芯片
  → 用户发送消息 → useSendMessage 拼 XML → query() 发出
  → 接收侧 agent 看到 `<shared_file abs_path="..." />` → 用 Read 工具读取（路径已在 additionalDirectories 内）
```

### 共享区在资源管理器打开

```
用户点「在资源管理器打开」
  → client.openSharedAreaInExplorer({ workspaceId, groupId })
  → 主进程 shell.openPath(共享目录绝对路径)
```

## 错误处理 / 边界情况

- **新建对话时 createGroup 失败**：toast 报错，不创建对话（已有错误处理路径）。
- **共享区目录不存在**：「在资源管理器打开」前先确保目录存在（mkdir -p）；列表为空时显示「Agent 产物会在这里出现」占位。
- **预览非 md 文件**：直接显示「不支持预览，点击在资源管理器打开」提示，不下载内容到内存。
- **引用 agent 产物时文件已被删**：发送前不做存在性校验（agent 自己 Read 失败时会报错给用户）；reference-store 里允许悬空，移除按钮可手动清。
- **组 title 永远为空**：UI 用 `deriveGroupTitle` 派生为「组内第一条对话标题」；如果组内没对话（理论上不会发生，因为建组立即建对话）则显示「未命名组」。

## 附带修复（同批一起做）

### Bug A：重命名"闪一下又回去"

**症状**：右键组卡片 / 对话行 → 选「重命名」→ input 出现一瞬间立即被打回查看态。

**根因**：Radix `ContextMenu` 关闭时异步调用 `onCloseAutoFocus`，把焦点强制还原到 trigger（行容器 div）。这个还原晚于 `startEditing` 里 `setTimeout(0)` 的 `input.focus()`，导致 input 被 blur，触发 `onBlur={saveTitle}`，`saveTitle` 设 `setIsEditing(false)` —— 编辑态秒退。

**修复**：在 `ConversationRow.tsx` 和 `GroupCard.tsx` 的 `<ContextMenuContent>` 上加：
```tsx
<ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
```
让我们 setTimeout 控制的焦点保留，不再被 Radix 抢走。

### Bug B：新建对话"闪一下"

**症状**：点新建 → 整个对话列表区瞬间被 loading spinner 替换，新对话出现时列表"闪一下"。

**根因**：`ConversationList.tsx:48` 无条件判断 `if (loadingConversations) return <spinner />`，而 `loadConversations()` 一进去就 `set loadingConversations: true`。新建路径里 `newConversation` 和 Toolbar.handleNew 都会在创建后调 `loadConversations()` 刷新，期间整段列表被 spinner 替换。

**修复**：把判断改成只在首次加载（无数据）时显示 spinner，刷新场景静默更新：
```tsx
if (loadingConversations && conversations.length === 0) {
  return <spinner />;
}
```

### 验证路径

- **重命名**：右键任一组/对话 → 点「重命名」→ input 出现并保持焦点和光标，能输入；Esc 取消、Enter 保存、点别处保存
- **新建**：点顶部「新建对话」或组卡片 `+` → 列表区不被 spinner 替换，新对话直接出现并选中

## 未决问题

- **组视觉降级的具体样式**（字号 / 颜色 / padding 数值）：实施时按手感迭代，本设计不锁死。
- **共享区目录约定**：当前 `group-shared-service` 已经定下目录位置，沿用即可（实施时确认下路径，必要时镜像到 design 里）。
- **`SharedFileReference` 是否需要在前端跨会话持久化**：暂按现有 reference-store 套路——会话级临时态，刷新即清。如果用户后续抱怨「切回上次的对话发现引用没了」再扩持久化。
