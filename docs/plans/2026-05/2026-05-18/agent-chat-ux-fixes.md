# Agent Chat UX 修复实施计划

> **For Claude:** 实施时使用 superpowers:executing-plans 按任务推进。

**目标:** 修复 9 个 AgentChat 体验/渲染问题，覆盖滚动跟随、Opus thinking 显示、status 灰点、SDK 工具名、TodoWrite/Edit/Write 渲染、插话 UI、subagent Haiku 兜底、Markdown 文件浮窗预览。

**方法:** UI 层精修 + 1 处 SDK 参数注入 + 1 处环境变量兜底 + 1 个新预览组件。不引入新依赖；新增渲染组件遵循 `components/agent-chat/` 现有拆分风格。

**技术栈:** React 19 + Vite + Zustand + shadcn/ui + lucide-react + `@anthropic-ai/claude-agent-sdk`

---

## 总览

| 批次 | 任务 | 把握 | 文件 |
|------|------|------|------|
| 1 | 滚动跟随发送后立即触底 | 95% | `components/agent-chat/hooks/useChatScroll.ts` |
| 1 | 屏蔽 status 灰点泛滥 | 95% | `electron/main/agents/query-based-session.ts:1197` |
| 1 | 插话 UI 立即渲染 | 90% | `components/agent-chat/hooks/useSendMessage.ts:421-449` + `useSessionMessages.ts:57-69` |
| 2 | SDK 内置工具显示具体名 | 95% | `components/ToolBlock.tsx:200-205` + `stores/tool-registry-store.ts` |
| 2 | TodoWrite 专用渲染 | 90% | 新建 `components/agent-chat/TodoListBlock.tsx` + `ContentBlockItem.tsx` 分流 |
| 2 | Edit/Write/Bash 增强渲染 | 85% | 新建 `components/agent-chat/CodeChangeBlock.tsx` + `ToolBlock.tsx` 分流 |
| 3 | Opus thinking display=summarized | 80% | `electron/main/agents/query-based-session.ts:208-217` |
| 3 | Subagent 模型 Haiku 兜底（修复 Explore effort 400 错误） | 90% | `electron/main/agents/agent-query-config.ts:149-151` |
| 4 | Markdown 文件点击浮窗渲染 | 80% | 新建 `components/MarkdownFileDialog.tsx` + 新增 `explorer/readFile` IPC + `WorkspaceExplorer.tsx:607-617` 分流 |

**执行顺序:** 批次 1（体验阻塞）→ 批次 2（渲染清晰度）→ 批次 3（思考可见性+subagent 兜底，需重启验证）→ 批次 4（新能力）。每个任务后单独 commit。

---

## 批次 1：体验类（先做，阻塞最重）

### Task 1: 修复发送消息后自动滚动跟随

**根因:**
`useChatScroll.ts:47-65` 的 useEffect 在 `isLoading=true` 触发时仅设置 `followRef.current = true` 并绑定 ResizeObserver；ResizeObserver 初次 observe 通常不立即触发，要等 DOM 实际变化才回调。而用户点发送的瞬间 isLoading 在同一渲染帧还是 false，所以 `AgentChat.tsx:463` 的 `scrollToBottom('instant')` 走 `useChatScroll.ts:87` 的 `if (isLoading) followRef.current = true` 分支时也是 false，不设置 follow。新消息渲染后没人滚。

**Files:**
- Modify: `components/agent-chat/hooks/useChatScroll.ts:47-65`
- Modify: `components/agent-chat/hooks/useChatScroll.ts:78-91`（`scrollToBottom`）

**Step 1: 修改 `scrollToBottom` 无条件设置 followRef**

把第 87 行：
```ts
if (isLoading) followRef.current = true;
```
改成：
```ts
followRef.current = true;
```
理由：调用方明确表达"我要去底部并跟随"，不必依赖当前 isLoading。

**Step 2: 修改 isLoading useEffect 进入时立即触底一次**

`useChatScroll.ts:47-65` 改成：
```ts
useEffect(() => {
  if (!isLoading) {
    followRef.current = false;
    return;
  }
  followRef.current = true;
  const vp = getViewport();
  if (!vp) return;
  vp.scrollTop = vp.scrollHeight; // 进入回答态立即触底一次
  const content = vp.firstElementChild;
  if (!content) return;
  const obs = new ResizeObserver(() => {
    if (followRef.current) {
      vp.scrollTop = vp.scrollHeight;
    }
  });
  obs.observe(content);
  return () => obs.disconnect();
}, [isLoading, getViewport]);
```

