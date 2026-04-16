# 会话管理优化设计

> 2026-03-27 | 修复重发/分叉 bug + 4 项交互改进

---

## 概述

本次优化涵盖 5 个改动，按优先级排序：

1. **Bug 修复** — 重发和分叉的运行时行为与设计意图不符
2. **分叉增强** — 延迟 SDK 会话创建 + 分叉来源标识
3. **重发交互改造** — 内容放回输入框，发送时才截断
4. **新对话自动标题** — 首条消息截取为标题
5. **工作区文件引用** — 文件路径引用到对话

---

## 1. Bug 修复：重发/分叉行为异常

### 问题现象

- **重发**（editResend）：应在当前对话截断重写，实际却新建了对话
- **分叉**（fork）：应创建新对话独立分支，实际却覆盖了原会话内容

### 设计意图（正确的）

| 操作 | forkSession | 对话记录 | SDK 行为 |
|------|-------------|---------|---------|
| 编辑重发 | `false` | 当前对话 | resume + resumeSessionAt 截断原 session |
| 分叉 | `true` | 新建对话 | resume + forkSession 创建新 session |

### 排查方向

1. **`useAgentSession.ts`** — 检查 forkParams 不同模式下 session_id 更新时目标 conversation 是否正确
2. **`conversation-store.ts`** — 检查 `updateSdkSessionId` 是否被错误调用到原对话
3. **SDK 返回验证** — 确认 `forkSession:false` 时 SDK 是否返回相同 session_id
4. **`agent.ts` IPC** — 检查 createQueryBasedSession 返回的 sessionId 在前端如何更新到 conversations.json

### 修复原则

- 编辑重发模式（`forkSession:false`）：session_id 更新到**当前**对话
- 分叉模式（`forkSession:true`）：新 session_id 更新到**新建的分叉**对话，原对话不动

---

## 2. 分叉增强：延迟 SDK 会话 + 来源标识

### 问题

分叉创建新对话后，SDK 尚未执行新会话（没有 JSONL），用户看到空白页面。

### 方案：延迟创建 + fork_pending 状态

#### 数据模型变更

`Conversation` 新增字段：

```typescript
interface Conversation {
  // ... 已有字段 ...
  fork_pending?: boolean;  // 分叉已创建但 SDK 会话未建立
}
```

已有的 `parent_conversation_id` 和 `fork_message_sdk_uuid` 足够支持分叉来源信息。

#### 流程变更

**当前流程：**
```
创建分叉对话 → 立即启动 SDK fork 会话 → 等待用户输入
```

**新流程：**
```
创建分叉对话(fork_pending:true)
  → 加载父对话截断历史显示（只读）
  → 顶部显示来源 banner
  → 用户发送第一条消息时 → 启动 SDK fork 会话 → fork_pending:false
```

#### 前端 UI

**分叉来源 Banner（对话顶部）：**
- 条件：`fork_pending === true` 且 `parent_conversation_id` 存在
- 内容：`"🔀 分叉自: [父对话标题]"` + 点击跳转到父对话
- 时机：用户发送第一条消息并获得新 sessionId 后，banner 消失

#### 历史消息展示

fork_pending 状态下，需要加载父对话的截断历史供用户参考：
- 调用 `getSessionMessages(parentSdkSessionId)` 获取父对话历史
- 截取到 `fork_message_sdk_uuid` 为止
- 以**只读**方式显示（无编辑/分叉按钮）

#### 涉及文件

| 文件 | 改动 |
|------|------|
| `types/electron-api.ts` | Conversation 新增 `fork_pending` 字段 |
| `electron/main/services/conversation-service.ts` | createFork 时设 `fork_pending: true` |
| `stores/conversation-store.ts` | forkConversation 不再立即设 forkParams；新增加载父历史逻辑 |
| `components/agent-chat/hooks/useAgentSession.ts` | fork_pending 时不启动 SDK 会话；首次发送时才启动 |
| `components/agent-chat/AgentChat.tsx` | 分叉来源 Banner 组件 |
| `components/agent-chat/hooks/useMessageHistory.ts` | fork_pending 时加载父对话截断历史 |

---

## 3. 重发交互改造：放回输入框

### 当前行为

点击重发 → 弹出编辑框 → 直接截断历史 + 自动发送

