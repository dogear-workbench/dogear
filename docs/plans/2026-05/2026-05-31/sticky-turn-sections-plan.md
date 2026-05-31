# 顶部悬停 header 改造：按轮次分组吸顶 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把聊天区"最新用户输入悬停在顶部"从"全局 sticky 互相覆盖"改成"按轮次分组、section 内吸顶"，彻底消除短消息盖不住长消息、展开后露底的问题。

**Architecture:** 把每一轮（一条用户消息 + 它后面的所有非用户消息）包进一个 `<section>`，用户消息保留 `sticky top-0`，于是它的吸顶范围被限制在自己的 section 内——本轮滚走时被下一 section 的边界顶出，下一轮 header 滑入，任意时刻顶部最多一个 header，不靠覆盖。轮次切分逻辑抽成唯一的纯函数 `buildTurns`，由 `MessageMinimap` 和 `AgentChat` 渲染共用，保证 minimap 与吸顶 section 永不分叉。

**Tech Stack:** React 19 + Tailwind CSS（CSS `position: sticky`）+ Bun（`bun:test` 跑纯函数单测）。

---

## 背景与既定决策

- **根因**：现状每条用户消息都是 `position: sticky; top-0; z-10`，且全是同一滚动容器的兄弟节点。CSS 中同容器多个 `top-0` sticky 兄弟会同时粘顶并重叠，旧的永不离场，只是被后来的不透明气泡"画在上面"。新消息比旧的矮 / 旧的被展开变高 → 盖不住 → 露底。
- **方案**：A —— 轮次分组 + section 内吸顶（纯 CSS 为主，JS 仅做分组）。
- **语义**（用户澄清）：钉的是"已被滚出视野顶部的、最新的那一条用户输入"。section 内吸顶天然满足。
- **决策点 1 — 插话**：插话消息是 `role==='user'` + `isQueued` 的普通用户消息（`transformers.ts:62`），照旧**另起一轮**（= 新 section）。这与 minimap 现有行为一致，也符合"钉最新输入"语义。
- **决策点 2 — 折叠 banner**：折叠态顶部的 `CollapsedHistoryBanner` **不吸顶**，作为普通块渲染在所有 section 之前。

## 涉及文件

- 新增：`components/agent-chat/turns.ts`（共享轮次切分纯函数）
- 新增：`components/agent-chat/turns.test.ts`（bun:test 单测）
- 修改：`components/agent-chat/MessageMinimap.tsx`（改用 `buildTurns`，可见输出保持不变）
- 修改：`components/agent-chat/AgentChat.tsx:324-374`（渲染循环改成按 turn 包 section）
- 不改：`components/agent-chat/MessageItem.tsx`（其 `sticky top-0` 在 section 内自动变为 section 内吸顶；如有顶部空隙再微调，见 Task 4）

## 关键不变量（实现期间必须守住）

1. 传给 `MessageItem` 的 `messageIndex` 必须始终是**原始扁平下标**（`messages` 数组里的 index），否则 minimap 跳转、搜索高亮、`scrollToMessage` 全部错位。分组只是包一层，不改下标。
2. 每条被渲染的消息都必须落进某个 section（包括 `isMeta` / `compact_boundary` / 注入消息），它们作为非 header 成员附着到"当前轮"。
3. minimap 的可见输出（哪些 turn、预览文案、当前轮高亮）改造前后必须一致。

---

## Task 1: 共享轮次切分纯函数 `buildTurns`

**Files:**
- Create: `components/agent-chat/turns.ts`
- Test: `components/agent-chat/turns.test.ts`

`buildTurns` 把 `messages` 划分成若干轮（turn）。判定规则镜像现有 `MessageMinimap.tsx:43-93`：

