# 微信 Bot Agent 集成实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让微信 Bot 充当 Dogear 的遥控器——通过斜杠命令切换工作区/对话，普通消息直接发给当前 Agent，最终回复发回微信。

**Architecture:** 新建 `wechat-bot-controller.ts` 作为消息路由中枢，收到消息后分两路：斜杠命令直接调用已有 service 层处理并回复微信；普通消息通过渲染层现有的 session 发给 Agent，监听 `sessionMessage` / `sessionComplete` 事件截取最终回复发回微信。渲染层通过新增 renderer-event（`wechatRemoteAction`）接收"切换工作区/对话/发消息"等指令，复用现有 store action。

**Tech Stack:** 主进程 TypeScript（Node）、tipc 事件、Zustand store（渲染层）、现有 `QueryBasedSessionManager`、`wechatILinkService`

---

## Task 1: 创建 Bot Controller — 命令解析骨架

**Files:**
- Create: `electron/main/services/wechat/wechat-bot-controller.ts`

**Step 1: 创建命令解析器和路由骨架**

```typescript
// electron/main/services/wechat/wechat-bot-controller.ts
/**
 * 微信 Bot 控制器
 *
 * 消息入口，分两路：
 * - "/" 开头 → 解析斜杠命令 → 调用对应 handler → 回复微信
 * - 普通文本 → 转发给当前激活的 Agent 会话 → 截取最终回复 → 回复微信
 */

import { mainLogger } from '../../agents/logger.js';
import { wechatILinkService } from './wechat-ilink-service.js';
import { wechatAuthService } from './wechat-auth-service.js';
import * as workspaceJsonService from '../../services/workspace-json-service.js';
import * as conversationService from '../../services/conversation-service.js';
import { getQueryBasedSessionManager } from '../../tipc/agent.js';
import { EventEmitter } from 'events';

const log = mainLogger;

export interface BotState {
  /** 当前激活的工作区 ID */
  activeWorkspaceId: string | null;
  /** 当前激活的对话 ID */
  activeConversationId: string | null;
  /** 当前 Agent 内部 session ID（QueryBasedSession 的 ID） */
  activeSessionId: string | null;
  /** 是否开启调试模式（把详细信息发回微信） */
  debugMode: boolean;
}

/**
 * 事件：
 * - 'remoteAction': 需要渲染层执行的操作（切换工作区/对话/发消息）
 * - 'stateChange': bot 状态变化
 */
class WechatBotController extends EventEmitter {
  private state: BotState = {
    activeWorkspaceId: null,
    activeConversationId: null,
    activeSessionId: null,
    debugMode: false,
  };

  /** 回复的 context_token 和 sender（从最近的来信中提取） */
  private replyContext: { contextToken: string; senderId: string } | null = null;

  /** 正在等待 Agent 回复 */
  private waitingForAgent = false;

  getState(): BotState {
    return { ...this.state };
  }

  /**
   * 处理收到的微信消息
   * 由 wechat-poller 的 onMessage 回调调用
   */
  async handleIncomingMessage(msg: {
    content: string;
    contextToken: string;
    senderId: string;
    messageType: string;
  }): Promise<void> {
    // 更新回复上下文
    this.replyContext = {
      contextToken: msg.contextToken,
      senderId: msg.senderId,
    };

    // 只处理文本消息
    if (msg.messageType !== 'text' || !msg.content.trim()) return;

    const text = msg.content.trim();

    if (text.startsWith('/')) {
      await this.handleCommand(text);
    } else {
      await this.handleAgentMessage(text);
    }
  }

  /**
   * 解析并执行斜杠命令
   */
  private async handleCommand(text: string): Promise<void> {
    const spaceIdx = text.indexOf(' ');
    const command = (spaceIdx === -1 ? text : text.slice(0, spaceIdx)).toLowerCase();
    const args = spaceIdx === -1 ? '' : text.slice(spaceIdx + 1).trim();

    try {
      switch (command) {
        case '/help':
          await this.cmdHelp();
          break;
        case '/status':
          await this.cmdStatus();
          break;
        case '/ws':
          await this.cmdWorkspace(args);
          break;
        case '/ls':
          await this.cmdListConversations();
          break;
        case '/use':
          await this.cmdUseConversation(args);
          break;
        case '/new':
          await this.cmdNewConversation();
          break;
        case '/stop':
          await this.cmdStop();
          break;
        case '/debug':
          await this.cmdToggleDebug();
          break;
        default:
          await this.reply(`未知命令: ${command}\n输入 /help 查看可用命令`);
      }
    } catch (err: any) {
      log.error(`[bot] 命令执行失败: ${command}`, err);
      await this.reply(`命令执行失败: ${err.message}`);
    }
  }

  /**
   * 将普通消息转发给 Agent
   */
  private async handleAgentMessage(text: string): Promise<void> {
    if (!this.state.activeSessionId) {
      await this.reply('当前没有激活的对话。\n用 /ls 查看对话列表，/use <编号> 选择对话，或 /new 新建对话。');
      return;
    }

    // 通过渲染层发送消息给 Agent
    this.emit('remoteAction', {
      type: 'sendMessage',
      sessionId: this.state.activeSessionId,
      conversationId: this.state.activeConversationId,
      content: text,
    });

    this.waitingForAgent = true;
  }

  // ─── 命令实现 ─────────────────────────────────────

  private async cmdHelp(): Promise<void> {
    await this.reply([
      '== Dogear Bot 命令 ==',
      '/help — 显示此帮助',
      '/status — 当前状态',
      '/ws — 列出工作区',
      '/ws <编号> — 切换工作区',
      '/ls — 列出当前工作区的对话',
      '/use <编号> — 切换到指定对话',
      '/new — 新建对话',
      '/stop — 中断当前 Agent',
      '/debug — 开关调试模式',
      '',
      '直接发送文本 → 转发给当前对话的 Agent',
    ].join('\n'));
  }

  private async cmdStatus(): Promise<void> {
    const ws = this.state.activeWorkspaceId
      ? await workspaceJsonService.getById(this.state.activeWorkspaceId)
      : null;

    let convTitle = '无';
    if (this.state.activeConversationId && this.state.activeWorkspaceId) {
      const conv = await conversationService.getById(
        this.state.activeWorkspaceId,
        this.state.activeConversationId,
      );
      convTitle = conv?.title || '未命名对话';
    }

    const sessionManager = getQueryBasedSessionManager();
    const session = this.state.activeSessionId
      ? sessionManager.getSession(this.state.activeSessionId)
      : null;

    await this.reply([
      '== 当前状态 ==',
      `工作区: ${ws?.name || '未选择'}`,
      `对话: ${convTitle}`,
      `Agent: ${session ? '已连接' : '未连接'}`,
      `调试: ${this.state.debugMode ? '开' : '关'}`,
    ].join('\n'));
  }

  private async cmdWorkspace(args: string): Promise<void> {
    const workspaces = await workspaceJsonService.getAll();

    if (!args) {
      // 列出工作区
      if (workspaces.length === 0) {
        await this.reply('没有工作区。请在 Dogear 桌面端创建。');
        return;
      }
      const lines = workspaces.map((ws, i) => {
        const marker = ws.id === this.state.activeWorkspaceId ? ' *' : '';
        return `${i + 1}. ${ws.name}${marker}`;
      });
      await this.reply(['== 工作区列表 ==', ...lines, '', '用 /ws <编号> 切换'].join('\n'));
      return;
    }

    // 切换工作区
    const idx = parseInt(args, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= workspaces.length) {
      await this.reply(`无效编号。可选: 1-${workspaces.length}`);
      return;
    }

    const target = workspaces[idx];
    await workspaceJsonService.setDefault(target.id);
    this.state.activeWorkspaceId = target.id;
    // 切换工作区后清除对话选择
    this.state.activeConversationId = null;
    this.state.activeSessionId = null;

    // 通知渲染层切换
    this.emit('remoteAction', {
      type: 'switchWorkspace',
      workspaceId: target.id,
    });

    await this.reply(`已切换到工作区: ${target.name}`);
  }

  private async cmdListConversations(): Promise<void> {
    if (!this.state.activeWorkspaceId) {
      await this.reply('请先选择工作区: /ws');
      return;
    }

    const conversations = await conversationService.getByWorkspaceId(this.state.activeWorkspaceId);
    if (conversations.length === 0) {
      await this.reply('当前工作区没有对话。用 /new 新建。');
      return;
    }

    const lines = conversations.map((conv, i) => {
      const marker = conv.id === this.state.activeConversationId ? ' *' : '';
      const title = conv.title || '未命名对话';
      return `${i + 1}. ${title}${marker}`;
    });

    await this.reply(['== 对话列表 ==', ...lines, '', '用 /use <编号> 选择'].join('\n'));
  }

  private async cmdUseConversation(args: string): Promise<void> {
    if (!this.state.activeWorkspaceId) {
      await this.reply('请先选择工作区: /ws');
      return;
    }

    if (!args) {
      await this.reply('用法: /use <编号>');
      return;
    }

    const conversations = await conversationService.getByWorkspaceId(this.state.activeWorkspaceId);
    const idx = parseInt(args, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= conversations.length) {
      await this.reply(`无效编号。可选: 1-${conversations.length}`);
      return;
    }

    const target = conversations[idx];
    this.state.activeConversationId = target.id;

    // 通知渲染层切换对话（会自动创建/恢复 session）
    this.emit('remoteAction', {
      type: 'switchConversation',
      workspaceId: this.state.activeWorkspaceId,
      conversationId: target.id,
    });

    await this.reply(`已切换到对话: ${target.title || '未命名对话'}`);
  }

  private async cmdNewConversation(): Promise<void> {
    if (!this.state.activeWorkspaceId) {
      await this.reply('请先选择工作区: /ws');
      return;
    }

    // 通知渲染层新建对话
    this.emit('remoteAction', {
      type: 'newConversation',
      workspaceId: this.state.activeWorkspaceId,
    });

    await this.reply('正在创建新对话...');
  }

  private async cmdStop(): Promise<void> {
    if (!this.state.activeSessionId) {
      await this.reply('当前没有活跃的 Agent 会话');
      return;
    }

    const sessionManager = getQueryBasedSessionManager();
    const session = sessionManager.getSession(this.state.activeSessionId);
    if (session) {
      await session.interrupt();
      this.waitingForAgent = false;
      await this.reply('已中断 Agent');
    } else {
      await this.reply('Agent 会话已不存在');
    }
  }

  private async cmdToggleDebug(): Promise<void> {
    this.state.debugMode = !this.state.debugMode;
    await this.reply(`调试模式: ${this.state.debugMode ? '已开启' : '已关闭'}`);
  }

  // ─── Agent 回复处理 ────────────────────────────────

  /**
   * 当 Agent 产生最终回复时调用
   * 由 tipc/agent.ts 中的 sessionMessage 监听器触发
   */
  async handleAgentReply(text: string): Promise<void> {
    if (!this.waitingForAgent) return;
    this.waitingForAgent = false;
    await this.reply(text);
  }

  /**
   * 当 Agent 会话完成时调用（无文本回复的情况）
   */
  async handleAgentComplete(): Promise<void> {
    this.waitingForAgent = false;
  }

  /**
   * 更新内部 session ID（渲染层创建/恢复 session 后通知）
   */
  updateSessionId(sessionId: string | null): void {
    this.state.activeSessionId = sessionId;
    log.info(`[bot] activeSessionId updated: ${sessionId?.slice(0, 8) || 'null'}`);
  }

  /**
   * 更新对话 ID（渲染层切换/新建对话后通知）
   */
  updateConversationId(conversationId: string | null): void {
    this.state.activeConversationId = conversationId;
  }

  /**
   * 初始化：加载默认工作区
   */
  async init(): Promise<void> {
    const defaultWs = await workspaceJsonService.getDefault();
    if (defaultWs) {
      this.state.activeWorkspaceId = defaultWs.id;
      log.info(`[bot] 初始化工作区: ${defaultWs.name}`);
    }
  }

  // ─── 工具 ──────────────────────────────────────────

  private async reply(text: string): Promise<void> {
    if (!this.replyContext) {
      log.warn('[bot] 没有回复上下文，无法发送');
      return;
    }

    const token = wechatAuthService.getToken();
    if (!token) {
      log.warn('[bot] 未认证，无法回复');
      return;
    }

    try {
      await wechatILinkService.sendMessage(
        token.botToken,
        token.baseUrl,
        {
          contextToken: this.replyContext.contextToken,
          toUserId: this.replyContext.senderId,
          content: text,
        },
      );
    } catch (err: any) {
      log.error(`[bot] 回复失败: ${err.message}`);
    }
  }
}

export const wechatBotController = new WechatBotController();
```