**Step 3: 手动验证**

`bun run dev` → 选一个长对话顶部 → 输入消息回车 → 期待：
- 消息发出瞬间视口已经到底部
- AI 流式回复时视口持续跟随到底部
- 用户手动往上滚 → 立即停止跟随，不会被回弹

**Step 4: Commit**

```bash
rtk git add components/agent-chat/hooks/useChatScroll.ts
rtk git commit -m "fix(agent-chat): 发送消息后立即触底并稳定跟随"
```

---

### Task 2: 屏蔽 status 灰点系统提示

**根因:**
`query-based-session.ts:1197-1201` 是 system 子消息的兜底分支，所有未识别的 `subtype` 都被包装成 `type: 'status'` 块。SDK 每轮回答会发若干个 system 事件（如 `init`, `cwd_changed`, 等），全部落到这里，前端 `ContentBlockItem.tsx:108-114` 渲染成灰点 + 文本，于是出现 10+ 个灰点。

**Files:**
- Modify: `electron/main/agents/query-based-session.ts:1197-1201`

**Step 1: 把兜底分支改为忽略**

```ts
return {
  type: 'status',
  status: sdkMessage.subtype,
  timestamp
};
```
改成：
```ts
return null;
```

**Step 2: 检查上游消费**

确认 `createMessageStream` 链路里 `null` 会被 `.filter(Boolean)` 之类丢弃。如果没有过滤，需要在 emit 处加 `if (!msg) return;`。
- 检索点：`grep -n "filter\|if (!msg" electron/main/agents/query-based-session.ts`
- 大概率已有；其他 `return null` 分支（如 hook_started）也是这么处理。

**Step 3: 编译 + 验证**

```bash
rtk bun run build:electron
rtk bun run dev
```
新建对话 → 发消息 → 期待：AI 回答过程中**不**再出现灰点 + 英文 subtype 文本。

**Step 4: 可选清理**

`components/agent-chat/ContentBlockItem.tsx:108-114` 的 `case 'status'` 分支已经无后端来源。可以保留（防御性渲染），但建议在 commit message 中标注"`type: 'status'` 分支现已弃用，等下次清理再删"。**本任务不删**。

**Step 5: Commit**

```bash
rtk git add electron/main/agents/query-based-session.ts
rtk git commit -m "fix(agent): 屏蔽未识别 system 子消息的 status 兜底"
```

---

### Task 3: 插话消息立即渲染到消息流

**根因:**
`useSendMessage.ts:421-449` 在 `isLoading` 时只把消息加入 `queuedMessagesRef`，UI 上不渲染，注释说"等后端通过 user 事件渲染"。`useSessionMessages.ts:57-69` 的 dequeue 依赖 SDK 推送 `type: 'user'` echo 事件；但 SDK 0.2.x 的 async generator 输入模式下不会 echo 用户输入，所以队列永远不消费，UI 一直显示"排队中"。

**改法:** 不依赖 SDK echo，直接在 `useSendMessage` 排队分支里把 `newUserMessage` push 到 messages 数组并附加 assistant 占位（与空闲分支保持一致），同时仍然 push 到 `queuedMessagesRef` 让后端的 user 事件到来时能"对账消费"而不重复插入。

**Files:**
- Modify: `components/agent-chat/hooks/useSendMessage.ts:421-449`
- Modify: `components/agent-chat/hooks/useSessionMessages.ts:57-69`

**Step 1: useSendMessage 排队分支也插入 messages**

`useSendMessage.ts:421-449` 改成：
```ts
if (isLoading) {
  const entry: QueuedMessageEntry = {
    content: messageToSend,
    ...(textBlocks.length > 1 && { textBlocks }),
    ...(imagesToSend.length > 0 && {
      images: imagesToSend.map(img => ({ base64: img.base64, mediaType: img.mediaType })),
    }),
    displayMessage: newUserMessage,
  };
  queuedMessagesRef.current.push(entry);
  setQueuedMessages([...queuedMessagesRef.current]);

  // UI 立即插入排队消息，不等 SDK echo
  setMessages(prev => [...prev, newUserMessage]);

  client.sendQueryBasedSessionMessage({
    sessionId: sessionId!,
    content: messageToSend,
    ...(textBlocks.length > 1 && { textBlocks }),
    ...(imagesToSend.length > 0 && {
      images: imagesToSend.map(img => ({
        media_type: img.mediaType,
        data: img.base64,
      })),
    }),
  }).catch(err => {
    console.error('发送排队消息失败:', err);
  });
  return;
}
```