- 折叠态（`collapsed=true`）：找到**最后一个** `isCompactBoundary` 的下标 `hiddenUntilIdx`，其**之前**的消息全部跳过（不渲染、不进任何 turn）。
- header（吸顶用户消息）判定：`role==='user'` 且非 `isMeta`/`isCompactBoundary`/`isCompactSummary` 且非 `isSdkInjectedUserMessage(content)`。
- header → 开新轮，`headerIdx=i`，`memberIdxs=[i]`。
- 非 header：若当前还没有任何轮（开头就是 assistant / meta / boundary）→ 开一个**无头轮**（`headerIdx=null`）；否则附着到当前轮。
- 与 minimap 不同的是：本函数对**所有被渲染的消息**（含 meta/boundary/注入）都写入 `turnByIndex` 并放进 `memberIdxs`，供 section 渲染兜底。注入用户消息**不**作为 header（与 minimap 一致），但仍作为成员附着到当前轮。

**Step 1: 写失败测试**

```ts
// components/agent-chat/turns.test.ts
import { test, expect } from 'bun:test';
import { buildTurns } from './turns.ts';
import type { Message } from './types.ts';

const u = (content: string, extra: Partial<Message> = {}): Message =>
  ({ role: 'user', content, ...extra } as Message);
const a = (content = 'reply', extra: Partial<Message> = {}): Message =>
  ({ role: 'assistant', content, ...extra } as Message);

test('单轮：user + assistant', () => {
  const { turns, turnByIndex } = buildTurns([u('hi'), a()], { collapsed: false });
  expect(turns).toEqual([{ turnId: 0, headerIdx: 0, memberIdxs: [0, 1] }]);
  expect(turnByIndex.get(0)).toBe(0);
  expect(turnByIndex.get(1)).toBe(0);
});

test('多轮：每条 user 开新轮', () => {
  const { turns } = buildTurns([u('q1'), a(), u('q2'), a(), a()], { collapsed: false });
  expect(turns).toEqual([
    { turnId: 0, headerIdx: 0, memberIdxs: [0, 1] },
    { turnId: 1, headerIdx: 2, memberIdxs: [2, 3, 4] },
  ]);
});

test('插话：isQueued 的 user 照常另起一轮', () => {
  const msgs = [u('q1'), a(), u('打断一下', { isQueued: true } as Partial<Message>), a()];
  const { turns } = buildTurns(msgs, { collapsed: false });
  expect(turns.map(t => t.headerIdx)).toEqual([0, 2]);
  expect(turns[1].memberIdxs).toEqual([2, 3]);
});

test('开头是 assistant：形成无头轮', () => {
  const { turns } = buildTurns([a('恢复的回复'), u('q1'), a()], { collapsed: false });
  expect(turns[0]).toEqual({ turnId: 0, headerIdx: null, memberIdxs: [0] });
  expect(turns[1]).toEqual({ turnId: 1, headerIdx: 1, memberIdxs: [1, 2] });
});

test('注入消息（/model）不作 header，附着当前轮', () => {
  const msgs = [u('q1'), a(), u('/model sonnet'), a()];
  const { turns } = buildTurns(msgs, { collapsed: false });
  expect(turns).toHaveLength(1);
  expect(turns[0].memberIdxs).toEqual([0, 1, 2, 3]);
});

test('meta 消息不作 header，附着当前轮', () => {
  const msgs = [u('q1'), { role: 'assistant', content: 'm', isMeta: true } as Message, a()];
  const { turns } = buildTurns(msgs, { collapsed: false });
  expect(turns).toHaveLength(1);
  expect(turns[0].memberIdxs).toEqual([0, 1, 2]);
});

test('折叠：最后一个 boundary 之前的消息被隐藏，boundary 入无头轮', () => {
  const msgs = [
    u('old-q'), a('old-a'),
    { role: 'assistant', content: '', isCompactBoundary: true } as Message,
    u('new-q'), a('new-a'),
  ];
  const { turns, turnByIndex } = buildTurns(msgs, { collapsed: true });
  // 下标 0、1 被隐藏，不出现在任何 turn
  expect(turnByIndex.has(0)).toBe(false);
  expect(turnByIndex.has(1)).toBe(false);
  // boundary(2) 是首个可见且非 header → 无头轮
  expect(turns[0]).toEqual({ turnId: 0, headerIdx: null, memberIdxs: [2] });
  expect(turns[1]).toEqual({ turnId: 1, headerIdx: 3, memberIdxs: [3, 4] });
});

test('未折叠：boundary 之前的轮正常保留', () => {
  const msgs = [
    u('old-q'), a('old-a'),
    { role: 'assistant', content: '', isCompactBoundary: true } as Message,
    u('new-q'), a('new-a'),
  ];
  const { turns } = buildTurns(msgs, { collapsed: false });
  expect(turns[0]).toEqual({ turnId: 0, headerIdx: 0, memberIdxs: [0, 1, 2] });
  expect(turns[1]).toEqual({ turnId: 1, headerIdx: 3, memberIdxs: [3, 4] });
});
```