**Step 2: 更新 barrel export**

Modify: `electron/main/services/wechat/index.ts` — 添加：
```typescript
export { wechatBotController } from './wechat-bot-controller.js';
```

**Step 3: 编译验证**

Run: `bun run build:electron`
Expected: 成功，无错误

**Step 4: Commit**

```bash
git add electron/main/services/wechat/wechat-bot-controller.ts electron/main/services/wechat/index.ts
git commit -m "feat(wechat): 创建 Bot Controller 命令解析骨架"
```

---

## Task 2: 接入 Poller — 消息路由到 Bot Controller

**Files:**
- Modify: `electron/main/tipc/wechat.ts` — `wechat:startPolling` 的 onMessage 回调
- Modify: `electron/main/services/wechat/wechat-poller.ts` — 确保 ParsedMessage 有 messageType

**Step 1: 修改 `wechat:startPolling` 的 onMessage**

在 `electron/main/tipc/wechat.ts` 的 `wechat:startPolling` handler 中，消息到达后先走 botController，再推给渲染层：

```typescript
// 在文件顶部添加导入
import { wechatBotController } from '../services/wechat/wechat-bot-controller.js';

// 修改 onMessage 回调
onMessage: async (messages) => {
  // 1. 持久化
  await wechatMessageStore.appendMessages('_bot_', messages as any[]);
  // 2. 推送到渲染层（微信窗口展示）
  handlers.wechatNewMessage.send({ messages: messages as any[] });
  // 3. 每条消息过 bot controller
  for (const msg of messages) {
    await wechatBotController.handleIncomingMessage({
      content: msg.content,
      contextToken: msg.contextToken,
      senderId: msg.senderId,
      messageType: msg.messageType,
    });
  }
},
```

