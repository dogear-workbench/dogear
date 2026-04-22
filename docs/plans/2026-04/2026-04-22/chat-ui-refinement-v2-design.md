# AgentChat UI 精细化修订 v2 设计

> 2026-04-22 · 对 2026-04-21 chat-ui-refinement 的回归修复与布局重构

## 背景

上一轮引入了 Minimap、搜索高亮、显示模式、sticky 用户消息等功能后发现以下问题：

1. Minimap 按钮挡住 sticky 用户消息的右上角，视觉上像消息"不见了"
2. 用户消息外框太淡，与 AI 消息区分度不够
3. `messageDisplayMode` 的语义写反了：当前 compact=折叠卡片、detailed=展开卡片，用户的真实预期是 compact=极简小角标、detailed=当前卡片样式
4. 搜索高亮用 `background: transparent` 只改文字色，不显眼；且点击上/下切换激活项时 `scrollIntoView` 在 Radix ScrollArea viewport 里不可靠，导致"跳转只能向下"
5. Minimap 浮窗自身 `overflow-y-auto` + 视口指示器基于 `minimapContainerRef.clientHeight` 计算，跳转错位
6. Minimap 信息层级过多（图钉按钮 + tooltip + 色块 + 指示器）
7. 近期实现把某些瞬时 UI 状态放进了 store，用户反馈"切换会话应该被初始化"

## 设计目标

- 引入"右侧工具轨道"统一收纳 Minimap、折叠右栏等辅助按钮，避免未来新按钮各自飘着互相打架
- AgentChat 的内容区域左右留白更对称、更有呼吸感
- 搜索和 Minimap 跳转用统一的 viewport-based 滚动实现，双向可靠
- 显示模式语义对齐用户心智：compact=极简角标、detailed=当前完整卡片
- 所有新增 UI 交互状态用组件本地 `useState`，切换对话时 React 自然卸载重建自动清零，不碰 Zustand

## 架构变更

### 1. 右侧工具轨道（核心新结构）

```
┌─────────────────────────────────────┐
│  AgentChat 外层 relative            │
│ ┌──────────────────────────┐ ┌───┐ │
│ │                          │ │top│ │ 顶部按钮组
│ │  ScrollArea              │ │   │ │ - 折叠右栏
│ │  （内容 px-6，右侧 pr-12）│ │ - │ │ - Minimap 触发
│ │                          │ │   │ │
│ │                          │ │ - │ │
│ │                          │ │bot│ │ 底部按钮组
│ │                          │ │   │ │ - 回到底部
│ └──────────────────────────┘ └───┘ │
│                               w-12  │
│                           (透明无边)│
└─────────────────────────────────────┘
```

- 轨道宽度 `w-12`，视觉完全透明（无背景无边框）
- 轨道容器 `absolute right-0 top-0 bottom-0 w-12 flex flex-col z-10`
- 顶部按钮组 `flex flex-col gap-1 p-1`
- 底部按钮组 `mt-auto flex flex-col gap-1 p-1`
- 按钮统一样式：`w-8 h-8 rounded-md hover:bg-muted`

### 2. 内容区域留白

- ScrollArea 容器：`pr-12`（留给轨道）
- ScrollArea 内部文本：`px-6`（从 `px-4` 调整）
- 移动端不考虑（Electron 桌面应用）

### 3. 折叠右栏按钮下移

AgentChat 新增 prop：

```ts
interface AgentChatProps {
  rightPanelToggle?: {
    open: boolean;
    onToggle: () => void;
  };
  // ... 原有 props
}
```

- 主页 `app/page.tsx`：
  - 删除 Tab 栏末尾的 `<Button title="折叠预览面板">` 块
  - 给每个 AgentChat 传 `rightPanelToggle={{ open: rightPanelOpen, onToggle: toggleRightPanel }}`
- 独立会话窗口 `app/session-window/page.tsx`：
  - 新增 `const [rightPanelOpen, setRightPanelOpen] = useState(true)`
  - 右侧 ArticlePreview 改为可折叠（`w-80` ↔ `w-0 border-l-0`，类似主页的处理）
  - 给 AgentChat 传相同 prop