**Step 2: 跑测试确认失败**

Run: `bun test components/agent-chat/turns.test.ts`
Expected: FAIL（`Cannot find module './turns.ts'` 或 `buildTurns is not a function`）

**Step 3: 写最小实现**

```ts
// components/agent-chat/turns.ts
import { isSdkInjectedUserMessage } from './utils';
import type { Message } from './types';

export interface Turn {
  turnId: number;
  /** 吸顶的用户消息下标；null = 无头轮（开头 assistant / 折叠后的 boundary 段） */
  headerIdx: number | null;
  /** 本轮所有被渲染消息的原始扁平下标，按顺序，含 header */
  memberIdxs: number[];
}

export interface BuildTurnsResult {
  turns: Turn[];
  /** 原始扁平下标 → turnId（仅含被渲染的消息） */
  turnByIndex: Map<number, number>;
}

function isHeader(msg: Message): boolean {
  return (
    msg.role === 'user' &&
    !msg.isMeta &&
    !msg.isCompactBoundary &&
    !msg.isCompactSummary &&
    !isSdkInjectedUserMessage(msg.content)
  );
}

export function buildTurns(
  messages: Message[],
  opts: { collapsed: boolean },
): BuildTurnsResult {
  const turns: Turn[] = [];
  const turnByIndex = new Map<number, number>();
  let currentTid = -1;

  let hiddenUntilIdx = -1;
  if (opts.collapsed) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].isCompactBoundary) {
        hiddenUntilIdx = i;
        break;
      }
    }
  }

  messages.forEach((msg, i) => {
    if (i < hiddenUntilIdx) return; // 折叠隐藏区，不渲染

    if (isHeader(msg)) {
      currentTid += 1;
      turns.push({ turnId: currentTid, headerIdx: i, memberIdxs: [i] });
    } else if (currentTid === -1) {
      currentTid = 0;
      turns.push({ turnId: 0, headerIdx: null, memberIdxs: [i] });
    } else {
      turns[turns.length - 1].memberIdxs.push(i);
    }
    turnByIndex.set(i, currentTid);
  });

  return { turns, turnByIndex };
}
```

**Step 4: 跑测试确认通过**

Run: `bun test components/agent-chat/turns.test.ts`
Expected: PASS（全部用例绿）

**Step 5: 提交**

```bash
rtk git add components/agent-chat/turns.ts components/agent-chat/turns.test.ts
rtk git commit -m "feat(agent-chat): 抽出共享轮次切分纯函数 buildTurns + 单测"
```

---

## Task 2: MessageMinimap 改用 buildTurns（输出保持不变）

**Files:**
- Modify: `components/agent-chat/MessageMinimap.tsx:43-93`（替换内联 useMemo）

把 minimap 内联的轮次切分换成 `buildTurns`，预览文案从 `memberIdxs` 派生。可见行为（turn 数量、预览、当前轮高亮）必须与改造前一致。

**Step 1: 替换轮次切分逻辑**

将 `MessageMinimap.tsx` 中 18-24 行的本地 `Turn` interface 删除（改用从 turns.ts 派生的展示结构），并把 42-93 行的 `useMemo` 替换为：

