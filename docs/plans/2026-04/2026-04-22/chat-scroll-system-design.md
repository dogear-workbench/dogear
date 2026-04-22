# Chat 滚动/跳转/搜索/Minimap 系统修订设计

> 2026-04-22 续 chat-ui-refinement-v2-design.md 之后的修订
>
> 对应用户反馈:sticky 失效、minimap 不精准、跳转失灵、搜索数量虚高

## 问题根因

### Bug 1:用户消息 sticky 失效 + 穿透

`MessageItem.tsx:61` 的 `sticky top-0 z-10` 放在内层 bg 容器上,外层 `<div class="w-full py-4">` 有 `py-4` padding。两条 user 消息接力(sticky 接替)时 padding 造成视觉空隙,且 `bg-background/95 backdrop-blur-sm` 半透明让 AI 回答从后面漏字,看起来"没冻结住"。

### Bug 2:Minimap 不精准 + 高度不够 + 信息太少

- `MessageMinimap.tsx:36-62` 用"最近中心线"算法,消息高度差异大时不准
- `extractMessagePreview` 单行截断,AI 长回答在 minimap 里看不清
- 浮窗 `w-48`(192px)太窄,没有默认最大高度(`max-h-[70vh]` 依赖视口)

### Bug 3:跳转失灵 + 底部失效(最严重)

**罪魁祸首**:`AgentChat.tsx:150-158` 的 `setInterval(50ms)` 轮询:

```ts
setInterval(() => {
  if (isAtBottomRef.current) {
    const el = getViewportEl();
    if (el) el.scrollTop = el.scrollHeight;
  }
}, 50);
```

这个轮询不分"是否正在回答",永远在跑。当用户从底部点击 minimap/搜索跳到历史消息:
1. 点击瞬间 `handleScroll` 还没触发(scroll 事件节流)
2. `isAtBottomRef.current` 此时仍是 `true`
3. 50ms 内轮询把 `scrollTop` 拽回 `scrollHeight`
4. 表现:"点一下跳一下又回弹"或"在底部点击完全无效"

### Bug 4:搜索数量虚高 + 点击不跳转

`useMessageSearch.ts:52-64` 的 `pureText` 对用户消息做 XML 剥离后 trim:
```ts
const pureText = msg.content
  .replace(/<referenced_articles>...</g, '')
  .replace(/<quoted_snippet[^>]*>...<\/quoted_snippet>/g, '')
  .replace(/<command-[a-z-]+>...</g, '')
  .replace(/^\n+/, '').trim();
```

而 `MessageItem.tsx:128` 渲染时用 `parseUserMessageReferences(message.content).userMessage`,走的是完全不同的 `utils.ts` 解析路径。两边 offset 不一致,`data-match-id="${messageIndex}-u-${idx}"` 挂不上对应的 DOM 节点,点击时 `document.querySelector(...)` 返回 null,自然跳转不到。

## 解决方案

### 方案:方案 A(修好 sticky)+ useChatScroll 抽象

用户决策:采用方案 A(CSS sticky 保持原样,修 bug),不做 VSCode 风格的 JS 浮条。

### 1. 修 sticky(MessageItem.tsx)

**改动**:
- `sticky top-0 z-10` 从内层 bg 容器挪到最外层 `<div class="w-full py-4 group">`
- 外层 padding 从 `py-4` 减到 `py-2`(间距由 sticky 块自身的 mb 保证)
- 外层背景设为完全不透明 `bg-background`(不是 `/95`,不是 `backdrop-blur`)
- 内层样式(border/shadow/rounded)完全不动
- 可选美化:内层加 `transition-shadow`,stuck 时阴影略强——通过 `:has()` 或固定不变(暂不做)

**修改后结构**:
```tsx
<div
  className="w-full py-2 group sticky top-0 z-10 bg-background"
  data-message-id={...}
>
  {isUser ? (
    <div className="relative border-2 border-muted-foreground/25 rounded-lg px-4 py-2 bg-background shadow-md">
      ...
    </div>
  ) : (
    // AI 消息不 sticky,需要把 sticky 拆到 isUser 分支里
  )}
</div>
```

**注意**:sticky 只用户消息需要,AI 消息不需要。所以最外层仍是 `w-full py-2 group`,但 **sticky 放在 isUser 的内层容器上**,或者最外层根据 role 条件添加 sticky class:

```tsx
<div
  className={cn(
    "w-full py-2 group",
    isUser && "sticky top-0 z-10 bg-background"
  )}
  data-message-id={...}
>
```

### 2. 新增 useChatScroll hook

`components/agent-chat/hooks/useChatScroll.ts`:

```ts
interface UseChatScrollOptions {
  scrollAreaRef: RefObject<HTMLDivElement | null>;
  isLoading: boolean;  // AI 是否在回答
}

interface UseChatScrollReturn {
  showScrollBtn: boolean;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  scrollToMessage: (messageIndex: number, opts?: ScrollOptions) => void;
  scrollToElement: (el: HTMLElement, opts?: ScrollOptions) => void;
  handleScroll: () => void;
}

interface ScrollOptions {
  align?: 'top-third' | 'top' | 'center';  // 默认 'top-third'
  behavior?: ScrollBehavior;  // 默认 'smooth'
  flash?: boolean;  // 闪烁 .minimap-flash 类,默认 false
}
```

**内部实现要点**:

1. **followBottom 只在回答期间生效**:
```ts
useEffect(() => {
  if (!isLoading) {
    followRef.current = false;
    return;
  }
  followRef.current = true;
  const vp = getViewport();
  if (!vp) return;
  const firstChild = vp.firstElementChild;
  const obs = new ResizeObserver(() => {
    if (followRef.current) vp.scrollTop = vp.scrollHeight;
  });
  obs.observe(firstChild);
  return () => obs.disconnect();
}, [isLoading]);
```

2. **handleScroll 只在回答期间更新 follow**:
```ts
const handleScroll = useCallback(() => {
  const vp = getViewport();
  if (!vp) return;
  const atBottom = vp.scrollHeight - vp.scrollTop - vp.clientHeight < 50;
  setShowScrollBtn(!atBottom);
  if (isLoading) followRef.current = atBottom;
}, [isLoading]);
```

3. **scrollToMessage 的 top-third 对齐**(考虑 sticky 头高度):
```ts
const scrollToMessage = (idx, opts) => {
  const el = document.querySelector(`[data-message-id="msg-${idx}"]`);
  const vp = getViewport();
  if (!el || !vp) return;
  followRef.current = false;  // 关键:取消跟随
  const vpRect = vp.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const stickyHeight = 0;  // 当前行就是 sticky,不用扣
  const targetOffsetFromVpTop = stickyHeight + vp.clientHeight / 3;
  const scrollTo = vp.scrollTop + (elRect.top - vpRect.top) - targetOffsetFromVpTop;
  vp.scrollTo({ top: Math.max(0, scrollTo), behavior: opts?.behavior ?? 'smooth' });
  if (opts?.flash) {
    (el as HTMLElement).classList.add('minimap-flash');
    setTimeout(() => el.classList.remove('minimap-flash'), 1200);
  }
};
```

**移除 AgentChat.tsx 的**:
- `setInterval(50ms)` 轮询(关键!)
- `getViewportEl / checkAtBottom / scrollToBottom / scrollElementIntoView / handleScroll / showScrollBtn / isAtBottomRef` 全部迁入 hook
- 保留 `scrollAreaRef` 作为 hook 的入参

### 3. 重构 Minimap(MessageMinimap.tsx)

**改动**:

- 浮窗尺寸:`w-48` → `w-64`(256px),`max-h-[70vh]` → `max-h-[500px]`
- 预览行数:`extractMessagePreview` 保留软换行,返回最多 180 字符;CSS 用 `line-clamp-3` 做 3 行封顶
- 当前位置指示:从"单条 highlight"改成"当前轮次范围高亮"
  - 用 IntersectionObserver 监听所有 `[data-message-id]` 的可见性
  - 维护 `visibleMessageIndices: Set<number>`
  - 渲染时,属于同一 turn 的连续消息整块用 `bg-primary/10` 淡色背景框住
  - 去掉之前的"最近中心线"算法和 `currentMessageIdx` state
- `jumpTo` 改调 `onJumpTo(messageIndex: number)`,由 AgentChat 传入 `scrollToMessage`

**Turn 分组**(minimap 内部):