**Step 2: 在 `wechat:startPolling` 开头初始化 controller**

在 `await wechatPoller.start(...)` 之前加：

```typescript
// 初始化 bot controller（加载默认工作区等）
await wechatBotController.init();
```

**Step 3: 编译验证**

Run: `bun run build:electron`

**Step 4: Commit**

```bash
git add electron/main/tipc/wechat.ts
git commit -m "feat(wechat): poller 消息路由到 Bot Controller"
```

---

## Task 3: 渲染层 remoteAction 事件处理

**Files:**
- Modify: `electron/main/tipc/renderer-handlers.ts` — 新增 `wechatRemoteAction` 事件
- Modify: `app/wechat/page.tsx` 或 `app/page.tsx` — 监听事件并执行 store action

**Step 1: 在 renderer-handlers.ts 新增事件**

```typescript
// 微信远程操作指令（Bot Controller → 渲染层）
wechatRemoteAction: (data: {
  type: 'switchWorkspace' | 'switchConversation' | 'newConversation' | 'sendMessage';
  workspaceId?: string;
  conversationId?: string;
  sessionId?: string;
  content?: string;
}) => void;
```

**Step 2: 在主页面 `app/page.tsx` 监听 remoteAction**

在 HomePage 组件中新增 useEffect 监听 `rendererEvents.wechatRemoteAction`：