```tsx
import { buildTurns } from './turns';
// ... 保留原有 imports（extractMessagePreview / isSdkInjectedUserMessage 等）

interface MinimapTurn {
  turnId: number;
  userPreview: string | null;
  assistantPreviews: string[];
  jumpTargetIdx: number;
}

// 组件内：
const { turns, turnByIndex } = useMemo(() => {
  const { turns: rawTurns, turnByIndex } = buildTurns(messages, {
    collapsed: isHistoryCollapsed,
  });

  const turns: MinimapTurn[] = rawTurns.map((t) => {
    const userPreview =
      t.headerIdx !== null ? extractMessagePreview(messages[t.headerIdx]) || '(空消息)' : null;

    const assistantPreviews = t.memberIdxs
      .filter((i) => {
        if (i === t.headerIdx) return false;
        const m = messages[i];
        if (m.isMeta || m.isCompactBoundary || m.isCompactSummary) return false;
        if (m.role === 'user' && isSdkInjectedUserMessage(m.content)) return false;
        return true;
      })
      .map((i) => extractMessagePreview(messages[i]) || '(AI 回复)');

    return {
      turnId: t.turnId,
      userPreview,
      assistantPreviews,
      jumpTargetIdx: t.headerIdx ?? t.memberIdxs[0],
    };
  });

  return { turns, turnByIndex };
}, [messages, isHistoryCollapsed]);
```

> 渲染段（`turns.map(...)`，185-217 行）与 `recomputeCurrentTurn`（用 `turnByIndex`）无需改动，字段名 `userPreview`/`assistantPreviews`/`jumpTargetIdx`/`turnId` 保持一致。

**Step 2: 类型检查**

Run: `rtk tsc -p tsconfig.json --noEmit`
Expected: PASS（无 MessageMinimap 相关报错）

**Step 3: 手动验证 minimap 输出一致**

启动应用（`bun run dev`），打开一个有多轮 + 有插话 + 有压缩折叠的对话，hover 右侧地图图标：
- turn 数量、用户/AI 预览文案与改造前一致；
- 折叠态隐藏 boundary 之前的轮；展开后恢复；
- 滚动时当前轮高亮跟随正确。

**Step 4: 提交**

```bash
rtk git add components/agent-chat/MessageMinimap.tsx
rtk git commit -m "refactor(agent-chat): MessageMinimap 改用共享 buildTurns，输出不变"
```

---

## Task 3: AgentChat 渲染循环改为按 turn 包 section

**Files:**
- Modify: `components/agent-chat/AgentChat.tsx:324-374`

把扁平 `messages.map(renderMessage)` 改成"先 `buildTurns`，再每轮包一个 `<section>`"。折叠 banner / 收起控制条作为普通块渲染在所有 section 之前（不吸顶）。`renderMessage` 仍接收原始扁平下标。

**Step 1: 重写渲染段**

将 324-374 行的 IIFE 整体替换为：

```tsx
{(() => {
  const lastCompactIdx = messages.reduce(
    (acc, m, i) => (m.isCompactBoundary ? i : acc),
    -1,
  );
  const hasCompactHistory = lastCompactIdx > 0;
  const collapsed = isHistoryCollapsed && hasCompactHistory;

  const renderMessage = (message: typeof messages[0], index: number) => (
    <MessageItem
      key={index}
      message={message}
      messageIndex={index}
      onFork={sendMessage.handleFork}
      sessionId={sessionId}
      onPermissionResolved={handlePermissionResolvedWithScroll}
      onAskUserResolved={handleAskUserResolvedWithScroll}
      searchQuery={search.query || undefined}
      activeMatchId={search.activeMatch?.id ?? null}
    />
  );

  const { turns } = buildTurns(messages, { collapsed });

  return (
    <>
      {/* 压缩历史 banner / 收起条：普通块，不吸顶，在所有 section 之前 */}
      {hasCompactHistory && (
        collapsed ? (
          <CollapsedHistoryBanner
            count={lastCompactIdx}
            onExpand={() => conversationId && toggleCollapse(conversationId)}
          />
        ) : (
          <CollapseControlBar
            count={lastCompactIdx}
            onCollapse={() => conversationId && toggleCollapse(conversationId)}
          />
        )
      )}

      {turns.map((turn) => (
        <section key={turn.turnId} className="agent-turn">
          {turn.memberIdxs.map((i) => renderMessage(messages[i], i))}
        </section>
      ))}
    </>
  );
})()}
```

