# AgentChat 滚动跟随状态机重设计

> **For Claude:** 实施时使用 superpowers:executing-plans，按任务顺序执行。本项目无前端单测，每个任务后用文末"手动验证清单"对照验证。

**Goal:** 修复"会话中新内容到达时滚动条不跟着走"的偶发 Bug，并让"用户主动介入"的判定只由真正的用户操作触发。

**Architecture:** 把现有单一 `followRef` 升级为显式状态机 `followMode: 'auto' | 'manual'`；用户介入的判定从 `scroll` 事件迁移到 `wheel/touchmove/keydown`（这些事件浏览器只在用户操作时触发，不会被程序滚动误伤）；程序滚动统一打 `programmaticRef` 标志，避免与 `scroll` 事件竞态。

**Tech Stack:** React 19 + TypeScript，Radix ScrollArea，单个 hook 文件 `components/agent-chat/hooks/useChatScroll.ts`。

---

## 1. 背景

### 1.1 当前实现

文件：`components/agent-chat/hooks/useChatScroll.ts`

核心是一个 `followRef`（boolean）。

| 触发源 | 改动 |
|---|---|
| `isLoading` false → true | `followRef=true`，立即触底，挂 `ResizeObserver` 监听 `vp.firstElementChild` 尺寸变化，每次变化都把 `scrollTop` 推到 `scrollHeight` |
| `isLoading` true → false | `followRef=false`，回答结束后**永久关闭跟随**直到下一轮 |
| `onScrollCapture`（`handleScroll`） | 仅 `isLoading=true` 时生效；距底 `≤4px` 算贴底，`followRef=atBottom` |
| `scrollToBottom` | 触底 + `followRef=true` |
| `scrollToMessage` / `scrollToElement` | `followRef=false`（跳转后防回弹） |
| 权限/AskUser 到达（`onScrollToAction`，`AgentChat.tsx:141-144`） | 无条件 `scrollToBottom('smooth')` |
| 权限/AskUser 用户响应（`useSendMessage.ts:144`、`:165`） | **无** scroll 行为 |

### 1.2 已识别的问题

1. **scroll 事件 vs ResizeObserver 竞态**——新内容追加 → DOM 增高 → 浏览器在 scrollTop 钳制时可能触发 native `scroll` → `handleScroll` 比 `ResizeObserver` 先跑，算出 `distance > 4px` 把 `followRef` 关掉。之后 ResizeObserver 才看到 `followRef=false`，不再续滚。**这是"内容不跟着走"的最可能根因**。
2. **贴底阈值 4px 太死**——Electron + 高 DPI 下 sub-pixel 余量经常 5~10px，会把"其实贴底了"误判为离开。
3. **scroll 事件无法区分用户操作 vs 程序滚动**——`scrollTop = scrollHeight` 也会触发 scroll。
4. **`isLoading=false` 永久关闭跟随过于绝对**——`type === 'result'` 到达后可能还有 prompt_suggestion / task_summary / compact_boundary 等收尾内容，不会贴底。
5. **权限/AskUser 到达时无条件滚到底**——违反"用户介入则保留位置"原则；用户翻历史时被强行打断。
6. **权限/AskUser 响应后无 scroll**——用户在等待期间手动向上翻 → `followRef=false` → 点"允许"后 AI 继续输出，**不再跟随**。

---

## 2. 新设计

### 2.1 状态机

```
followMode: 'auto' | 'manual'
```

**进入 auto**（自动跟随最新内容）：
- 切换/创建对话、`isLoading` 由 false → true（新一轮开始）
- 发送新消息（含发送框 Send / Ctrl+Enter）
- 用户点"回到底部"按钮
- 用户响应权限请求 / AskUser 问题
- 滚动停止时距底部 `≤ 64px`（用 `scrollend` 或滚动节流后判断；仅在 manual 态下检查并提升为 auto）

**进入 manual**（保留用户位置）：
- **wheel 向上**（`deltaY < 0`）
- **touchmove 方向向上**
- **键盘** `PageUp` / `ArrowUp` / `Home` / `Shift+Space`（仅在 viewport 聚焦或焦点在 ScrollArea 内）
- `scrollToMessage` / `scrollToElement`（搜索/Minimap/引用跳转）

**不改变状态**：
- 程序触发的 `scrollTop = ...`（写入时打 `programmaticRef` 标志）
- ResizeObserver 触发的自动续滚