**Step 2: useSessionMessages dequeue 改为"对账消费"**

`useSessionMessages.ts:57-69` 改成：
```ts
// 后端开始处理排队消息时，SDK 推送 type=user 事件
// UI 已在发送时插入，这里只需消费队列、不再追加消息
if (extendedMsg.type === 'user' && !extendedMsg.isReplay) {
  const queued = queuedMessagesRef.current;
  const isMeta = 'isMeta' in extendedMsg && extendedMsg.isMeta;
  const isBot = 'source' in extendedMsg && extendedMsg.source === 'wechat-bot';
  if (queued.length > 0 && !isMeta && !isBot) {
    queued.shift();
    onQueueChanged?.();
    setHistoryLoaded(true);
    return;
  }
}
```

**Step 3: 验证 wechat-bot 路径不受影响**

`transformers.ts` 中的 `streamReducer` 对 `source === 'wechat-bot'` 的 user 事件会插入消息（保留），desktop 来源依然走 `return null`（因 UI 已自插入）。

**Step 4: 手动验证**

`bun run dev` → 起会话 → AI 长回答中输入第二条消息回车 → 期待：
- 第二条消息**立即**出现在消息流（不再"排队中"卡顿）
- 悬浮区可不显示或显示"已排队等待处理"皆可
- AI 完成第一段回答后，自动开始处理第二条消息，无重复

**Step 5: Commit**

```bash
rtk git add components/agent-chat/hooks/useSendMessage.ts components/agent-chat/hooks/useSessionMessages.ts
rtk git commit -m "fix(agent-chat): 插话消息立即渲染到消息流，dequeue 改为对账消费"
```

---

## 批次 2：渲染清晰度

### Task 4: SDK 内置工具显示具体工具名

**根因:**
`components/ToolBlock.tsx:200-205` 把工具标题构造为 `${categoryLabel} · ${summary}`，所有 `server='sdk'` 的工具（Read/Edit/Bash 等）共用 categoryLabel="SDK 内置工具"，看不出是哪个工具。

**Files:**
- Modify: `components/ToolBlock.tsx:200-205`
- Modify: `stores/tool-registry-store.ts` 可选：导出 `getToolLabel(toolName)` 用于「优先具体名 / 否则类别」逻辑

**Step 1: 修改标题构造**

`components/ToolBlock.tsx:200-205`：
```ts
const categoryLabel = getCategoryLabel(toolName);

// 优先级：具体工具名（去掉 mcp__server__ 前缀）> 类别名
const niceName = toolName.startsWith('mcp__')
  ? toolName.split('__').slice(2).join('__') // mcp__dogear-stock__GetQuote → GetQuote
  : toolName;

const headLabel = niceName || categoryLabel;
const titleText = summary ? `${headLabel} · ${summary}` : headLabel;
```

可选改进：把 MCP 工具仍按 categoryLabel 展示（保留品牌感），SDK 工具直接用具体名。需要时再调。

**Step 2: 手动验证**

跑会话让 AI 调用 Read / Edit / Bash → 期待标题显示 `Read · 参数摘要`、`Edit · ...`、`Bash · ...`。
MCP 工具如 `mcp__dogear-stock__GetQuote` 显示 `GetQuote · ...`。

**Step 3: Commit**

```bash
rtk git add components/ToolBlock.tsx
rtk git commit -m "fix(tool-block): 标题优先显示具体工具名而非类别"
```

---

### Task 5: TodoWrite 专用渲染

**根因:** `ContentBlockItem.tsx` `case 'tool_use'` 一律走 `ToolBlock`，TodoWrite 的 `todos: Array<{ content, status, activeForm }>` 被当作普通 JSON 展示，不直观。

**Files:**
- Create: `components/agent-chat/TodoListBlock.tsx`
- Modify: `components/agent-chat/ContentBlockItem.tsx` 加 TodoWrite 分流

**Step 1: 新建 TodoListBlock.tsx**

