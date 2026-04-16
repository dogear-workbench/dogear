# UX 改进 V2 设计文档

> 2026-04-02 | 8项改进：子代理实时展示、工作区切换重置、系统托盘、滚动优化、分叉修复、删除编辑重发

---

## 一、子代理实时展示与详情面板（第1、2、3点）

### 1.1 问题

- 子代理运行时无法实时看到执行内容，只能看最终结果
- 右侧没有统一的子代理列表（运行中 + 已完成）
- **新运行的子代理无法查看详情**，必须重启项目才行（根因：运行中子代理的消息走内存事件流，`getSubAgentHistory` 读的是磁盘 JSONL 文件，运行中时文件未写完）

### 1.2 方案

#### 后端：子代理消息实时转发

**`query-based-session.ts`**：
- 监听 SDK 子代理的 `sessionMessage` 事件
- 通过 `rendererEvents` 新增 `subAgentMessage` 事件转发每条消息
- 消息格式复用 `ExtendedSessionMessage`，增加 `parentSessionId` + `agentId` 字段标识来源
- 子代理生命周期事件：`subAgentStarted`（子代理开始）、`subAgentCompleted`（子代理结束）

**`renderer-handlers.ts`**：
- 新增事件定义：`subAgentMessage`、`subAgentStarted`、`subAgentCompleted`

**`tipc/agent.ts`**：
- `getSubAgentHistory` 保持不变，用于已完成子代理的历史加载

#### 前端：右侧面板新增"子代理" Tab

**位置**：`app/page.tsx` 右侧面板区域

**两级结构**：
- **第一级：子代理列表**（仅显示当前对话的子代理）
  - 运行中排在前面，蓝色脉冲标记
  - 已完成按完成时间倒序排列
  - 显示：描述、类型、状态、时长
- **第二级：子代理详情**
  - 点击列表项展开完整会话流
  - **渲染复用主会话的组件**（`MessageItem` + `ContentBlockItem` + `ToolBlock` 等）
  - 运行中：监听 `subAgentMessage` 实时事件渲染
  - 已完成：调用 `getSubAgentHistory` 加载 JSONL 历史渲染
  - 两种数据源，同一套渲染逻辑

**自动行为**：
- 新子代理开始运行时，右侧自动切换到子代理 tab 并选中该子代理
- 子代理列表跟随当前对话切换（切换对话时列表刷新）

#### 数据流

```
运行中子代理:
  SDK event → query-based-session 拦截
    → IPC subAgentMessage → 前端实时接收
    → 复用 streamReducer 转换为 ContentBlock[]
    → MessageItem/ContentBlockItem 渲染

已完成子代理:
  getSubAgentHistory → 读取 JSONL 文件
    → 复用 historyTransformer 转换为 Message[]
    → MessageItem/ContentBlockItem 渲染
```

#### 涉及文件

| 文件 | 改动 |
|------|------|
| `electron/main/agents/query-based-session.ts` | 拦截子代理消息事件，通过 IPC 转发 |
| `electron/main/tipc/renderer-handlers.ts` | 新增 subAgentMessage/Started/Completed 事件 |
| `app/page.tsx` | 右侧面板增加子代理 tab |
| `components/agent-chat/SubAgentPanel.tsx` | 重写：两级列表 + 实时/历史统一渲染 |
| `components/agent-chat/SubAgentBlock.tsx` | 简化：移除内嵌详情，改为触发右侧面板选中 |
| `components/agent-chat/hooks/useSubAgentMessages.ts` | 新增：监听子代理实时消息事件 |
| `components/agent-chat/transformers.ts` | 复用现有 streamReducer/historyTransformer |
| `stores/ui-store.ts` | 增加右侧面板 tab 状态（子代理 tab 激活） |

---

## 二、工作区切换全状态重置（第4点）

### 2.1 问题

当前 `clearWorkspace()` 只清除 workspace-store 自身状态，其他 store（对话、文章、分析、引用、标签页等）未被清理，旧工作区的状态残留在内存中。

### 2.2 方案

切换工作区 = 软重启，所有 store 回到初始值。

**`workspace-store.ts` 的 `clearWorkspace()`**：

```typescript
clearWorkspace: async () => {
  // 1. 通知后端关闭所有打开的 Agent 会话
  //    （遍历当前所有 sessionId，调用 closeQueryBasedSession）

  // 2. 级联重置所有相关 store 到初始状态
  useConversationStore.getState().reset()    // 对话列表、选中对话、forkParams
  useArticleStore.getState().reset()         // 文章列表、选中文章
  useReferenceStore.getState().reset()       // 引用列表
  useAnalysisStore.getState().reset()        // 分析状态
  useUIStore.getState().reset()              // 右侧面板、设置 overlay
  useSlashCommandStore.getState().reset()    // 斜杠命令
  // session-store（标签页）也要重置

  // 3. 最后清除 workspace-store 自身
  set({ workspace: null, files: [], selectedFile: null, selectedBook: null, workspaceFilePath: null })
}
```

**每个 store 新增 `reset()` 方法**，将状态设回初始值（类似 zustand 的 `initialState` 模式）。

#### 涉及文件