并在文件顶部加 `import { buildTurns } from './turns';`。

> 说明：
> - `CollapseControlBar` 之前位于 before-compact 之上；现在 before-compact 的消息在未折叠时位于最前面的若干 section 里，control bar 仍渲染在它们之前，位置语义不变。
> - `count` 用 `lastCompactIdx`（= 旧代码 `beforeCompact.length`）。
> - `<section>` 默认 `display:block`、无 `overflow`/`transform`，是其内 sticky header 的合法 containing block——这正是吸顶被限制在本轮的关键。**不要**给 section 加 `overflow`，否则 sticky 失效。

**Step 2: 类型检查 + lint**

Run: `rtk tsc -p tsconfig.json --noEmit && rtk lint`
Expected: PASS

**Step 3: 提交**

```bash
rtk git add components/agent-chat/AgentChat.tsx
rtk git commit -m "feat(agent-chat): 按轮次包 section，header 改为 section 内吸顶"
```

---

## Task 4: 应用内人工验证（核心：CSS 行为无法单测）

**Files:** 无（验证 + 必要时微调样式）

启动 `bun run dev`，逐项验证：

**Step 1: 高度差不再露底（核心修复）**

- 构造一轮很长的提问（带引用芯片 + 多行），下一轮提问很短。
- 滚动浏览：旧的长 header 被顶出后，**底部不再露出残影**；短 header 接管干净。
- 把某条历史 header 展开成多行后再滚动：同样不露底。

**Step 2: 吸顶语义正确**

- 当前轮答案超过一屏、提问被顶出顶部时 → 该提问钉在顶部。
- 滚进下一轮 → 下一轮提问到顶时无缝接管，任意时刻顶部只有一个 header。

**Step 3: 插话**

- AI 运行中插话发送，等其接收并产出。
- 滚到插话之后的输出时，顶部钉的是**插话那句**（新轮 header），minimap 也对应多出一个 turn。

**Step 4: 压缩折叠**

- 折叠态：顶部 `CollapsedHistoryBanner` **不吸顶**（随内容正常滚动）；其下第一条可见用户提问正常吸顶。
- 展开态：before-compact 的各轮恢复吸顶与锚定。

**Step 5: section 切换处的顶部空隙（按需微调）**

- 重点观察 section 交界：若 header 因 `MessageItem` 的 `my-2` 上外边距在吸顶时露出一条透明缝（缝里能看到背后内容滚过），则微调：
  - 方案：把用户消息外层的纵向间距从 `my-2` 改为由 `<section>` 提供（section 间距），header 自身贴 `top-0`；
  - 或给用户气泡所在 sticky 容器一个不透明背景延伸覆盖该缝。
- 若无可见缝隙则不改 `MessageItem`，保持最小改动。

**Step 6: 回归检查**

- minimap 跳转、Ctrl+F 搜索高亮跳转、`scrollToMessage`（搜索命中折叠段自动展开+跳转）均定位正确（验证 `messageIndex` 保号无误）。
- "回到底部"按钮、自动跟随（isLoading 时触底）行为正常。

**Step 7: 提交（若 Step 5 有改动）**

```bash
rtk git add components/agent-chat/MessageItem.tsx
rtk git commit -m "fix(agent-chat): 消除 section 内吸顶 header 顶部间隙"
```

---

## 完成后

- 若新增/改动模块结构（新增 `turns.ts`），按需触发 `/doc-sync` 更新 `codebase-map.md` 中 agent-chat 的文件清单。
- 整支分支验收通过后用 superpowers:finishing-a-development-branch 决定合并方式。