`components/agent-chat/TodoListBlock.tsx`：
```tsx
import { Check, Circle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TodoItem {
  content: string;
  activeForm: string;
  status: 'pending' | 'in_progress' | 'completed';
}

interface TodoListBlockProps {
  todos: TodoItem[];
}

export function TodoListBlock({ todos }: TodoListBlockProps) {
  if (!Array.isArray(todos) || todos.length === 0) return null;
  const total = todos.length;
  const done = todos.filter(t => t.status === 'completed').length;
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2 space-y-1.5 text-sm">
      <div className="text-xs text-muted-foreground">
        任务清单 {done}/{total}
      </div>
      <ul className="space-y-1">
        {todos.map((t, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className="mt-0.5 flex-none">
              {t.status === 'completed' && <Check className="w-3.5 h-3.5 text-emerald-600" />}
              {t.status === 'in_progress' && <Loader2 className="w-3.5 h-3.5 text-sky-600 animate-spin" />}
              {t.status === 'pending' && <Circle className="w-3.5 h-3.5 text-muted-foreground" />}
            </span>
            <span className={cn(
              t.status === 'completed' && 'line-through text-muted-foreground',
              t.status === 'in_progress' && 'font-medium',
            )}>
              {t.status === 'in_progress' ? t.activeForm : t.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

**Step 2: ContentBlockItem 分流**

`components/agent-chat/ContentBlockItem.tsx` 在 `case 'tool_use'` 顶部加：
```ts
case 'tool_use': {
  if (block.toolName === 'TodoWrite' && block.toolInput?.todos) {
    return <TodoListBlock todos={block.toolInput.todos} />;
  }
  // ...原 ToolBlock 渲染保持不动
}
```

记得 `import { TodoListBlock } from './TodoListBlock';`。

**Step 3: 验证**

让 AI 调用 TodoWrite（提示词："请用 TodoWrite 列出 3 个测试任务"）→ 期待看到带勾选/旋转/空圈图标的清单，而非折叠的 JSON。

**Step 4: Commit**

```bash
rtk git add components/agent-chat/TodoListBlock.tsx components/agent-chat/ContentBlockItem.tsx
rtk git commit -m "feat(agent-chat): TodoWrite 专用清单渲染组件"
```

---

### Task 6: Edit/Write/Bash 增强渲染

**根因:** Edit/Write 工具的 `old_string`/`new_string`/`content` 在通用 ToolBlock 中只是长 JSON 字符串，看 diff 不直观；Bash 的 command 也最好单独高亮。

**改法:** 新建 `CodeChangeBlock.tsx`，按工具类型分别渲染：
- `Edit`: 显示文件路径 + 简化 diff（old → new 双栏或前后两块代码框）
- `Write`: 显示文件路径 + 内容预览（前 20 行）
- `Bash`: 显示命令（带 shell 高亮可选）+ 输出预览

**Files:**
- Create: `components/agent-chat/CodeChangeBlock.tsx`
- Modify: `components/agent-chat/ContentBlockItem.tsx` 加 Edit/Write/Bash 分流

**Step 1: 新建 CodeChangeBlock.tsx**

```tsx
import { CollapsibleBlock } from '@/components/CollapsibleBlock';
import { FileEdit, FilePlus, Terminal } from 'lucide-react';

interface Props {
  toolName: 'Edit' | 'Write' | 'Bash' | string;
  toolInput: Record<string, any> | undefined;
  toolOutput?: string | undefined;
  isError?: boolean;
}

