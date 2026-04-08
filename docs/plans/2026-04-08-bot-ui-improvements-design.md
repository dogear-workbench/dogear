# 微信 Bot UI 改进设计

> 5 项改进：会话运行状态、自动初始化、Bot 绑定标记、Bot 输入显示、微信 Dialog 化

---

## 1. 会话运行状态提升到 Conversation 级别

### 问题
当前 `isStreaming` 存在 session-store 的 `SessionTab` 上，由 `AgentChat` 组件的 `isLoading` 同步。只有 desktop 端打开了 tab 且组件挂载时才更新。Bot 操作会话时 UI 无感知。

### 方案：主进程维护运行状态 + 事件广播

#### 主进程侧

在 `agent.ts` 的广播层（已有 `setBroadcaster`）扩展：

```typescript
// agent.ts 中的广播逻辑扩展
// 维护 conversationId → running 的映射
const runningConversations = new Map<string, boolean>();

// session 开始处理时（sendMessage 被调用时）
function markConversationRunning(sessionId: string, running: boolean) {
  const conversationId = sessionManager.getConversationIdBySession(sessionId);
  if (!conversationId) return;
  
  runningConversations.set(conversationId, running);
  
  // 广播给所有渲染层窗口
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    const h = getRendererHandlers<RendererHandlers>(win.webContents);
    h.conversationRunningStateChanged.send({
      conversationId,
      isRunning: running,
    });
  }
}
```

触发时机：
- `sendQueryBasedSessionMessage` 被调用时 → `markConversationRunning(sessionId, true)`
- `sessionComplete` 事件触发时 → `markConversationRunning(sessionId, false)`
- 无论消息来自 desktop 还是 bot，都走同一条路径

#### renderer-handlers 新增事件

```typescript
// renderer-handlers.ts
conversationRunningStateChanged: (data: {
  conversationId: string;
  isRunning: boolean;
}) => void;
```

#### 前端侧

在 `conversation-store.ts`（或 `session-store.ts`）中新增状态：

```typescript
// conversation-store.ts 扩展
runningConversationIds: Set<string>;

// 初始化时监听事件
rendererEvents.conversationRunningStateChanged.listen((data) => {
  set(state => {
    const newSet = new Set(state.runningConversationIds);
    if (data.isRunning) newSet.add(data.conversationId);
    else newSet.delete(data.conversationId);
    return { runningConversationIds: newSet };
  });
});
```

#### BookConversationList 修改

```tsx
// 原来的逻辑
const tab = tabs.find(t => t.conversationId === conv.id);
const isRunning = tab?.isStreaming ?? false;

// 新逻辑：优先用 conversation 级别的状态
const runningIds = useConversationStore(s => s.runningConversationIds);
const isRunning = runningIds.has(conv.id);
```

#### AgentChat 修改

移除 `AgentChat.tsx` 中通过 `useEffect` 同步 `isLoading` 到 `session-store.updateStreaming` 的逻辑。`isStreaming` tab 字段可以保留但不再是唯一来源，对话列表直接读 conversation 级别状态。

---

## 2. 扫码完成后自动执行 /status 和 /ls

### 问题
每次扫码连接后都要手动在微信中发 `/status` 和 `/ls`，操作繁琐。

### 方案：startPolling 成功后自动执行并推送结果

#### 新增 renderer-handler 事件

```typescript
// renderer-handlers.ts
wechatBotAutoInit: (data: {
  status: {
    workspaceId: string | null;
    workspaceName: string | null;
    conversationId: string | null;
    conversationTitle: string | null;
    debugMode: boolean;
  };
  conversations: Array<{
    index: number;
    id: string;
    title: string;
    updatedAt: string;
  }>;
}) => void;
```

#### wechat-bot-controller 新增方法

```typescript
// wechat-bot-controller.ts
getAutoInitData(): Promise<{
  status: BotStatusInfo;
  conversations: ConversationListItem[];
}> {
  // 复用 /status 和 /ls 的逻辑，但返回结构化数据而非格式化文本
  const status = this.getStatusInfo();
  const conversations = await this.getConversationList();
  return { status, conversations };
}
```

#### startPolling 中调用

```typescript
// tipc/wechat.ts - startPolling 成功后
await wechatBotController.init();

// 自动获取状态和对话列表
const autoInitData = await wechatBotController.getAutoInitData();
safeSend(() => handlers.wechatBotAutoInit.send(autoInitData));
```

#### 前端微信页面

收到 `wechatBotAutoInit` 后，显示：
- 当前工作区名称
- 对话列表（可点击，点击执行 `/use`）
- 省去用户手动输入 `/status` 和 `/ls`

---

## 3. 对话列表显示 Bot 绑定标记

### 问题
用户无法知道 bot 当前绑定了哪个对话。

### 方案：Bot 绑定变更时广播 + 前端显示图标

#### 新增 renderer-handler 事件