### 2.2 跟随机制

任何 DOM 变更（继续用 `ResizeObserver` 监听 `vp.firstElementChild`）：

```ts
if (followMode === 'auto') {
  programmaticRef.current = true;
  vp.scrollTop = vp.scrollHeight;
  requestAnimationFrame(() => { programmaticRef.current = false; });
}
```

ResizeObserver 的安装时机也要改：**不再绑死 `isLoading`**。改成 hook 挂载即装，整个会话生命周期都在，只是回调里看 `followMode` 决定是否动手。这样修复了"isLoading 切换瞬间收尾内容丢跟随"的问题。

### 2.3 事件源

| 事件 | 监听位置 | 用途 |
|---|---|---|
| `wheel` | `vp`（capture phase） | `deltaY < 0` → manual |
| `touchstart` + `touchmove` | `vp` | 记录起始 Y，移动向上 → manual |
| `keydown` | `vp`（或 window，过滤焦点在 vp 内） | PageUp/ArrowUp/Home → manual |
| `scroll` | `vp` | **只做两件事**：(1) 更新"回到底部"按钮显示；(2) 在 manual 态滚动结束时检测是否回到底部 → auto |
| `scrollend`（如可用） | `vp` | 同上，更准确；若浏览器不支持降级到 scroll + debounce(150ms) |

**关键变化**：`scroll` 事件**不再**做"用户向上滚就关闭跟随"——这件事改由 `wheel/touch/key` 负责。

### 2.4 程序滚动标志

```ts
const programmaticRef = useRef(false);

function scrollViewportTo(top: number, behavior: ScrollBehavior) {
  programmaticRef.current = true;
  vp.scrollTo({ top, behavior });
  // smooth 模式下 raf 不够，改为短 timeout 兜底
  if (behavior === 'instant') {
    requestAnimationFrame(() => { programmaticRef.current = false; });
  } else {
    setTimeout(() => { programmaticRef.current = false; }, 400);
  }
}
```

所有程序滚动入口（`scrollToBottom` / `scrollToElement` / ResizeObserver 续滚）都走这个 helper。

`handleScroll` 开头：`if (programmaticRef.current) return;`

### 2.5 阈值

| 用途 | 取值 | 说明 |
|---|---|---|
| "回到底部"按钮显示 | `distance >= 50` | 保持现状 |
| 滚动停止后视为贴底（manual → auto） | `distance <= 64` | 容忍 sub-pixel + 用户停在"几乎底"位置时的语义 |
| wheel 向上判定 | `deltaY < 0` | 无数值阈值 |

### 2.6 收尾窗口

`isLoading` 由 true → false 时，**不再**强制 `followMode = manual`。保留当前态。如此一来 result 之后到达的 prompt_suggestion 等通过 ResizeObserver 续滚正常贴底。

### 2.7 对外 API 变更

`useChatScroll` 返回值保持兼容：

```ts
{
  showScrollBtn: boolean;
  scrollToBottom: (behavior?: ScrollBehavior) => void;
  scrollToMessage: (idx: number, opts?: ScrollOptions) => void;
  scrollToElement: (el: HTMLElement, opts?: ScrollOptions) => void;
  handleScroll: () => void;   // 仍然挂在 onScrollCapture，做 (1)(2)
}
```

外部调用方（`AgentChat.tsx`）几乎不变，仅：
- `onScrollToAction` 改为"条件滚动"
- `handlePermissionResolved` / `handleAskUserResolved` 完成后调 `scrollToBottom`

---

## 3. 实施任务

> 每个任务结束都 `bun run lint` 通过 + 手动验证清单对应项目走一遍 + 提交。

### Task 1：扩展 `useChatScroll` 内部状态机（不改变外部行为）

**Files:**
- Modify: `components/agent-chat/hooks/useChatScroll.ts`

**Step 1**：把 `followRef: boolean` 改为 `followModeRef: { current: 'auto' | 'manual' }`，并新增 `programmaticRef: { current: boolean }`。

**Step 2**：新增内部 helper：