export function CodeChangeBlock({ toolName, toolInput, toolOutput, isError }: Props) {
  const status: 'running' | 'success' | 'error' =
    toolOutput === undefined ? 'running' : (isError ? 'error' : 'success');

  if (toolName === 'Edit') {
    const file = toolInput?.file_path ?? '';
    const oldStr: string = toolInput?.old_string ?? '';
    const newStr: string = toolInput?.new_string ?? '';
    return (
      <CollapsibleBlock
        icon={<FileEdit className="w-4 h-4 text-amber-600" />}
        title={`Edit · ${file.split(/[\\/]/).pop() || file}`}
        titleClassName={status === 'error' ? 'text-red-600' : ''}
        defaultOpen={false}
        previewLines={0}
      >
        <div className="space-y-1.5 text-xs">
          <div className="font-mono text-muted-foreground break-all">{file}</div>
          <pre className="bg-red-50 text-red-900 rounded px-2 py-1.5 whitespace-pre-wrap break-all max-h-48 overflow-auto">
            - {oldStr}
          </pre>
          <pre className="bg-emerald-50 text-emerald-900 rounded px-2 py-1.5 whitespace-pre-wrap break-all max-h-48 overflow-auto">
            + {newStr}
          </pre>
        </div>
      </CollapsibleBlock>
    );
  }

  if (toolName === 'Write') {
    const file = toolInput?.file_path ?? '';
    const content: string = toolInput?.content ?? '';
    return (
      <CollapsibleBlock
        icon={<FilePlus className="w-4 h-4 text-emerald-600" />}
        title={`Write · ${file.split(/[\\/]/).pop() || file}`}
        defaultOpen={false}
        previewLines={0}
      >
        <div className="space-y-1.5 text-xs">
          <div className="font-mono text-muted-foreground break-all">{file}</div>
          <pre className="bg-muted/40 rounded px-2 py-1.5 whitespace-pre-wrap break-all max-h-64 overflow-auto">
            {content}
          </pre>
        </div>
      </CollapsibleBlock>
    );
  }

  if (toolName === 'Bash') {
    const cmd: string = toolInput?.command ?? '';
    return (
      <CollapsibleBlock
        icon={<Terminal className="w-4 h-4 text-zinc-700" />}
        title={`Bash · ${cmd.slice(0, 60)}`}
        defaultOpen={false}
        previewLines={0}
      >
        <div className="space-y-1.5 text-xs">
          <pre className="bg-zinc-900 text-zinc-100 rounded px-2 py-1.5 whitespace-pre-wrap break-all max-h-32 overflow-auto">
            $ {cmd}
          </pre>
          {toolOutput && (
            <pre className="bg-muted/40 rounded px-2 py-1.5 whitespace-pre-wrap break-all max-h-64 overflow-auto">
              {toolOutput}
            </pre>
          )}
        </div>
      </CollapsibleBlock>
    );
  }

  return null;
}
```

**Step 2: ContentBlockItem 分流**

```ts
case 'tool_use': {
  if (block.toolName === 'TodoWrite' && block.toolInput?.todos) {
    return <TodoListBlock todos={block.toolInput.todos} />;
  }
  if (['Edit', 'Write', 'Bash'].includes(block.toolName || '')) {
    return (
      <CodeChangeBlock
        toolName={block.toolName!}
        toolInput={block.toolInput}
        toolOutput={typeof block.toolOutput === 'string' ? block.toolOutput : undefined}
        isError={block.isError}
      />
    );
  }
  // ...原 ToolBlock
}
```

**Step 3: 验证**

让 AI 改一个测试文件（用 Edit）和读 / 写一个文件 + 跑一条 Bash → 期待看到独立的 diff/写入预览/命令框，而不是通用 JSON 折叠块。

**Step 4: Commit**

```bash
rtk git add components/agent-chat/CodeChangeBlock.tsx components/agent-chat/ContentBlockItem.tsx
rtk git commit -m "feat(agent-chat): Edit/Write/Bash 专用渲染（diff/预览/命令框）"
```

---

## 批次 3：Opus thinking 显示

### Task 7: 注入 thinking.display='summarized'

**根因:**
适应思维.md 文档明确：Opus 4.7 的 `thinking.display` 默认值从 4.6 的 `"summarized"` silent change 为 `"omitted"`，导致流里的 thinking block 只有 signature 没有 `thinking` 文本字段。`query-based-session.ts:208-217` 的 queryOptions 当前未传 `thinking` 字段，所以走 SDK/模型默认值，Opus 4.7 表现就是空。

**SDK 验证:**
`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:5255/5276` 暴露 `display: 'summarized' | 'omitted'`。说明 SDK 支持显式传 `display`。

**Files:**
- Modify: `electron/main/agents/query-based-session.ts:208-217`
- 可选 Modify: `types/settings.ts` 加 `ai.thinkingDisplay?: 'summarized' | 'omitted'` 让用户切换（**本任务不做**，直接硬编码 summarized）

**Step 1: 确认 SDK 类型字段名（display 还是 displayMode）**

在动手前读：
```bash
rtk grep -n "'summarized'" "C:\dogear\node_modules\@anthropic-ai\claude-agent-sdk\sdk.d.ts"
```
找到 5255 行的具体字段定义，确认字段名是否就是 `display`。如果是 `displayMode` 或其他名，按 SDK 实际为准。

**Step 2: 在 queryOptions 注入 thinking config**

`query-based-session.ts:208-217` 改为：
```ts
const queryOptions: Record<string, any> = {
  systemPrompt,
  includePartialMessages: true,
  env: baseConfig.env,
  effort: baseConfig.effort,
  // Opus 4.7 默认 display='omitted'，显式恢复 summarized 让用户看见思考过程
  thinking: { type: 'adaptive', display: 'summarized' },
  ...(baseConfig.pathToClaudeCodeExecutable && {
    pathToClaudeCodeExecutable: baseConfig.pathToClaudeCodeExecutable,
  }),
};
```

**Step 3: 编译 + 验证**

```bash
rtk bun run build:electron
rtk bun run dev
```

选 Opus 模型 → 提一个需要思考的问题 → 期待 ThinkingBlock 显示文本内容（不再永远是"正在思考"）。

Sonnet 也应正常显示（Sonnet 4.6 也是 adaptive thinking，display 字段一致接受）。

**Step 4: 失败回退**

如果 SDK query() 抛"unknown field 'display'"或类似错误：
- 移除 `display` 字段，只保留 `thinking: { type: 'adaptive' }`，看 SDK 是否能转译
- 若仍空，检查是否要走 `extra_body` / `outputConfig` 而非顶层 `thinking`
- 实在不行，将 `thinking: { type: 'enabled', budget_tokens: 8192 }` 试老式参数

**Step 5: Commit**

```bash
rtk git add electron/main/agents/query-based-session.ts
rtk git commit -m "fix(agent): Opus 4.7 显式设置 thinking.display=summarized 恢复思考可见"
```

---

### Task 8: Subagent 模型 Haiku 兜底

**根因:**
- `agent-query-config.ts:149-151` 已正确处理 `subagentModelTier` 配置（设了 → 注入 `CLAUDE_CODE_SUBAGENT_MODEL`）
- UI（`app/settings/page.tsx:317-328`）已就绪
- **但 `DEFAULT_SETTINGS` 中 `subagentModelTier` 默认 `undefined`** → SDK 走默认 → Claude Code 内置子代理默认用 Haiku
- 此时主会话注入了 `effort`（用户已配置），子代理继承调用 → Haiku 不支持 `effort` 参数 → API 400

**改法:** 在 `agent-query-config.ts` 里做兜底：当 `effort` 设置成非默认值（`low/medium/high/xhigh/max` 任一显式存在）且 `subagentModelTier` 未设置时，自动注入 Sonnet 作为 subagent 模型，避免主会话 effort 配置导致子代理报错。

**Files:**
- Modify: `electron/main/agents/agent-query-config.ts:139-151`

**Step 1: 在 tierMap 之后加兜底逻辑**

`agent-query-config.ts:146-151` 现状：
```ts
if (appSettings.ai.defaultModelTier) {
  env.ANTHROPIC_MODEL = tierMap[appSettings.ai.defaultModelTier];
}
if (appSettings.ai.subagentModelTier) {
  env.CLAUDE_CODE_SUBAGENT_MODEL = tierMap[appSettings.ai.subagentModelTier];
}
```

改成：
```ts
if (appSettings.ai.defaultModelTier) {
  env.ANTHROPIC_MODEL = tierMap[appSettings.ai.defaultModelTier];
}