- AgentChat 内部：若 `rightPanelToggle` 有值，在轨道顶部渲染对应按钮（`PanelRightOpen` / `PanelRightClose`）

### 4. MessageMinimap 重做

组件结构：

```
<div className="relative"
     onMouseEnter={cancelHide, setHovering(true)}
     onMouseLeave={scheduleHide}>
  <button class="w-8 h-8 ..." onClick={() => setPinned(p => !p)}>
    <Map size={14} />
  </button>

  {shouldShow && (
    <div class="absolute right-12 top-0 w-48 max-h-[70vh] rounded-md
                border bg-background/95 backdrop-blur-sm shadow-lg
                overflow-y-auto">
      <TooltipProvider>
        <div ref={minimapContainerRef} class="relative flex flex-col">
          {visibleMessages.map((msg, idx) => (
            <button onClick={() => jumpTo(originalIdx)}
                    class={cn(
                      'flex items-center gap-2 px-2 py-1.5 text-xs text-left',
                      'hover:bg-muted transition-colors border-l-2',
                      isUser ? 'border-l-blue-500' : 'border-l-muted-foreground/40',
                      isCurrentViewport && 'bg-primary/10 ring-1 ring-primary/30'
                    )}>
              <span class="truncate">{preview}</span>
            </button>
          ))}
        </div>
      </TooltipProvider>
    </div>
  )}
</div>
```

关键变化：
- **去掉图钉按钮**：pinned 状态改由点击触发器本身切换
- **去掉 Tooltip**：改为"带文字预览的窄行"，直接看到内容
- **宽度加宽到 w-48**：能容纳 14 字预览
- **视口指示器改为整行高亮**：浮窗内部当前对应 viewport 的那条消息，加 `bg-primary/10 ring-1 ring-primary/30`；不再画单独的覆盖层方框
- **浮窗可滚动**：保留 `overflow-y-auto`，但视口指示器不再依赖 `minimapContainerRef.clientHeight`，而是依赖"哪条消息在视口内"（用 `viewport.scrollTop` + `messageEl.offsetTop` 比对判定）
- **触发按钮位置**：不再绝对定位，而是作为轨道顶部按钮组的子元素参与 flex 布局

### 5. minimap-utils.ts

- `extractMessagePreview` 字数上限从 30 改为 14（窄行展示）

### 6. 统一的 viewport 滚动辅助

在 AgentChat 内新增 helper（或抽到 utils）：

```ts
function scrollElementIntoView(viewport: HTMLElement, el: HTMLElement) {
  const elRect = el.getBoundingClientRect();
  const vpRect = viewport.getBoundingClientRect();
  const offset = elRect.top - vpRect.top + viewport.scrollTop
               - viewport.clientHeight / 2 + el.clientHeight / 2;
  viewport.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' });
}
```

用 `getBoundingClientRect` 差值计算绝对偏移，比 `scrollIntoView` 在 Radix ScrollArea 里可靠，双向跳转都准。

- 搜索激活项切换：`useEffect([search.activeMatch?.id])` 里调此函数
- Minimap 点击色块：`jumpTo` 改为调此函数 + 加 flash 动画

### 7. highlight.ts 样式

```ts
// 普通匹配
className: 'bg-yellow-200 text-foreground rounded px-0.5'
// 激活匹配
className: 'bg-orange-400 text-white rounded px-0.5 ring-2 ring-orange-600'
```

去掉 `style={{ background: 'transparent' }}`。激活项加 ring 方便定位。

### 8. 显示模式语义反转

**新语义**：
- `compact`（简化）= 工具/思考块不展示展开按钮，直接渲染一行 20px 高的胶囊
- `detailed`（详细）= 当前 compact 的表现（可折叠卡片，默认折叠）

> 注：原有的 detailed（默认展开）不再是"默认展开 vs 默认折叠"的对立，而是"是否能展开"的对立。详细模式保持可折叠体验，点用户 chevron 可展开看详情；简化模式直接无法展开。