```ts
const setFollowMode = (mode: 'auto' | 'manual') => {
  followModeRef.current = mode;
};

const scrollViewportTo = (top: number, behavior: ScrollBehavior) => {
  const vp = getViewport();
  if (!vp) return;
  programmaticRef.current = true;
  if (behavior === 'instant') {
    vp.scrollTop = top;
    requestAnimationFrame(() => { programmaticRef.current = false; });
  } else {
    vp.scrollTo({ top, behavior: 'smooth' });
    setTimeout(() => { programmaticRef.current = false; }, 400);
  }
};
```

**Step 3**：把现有所有 `vp.scrollTop = ...` / `vp.scrollTo(...)` 全部替换成 `scrollViewportTo(...)`，包括 ResizeObserver 回调里的续滚。

**Step 4**：暂时保留旧 `followRef` 的语义映射（`followRef === true` 等价 `followModeRef.current === 'auto'`），让 ResizeObserver 和 handleScroll 继续编译通过。

**Step 5**：`bun run lint`。

**Step 6**：手动验证 §A1。

**Commit**：`refactor(agent-chat): scroll hook 引入 followMode + 程序滚动标志`

---

### Task 2：解耦 ResizeObserver 与 isLoading

**Files:**
- Modify: `components/agent-chat/hooks/useChatScroll.ts`

**Step 1**：把 "isLoading 由 false → true 时挂 ResizeObserver" 的 effect 改为 "hook 挂载时挂 ResizeObserver，仅在 followMode === 'auto' 时续滚"。

```ts
useEffect(() => {
  const vp = getViewport();
  if (!vp) return;
  const content = vp.firstElementChild;
  if (!content) return;
  const obs = new ResizeObserver(() => {
    if (followModeRef.current === 'auto') {
      scrollViewportTo(vp.scrollHeight, 'instant');
    }
  });
  obs.observe(content);
  return () => obs.disconnect();
}, [getViewport]);
```

**Step 2**：保留一个独立的 effect，仅在 `isLoading` 由 false → true 时**触底一次**并 `setFollowMode('auto')`：

```ts
useEffect(() => {
  if (isLoading) {
    setFollowMode('auto');
    const vp = getViewport();
    if (vp) scrollViewportTo(vp.scrollHeight, 'instant');
  }
  // isLoading 转 false 时不再强制 manual
}, [isLoading, getViewport]);
```

**Step 3**：`bun run lint`。

**Step 4**：手动验证 §A2、§A6（收尾窗口）。

**Commit**：`refactor(agent-chat): ResizeObserver 与 isLoading 解耦，保留收尾跟随`

---

### Task 3：把"用户介入"判定从 scroll 迁移到 wheel/touch/keydown

**Files:**
- Modify: `components/agent-chat/hooks/useChatScroll.ts`

**Step 1**：新增 effect，在 viewport 上监听 wheel/touchstart/touchmove/keydown：

```ts
useEffect(() => {
  const vp = getViewport();
  if (!vp) return;

  const onWheel = (e: WheelEvent) => {
    if (e.deltaY < 0) setFollowMode('manual');
  };

  let touchStartY: number | null = null;
  const onTouchStart = (e: TouchEvent) => {
    touchStartY = e.touches[0]?.clientY ?? null;
  };
  const onTouchMove = (e: TouchEvent) => {
    if (touchStartY === null) return;
    const y = e.touches[0]?.clientY ?? 0;
    if (y - touchStartY > 4) setFollowMode('manual'); // 手指向下拖 = 内容向上 = 看上文
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!vp.contains(document.activeElement) && document.activeElement !== document.body) return;
    if (['PageUp', 'ArrowUp', 'Home'].includes(e.key)) setFollowMode('manual');
  };

  vp.addEventListener('wheel', onWheel, { passive: true });
  vp.addEventListener('touchstart', onTouchStart, { passive: true });
  vp.addEventListener('touchmove', onTouchMove, { passive: true });
  window.addEventListener('keydown', onKeyDown);

  return () => {
    vp.removeEventListener('wheel', onWheel);
    vp.removeEventListener('touchstart', onTouchStart);
    vp.removeEventListener('touchmove', onTouchMove);
    window.removeEventListener('keydown', onKeyDown);
  };
}, [getViewport]);
```

**Step 2**：改写 `handleScroll`，**移除**"用户向上滚则关闭跟随"逻辑。新职责：
- 仅在 `!programmaticRef.current` 时执行
- 更新 `showScrollBtn`（`distance >= 50`）
- 若 `followModeRef.current === 'manual'` 且 `distance <= 64`，提升为 `'auto'`（用户主动滚回底部）