```typescript
// renderer-handlers.ts
wechatBotBindingChanged: (data: {
  conversationId: string | null;  // null 表示解绑
}) => void;
```

#### 广播时机

在 `wechat-bot-controller.ts` 的 `switchBotSession()` 中，每次切换成功后通过 `BrowserWindow.getAllWindows()` 广播：

```typescript
// switchBotSession 成功后
broadcastBotBinding(conversationId);

// 单独的广播函数
function broadcastBotBinding(conversationId: string | null) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    const h = getRendererHandlers<RendererHandlers>(win.webContents);
    h.wechatBotBindingChanged.send({ conversationId });
  }
}
```

同时在 detach 时广播 `null`（解绑）。

#### 前端状态

在 `conversation-store.ts` 中新增：

```typescript
botBoundConversationId: string | null;

// 初始化监听
rendererEvents.wechatBotBindingChanged.listen((data) => {
  set({ botBoundConversationId: data.conversationId });
});
```

#### BookConversationList 显示

```tsx
const botBoundId = useConversationStore(s => s.botBoundConversationId);
const isBotBound = conv.id === botBoundId;

// 在对话项上显示 Bot 图标
{isBotBound && <Bot className="w-3.5 h-3.5 text-green-500" />}
```

---

## 4. 实时显示 Bot 的输入内容

### 问题
Bot 通过 `session.sendMessage()` 发消息后，只有 agent 的回复通过流式广播到前端，bot 的输入（user 消息）没有广播。

### 方案：Bot 发消息前广播一条 user 消息

#### 修改 wechat-bot-controller 或 agent.ts

在 bot 调用 `session.sendMessage()` 之前，通过已有的广播机制发送一条 user 消息：

```typescript
// bot 发消息时的处理
async handleAgentMessage(text: string) {
  const sessionId = this.state.activeSessionId;
  if (!sessionId) return;
  
  // 1. 先广播 user 消息给前端（用于实时显示）
  broadcaster(sessionId, 'message', {
    type: 'human',
    message: {
      role: 'user',
      content: text,
    },
    // 标记来源
    source: 'wechat-bot',
  });
  
  // 2. 正常发送给 SDK
  const session = sessionManager.getSession(sessionId);
  await session.sendMessage(text);
}
```

#### 前端处理

`useSessionMessages` 已经通过 `sessionId` 过滤消息，只有打开了对应 tab 的窗口才会收到和渲染。不会串流。

对于 user 消息的渲染，可以在 `MessageItem` 中根据 `source === 'wechat-bot'` 加一个小标记（如 Bot 图标），区分是用户手动输入还是 bot 输入。

#### 注意事项

- sessionId 匹配机制保证不会串流（`data.sessionId !== sessionId` 时直接 return）
- 广播的 user 消息只用于 UI 显示，不影响 SDK 的历史记录（SDK 自己会记录）
- 如果 tab 没有打开，广播的消息无人消费，不会造成副作用

---

## 5. 微信控制面板 Dialog 化

### 问题
当前微信功能使用独立的 Electron 窗口（`createWechatWindow()` → `#/wechat` 路由），但实际内容很简单（QR 码 + 连接状态），不值得占用一个独立窗口。而且独立窗口中连接成功后只显示"正在监听消息"，信息量很低。

### 方案：改为 Dialog + 命令面板

将微信窗口改为主窗口中的 shadcn Dialog，内容分两个状态：

#### 未连接状态：QR 码扫描

复用现有 `QRCodeAuth` 组件，在 Dialog 中展示扫码流程。

#### 已连接状态：Bot 控制面板

上半部分显示连接状态 + bot 信息，下半部分显示所有可用命令列表（带解释），还结合需求 2 的自动初始化数据（对话列表可直接点击操作）。

```
┌─────────────────────────────────────────┐
│  微信 Bot 控制          [断开] [✕]      │
├─────────────────────────────────────────┤
│                                         │
│   🟢 已连接 · BotName                   │
│   工作区: xxx · 对话: xxx               │
│                                         │
├─────────────────────────────────────────┤
│  📋 对话列表            （自动加载）     │
│  ┌─────────────────────────────────┐    │
│  │ 1. 聊天 - 默认对话       [使用] │    │
│  │ 2. 读书笔记             [使用]  │    │
│  │ 3. 代码问答             [使用]  │    │
│  └─────────────────────────────────┘    │
│                                         │
├─────────────────────────────────────────┤
│  ⌨️ Bot 命令参考                        │
│                                         │
│  /help     显示帮助信息                  │
│  /status   查看当前状态                  │
│  /ws       列出所有工作区                │
│  /ws <n>   切换到第 n 个工作区           │
│  /ls       列出当前工作区的对话          │
│  /use <n>  切换到第 n 个对话             │
│  /new      新建对话                      │
│  /stop     中断当前 Agent 执行           │
│  /debug    开关调试模式                  │
│                                         │
└─────────────────────────────────────────┘
```

#### 实现细节