```ts
// messages → turns: user 消息开始一个新 turn,直到下一个 user 消息
const turns = useMemo(() => {
  const result: { userIdx: number; msgIndices: number[] }[] = [];
  messages.forEach((msg, i) => {
    if (msg.isMeta || msg.isCompactBoundary || msg.isCompactSummary) return;
    if (msg.role === 'user') result.push({ userIdx: i, msgIndices: [i] });
    else if (result.length > 0) result[result.length - 1].msgIndices.push(i);
  });
  return result;
}, [messages]);
```

### 4. 修搜索 offset(useMessageSearch + utils)

**抽统一函数**到 `components/agent-chat/utils.ts`:

```ts
export function getUserMessageSearchableText(content: string): string {
  // 与 parseUserMessageReferences 返回的 userMessage 保持完全一致
  return content
    .replace(/<referenced_articles>[\s\S]*?<\/referenced_articles>/g, '')
    .replace(/<quoted_snippet[^>]*>[\s\S]*?<\/quoted_snippet>/g, '')
    .replace(/<command-[a-z-]+>[\s\S]*?<\/command-[a-z-]+>/g, '')
    .replace(/^\n+/, '')
    .trim();
}
```

`useMessageSearch.ts:52-64` 改用这个函数。`MessageItem.tsx:128` 如果 `parseUserMessageReferences` 的 `userMessage` 字段和这个函数输出不一致,需要把 parseUserMessageReferences 内部也改用这个函数,保证 offset 完全对齐。

### 5. AgentChat.tsx 接入

```tsx
const scroll = useChatScroll({ scrollAreaRef, isLoading });

// 原来的 setInterval、scrollToBottom、scrollElementIntoView 全删
// onScrollCapture={scroll.handleScroll}

<MessageMinimap
  messages={messages}
  hidden={search.isOpen}
  scrollAreaRef={scrollAreaRef}
  onJumpTo={(idx) => scroll.scrollToMessage(idx, { align: 'top-third', flash: true })}
/>

// 搜索激活项切换时
useEffect(() => {
  if (!search.activeMatch) return;
  const el = document.querySelector(`[data-match-id="${search.activeMatch.id}"]`);
  if (el) scroll.scrollToElement(el as HTMLElement, { align: 'top-third' });
}, [search.activeMatch?.id]);

// 回到底部按钮
{scroll.showScrollBtn && (
  <button onClick={() => scroll.scrollToBottom()}>...</button>
)}

// 发送消息时
handleSend={() => { scroll.scrollToBottom('instant'); sendMessage.handleSend(); }}
```

## 文件改动清单

**新增**:
- `components/agent-chat/hooks/useChatScroll.ts`

**修改**:
- `components/agent-chat/AgentChat.tsx`(迁出 ~80 行滚动代码)
- `components/agent-chat/MessageItem.tsx`(sticky 外层 + 不透明背景 + py-2)
- `components/agent-chat/MessageMinimap.tsx`(宽度/高度/3行预览 + turn 范围高亮)
- `components/agent-chat/hooks/useMessageSearch.ts`(用 getUserMessageSearchableText)
- `components/agent-chat/utils.ts`(新增 getUserMessageSearchableText)

**不动**:
- ContentBlockItem / ChatInputArea / SearchBar / highlight.ts / 其他 hook

## 验收标准

1. 滚动过程中历史 user 消息贴顶冻结,不穿透、不闪烁
2. 下一条 user 消息滚入视口时自然顶替上一条
3. AI 回答时自动跟随底部,用户向上滚立即停止跟随
4. 非回答期间不再有任何自动滚动行为
5. 点击 minimap 任意条目精确跳转,目标第一行位于可见区上 1/3
6. 搜索数量与实际匹配一致,每个匹配点击都能跳转
7. Minimap 浮窗 256×500px,每条最多 3 行,当前视口对应的 turn 整体有浅蓝背景

## 实施顺序

1. 先做 utils 的 `getUserMessageSearchableText`(修 Bug 4 基础)
2. 做 `useChatScroll` hook(修 Bug 3 基础)
3. AgentChat 接入 hook,删除 setInterval
4. MessageItem sticky 修复(修 Bug 1)
5. MessageMinimap 重构(修 Bug 2,依赖 hook)
6. useMessageSearch 用新的 searchable text 函数

每步改完运行 `bun run lint` 和手工回归。