// Subagent 模型：用户显式指定优先；未指定但 effort 非空时兜底到 sonnet
// 原因：Claude Code 子代理默认 haiku，haiku 不支持 effort 参数会 API 400
const subagentTier = appSettings.ai.subagentModelTier
  ?? (appSettings.ai.effort ? 'sonnet' as const : undefined);
if (subagentTier) {
  env.CLAUDE_CODE_SUBAGENT_MODEL = tierMap[subagentTier];
}
```

**Step 2: 设置页加一行提示**

`app/settings/page.tsx:314` 的 `<p>` 文字改成：
```
注入 CLAUDE_CODE_SUBAGENT_MODEL 环境变量，决定 Task 工具启动的子代理用哪一层。
未指定时，若配置了「努力程度」会自动用 Sonnet（Haiku 不支持 effort 参数）。
```

**Step 3: 编译 + 验证**

```bash
rtk bun run build:electron
rtk bun run dev
```
- 不在设置页改 subagent 模型，保持空 → 让 AI 调用 Task 工具（如让它用 Explore subagent 找文件）→ 期待不再 400，子代理正常返回结果
- 在设置页把 subagent 模型显式设为 Haiku → 期待**保留**用户选择（兜底逻辑只在 undefined 时触发），如果此时 effort 已设，subagent 仍会 400（这是用户自己的选择，不强行覆盖）

**Step 4: Commit**

```bash
rtk git add electron/main/agents/agent-query-config.ts app/settings/page.tsx
rtk git commit -m "fix(agent): subagent 模型 Haiku 兜底，避免 effort 配置触发 API 400"
```

---

## 批次 4：新能力

### Task 9: Markdown 文件点击浮窗渲染

**根因:** 当前 `app/page.tsx:362-373` 选中文件后仅显示文件名/路径占位卡片，无内容。用户需要点击 `.md` 文件时弹出渲染好的 Markdown 浮窗，而不是只在侧栏看占位。

**架构选择:** 用 shadcn Dialog 组件做浮窗（`components/ui/dialog.tsx` 已就绪），复用 `components/MarkdownRenderer.tsx`；新增 `workspace/readFile` IPC 读取文件内容（限制只读 .md/.markdown/.txt 避免越权）。

**Files:**
- Create: `components/MarkdownFileDialog.tsx` — 浮窗组件
- Create: `stores/markdown-preview-store.ts` — 浮窗打开状态（避免污染 workspace-store）
- Modify: `electron/main/services/workspace-fs-service.ts` — 加 `readWorkspaceTextFile(path: string)`
- Modify: `electron/main/tipc/explorer.ts` — 暴露 `readFile` IPC
- Modify: `components/WorkspaceExplorer.tsx:607-617` — `handlePrimaryAction` 中 `.md` 文件触发浮窗
- Modify: `app/page.tsx` — 挂载 `<MarkdownFileDialog />`

**Step 1: 新建 markdown-preview-store.ts**

`stores/markdown-preview-store.ts`：
```ts
import { create } from 'zustand';