**1. 新建 Dialog 组件**

创建 `components/wechat/WechatDialog.tsx`，使用 shadcn `Dialog` 组件：

```tsx
// WechatDialog.tsx
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function WechatDialog({ open, onOpenChange }: Props) {
  // 复用 wechat-store 的所有状态和逻辑
  const { authState, ... } = useWechatStore();
  
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>微信 Bot 控制</DialogTitle>
        </DialogHeader>
        {authState !== 'connected' ? (
          <QRCodeAuth ... />
        ) : (
          <BotControlPanel ... />
        )}
      </DialogContent>
    </Dialog>
  );
}
```

**2. BotControlPanel 子组件**

新建 `components/wechat/BotControlPanel.tsx`，包含：
- 连接状态行（bot 名称、工作区、当前对话）
- 对话列表（可点击 use）— 数据来自需求 2 的 `wechatBotAutoInit` 事件
- 命令参考表（静态内容）

**3. 主窗口入口修改**

`app/page.tsx` 中将"微信"按钮从 `openWechatWindow()` 改为打开 Dialog：

```tsx
const [wechatDialogOpen, setWechatDialogOpen] = useState(false);

<Button variant="outline" size="sm" onClick={() => setWechatDialogOpen(true)}>
  <MessageCircle className="w-4 h-4 mr-2" />
  微信
</Button>

<WechatDialog open={wechatDialogOpen} onOpenChange={setWechatDialogOpen} />
```

**4. 清理独立窗口相关代码**

- 移除 `electron/main/index.ts` 中的 `createWechatWindow()`
- 移除 `tipc/agent.ts` 中的 `openWechatWindow` IPC
- 移除 `workspace-store.ts` 中的 `openWechatWindow` action
- 保留 `app/wechat/page.tsx` 但可以标记为废弃（或直接删除）
- 保留 `src/App.tsx` 中 `/wechat` 路由（向后兼容）或删除

**5. IPC 事件监听迁移**

原来在 `WechatPage` 中的 `rendererEvents` 监听需要迁移到 `wechat-store.ts` 中用 store 级别的初始化完成（避免 Dialog 关闭后丢失监听）。或者在 `app/page.tsx`（主页面，始终挂载）中注册监听。

**6. 对话列表的 /use 操作**

点击对话列表的"使用"按钮时，需要一个新的 IPC API 来执行 bot 的 `/use` 命令：

```typescript
// tipc/wechat.ts 新增
'wechat:botUseConversation': t.procedure
  .input(z.object({ index: z.number() }))
  .action(async ({ input }) => {
    await wechatBotController.switchBotSessionByIndex(input.index);
    return { success: true };
  }),
```

---

## 实现顺序

1. **需求 5**（Dialog 化）— 替换独立窗口，这是 UI 框架改动，先做
2. **需求 1**（运行状态）— 新增 renderer-handler 事件 + 广播逻辑 + 前端 store + 组件
3. **需求 3**（Bot 绑定标记）— 新增 renderer-handler 事件 + 广播 + 前端 store + 组件
4. **需求 4**（Bot 输入显示）— 修改 bot 消息发送逻辑 + 前端消息渲染
5. **需求 2**（自动初始化）— 修改 startPolling + 新增事件 + Dialog 中的对话列表

需求 1 和 3 可以并行开发（都是新增事件+前端状态）。
需求 2 和 5 紧密相关（Dialog 中显示自动初始化数据）。

---

## 涉及文件

### 主进程
- `electron/main/tipc/renderer-handlers.ts` — 新增 4 个事件
- `electron/main/tipc/agent.ts` — 运行状态广播逻辑 + 移除 openWechatWindow
- `electron/main/tipc/wechat.ts` — 自动初始化 + bot 输入广播 + botUseConversation
- `electron/main/services/wechat/wechat-bot-controller.ts` — getAutoInitData() + 绑定广播 + 消息广播
- `electron/main/index.ts` — 移除 createWechatWindow()

### 前端（新增）
- `components/wechat/WechatDialog.tsx` — 新的 Dialog 组件
- `components/wechat/BotControlPanel.tsx` — 已连接状态的控制面板

### 前端（修改）
- `app/page.tsx` — 微信按钮改为打开 Dialog
- `stores/conversation-store.ts` — 新增 runningConversationIds + botBoundConversationId
- `stores/wechat-store.ts` — 新增自动初始化数据状态 + 事件监听迁移
- `stores/workspace-store.ts` — 移除 openWechatWindow action
- `components/BookConversationList.tsx` — 运行状态 + bot 图标显示
- `components/agent-chat/AgentChat.tsx` — 可能移除旧的 isStreaming 同步
- `components/agent-chat/hooks/useSessionMessages.ts` — 处理 bot user 消息

### 可删除
- `app/wechat/page.tsx` — 独立窗口页面（Dialog 替代）
- `src/App.tsx` 中 `/wechat` 路由（可选保留）