```typescript
// 监听微信 Bot 远程操作指令
useEffect(() => {
  const unsub = rendererEvents.wechatRemoteAction.listen(async (data) => {
    switch (data.type) {
      case 'switchWorkspace':
        if (data.workspaceId) {
          // 复用已有的工作区切换逻辑
          await loadWorkspace(data.workspaceId);
        }
        break;
      case 'switchConversation':
        if (data.conversationId) {
          // 通过 conversation-store 选中对话
          const conversations = useConversationStore.getState().conversations;
          const target = conversations.find(c => c.id === data.conversationId);
          if (target) {
            useConversationStore.getState().selectConversation(target);
          }
        }
        break;
      case 'newConversation':
        await useConversationStore.getState().newConversation();
        break;
      case 'sendMessage':
        if (data.sessionId && data.content) {
          // 复用 sendQueryBasedSessionMessage 发消息
          await client.sendQueryBasedSessionMessage({
            sessionId: data.sessionId,
            content: data.content,
          });
        }
        break;
    }
  });
  return unsub;
}, []);
```

**Step 3: 在 tipc/wechat.ts 的 startPolling 中注册 remoteAction 事件转发**

Bot Controller emit 的 `remoteAction` 需要通过 renderer handlers 发到渲染层：

```typescript
// 在 wechat:startPolling 中，初始化 bot controller 之后
wechatBotController.removeAllListeners('remoteAction');
wechatBotController.on('remoteAction', (action: any) => {
  handlers.wechatRemoteAction.send(action);
});
```

**Step 4: 编译验证**

Run: `bun run build:electron`

**Step 5: Commit**

```bash
git add electron/main/tipc/renderer-handlers.ts app/page.tsx electron/main/tipc/wechat.ts
git commit -m "feat(wechat): 渲染层 remoteAction 事件处理（工作区/对话切换/发消息）"
```

---