```ts
const handleScroll = useCallback(() => {
  if (programmaticRef.current) return;
  const vp = getViewport();
  if (!vp) return;
  const distance = vp.scrollHeight - vp.scrollTop - vp.clientHeight;
  setShowScrollBtn(distance >= 50);
  if (followModeRef.current === 'manual' && distance <= 64) {
    setFollowMode('auto');
  }
}, [getViewport]);
```

**Step 3**：`bun run lint`。

**Step 4**：手动验证 §A3、§A4。

**Commit**：`refactor(agent-chat): 用户介入判定改用 wheel/touch/keydown`

---

### Task 4：scrollToBottom / scrollToElement / scrollToMessage 接入新状态机

**Files:**
- Modify: `components/agent-chat/hooks/useChatScroll.ts`

**Step 1**：

```ts
const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
  const vp = getViewport();
  if (!vp) return;
  scrollViewportTo(vp.scrollHeight, behavior);
  setFollowMode('auto');
  setShowScrollBtn(false);
}, [getViewport]);
```

**Step 2**：`scrollToElement` 内部把 `followRef.current = false` 改为 `setFollowMode('manual')`，把 `vp.scrollTo({...})` 改为 `scrollViewportTo(...)`。

**Step 3**：删除遗留的 `followRef`（Task 1 暂留的兼容映射）。全文搜索确认无残留。

**Step 4**：`bun run lint`。

**Step 5**：手动验证 §A5、§A7。

**Commit**：`refactor(agent-chat): 跳转/触底入口全部走新状态机`

---

### Task 5：权限/AskUser 到达时按 followMode 决定是否滚动

**Files:**
- Modify: `components/agent-chat/AgentChat.tsx:141-144`

**Step 1**：`useChatScroll` 暴露 `isFollowing: () => boolean`（读 followModeRef）：

```ts
return {
  showScrollBtn,
  scrollToBottom,
  scrollToMessage,
  scrollToElement,
  handleScroll,
  isFollowing: () => followModeRef.current === 'auto',
};
```

**Step 2**：`AgentChat.tsx` 的 `onScrollToAction`：

```ts
onScrollToAction: () => {
  requestAnimationFrame(() => {
    if (isFollowing()) scrollToBottom('smooth');
  });
},
```

**Step 3**：`bun run lint`。

**Step 4**：手动验证 §A8。

**Commit**：`fix(agent-chat): 权限/AskUser 到达时尊重用户阅读位置`

---

### Task 6：权限/AskUser 响应完成后回到自动跟随

**Files:**
- Modify: `components/agent-chat/AgentChat.tsx`（给 MessageItem 多传一个回调或包一层）
- Modify: `components/agent-chat/hooks/useSendMessage.ts`（暴露响应完成钩子）

**方案 A**（推荐，改动小）：在 `AgentChat.tsx` 里包装两个 handler，响应完成后调用 `scrollToBottom('smooth')`：

```ts
const handlePermissionResolvedWithScroll = useCallback(
  async (...args: Parameters<typeof sendMessage.handlePermissionResolved>) => {
    await sendMessage.handlePermissionResolved(...args);
    requestAnimationFrame(() => scrollToBottom('smooth'));
  },
  [sendMessage.handlePermissionResolved, scrollToBottom]
);
// 同理 handleAskUserResolvedWithScroll
```

把 `MessageItem` 的 `onPermissionResolved` / `onAskUserResolved` 接到包装版本。

**Step 1**：实现两个包装回调。

**Step 2**：替换 `MessageItem` 的 props 绑定。

**Step 3**：`bun run lint`。

**Step 4**：手动验证 §A9。

**Commit**：`fix(agent-chat): 权限/AskUser 响应后自动恢复跟随`

---

### Task 7：清理与文档

**Files:**
- Modify: `components/agent-chat/hooks/useChatScroll.ts`（顶部注释）
- Modify: `.claude/rules/codebase-map.md`（如有必要更新 useChatScroll 行为描述）

**Step 1**：把 hook 顶部的"行为约定"注释完整改写为新状态机说明（参考本文 §2.1~§2.6）。

**Step 2**：检查 `codebase-map.md` 中 `useChatScroll.ts` 的描述是否需要更新（行 31~32 附近）。

**Step 3**：`bun run lint`。

**Commit**：`docs(agent-chat): 更新滚动跟随逻辑注释`