`ThinkingBlock.tsx` compact 分支：

```tsx
<div className="inline-flex items-center gap-1 px-2 h-5 rounded-full
                bg-muted/70 text-muted-foreground text-xs">
  <Brain size={10} />
  <span>思考 · {contentLength}字</span>
</div>
```

`ToolBlock.tsx` compact 分支：

```tsx
<div className="inline-flex items-center gap-1 px-2 h-5 rounded-full
                bg-muted/70 text-muted-foreground text-xs">
  <span>{iconFor(toolName)}</span>
  <span>{toolName}</span>
  {shortArg && <span className="opacity-70">· {shortArg}</span>}
</div>
```

`shortArg` 从 `toolInput` 抽关键字段（Read → file_path 的 basename+line，Grep → pattern，Bash → command 前20字符等）。

### 9. 用户消息外框加粗

`MessageItem.tsx` 用户消息分支：

```tsx
<div className="relative sticky top-0 z-10 border-2 border-muted-foreground/25
                rounded-lg px-4 py-2 bg-background/95 backdrop-blur-sm
                shadow-md">
  ...
</div>
```

- `border` → `border-2`
- 颜色 `border-border` → `border-muted-foreground/25`
- 加 `shadow-md`（sticky 吸附时更明显的悬浮感）

### 10. 状态管理原则

**UI 交互状态一律组件本地 `useState`，不碰 Zustand、不碰 settings.json。**

适用对象：
- SearchBar 的 `isOpen/query/matches/activeIndex`（已在 useMessageSearch）
- MessageMinimap 的 `hovering/pinned/indicator`（本来就是组件本地）
- MessageItem 的 `isStickyExpanded`（本来就是组件本地）
- SessionWindowPage 的 `rightPanelOpen`（本地 useState，不写 ui-store）

切换 conversation 时，AgentChat 因 React key 变化重建整棵子树，所有 useState 自然重置。

`ui-store.rightPanelOpen` 保留（这是主页跨组件共享的状态，本身合理），但 AgentChat 不直接读，而是通过 prop 被动接收 → 解耦主页和独立窗口两种场景。

## 文件变更清单

- `components/agent-chat/AgentChat.tsx` — 轨道容器、prop 扩展、滚动 helper、padding 调整、回到底部按钮迁入轨道
- `components/agent-chat/MessageMinimap.tsx` — 去图钉去 tooltip、窄行预览、视口高亮改整行、跳转改 helper
- `components/agent-chat/minimap-utils.ts` — 预览长度 30 → 14
- `components/agent-chat/highlight.ts` — 样式改黄底/橙底
- `components/agent-chat/MessageItem.tsx` — 用户消息外框 border-2 + shadow-md
- `components/agent-chat/ThinkingBlock.tsx` — compact 改胶囊
- `components/ToolBlock.tsx` — compact 改胶囊
- `app/page.tsx` — 删除原折叠按钮、通过 prop 传入 AgentChat
- `app/session-window/page.tsx` — ArticlePreview 可折叠、新增本地 state、传 prop

## 验证计划

- [ ] sticky 用户消息在滚动时完整可见，外框明显（截图对比）
- [ ] 点击轨道折叠按钮在主页和独立窗口行为一致
- [ ] Minimap 点击任意块双向跳转都准确（上下任意方向）
- [ ] 搜索点击上/下切换激活项时内容自动居中到视口
- [ ] 搜索匹配有明显黄底，激活项橙底 + ring
- [ ] compact 模式工具/思考块只显示一行胶囊，占用空间极小
- [ ] detailed 模式维持当前完整卡片可折叠体验
- [ ] 切换对话后搜索浮条关闭、Minimap 收起、折叠态复位（验证 useState 重置）
- [ ] 独立会话窗口右侧 ArticlePreview 折叠/展开正常

## 不做

- 不新增 Zustand store
- 不改搜索的匹配算法
- 不改 Minimap 的消息过滤规则（仍然排除 isMeta / isCompactBoundary / isCompactSummary）
- 不引入滚动条槽的 match 标记条（等用户有进一步需求再说）