### 新行为

点击重发 → 内容放入输入框 + 显示重发指示芯片 → 用户可修改 → 点击发送时执行截断 + resume

### 状态设计

`conversation-store.ts` 新增：

```typescript
resendDraft?: {
  messageIndex: number;       // 原消息在消息列表中的索引
  forkPointSdkUuid: string;   // 截断点（原消息前的 assistant UUID）
  originalContent: string;    // 原始消息内容
};
setResendDraft: (draft: ResendDraft | null) => void;
```

### 交互细节

1. **点击重发**：`handleEditResend` 改为设置 `resendDraft` + 填充输入框，不做截断
2. **输入框芯片**：`ChatInputArea` 检测 `resendDraft` 存在时显示 `↩ 重新发送 · 来自第 N 条消息  ×`
3. **取消重发**：点击 `×` 清除 resendDraft + 清空输入框
4. **发送**：`handleSend` 检测 resendDraft 存在时走重发分支：截断历史 → resume + resumeSessionAt → 发送消息
5. **发送成功后**：清除 resendDraft

### 涉及文件

| 文件 | 改动 |
|------|------|
| `stores/conversation-store.ts` | 新增 resendDraft 状态和 setter |
| `components/agent-chat/hooks/useSendMessage.ts` | handleEditResend 改为设置 draft；handleSend 增加重发分支 |
| `components/agent-chat/ChatInputArea.tsx` | 重发指示芯片 UI |
| `components/agent-chat/MessageItem.tsx` | 编辑重发按钮交互调整 |

---

## 4. 新对话自动标题

### 触发条件

- 当前对话标题为 `"新对话"`（默认值）
- 用户发送第一条消息时

### 截取规则

- 去除 XML 引用标签（`<referenced_articles>` / `<quoted_snippet>` / `<referenced_files>`）
- 取纯文本前 30 个字符
- 超过 30 字加 `...` 后缀
- 去掉首尾空白

### 实现位置

`useSendMessage.ts` 的 `handleSend` 中，发送消息后：

```typescript
if (conversationTitle === '新对话' && messages.length === 0) {
  const titleText = userMessage.replace(/<[^>]+>/g, '').trim();
  const autoTitle = titleText.length > 30
    ? titleText.slice(0, 30) + '...'
    : titleText;
  if (autoTitle) {
    updateConversationTitle(conversationId, autoTitle);
  }
}
```

### 涉及文件

| 文件 | 改动 |
|------|------|
| `components/agent-chat/hooks/useSendMessage.ts` | handleSend 中添加自动标题逻辑 |

---

## 5. 工作区文件引用

### 交互方式

- WorkspaceExplorer 右键菜单增加"引用到对话"选项
- 输入框上方显示文件引用芯片：`📄 filename.txt  ×`

### 发送格式

```xml
<referenced_files>
  <file name="design.md" path="C:/dogear/docs/plans/design.md" />
</referenced_files>
```

Agent 通过 `Read` 工具自行读取文件内容。

### 状态管理

`reference-store.ts` 扩展：

```typescript
interface FileReference {
  name: string;      // 文件名
  path: string;      // 绝对路径
}

interface ReferenceState {
  // ... 已有文章引用 ...
  referencedFiles: FileReference[];
  addReferencedFile: (file: FileReference) => void;
  removeReferencedFile: (filePath: string) => void;
  clearReferencedFiles: () => void;
}
```

### 涉及文件

| 文件 | 改动 |
|------|------|
| `stores/reference-store.ts` | 新增 file 引用状态 |
| `components/agent-chat/ChatInputArea.tsx` | 渲染文件引用芯片 |
| `components/agent-chat/hooks/useSendMessage.ts` | 发送时组装 `<referenced_files>` XML |
| `components/WorkspaceExplorer.tsx` | 右键菜单增加"引用到对话" |

---

## 实施顺序建议

1. **Bug 修复**（#1） — 最高优先级，影响核心功能
2. **重发改造**（#3） — 与 bug 修复相关，一起改
3. **分叉增强**（#2） — 依赖 bug 修复完成
4. **自动标题**（#4） — 独立改动，随时可做
5. **文件引用**（#5） — 独立改动，随时可做

其中 #4 和 #5 互相独立，可以并行开发。