---

## 4. 手动验证清单

**所有场景都在 `bun run dev` 启动的应用里验证。**

### A1 基本回归（Task 1 后）
- [ ] 发送消息，AI 输出过程中页面正常贴底
- [ ] 点击对话切换，新对话首屏正常
- [ ] Ctrl+F 搜索、Minimap 跳转、引用插入均无报错

### A2 收尾内容（Task 2 后）
- [ ] 发一条会产生 prompt_suggestion 的消息，**等到 result 出现后**观察 prompt_suggestion 气泡到达瞬间，页面贴底（不应卡在 suggestion 上方）
- [ ] 触发一次 `/compact`（或自然 compact_boundary），收尾后页面仍贴底

### A3 wheel/touch 介入（Task 3 后）
- [ ] AI 输出过程中**鼠标滚轮向上滚** → 页面停在中间不动，新内容继续到达但不打扰
- [ ] 鼠标滚轮**向下滚回底部附近**（距底 ≤ 64px） → 自动恢复跟随
- [ ] 触摸板**双指上滑** → 同 wheel 上滚行为
- [ ] 在 viewport 上按 `PageUp` / `Home` → 进入 manual

### A4 程序滚动不误判（Task 3 后）
- [ ] AI 持续输出过程中，鼠标完全不动 → 页面**全程贴底**，不会因为内容增高自己触发的 scroll 事件而停下（这是修复的核心 Bug）
- [ ] DevTools 中临时打 `console.log(followModeRef.current)`（开发期）确认整个过程都是 'auto'

### A5 跳转后保留位置（Task 4 后）
- [ ] 用 Minimap 跳到上文 → 留在那里，AI 输出继续但页面不回弹
- [ ] 搜索激活某条历史 → 同上
- [ ] 点击"回到底部"按钮 → 立即贴底并恢复跟随

### A6 isLoading 切换边界（Task 2 后）
- [ ] 用户翻到上文（manual） → 等 AI 回答结束 → 用户翻到的位置**保留不动**（不再像旧实现那样被 isLoading=false 影响）
- [ ] 用户在底部 → AI 回答结束 → 仍在底部，prompt_suggestion 到达时贴底

### A7 多对话切换（Task 4 后）
- [ ] 对话 A 翻到上文（manual），切到对话 B（首屏 auto），切回对话 A → 期望：进入 A 时按新对话首屏处理（auto + 贴底）。**这点跟旧版一致**，因为 useChatScroll 实例随对话切换重建

### A8 权限/AskUser 到达（Task 5 后）
- [ ] 触发一个需要权限的工具（如 Write） + 用户**当前在底部** → 权限卡片到达时页面贴底
- [ ] 触发权限工具 + 用户**正在翻上文** → 权限卡片到达时页面**不动**；可看到"回到底部"按钮闪现

### A9 权限/AskUser 响应后（Task 6 后）
- [ ] 用户翻到上文 → 权限卡片到达不打扰 → 用户滚回底部点"允许" → AI 继续输出，正常贴底
- [ ] 用户翻到上文 → 在 manual 态点"允许"（不滚回底部直接点） → 期望：响应完成的瞬间页面**滚到底部**并恢复 auto

---

## 5. 回滚预案

- 所有改动集中在 `components/agent-chat/hooks/useChatScroll.ts` + `components/agent-chat/AgentChat.tsx`，单 PR 内可独立 revert
- 不动 store、不动主进程、不动 SDK 调用，无数据迁移风险
- 若发现新机制在某种 ScrollArea 内部实现下失效（如 Radix 升级），可临时把 wheel 监听换成 scroll 旧逻辑

---

## 6. 关键决策记录

- **不引入"找正在思考/生成元素"作为锚点**：几何判断（distance）开销更低、语义更稳定；UI 切换思考块/工具块时不抖动。
- **不再用 scroll 事件判断用户介入**：根因是 scroll 无法区分用户操作与程序滚动；wheel/touch/keydown 是浏览器只在用户操作时触发的天然信号源。
- **ResizeObserver 不再绑 isLoading**：避免 result 之后到达的内容（prompt_suggestion 等）丢失跟随；状态机里 `followMode` 已足够表达"该不该跟"。
- **manual → auto 的反向提升保留**：让用户"滚回底部=表达想跟随"的常识成立，不必每次都点"回到底部"按钮。