## Task 4: Agent 回复截取 — 最终回复发回微信

**Files:**
- Modify: `electron/main/tipc/wechat.ts` — 监听 sessionMessage/sessionComplete 事件
- Modify: `electron/main/tipc/renderer-handlers.ts` — 新增 `wechatSessionSync` 事件（渲染层→主进程同步 sessionId）

**Step 1: 在 `wechat:startPolling` 中监听 Agent 会话消息**

在 startPolling handler 中，注册 sessionManager 的事件监听：

```typescript
// 监听 Agent 会话消息，截取最终回复发回微信
const sessionManager = getQueryBasedSessionManager();

// 移除旧监听避免重复
sessionManager.removeAllListeners('wechat:sessionMessage');
sessionManager.removeAllListeners('wechat:sessionComplete');

sessionManager.on('sessionMessage', async (sessionId: string, message: any) => {
  const botState = wechatBotController.getState();
  // 只截取当前 bot 激活的 session 的消息
  if (sessionId !== botState.activeSessionId) return;

  // 只截取 assistant 的文本消息
  if (message.role === 'assistant' && message.type === 'text' && message.content) {
    // 收集文本（可能有多个 text block）
    const text = typeof message.content === 'string'
      ? message.content
      : Array.isArray(message.content)
        ? message.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n')
        : '';

    if (text.trim()) {
      await wechatBotController.handleAgentReply(text.trim());
    }
  }
});

sessionManager.on('sessionComplete', async (sessionId: string) => {
  const botState = wechatBotController.getState();
  if (sessionId !== botState.activeSessionId) return;
  await wechatBotController.handleAgentComplete();
});
```

**Step 2: 渲染层同步 sessionId 到 bot controller**

在 `renderer-handlers.ts` 新增：
```typescript
// 渲染层通知主进程当前活跃的 session（供 bot controller 使用）
wechatSessionSync: (data: {
  sessionId: string | null;
  conversationId: string | null;
}) => void;
```

在 `tipc/wechat.ts` 新增路由：
```typescript
'wechat:syncSession': t.procedure
  .input<{ sessionId: string | null; conversationId: string | null }>()
  .action(async ({ input }) => {
    wechatBotController.updateSessionId(input.sessionId);
    wechatBotController.updateConversationId(input.conversationId);
    return { success: true };
  }),
```

在渲染层 `hooks/useAgentSession.ts` 中，当 session 创建成功后调用：
```typescript
// session 创建后同步给微信 bot controller
client['wechat:syncSession']({
  sessionId: newSessionId,
  conversationId: conversationId,
});
```

**Step 3: 回复长文本截断**

微信消息有长度限制，在 `wechat-bot-controller.ts` 的 `reply()` 中加截断：

```typescript
// 微信单条消息限制约 2048 字符，超长则分段
const MAX_MSG_LEN = 2000;
if (text.length > MAX_MSG_LEN) {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += MAX_MSG_LEN) {
    chunks.push(text.slice(i, i + MAX_MSG_LEN));
  }
  for (const chunk of chunks) {
    await wechatILinkService.sendMessage(..., { ..., content: chunk });
  }
  return;
}
```

**Step 4: 编译验证**

Run: `bun run build:electron`

**Step 5: Commit**

```bash
git add electron/main/tipc/wechat.ts electron/main/tipc/renderer-handlers.ts
git commit -m "feat(wechat): Agent 回复截取发回微信 + 渲染层 sessionId 同步"
```

---

## Task 5: 渲染层同步 — useAgentSession 通知 sessionId

**Files:**
- Modify: `components/agent-chat/hooks/useAgentSession.ts` — session 创建/恢复后同步
- Modify: `lib/events.ts` — 注册 `wechatRemoteAction` 和 `wechatSessionSync` 事件

**Step 1: 在 `lib/events.ts` 注册新事件**

确认 `rendererEvents` 中包含新增的 `wechatRemoteAction` 事件定义。

**Step 2: 在 `useAgentSession.ts` 中同步 sessionId**

在 session 创建成功的回调中，调用 tipc 同步：

```typescript
// 在 createQueryBasedSession 成功后
try {
  await client['wechat:syncSession']({
    sessionId: session.sessionId,
    conversationId: props.conversationId,
  });
} catch { /* 微信模块可能未启用，忽略 */ }
```

同样在 session 关闭时同步 null。

**Step 3: 编译验证**

Run: `bun run build:electron`

**Step 4: Commit**