interface MarkdownPreviewState {
  isOpen: boolean;
  filePath: string | null;
  fileName: string | null;
  open: (filePath: string, fileName: string) => void;
  close: () => void;
}

export const useMarkdownPreviewStore = create<MarkdownPreviewState>((set) => ({
  isOpen: false,
  filePath: null,
  fileName: null,
  open: (filePath, fileName) => set({ isOpen: true, filePath, fileName }),
  close: () => set({ isOpen: false, filePath: null, fileName: null }),
}));
```

**Step 2: 加 readFile service + IPC**

`electron/main/services/workspace-fs-service.ts` 末尾追加：
```ts
const ALLOWED_TEXT_EXT = ['.md', '.markdown', '.txt', '.json'];

export async function readWorkspaceTextFile(workspaceRoot: string, relPath: string): Promise<string> {
  const safePath = resolveSafePath(workspaceRoot, relPath); // 复用现有的安全路径校验
  const ext = path.extname(safePath).toLowerCase();
  if (!ALLOWED_TEXT_EXT.includes(ext)) {
    throw new Error(`不支持的文件类型: ${ext}`);
  }
  const stat = await fs.promises.stat(safePath);
  if (stat.size > 5 * 1024 * 1024) {
    throw new Error('文件过大（>5MB），不支持预览');
  }
  return fs.promises.readFile(safePath, 'utf-8');
}
```
（若已有 `resolveSafePath`，直接复用；否则按文件中现有模式实现，参考其他 workspace 路径校验。）

`electron/main/tipc/explorer.ts` 加 route：
```ts
readFile: t.procedure
  .input(z.object({ path: z.string() }))
  .action(async ({ input }) => {
    const ws = await getCurrentDefaultWorkspace();
    if (!ws) throw new Error('无默认工作区');
    return await readWorkspaceTextFile(ws.path, input.path);
  }),
```
按文件中其他 procedure 的现有 import / context 风格调整。

**Step 3: 新建 MarkdownFileDialog 组件**

`components/MarkdownFileDialog.tsx`：
```tsx
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MarkdownRenderer } from './MarkdownRenderer';
import { useMarkdownPreviewStore } from '@/stores/markdown-preview-store';
import { client } from '@/lib/client';
import { Loader2 } from 'lucide-react';

export function MarkdownFileDialog() {
  const { isOpen, filePath, fileName, close } = useMarkdownPreviewStore();
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !filePath) return;
    setLoading(true);
    setError(null);
    setContent('');
    client.readFile({ path: filePath })
      .then(setContent)
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [isOpen, filePath]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="truncate">{fileName ?? '预览'}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-1 -mx-6 px-6">
          {loading && (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              加载中...
            </div>
          )}
          {error && <div className="text-red-600 text-sm py-4">{error}</div>}
          {!loading && !error && <MarkdownRenderer content={content} />}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