| 文件 | 改动 |
|------|------|
| `stores/workspace-store.ts` | clearWorkspace 级联调用所有 reset |
| `stores/conversation-store.ts` | 新增 reset() |
| `stores/article-store.ts` | 新增 reset() |
| `stores/reference-store.ts` | 新增 reset() |
| `stores/analysis-store.ts` | 新增 reset() |
| `stores/ui-store.ts` | 新增 reset() |
| `stores/slash-command-store.ts` | 新增 reset() |
| `stores/session-store.ts`（标签页） | 新增 reset() |

---

## 三、系统托盘最小化（第5点）

### 3.1 方案

**`electron/main/index.ts`**：

```typescript
// 创建托盘
let tray: Tray | null = null;
let isQuitting = false;

function createTray() {
  tray = new Tray(iconPath);  // 使用应用图标
  const contextMenu = Menu.buildFromTemplate([
    { label: '显示窗口', click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setToolTip('Dogear');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

// 拦截主窗口关闭
mainWindow.on('close', (event) => {
  if (!isQuitting) {
    event.preventDefault();
    mainWindow.hide();  // 隐藏到托盘
  }
});

// 真正退出时设置标记
app.on('before-quit', () => { isQuitting = true; });
```

#### 涉及文件

| 文件 | 改动 |
|------|------|
| `electron/main/index.ts` | 新增 createTray()、拦截 close 事件、isQuitting 标记 |

#### 图标

需要一个托盘图标文件（Windows 用 `.ico`），放在 `electron/main/assets/` 或 `resources/` 目录下。可以复用现有的应用图标。

---

## 四、滚动行为优化（第6点）

### 4.1 问题

当前缺少"消息更新时自动跟随滚动"的逻辑——只有手动点击"跳到最新"按钮才能到底部。

### 4.2 方案

**`AgentChat.tsx`**：

```
核心逻辑：
  messages 变化时（useEffect）：
    if (isAtBottom) → scrollToBottom('smooth')
    else → newMsgCount++

  用户手动滚到底部 → isAtBottom = true → 后续消息自动跟随
  用户向上滚动 → isAtBottom = false → 停止跟随，显示"跳到最新"按钮
```

**注意**：流式消息更新频率很高（每个 token），滚动需要 throttle（~100ms）避免性能问题。

#### 涉及文件

| 文件 | 改动 |
|------|------|
| `components/agent-chat/AgentChat.tsx` | useEffect 监听 messages 变化 + throttled scrollToBottom |

---

## 五、分叉 UUID 修复（第7点）

### 5.1 问题

分叉时选取的 UUID 有误。分叉的语义是：在某处点击分叉，**之前的完整会话都要带走**（包括点击位置的那轮 assistant 回答）。当前实现少了最后一轮 assistant 回答。

### 5.2 方案

检查 `useSendMessage.ts` 中 `handleFork` 传递的 `sdkUuid`：

- 分叉按钮在 assistant 消息上 → 传该 assistant 消息的 `sdkUuid` 作为 `resumeSessionAt`
- SDK 的 `resumeSessionAt` 语义：截断到该消息（**含**该消息）

需要验证当前代码传的是哪条消息的 UUID。如果传的是 assistant 的上一条 user 消息的 UUID，就会丢失 assistant 回答。修复为传 assistant 消息自身的 UUID。

#### 涉及文件

| 文件 | 改动 |
|------|------|
| `components/agent-chat/MessageItem.tsx` | 检查分叉按钮传递的 UUID 参数 |
| `components/agent-chat/hooks/useSendMessage.ts` | handleFork 中 UUID 选取逻辑修正 |

---

## 六、删除编辑重发功能（第8点）

### 6.1 理由

fork 功能已完整实现，编辑重发本质上是"fork 到同一个对话 + 自动发送编辑消息"，这个操作可以由用户通过 fork 手动完成。保留两套逻辑增加了代码复杂度且容易引起混淆。

### 6.2 删除范围

| 文件 | 删除内容 |
|------|----------|
| `stores/conversation-store.ts` | `ResendDraft` 类型、`resendDraftMap` 状态、`setResendDraft()`、`clearResendDraft()`、`editResend()` action |
| `components/agent-chat/hooks/useSendMessage.ts` | `handleEditResend()` 函数、`handleSend` 中 resendDraft 相关分支 |
| `components/agent-chat/ChatInputArea.tsx` | 重发模式 UI（取消/确认按钮、重发提示文本） |
| `components/agent-chat/MessageItem.tsx` | 用户消息上的"重新发送"按钮 |
| `components/agent-chat/hooks/useAgentSession.ts` | editResend 自动发送逻辑（forkParams.editedMessage 分支） |
| `components/agent-chat/AgentChat.tsx` | resendDraft 相关的 props 传递和状态 |
| `types/agents.ts` 或 `ForkParams` | `editedMessage`、`isForkNewConversation` 等仅服务于 editResend 的字段（评估是否 fork 本身还需要） |

**保留**：fork 功能完整保留，`forkConversation`、`handleFork`、`ForkParams` 中 fork 相关字段不动。

---

## 实施顺序建议

| 优先级 | 任务 | 复杂度 | 依赖 |
|--------|------|--------|------|
| 1 | 删除编辑重发（第8点） | 低 | 无，纯删除 |
| 2 | 分叉 UUID 修复（第7点） | 低 | 删除重发后更清晰 |
| 3 | 滚动行为优化（第6点） | 低 | 无 |
| 4 | 系统托盘（第5点） | 中 | 无 |
| 5 | 工作区切换重置（第4点） | 中 | 无 |
| 6 | 子代理实时展示（第1、2、3点） | 高 | 最复杂，放最后 |