```bash
git add components/agent-chat/hooks/useAgentSession.ts lib/events.ts
git commit -m "feat(wechat): useAgentSession 同步 sessionId 到 bot controller"
```

---

## Task 6: 微信 Markdown 过滤

**Files:**
- Create: `electron/main/services/wechat/markdown-filter.ts`
- Modify: `electron/main/services/wechat/wechat-bot-controller.ts` — 回复前过滤

**Step 1: 创建简单的 Markdown 过滤器**

Agent 回复包含 Markdown（代码块、表格、链接等），微信不支持渲染。参考官方包的 `StreamingMarkdownFilter` 思路，做简单的静态过滤：

```typescript
// electron/main/services/wechat/markdown-filter.ts
/**
 * 过滤 Agent 回复中微信不支持的 Markdown 语法
 */
export function stripMarkdownForWechat(text: string): string {
  let result = text;

  // 移除代码块标记（保留内容）
  result = result.replace(/```[\w]*\n?/g, '');

  // 移除行内代码标记
  result = result.replace(/`([^`]+)`/g, '$1');

  // 移除粗体/斜体标记
  result = result.replace(/\*\*([^*]+)\*\*/g, '$1');
  result = result.replace(/\*([^*]+)\*/g, '$1');
  result = result.replace(/__([^_]+)__/g, '$1');

  // 简化链接为 "文字 (URL)"
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');

  // 移除标题标记
  result = result.replace(/^#{1,6}\s+/gm, '');

  // 简化表格（保留内容，去掉分隔线）
  result = result.replace(/^\|?[\s-:]+\|[\s-:|]+$/gm, '');
  result = result.replace(/\|/g, ' | ');

  // 清理多余空行
  result = result.replace(/\n{3,}/g, '\n\n');

  return result.trim();
}
```

**Step 2: 在 bot controller 的 reply 中使用**

```typescript
import { stripMarkdownForWechat } from './markdown-filter.js';

// 在 reply() 方法中
const filtered = stripMarkdownForWechat(text);
// 用 filtered 发送
```

**Step 3: 编译验证**

Run: `bun run build:electron`

**Step 4: Commit**

```bash
git add electron/main/services/wechat/markdown-filter.ts electron/main/services/wechat/wechat-bot-controller.ts
git commit -m "feat(wechat): Agent 回复 Markdown 过滤（适配微信纯文本）"
```

---

## Task 7: 权限请求转发微信

**Files:**
- Modify: `electron/main/tipc/wechat.ts` — 监听 permissionRequest 事件

**Step 1: 在 startPolling 中监听权限请求**

当 Agent 需要用户确认工具调用时，转发到微信：

```typescript
// 在 startPolling 中
// 监听权限请求（可选：转发到微信让用户远程确认）
// 这里只做通知，实际确认仍在桌面端
session.on('permissionRequest', ...) // 已有，由 agent.ts 注册

// 但 bot controller 可以监听 sessionManager 的事件来通知微信用户
// 这个比较复杂，先做简单版：只通知，不做远程确认
```

简单版：在 bot controller 添加 `handlePermissionRequest` 方法，当 debug 模式开启时通知微信：

```typescript
async handlePermissionNotify(toolName: string, sessionId: string): Promise<void> {
  if (!this.state.debugMode) return;
  if (sessionId !== this.state.activeSessionId) return;
  await this.reply(`[Agent 请求权限] 工具: ${toolName}\n请在桌面端确认`);
}
```

**Step 2: 编译验证**

Run: `bun run build:electron`

**Step 3: Commit**

```bash
git add electron/main/tipc/wechat.ts electron/main/services/wechat/wechat-bot-controller.ts
git commit -m "feat(wechat): debug 模式下权限请求通知微信"
```

---

## Task 8: 端到端测试 & 完善

**Step 1: 手动测试流程**

1. `bun run dev`
2. 点击微信按钮打开窗口，扫码登录
3. 手机微信发 `/help` → 应收到命令列表
4. 发 `/ws` → 应列出工作区
5. 发 `/ws 1` → 应切换工作区，桌面端同步切换
6. 发 `/ls` → 应列出对话
7. 发 `/use 1` → 应切换对话，桌面端对话面板同步
8. 发一条普通消息 → Agent 处理，最终回复发回微信
9. 发 `/stop` → 应中断 Agent
10. 发 `/status` → 应显示当前状态

**Step 2: 修复测试中发现的问题**

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat(wechat): 微信 Bot Agent 集成完成（斜杠命令 + Agent 消息转发）"
```