```

**Step 4: WorkspaceExplorer 触发浮窗**

`components/WorkspaceExplorer.tsx:607-617` 的 `handlePrimaryAction` 改成：
```ts
const handlePrimaryAction = useCallback((item: ItemInstance<FlatNode>) => {
  const data = item.getItemData();
  if (!data.originalNode) return;
  if (data.nodeType === 'article') {
    const articleMeta = buildArticleMeta(data.originalNode);
    if (articleMeta) selectArticleRef.current(articleMeta);
  } else if (data.nodeType === 'file') {
    const node = data.originalNode;
    const ext = node.ext?.toLowerCase();
    if (ext === '.md' || ext === '.markdown') {
      useMarkdownPreviewStore.getState().open(node.path, node.name);
    } else {
      selectFileRef.current(node);
    }
  }
}, []);
```
顶部加 `import { useMarkdownPreviewStore } from '@/stores/markdown-preview-store';`。

**Step 5: 挂载到主页面**

`app/page.tsx` 在已有的 `<WorkspaceRuleDialog />` 附近加：
```tsx
<MarkdownFileDialog />
```
并 import。session-window 路由（`app/session-window/page.tsx`）若也展示文件树，同样挂一个。

**Step 6: 验证**

- 在工作区放一个 `test.md` 文件 → 点击它 → 期待浮窗弹出，渲染 Markdown 内容
- 关闭浮窗（点遮罩或 X）→ 浮窗消失
- 点击 `.txt` 文件 → 期待不弹浮窗（走原 selectFile，侧栏显示）
- 点击 `.png` 等不支持类型 → 不报错
- 把刚才计划的 md 文件路径试一下：`docs/plans/2026-05/2026-05-18/agent-chat-ux-fixes.md`

**Step 7: Commit**

```bash
rtk git add stores/markdown-preview-store.ts components/MarkdownFileDialog.tsx components/WorkspaceExplorer.tsx app/page.tsx electron/main/services/workspace-fs-service.ts electron/main/tipc/explorer.ts
rtk git commit -m "feat(workspace): 点击 Markdown 文件弹出浮窗渲染"
```

---

## 验收 Checklist（所有任务完成后整体过一遍）

- [ ] 发消息瞬间视口到底
- [ ] AI 流式回答时持续跟随到底
- [ ] 手动上滚立即停止跟随，不被回弹
- [ ] AI 回答中**不**出现灰点 + status 系统提示
- [ ] AI 长回答中第二条消息立即渲染到消息流，不卡"排队中"
- [ ] SDK 工具显示具体名（Read/Edit/Bash），不再统一"SDK 内置工具"
- [ ] TodoWrite 渲染为清单（含 ✓/▢/⟳ 图标）
- [ ] Edit 显示文件路径 + 红绿 diff
- [ ] Write 显示文件路径 + 内容预览
- [ ] Bash 显示命令 + 输出
- [ ] Opus 模型 ThinkingBlock 显示思考文本，不再只显示"正在思考"
- [ ] Sonnet 模型 ThinkingBlock 仍正常
- [ ] 不设置 subagent 模型时，AI 调用 Explore 等子代理不再 API 400
- [ ] 点击工作区 `.md` 文件弹出浮窗，渲染 Markdown
- [ ] 点击 `.txt` 等其他文件不弹浮窗（走原侧栏预览）
- [ ] 浮窗内容支持滚动，长文档不溢出

## 风险与回滚

- **批次 3（thinking）若 SDK 不接受 display 字段** → 单独回滚 Task 7，其他任务独立可用
- **滚动改动影响搜索定位** → `scrollToElement` 中 `followRef.current = false` 已先于 scrollTo 设置，不受影响
- **插话改动让重复消息出现** → 若 SDK 真 echo 了 user，`useSessionMessages` 的 dequeue 只 shift 不再 push，不会重复
- **Subagent 兜底改了用户没显式设置的行为** → 仅当 `effort` 已配置时才兜底；用户显式选 Haiku 时不覆盖
- **MD 浮窗 readFile IPC 越权风险** → service 端校验扩展名白名单 + 复用 workspace 安全路径解析；超过 5MB 拒绝

每个任务独立 commit，整体改动可按需逐批 revert。
