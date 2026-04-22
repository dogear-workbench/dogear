# 会话界面精细化 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 重构会话阅读体验,引入搜索、小地图、工具降噪、用户输入悬浮冻结、模型 badge 五项改进。

**Architecture:** 纯前端改动,集中在 `components/agent-chat/` 模块。核心改造是 `MessageItem.tsx`(去头像 + sticky + 外框),其余为新增组件(SearchBar、MessageMinimap)和设置字段(messageDisplayMode)。不涉及主进程、IPC、服务层改动。

**Tech Stack:** React 19 + Vite + Tailwind CSS 4 + shadcn/ui + Radix UI + Zustand + lucide-react

**设计文档参考:** `docs/plans/2026-04/2026-04-21/chat-ui-refinement-design.md`

**项目约定(重要):**
- 本项目**无前端测试框架**(无 jest/vitest),所有"测试"步骤改为**手动验证步骤**:先运行 `bun run dev`,然后在 UI 上按照明确步骤验证行为,报告结果。
- 不要擅自引入测试框架。
- 每完成一个 task 必须先通过验证步骤,才能进入下一步;出错先回滚再查原因,不强行继续。
- 使用 `bun`(不用 npm)。
- 主进程改动需要 `bun run build:electron` 重新编译,**本 plan 全是前端改动,Vite 热重载即可**。
- 中文注释优先。
- 遵循 CLAUDE.md 中"不做兼容"原则:修改代码时不保留旧格式兼容,不加 backwards-compat shim。
- 出现不确定的时候,先询问再动手。

**实施顺序与依赖:**
1. Task 1 — ⑤ 模型 badge 位置调整(独立小改动,先做建立信心)
2. Task 2 — ④-a 去头像 + 外框(渲染骨架重构,基础)
3. Task 3 — ④-b 用户消息 sticky 悬浮(依赖 Task 2 的新结构)
4. Task 4 — ③ 设置字段 `messageDisplayMode` 添加
5. Task 5 — ③ ToolBlock/ThinkingBlock 接入 messageDisplayMode
6. Task 6 — ③ 设置页 AI 行为 Tab 加消息显示选项
7. Task 7 — ① 搜索浮条 UI + 基础状态
8. Task 8 — ① 文本匹配与高亮渲染
9. Task 9 — ① 跳转与快捷键
10. Task 10 — ② Minimap 浮窗触发与块渲染
11. Task 11 — ② Minimap 视口指示器与跳转闪烁

**Commit 策略:** 每个 task 完成后一个 commit,commit message 遵循项目现有 conventional commits 风格(`feat(chat-ui):`/`refactor(chat-ui):` 前缀)。

---

## Task 1:⑤ 模型 badge 位置调整为顶部左对齐

**目标:** 把已经存在的模型名从 AI 头像下方,移到 AI 消息正文上方左对齐的 badge 位置。

**当前状态:** `components/agent-chat/MessageItem.tsx:183-187` 已经在 AI 头像下方显示 `formatModelName(message.model)`,但样式是文字截断,不是 badge。

**Files:**
- Modify: `components/agent-chat/MessageItem.tsx`(AI 消息渲染分支)

### Step 1:阅读现有 MessageItem AI 消息分支(176-236 行)

目的:了解当前头像 + 模型名渲染结构,找到替换点。

### Step 2:修改 AI 消息渲染

**定位:** `MessageItem.tsx` 第 176-236 行(`) : (` 之后的 AI 分支)。

**改动:**
- 删除 `{message.model && (...)}` 那块(第 182-187 行,头像下方的模型名 div)
- 在 `<div className="flex-1 min-w-0">`(第 189 行) 内部**最顶部**添加 model badge,位于 `{message.contentBlocks && ...}` 之前

**新 badge 代码块**(插入在第 190 行位置):

```tsx
{message.model && (
  <div className="mb-1">
    <span className="inline-flex items-center h-5 px-2 rounded-md bg-muted text-muted-foreground text-xs font-medium">
      {formatModelName(message.model)}
    </span>
  </div>
)}
```

注意:**Task 1 保留 AI 头像**,只移动模型名;头像的移除放在 Task 2 统一处理。

### Step 3:运行 dev 并手动验证

Run: `bun run dev`(如果已经在运行则热重载即可)

验证清单:
1. 打开主工作区,选一个有历史消息的对话
2. AI 消息**正文上方**应该出现一个扁 badge,显示 `Opus 4.7` / `Sonnet 4.5` 等简称
3. AI 头像下方的原模型名**消失**了
4. 发一条新消息,流式输出时 badge 正确显示(一旦 `model` 字段到达就出现)
5. 用户消息**不受影响**,仍是原样式

### Step 4:Commit

```bash
rtk git add components/agent-chat/MessageItem.tsx
rtk git commit -m "feat(chat-ui): 模型名 badge 移到 AI 消息正文上方"
```

---

## Task 2:④-a 去头像 + 用户消息外框

**目标:** 移除用户和 AI 消息左侧头像区域,用户消息用淡色外框包裹,AI 消息无边框平齐;正文向左扩展。

**Files:**
- Modify: `components/agent-chat/MessageItem.tsx`

### Step 1:改用户消息渲染结构

**定位:** `MessageItem.tsx` 第 54-174 行(isUser 分支)。

**改动:**
- 删除头像 div(第 57-63 行):`<div className="flex-shrink-0 w-8 h-8 rounded-full...">...</div>`
- 外层容器改结构:
  - 删除:`<div className="flex items-start gap-3">` 的 flex 布局
  - 新外层:`<div className="border border-border rounded-lg px-4 py-3 bg-background/50">`
- 微信 Bot 标记 `<Bot className="...">` 原来挂在头像上,现在移到消息右上角或在外框左上角放一个小图标(保留功能)
- **保持**内容结构不变(引用芯片、消息文本、图片、timestamp、斜杠命令渲染全都不动)
- `pr-8` 可以去掉(原来是为右侧留空,现在没必要)

**参考结构(改动后应该长这样):**

```tsx
{isUser ? (
  // 用户消息:外框包裹,无头像
  <div className="relative border border-border rounded-lg px-4 py-3 bg-background/50">
    {message.source === 'wechat-bot' && (
      <Bot className="w-3 h-3 text-green-500 absolute top-2 right-2" />
    )}
    <div className="min-w-0">
      {/* ... 原 flex-1 内部的内容保持不变 ... */}
    </div>
  </div>
) : ( /* ... AI 分支见 Step 2 ... */ )}
```

### Step 2:改 AI 消息渲染结构

**定位:** 第 176-236 行(AI 分支)。

**改动:**
- 删除 AI 头像 div(第 177-188 行包含 `w-8 h-8 rounded-full bg-primary` 的块)
- 外层从 `<div className="flex items-start gap-3">` 改为 `<div className="w-full">`(无框,平齐)
- `<div className="flex-1 min-w-0">` 改为 `<div className="min-w-0">`
- Task 1 添加的 model badge 保留不变,仍在顶部

**参考结构:**

```tsx
) : (
  // AI 消息:无外框,无头像,平齐
  <div className="w-full">
    <div className="min-w-0">
      {/* model badge(Task 1 已加) */}
      {message.model && (
        <div className="mb-1">
          <span className="inline-flex items-center h-5 px-2 rounded-md bg-muted text-muted-foreground text-xs font-medium">
            {formatModelName(message.model)}
          </span>
        </div>
      )}
      {/* ... 原 flex-1 内部的内容保持不变 ... */}
    </div>
  </div>
)}
```

### Step 3:清理 import

确认 `MessageItem.tsx` 第 2 行的 import:如果 `Bot` 图标仍在使用(微信 Bot 标记),保留;否则清理。`GitBranch`、`ChevronDown`、`ChevronRight`、`FileText` 应保留。

### Step 4:手动验证

1. 用户消息:应该被**淡色外框**包起来(`border-border` + 圆角),无左侧头像,正文从左边缘开始有 padding
2. AI 消息:**无外框**,无头像,正文直接从左边缘开始,上方有模型 badge
3. 微信 Bot 来源的用户消息,右上角应该仍显示绿色 Bot 图标
4. 引用芯片、长文本折叠、图片附件、timestamp 全部正常显示
5. 分叉按钮在 AI 消息底部仍能 hover 显示
6. 压缩摘要消息(isCompactSummary)保持原样式不变(这个分支在 33-50 行,不在本次改动范围内)

### Step 5:Commit

```bash
rtk git add components/agent-chat/MessageItem.tsx
rtk git commit -m "refactor(chat-ui): 移除消息头像,用户消息改用外框区分角色"
```

---

## Task 3:④-b 用户消息 sticky 悬浮 + 收起/展开

**目标:** 滚动时用户消息自动粘到消息区顶部(CSS sticky),默认 2 行收起,点击切换展开(max-h 40vh)。

**Files:**
- Modify: `components/agent-chat/MessageItem.tsx`
- 可能 Modify: `components/agent-chat/AgentChat.tsx`(确保滚动容器是 sticky containing block)

### Step 1:为用户消息外框加 sticky

**定位:** Task 2 改过的用户消息外层 div。

**改动:**
- 在外层 div 加 `sticky top-0 z-10 bg-background/95 backdrop-blur-sm`
- 原 `bg-background/50` 替换为 `bg-background/95 backdrop-blur-sm`(确保滚到顶部时不透)

**预期外层 className:**
```
"relative sticky top-0 z-10 border border-border rounded-lg px-4 py-3 bg-background/95 backdrop-blur-sm"
```

### Step 2:加收起/展开态逻辑

**改动:**
- `MessageItem` 组件内新增 local state:`const [isStickyExpanded, setIsStickyExpanded] = useState(false);`
- 原 `needsCollapse`/`isExpanded` 状态**保留不变**(那是长文本折叠,不同概念,互不干扰)

**在用户消息外层 div 里**加 onClick 切换 sticky 展开:

```tsx
<div
  className="relative sticky top-0 z-10 border border-border rounded-lg px-4 py-3 bg-background/95 backdrop-blur-sm cursor-pointer"
  onClick={(e) => {
    // 仅当点击在外层 div 本身(不是内部的按钮/链接)时切换
    if (e.target === e.currentTarget || (e.target as HTMLElement).closest('[data-sticky-toggle-ignore]')) return;
    setIsStickyExpanded(v => !v);
  }}
  data-sticky-collapsed={!isStickyExpanded}
>
  {/* 内容区:收起态 line-clamp-2,展开态 max-h-[40vh] overflow-y-auto */}
  <div
    className={isStickyExpanded ? 'max-h-[40vh] overflow-y-auto' : 'line-clamp-2'}
  >
    {/* 原内容 */}
  </div>
</div>
```

**坑点:** 用户消息里有引用芯片(可点击 `title` 气泡)、长文本展开按钮(`onClick={() => setIsExpanded(true)}`)、图片等可交互元素。onClick 冒泡会触发 sticky 展开/收起。

**解决方案:**
- 在用户原"展开/收起长文本"按钮上加 `data-sticky-toggle-ignore` data attribute
- 外层 onClick 检测时排除这些区域
- 或更简单:**只在消息文本区域**响应 onClick,不在外层

**简化后的推荐写法**(只让文本区域响应 sticky 切换):

```tsx
<div className="relative sticky top-0 z-10 border border-border rounded-lg px-4 py-3 bg-background/95 backdrop-blur-sm">
  {message.source === 'wechat-bot' && (
    <Bot className="w-3 h-3 text-green-500 absolute top-2 right-2" />
  )}
  <div className="min-w-0">
    {/* 引用芯片 */}
    {hasRefs && <div className="flex flex-wrap gap-1.5 mb-2">...</div>}

    {/* 消息文本区 - 这里是 sticky 切换区域 */}
    <div
      className={cn(
        "whitespace-pre-wrap break-words text-sm text-foreground cursor-pointer",
        !isStickyExpanded && "line-clamp-2",
        isStickyExpanded && "max-h-[40vh] overflow-y-auto"
      )}
      onClick={() => setIsStickyExpanded(v => !v)}
    >
      {parsed.userMessage}
    </div>

    {/* 原长文本展开按钮:sticky 模式下不显示(避免双重展开逻辑) */}
    {/* 图片、timestamp */}
  </div>
</div>
```

**重要决策:** sticky 收起/展开替代原长文本折叠逻辑(两个重复),**移除原 `needsCollapse`/`isExpanded` 的按钮渲染**(`ChevronRight`/`ChevronDown` 按钮那两段),但保留 state 以备将来。或者更干净地直接删除原长文本折叠。**选择后者:直接删除 `needsCollapse`/`isExpanded` 相关代码,统一用 sticky 的收起/展开。**

### Step 3:CSS 层级确认

Sticky 生效的条件是**祖先没有 `overflow: hidden/auto`** 阻断(除非那个祖先自己也是滚动容器)。

**AgentChat.tsx** 的消息区使用 `<ScrollArea>`(Radix),内部 viewport 是滚动容器。sticky 需要挂在 viewport 内的消息元素上,position: sticky 会相对 viewport 粘住。

**验证点:** `scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]')` 就是滚动容器。我们的 sticky top-0 会相对于它粘住。

**如果 sticky 不生效**(Task 3 Step 4 验证时发现),可能需要:
- 检查 `<div className="px-4">`(AgentChat.tsx 第 243 行) 和 ScrollArea viewport 是否有 `overflow: hidden`
- 如果 `CollapsibleContent` 或其他祖先有阻断,需要调整结构

### Step 4:手动验证

1. 打开一个有 10+ 轮对话的会话
2. 滚到中间某条用户消息位置
3. **当这条用户消息的位置滚出视口上方时**,它应该粘在消息区顶部
4. 粘住的消息默认显示 2 行(`line-clamp-2`)
5. 点击粘住的消息文本 → 展开,展开态不超过视口 40%,超出可内部滚动
6. 再次点击 → 收起
7. 继续向下滚,**遇到下一条用户消息时,顶部粘住的自动替换**为新的
8. AI 消息不会粘住
9. 引用芯片、图片附件等原有元素仍正常显示
10. 微信 Bot 标记(右上角)在粘住时不遮挡内容

**常见问题排查:**
- sticky 不生效:检查父元素 overflow;尝试临时去除 `<div className="opacity-70">`(压缩历史折叠容器) 排除;如果是 Radix ScrollArea 兼容问题,参考 https://github.com/radix-ui/primitives/issues 搜索 sticky 相关 issue
- 粘住的消息半透明/透文字:增加 backdrop-blur 或改为完全不透明背景

### Step 5:Commit

```bash
rtk git add components/agent-chat/MessageItem.tsx
rtk git commit -m "feat(chat-ui): 用户消息 sticky 悬浮冻结,支持收起/展开"
```

---

## Task 4:③ 设置字段 messageDisplayMode 添加

**目标:** 在 `AppSettings` 中新增 `ui.messageDisplayMode: 'compact' | 'detailed'` 字段,默认 `'compact'`。

**Files:**
- Modify: `types/settings.ts`

### Step 1:添加 UI 设置子对象

**定位:** `types/settings.ts` 第 42-61 行的 `AppSettings` 接口。

**改动:** 在 `AppSettings` 中新增 `ui` 子对象:

```ts
export interface AppSettings {
  ai: { /* ... 现有字段 ... */ };
  permissionRules?: { /* ... */ };
  personas: Persona[];
  profiles: Record<string, ModelProfile>;
  ui?: {
    messageDisplayMode: 'compact' | 'detailed'; // ③ 工具/思考块显示模式,默认 'compact'
  };
}
```

注意:用 `ui?: {...}` 可选对象,避免 JSON 里已有 settings 文件缺字段时崩溃(迁移兼容)。读取时用 `settings.ui?.messageDisplayMode ?? 'compact'`。

### Step 2:更新 DEFAULT_SETTINGS

**定位:** 第 66-89 行 `DEFAULT_SETTINGS`。

**改动:** 在对象末尾添加 `ui` 字段:

```ts
export const DEFAULT_SETTINGS: AppSettings = {
  ai: { /* ... */ },
  personas: [],
  profiles: { /* ... */ },
  ui: {
    messageDisplayMode: 'compact',
  },
};
```

### Step 3:手动验证类型

Run: `bun run lint`

Expected: 无新增 TypeScript 错误。

如果 `settings-service.ts` 或 `settings-store.ts` 有类型检查报错,阅读报错位置并按需处理(通常是因为 `ui` 字段可选,读取位置需要可选链)。

### Step 4:Commit

```bash
rtk git add types/settings.ts
rtk git commit -m "feat(settings): 新增 ui.messageDisplayMode 字段用于消息显示模式"
```

---

## Task 5:③ ToolBlock / ThinkingBlock 接入 messageDisplayMode

**目标:** `ToolBlock` 和 `ThinkingBlock` 根据 `settings.ui.messageDisplayMode` 决定是否默认展开。

**注意:** `CollapsibleBlock` 已支持 `defaultOpen` prop(第 22、40 行),**不需要改 CollapsibleBlock**。只需透传。

**Files:**
- Modify: `components/ToolBlock.tsx`
- Modify: `components/agent-chat/ThinkingBlock.tsx`

### Step 1:先看 settings-store 怎么暴露

<!-- 如果 executing-plans 的 subagent 不熟悉,补充:settings-store 从 .dogear/settings.json 读取,Zustand hook 通常叫 useSettingsStore。核对一下。 -->

Run 查找:
```
Grep: pattern="useSettingsStore" path="stores/settings-store.ts"
```

确认如何获取 settings 对象(应该类似 `const settings = useSettingsStore(s => s.settings)`,但以实际代码为准)。

### Step 2:ToolBlock 接入

**定位:** `components/ToolBlock.tsx` 第 200-267 行 `ToolBlock` 函数。

**改动:**
- import 顶部加:`import { useSettingsStore } from '@/stores/settings-store';`
- 函数体开头加:
  ```ts
  const displayMode = useSettingsStore(s => s.settings?.ui?.messageDisplayMode ?? 'compact');
  const defaultOpen = displayMode === 'detailed';
  ```
- 在 `<CollapsibleBlock>` 传入 `defaultOpen={defaultOpen}`:
  ```tsx
  <CollapsibleBlock
    icon={...}
    title={titleText}
    titleClassName={...}
    statusIcon={...}
    previewLines={2}
    defaultOpen={defaultOpen}
    className={className}
  >
  ```

### Step 3:ThinkingBlock 接入

**定位:** `components/agent-chat/ThinkingBlock.tsx`。

**改动:**
- import 加:`import { useSettingsStore } from '@/stores/settings-store';`
- 组件开头加同样的 displayMode / defaultOpen 读取
- `<CollapsibleBlock>` 加 `defaultOpen={defaultOpen}`:

```tsx
<CollapsibleBlock
  icon={...}
  title={hasContent ? '思考' : '思考中...'}
  previewLines={3}
  defaultOpen={defaultOpen}
>
```

### Step 4:手动验证

1. 确认 `.dogear/settings.json` 中没有 `ui.messageDisplayMode` 字段(或为 `'compact'`)
2. `bun run dev`
3. 触发一次会带工具调用的 AI 回复(比如 `@` 引用一篇文章让 AI 分析)
4. 工具块**默认折叠**,只显示标题(例如 `📄 Read src/App.tsx`)
5. Thinking 块(如果有)**默认折叠**,只显示标题"思考"
6. 点击工具块标题可展开查看详情
7. 手动编辑 `.dogear/settings.json`,加上 `"ui": { "messageDisplayMode": "detailed" }`,**重启应用**
8. 工具块和 thinking 块**默认展开**

**注意:** 现在设置页还没 UI,所以先手动改 JSON 验证。Task 6 会加 UI。

### Step 5:Commit

```bash
rtk git add components/ToolBlock.tsx components/agent-chat/ThinkingBlock.tsx
rtk git commit -m "feat(chat-ui): 工具/思考块按 messageDisplayMode 决定默认展开态"
```

---

## Task 6:③ 设置页 AI 行为 Tab 加"消息显示模式"选项

**目标:** 在设置页「AI 行为」Tab 最末尾添加消息显示模式的单选(简化/详细)。

**Files:**
- Modify: `app/settings/page.tsx`

### Step 1:找到插入位置

**定位:** `app/settings/page.tsx` 第 386 行起的 `<TabsContent value="behavior">`。

找到「默认权限模式」选项结束的位置(第 486 行左右,`</div>` 闭合默认权限模式分组后)。新选项插在这组后面。

### Step 2:添加消息显示模式分组

**插入代码**(参考项目已有样式,和权限模式格式一致):

```tsx
{/* 消息显示模式 */}
<div className="space-y-3">
  <label className="text-sm font-medium">消息显示模式</label>
  <p className="text-xs text-muted-foreground">控制工具调用和思考过程的默认展开态</p>
  <div className="space-y-2">
    <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
      <input
        type="radio"
        name="messageDisplayMode"
        className="mt-0.5"
        checked={(local.ui?.messageDisplayMode ?? 'compact') === 'compact'}
        onChange={() => updateUI({ messageDisplayMode: 'compact' })}
      />
      <div>
        <div className="text-sm font-medium">简化(推荐)</div>
        <div className="text-xs text-muted-foreground">工具调用和思考块默认折叠,只显示标题</div>
      </div>
    </label>
    <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
      <input
        type="radio"
        name="messageDisplayMode"
        className="mt-0.5"
        checked={local.ui?.messageDisplayMode === 'detailed'}
        onChange={() => updateUI({ messageDisplayMode: 'detailed' })}
      />
      <div>
        <div className="text-sm font-medium">详细</div>
        <div className="text-xs text-muted-foreground">工具调用和思考块默认展开,显示完整输入/输出</div>
      </div>
    </label>
  </div>
</div>
```

### Step 3:补 updateUI helper

设置页很可能已经有类似 `updateAI(patch)` 的 helper 函数(从 `local` state 派生更新)。搜一下:

Run: Grep `pattern="updateAI"` path="app/settings/page.tsx"

找到 `updateAI` 的定义,**仿照它添加 `updateUI` 函数**。例如:

```ts
const updateUI = (patch: Partial<NonNullable<AppSettings['ui']>>) => {
  setLocal(prev => ({
    ...prev,
    ui: { ...(prev.ui ?? { messageDisplayMode: 'compact' }), ...patch }
  }));
};
```

插入位置:和 `updateAI` 在一起(通常在组件顶部 state 定义下方)。

### Step 4:手动验证

1. `bun run dev`
2. 打开设置页 → AI 行为 Tab
3. 滚到底部看到「消息显示模式」分组
4. 默认应为"简化"选中
5. 切换为"详细",保存设置(设置页可能有保存按钮 / 自动保存,以现有模式为准)
6. 切换到某有工具调用的会话,工具块默认展开
7. 切回"简化",工具块默认折叠
8. 退出重进应用,设置持久化

**注意:** 设置切换的生效时机 —— 由于 `ToolBlock` 使用 `defaultOpen`(初始值),已经渲染的工具块不会即时改变展开态(这符合预期,用户切了模式后对**新渲染**的消息生效)。如果想即时生效,需要把 `defaultOpen` 改成 `open`(受控)。**先不改**,等验证后再说。

### Step 5:Commit

```bash
rtk git add app/settings/page.tsx
rtk git commit -m "feat(settings): AI 行为 Tab 新增消息显示模式选项"
```

---

## Task 7:① 搜索浮条 UI + 基础状态

**目标:** 新建 `SearchBar.tsx` 和 `useMessageSearch` hook,渲染顶部浮条并管理搜索状态。本 task **不实现文本匹配和高亮**,只做 UI 框架。

**Files:**
- Create: `components/agent-chat/SearchBar.tsx`
- Create: `components/agent-chat/hooks/useMessageSearch.ts`
- Modify: `components/agent-chat/AgentChat.tsx`

### Step 1:创建 useMessageSearch hook

**File:** `components/agent-chat/hooks/useMessageSearch.ts`

```ts
import { useState, useCallback } from 'react';

export interface SearchMatch {
  id: string;           // 唯一 ID: `${messageIndex}-${blockIndex}-${textStart}`
  messageIndex: number;
  blockIndex: number;   // contentBlock 索引,用户消息为 0
  textStart: number;
  textEnd: number;
}

export function useMessageSearch() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => {
    setIsOpen(false);
    setQuery('');
    setMatches([]);
    setActiveIndex(0);
  }, []);

  const next = useCallback(() => {
    if (matches.length === 0) return;
    setActiveIndex(i => (i + 1) % matches.length);
  }, [matches.length]);

  const prev = useCallback(() => {
    if (matches.length === 0) return;
    setActiveIndex(i => (i - 1 + matches.length) % matches.length);
  }, [matches.length]);

  return {
    isOpen,
    query,
    setQuery,
    matches,
    setMatches,
    activeIndex,
    open,
    close,
    next,
    prev,
    activeMatch: matches[activeIndex],
  };
}
```

### Step 2:创建 SearchBar 组件

**File:** `components/agent-chat/SearchBar.tsx`

```tsx
import { useEffect, useRef } from 'react';
import { ChevronUp, ChevronDown, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SearchBarProps {
  isOpen: boolean;
  query: string;
  setQuery: (q: string) => void;
  totalMatches: number;
  activeIndex: number; // 0-based
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}

export function SearchBar({
  isOpen,
  query,
  setQuery,
  totalMatches,
  activeIndex,
  onPrev,
  onNext,
  onClose,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // 打开时自动聚焦
  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  if (!isOpen) return null;

  const display = totalMatches === 0 ? (query ? '无匹配' : '') : `${activeIndex + 1}/${totalMatches}`;

  return (
    <div className="absolute top-2 right-2 z-30 flex items-center gap-1 px-2 py-1 rounded-md border border-border bg-background/95 backdrop-blur-sm shadow-sm">
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.shiftKey ? onPrev() : onNext();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
        placeholder="搜索..."
        className="h-6 w-48 px-2 text-xs bg-transparent focus:outline-none"
      />
      <span className="text-xs text-muted-foreground min-w-[40px] text-center">{display}</span>
      <button
        onClick={onPrev}
        disabled={totalMatches === 0}
        className={cn(
          'p-0.5 rounded hover:bg-muted',
          totalMatches === 0 && 'opacity-30 cursor-not-allowed'
        )}
        title="上一个 (Shift+Enter)"
      >
        <ChevronUp size={14} />
      </button>
      <button
        onClick={onNext}
        disabled={totalMatches === 0}
        className={cn(
          'p-0.5 rounded hover:bg-muted',
          totalMatches === 0 && 'opacity-30 cursor-not-allowed'
        )}
        title="下一个 (Enter)"
      >
        <ChevronDown size={14} />
      </button>
      <button onClick={onClose} className="p-0.5 rounded hover:bg-muted" title="关闭 (Esc)">
        <X size={14} />
      </button>
    </div>
  );
}
```

### Step 3:挂载到 AgentChat

**定位:** `AgentChat.tsx` 第 234 行返回 JSX 起始处。

**改动:**
- import 加:
  ```ts
  import { SearchBar } from './SearchBar';
  import { useMessageSearch } from './hooks/useMessageSearch';
  ```
- 函数体内调用 hook(约第 220 行 slashCommands 之后):
  ```ts
  const search = useMessageSearch();
  ```
- 在 `<div className="relative flex-1 overflow-hidden">`(第 237 行) **内部最顶部**挂 SearchBar:
  ```tsx
  <div className="relative flex-1 overflow-hidden">
    <SearchBar
      isOpen={search.isOpen}
      query={search.query}
      setQuery={search.setQuery}
      totalMatches={search.matches.length}
      activeIndex={search.activeIndex}
      onPrev={search.prev}
      onNext={search.next}
      onClose={search.close}
    />
    <ScrollArea ...>
      ...
    </ScrollArea>
  </div>
  ```

**Ctrl+F 快捷键监听**(加在 `useSessionEvents` 之后,约第 158 行之前):

```ts
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      search.open();
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, [search.open]);
```

### Step 4:手动验证

1. `bun run dev`
2. 打开任意会话
3. 按 `Ctrl+F`,右上角出现搜索浮条,输入框自动聚焦
4. 输入任意文字,显示"无匹配"(因为 Step 4 还没实现匹配)
5. 按 `Esc` 或点 × 关闭
6. 浮条不影响消息区滚动

### Step 5:Commit

```bash
rtk git add components/agent-chat/SearchBar.tsx components/agent-chat/hooks/useMessageSearch.ts components/agent-chat/AgentChat.tsx
rtk git commit -m "feat(chat-ui): 搜索浮条 UI 与 Ctrl+F 快捷键"
```

---

## Task 8:① 文本匹配与高亮渲染

**目标:** 实现文本匹配逻辑(子串、大小写不敏感),在消息文本中用 `<mark>` 包裹匹配片段,橙色高亮。

**Files:**
- Modify: `components/agent-chat/hooks/useMessageSearch.ts`(加匹配逻辑)
- Modify: `components/agent-chat/AgentChat.tsx`(传 query 到 MessageItem)
- Modify: `components/agent-chat/MessageItem.tsx`(传 query 到 ContentBlockItem 和用户消息文本)
- Modify: `components/agent-chat/ContentBlockItem.tsx`(传 query 到文本块)
- Modify: `components/MarkdownRenderer.tsx`(接收 query,在渲染后高亮)
- 可能新建: `components/agent-chat/utils/highlight.ts`(高亮工具函数)

### Step 1:在 useMessageSearch 加匹配逻辑

**追加到 useMessageSearch.ts:**

```ts
import { useEffect, useMemo } from 'react';
// 加参数:messages (从 AgentChat 传入)
export function useMessageSearch(messages: any[]) {
  // ... 原 state
  
  // 根据 query 计算 matches
  useEffect(() => {
    if (!query.trim()) {
      setMatches([]);
      setActiveIndex(0);
      return;
    }
    const q = query.toLowerCase();
    const result: SearchMatch[] = [];
    
    messages.forEach((msg, messageIndex) => {
      if (msg.isMeta || msg.isCompactBoundary || msg.isCompactSummary) return;
      
      // 用户消息:解析后的 userMessage 文本
      if (msg.role === 'user' && msg.content) {
        // 去除 XML 引用标签
        const pureText = msg.content
          .replace(/<referenced_articles>[\s\S]*?<\/referenced_articles>/g, '')
          .replace(/<quoted_snippet[^>]*>[\s\S]*?<\/quoted_snippet>/g, '')
          .replace(/<command-[a-z]+>[\s\S]*?<\/command-[a-z]+>/g, '');
        let idx = 0;
        const lower = pureText.toLowerCase();
        while ((idx = lower.indexOf(q, idx)) !== -1) {
          result.push({
            id: `${messageIndex}-u-${idx}`,
            messageIndex,
            blockIndex: -1, // -1 表示用户消息
            textStart: idx,
            textEnd: idx + q.length,
          });
          idx += q.length;
        }
      }
      
      // AI 消息:遍历 contentBlocks 中 type=text 和 type=thinking 的块
      if (msg.role === 'assistant' && msg.contentBlocks) {
        msg.contentBlocks.forEach((block: any, blockIndex: number) => {
          if (block.type !== 'text' && block.type !== 'thinking') return;
          const text = block.content || block.text || '';
          if (!text) return;
          const lower = text.toLowerCase();
          let idx = 0;
          while ((idx = lower.indexOf(q, idx)) !== -1) {
            result.push({
              id: `${messageIndex}-${blockIndex}-${idx}`,
              messageIndex,
              blockIndex,
              textStart: idx,
              textEnd: idx + q.length,
            });
            idx += q.length;
          }
        });
      }
      
      // AI 消息无 contentBlocks 时用 content
      if (msg.role === 'assistant' && !msg.contentBlocks && msg.content) {
        const lower = msg.content.toLowerCase();
        let idx = 0;
        while ((idx = lower.indexOf(q, idx)) !== -1) {
          result.push({
            id: `${messageIndex}-c-${idx}`,
            messageIndex,
            blockIndex: -2,
            textStart: idx,
            textEnd: idx + q.length,
          });
          idx += q.length;
        }
      }
    });
    
    setMatches(result);
    setActiveIndex(0);
  }, [query, messages]);
  
  // ... 其余不变
}
```

### Step 2:创建高亮工具函数

**File:** `components/agent-chat/utils/highlight.ts`

```tsx
import React from 'react';

/**
 * 将文本中所有 query 匹配替换为 <mark>,大小写不敏感
 * activeMatchIds: 要标记为"激活"的 match id 集合
 * baseId: 生成 match id 的前缀,必须和 useMessageSearch 中生成的规则一致
 */
export function highlightText(
  text: string,
  query: string,
  baseId: string,
  activeMatchId: string | null
): React.ReactNode {
  if (!query.trim() || !text) return text;
  const q = query.toLowerCase();
  const parts: React.ReactNode[] = [];
  let lastEnd = 0;
  const lower = text.toLowerCase();
  let idx = 0;
  let matchCounter = 0;
  while ((idx = lower.indexOf(q, idx)) !== -1) {
    if (idx > lastEnd) {
      parts.push(text.slice(lastEnd, idx));
    }
    const matchId = `${baseId}-${idx}`;
    const isActive = matchId === activeMatchId;
    parts.push(
      <mark
        key={`mark-${idx}-${matchCounter}`}
        data-match-id={matchId}
        className={
          isActive
            ? 'bg-transparent text-orange-600 font-medium'
            : 'bg-transparent text-orange-500'
        }
      >
        {text.slice(idx, idx + q.length)}
      </mark>
    );
    lastEnd = idx + q.length;
    idx += q.length;
    matchCounter++;
  }
  if (lastEnd < text.length) {
    parts.push(text.slice(lastEnd));
  }
  return parts;
}
```

### Step 3:MessageItem 传递 query 到用户消息文本

**改动:** `MessageItem.tsx` props 新增 `searchQuery?: string; activeMatchId?: string | null; messageIndex?: number;`。

在用户消息的文本渲染处,把纯文本用 `highlightText(parsed.userMessage, searchQuery, `${messageIndex}-u`, activeMatchId)` 替换。

**注意:** 原来直接用 `{parsed.userMessage}` 的地方,现在改为 `{searchQuery ? highlightText(...) : parsed.userMessage}`。

### Step 4:MarkdownRenderer 支持搜索高亮

**File:** `components/MarkdownRenderer.tsx`

先看看现状:
```
Read: components/MarkdownRenderer.tsx
```

然后在 props 加 `searchQuery`/`activeMatchId`/`matchIdPrefix`,在 `react-markdown` 的 `components` 中自定义 text 节点:

```tsx
// react-markdown 会把每段文本作为字符串 child 传给各个元素
// 最简单的办法:用 rehype-react 或 rehype 插件;但复杂
// 简化方案:递归遍历 children,遇到字符串就 highlightText 处理
```

**简化实现** — 使用 react-markdown 的 `components` 覆盖 `p`, `li`, `code` 等,在渲染 children 时调用 `highlightText`:

```tsx
function wrapChildren(children: React.ReactNode, query?: string, prefix?: string, activeId?: string | null): React.ReactNode {
  if (!query || !prefix) return children;
  return React.Children.map(children, (child) => {
    if (typeof child === 'string') {
      return highlightText(child, query, prefix, activeId);
    }
    return child;
  });
}

// 在 <ReactMarkdown components={{...}}> 中:
{
  p: ({ children }) => <p>{wrapChildren(children, searchQuery, matchIdPrefix, activeMatchId)}</p>,
  li: ({ children }) => <li>{wrapChildren(children, searchQuery, matchIdPrefix, activeMatchId)}</li>,
  // 不处理 code,按设计不搜代码块
}
```

**注意坑:** react-markdown 里同一段落可能有嵌套(加粗、链接等),高亮只命中顶层 string child。对于大多数自然语言场景这已经够用。如果发现漏命中严重,考虑用 rehype 插件深度处理 —— 但先做简化版。

### Step 5:贯穿 props 链路

- `AgentChat.tsx` 向 `MessageItem` 传 `searchQuery={search.query}`、`activeMatchId={search.activeMatch?.id ?? null}`、`messageIndex={index}`
- `MessageItem` 向 `ContentBlockItem` 传相同的 props(加 `messageIndex`)
- `ContentBlockItem` 对 `type=text` 和 `type=thinking` 的块,调用 MarkdownRenderer 时传 `searchQuery`、`activeMatchId`、`matchIdPrefix={`${messageIndex}-${blockIndex}`}`

### Step 6:手动验证

1. `bun run dev`
2. 打开一个有对话的会话
3. `Ctrl+F`,输入消息中存在的文本(比如 `"the"` 或 `"我"`)
4. 匹配的文字应变为**橙色**(不加底色)
5. 浮条显示正确的总数 `x/N`
6. 工具块、permission 卡片内的文本**不参与高亮**
7. 代码块内的文本**不高亮**(按设计)
8. 清空输入或关闭浮条,高亮消失

### Step 7:Commit

```bash
rtk git add components/agent-chat components/MarkdownRenderer.tsx
rtk git commit -m "feat(chat-ui): 搜索文本匹配与橙色高亮渲染"
```

---

## Task 9:① 搜索跳转与激活项滚动

**目标:** ↑↓ 按钮切换激活项,激活项滚动到视口中央。

**Files:**
- Modify: `components/agent-chat/hooks/useMessageSearch.ts` 或 AgentChat.tsx

### Step 1:activeIndex 变化时滚动到匹配元素

在 `AgentChat.tsx` 中:

```ts
useEffect(() => {
  if (!search.activeMatch) return;
  const el = document.querySelector(`[data-match-id="${search.activeMatch.id}"]`);
  if (el) {
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}, [search.activeMatch?.id]);
```

### Step 2:手动验证

1. `Ctrl+F` 输入搜索词
2. 按 ↓ 或 Enter 跳到下一个,页面滚动,该匹配项变为橙色加粗
3. 按 ↑ 或 Shift+Enter 跳上一个
4. 跳到最后一个再按 ↓ 循环回第一个
5. 关闭搜索后,高亮消失,页面位置不变

### Step 3:Commit

```bash
rtk git add components/agent-chat/AgentChat.tsx
rtk git commit -m "feat(chat-ui): 搜索激活项自动滚动到视口中央"
```

---

## Task 10:② Minimap 浮窗触发与块渲染

**目标:** 右上角触发器 + hover 浮窗,展示用户/AI 消息的色块列表,hover 块显示 tooltip,点击块跳转(不含视口指示器和闪烁)。

**Files:**
- Create: `components/agent-chat/MessageMinimap.tsx`
- Modify: `components/agent-chat/AgentChat.tsx`
- Modify: `components/agent-chat/MessageItem.tsx`(消息外层加 data-message-id)

### Step 1:给每条消息 DOM 加 data-message-id

**定位:** `MessageItem.tsx` 外层容器(`<div className="w-full py-4 group">` 第 53 行 和 isCompactSummary 的 div)。

**改动:** 加 `data-message-id={`msg-${messageIndex}`}`。props 新增 `messageIndex: number`。

### Step 2:创建 MessageMinimap 组件

**File:** `components/agent-chat/MessageMinimap.tsx`

```tsx
import { useState, useRef } from 'react';
import { Map, Pin } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { extractMessagePreview } from './utils/minimap';

interface MinimapProps {
  messages: any[];
}

export function MessageMinimap({ messages }: MinimapProps) {
  const [hovering, setHovering] = useState(false);
  const [pinned, setPinned] = useState(false);
  const hideTimerRef = useRef<number | null>(null);
  
  // 过滤 meta/compactBoundary 之前的
  const visibleMessages = messages.filter(m => !m.isMeta && !m.isCompactBoundary && !m.isCompactSummary);
  
  // 会话太短不显示
  if (visibleMessages.length < 5) return null;
  
  const shouldShow = hovering || pinned;
  
  const scheduleHide = () => {
    if (pinned) return;
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => setHovering(false), 500);
  };
  
  const cancelHide = () => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  };
  
  const jumpTo = (messageIdx: number) => {
    const el = document.querySelector(`[data-message-id="msg-${messageIdx}"]`);
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      (el as HTMLElement).classList.add('minimap-flash');
      setTimeout(() => (el as HTMLElement).classList.remove('minimap-flash'), 1200);
    }
  };
  
  return (
    <div
      className="absolute top-2 right-2 z-20"
      onMouseEnter={() => { cancelHide(); setHovering(true); }}
      onMouseLeave={scheduleHide}
    >
      {/* 触发器 */}
      <button
        className="p-1.5 rounded-md bg-background/90 border border-border hover:bg-muted transition-colors"
        title="消息地图"
      >
        <Map size={14} className="text-muted-foreground" />
      </button>
      
      {/* 浮窗 */}
      {shouldShow && (
        <div className="absolute top-8 right-0 w-[48px] max-h-[70vh] overflow-y-auto rounded-md border border-border bg-background/95 backdrop-blur-sm shadow-lg p-1">
          {/* 图钉 */}
          <button
            onClick={() => setPinned(p => !p)}
            className={cn(
              "w-full flex justify-center p-1 rounded hover:bg-muted mb-1",
              pinned && "bg-muted"
            )}
            title={pinned ? '取消固定' : '固定'}
          >
            <Pin size={12} className={cn('text-muted-foreground', pinned && 'text-foreground')} />
          </button>
          
          {/* 消息块列表 */}
          <TooltipProvider delayDuration={200}>
            <div className="flex flex-col gap-0.5">
              {messages.map((msg, idx) => {
                if (msg.isMeta || msg.isCompactBoundary || msg.isCompactSummary) return null;
                const isUser = msg.role === 'user';
                const preview = extractMessagePreview(msg);
                return (
                  <Tooltip key={idx}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => jumpTo(idx)}
                        className={cn(
                          'h-2 w-full rounded-sm hover:opacity-80 transition-opacity',
                          isUser ? 'bg-blue-500' : 'bg-muted-foreground/40'
                        )}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="left" className="max-w-[240px] text-xs">
                      {preview || '(空消息)'}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </TooltipProvider>
        </div>
      )}
    </div>
  );
}
```

### Step 3:创建 extractMessagePreview 工具

**File:** `components/agent-chat/utils/minimap.ts`

```ts
/**
 * 从 message 提取预览文本(去 markdown 和 XML 标签),截前 30 字
 */
export function extractMessagePreview(msg: any): string {
  let text = '';
  
  if (msg.role === 'user' && msg.content) {
    text = msg.content
      .replace(/<referenced_articles>[\s\S]*?<\/referenced_articles>/g, '')
      .replace(/<quoted_snippet[^>]*>[\s\S]*?<\/quoted_snippet>/g, '')
      .replace(/<command-[a-z]+>[\s\S]*?<\/command-[a-z]+>/g, '');
  } else if (msg.role === 'assistant') {
    if (msg.contentBlocks) {
      const textBlock = msg.contentBlocks.find((b: any) => b.type === 'text');
      text = textBlock?.content || textBlock?.text || '';
    } else {
      text = msg.content || '';
    }
  }
  
  // 去 markdown 符号
  text = text
    .replace(/[#*_`~\[\]\(\)]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  return text.length > 30 ? text.substring(0, 30) + '...' : text;
}
```

### Step 4:挂载 Minimap 到 AgentChat

**定位:** 与 SearchBar 同级(第 237 行 `<div className="relative flex-1 overflow-hidden">` 内部)。

```tsx
<div className="relative flex-1 overflow-hidden">
  <SearchBar ... />
  <MessageMinimap messages={messages} />
  <ScrollArea ...>
```

**位置冲突:** SearchBar 也在 `top-2 right-2`,两者会挤。让 Minimap 稍错开,例如 `top-2 right-20`(搜索浮条在更右侧) 或让它们**互斥显示**(搜索打开时 Minimap 隐藏)。

**推荐:** 互斥。MinimapProps 加 `hidden?: boolean`:

```tsx
<MessageMinimap messages={messages} hidden={search.isOpen} />
```

Minimap 组件开头:`if (hidden) return null;`。

搜索关闭后 Minimap 恢复显示。

### Step 5:添加闪烁 CSS

**File:** `src/globals.css`(Tailwind 全局文件)

追加:

```css
@keyframes minimap-flash {
  0%, 100% { background-color: transparent; }
  50% { background-color: rgba(234, 179, 8, 0.2); }
}

.minimap-flash {
  animation: minimap-flash 1s ease-in-out;
}
```

### Step 6:手动验证

1. `bun run dev`,打开一个有 10+ 条消息的会话
2. 右上角出现 Map 图标
3. Hover → 浮窗展开,显示蓝色/灰色色块垂直排列
4. Hover 某个块 → Tooltip 显示该消息前 30 字
5. 点击某块 → 页面滚到对应消息,该消息短暂**淡黄色闪烁**一下
6. 点击图钉 → 固定浮窗,鼠标移开不收起
7. 再点图钉 → 取消固定,移开 0.5s 后收起
8. 会话消息 < 5 条时 **Map 图标不显示**
9. 打开搜索 Ctrl+F → Minimap 图标和浮窗**隐藏**;关闭搜索后恢复

### Step 7:Commit

```bash
rtk git add components/agent-chat components/agent-chat/utils/minimap.ts src/globals.css
rtk git commit -m "feat(chat-ui): 会话 minimap 浮窗,hover 展开与固定支持"
```

---

## Task 11:② Minimap 视口指示器

**目标:** Minimap 浮窗内显示一个半透明矩形,指示当前滚动视口对应的消息范围。

**Files:**
- Modify: `components/agent-chat/MessageMinimap.tsx`

### Step 1:接收滚动容器引用

**改动:**
- MinimapProps 新增 `scrollContainer: HTMLElement | null`
- AgentChat 传入 `scrollContainer={getViewportEl()}`

但 `getViewportEl()` 返回实时计算的元素,需要 ref 传递。方案:AgentChat 把 `scrollAreaRef` 传给 Minimap,Minimap 内部用 `scrollAreaRef.current?.querySelector(...)` 获取 viewport。

### Step 2:监听滚动并计算指示器位置

```tsx
// MessageMinimap.tsx 内:
const [indicator, setIndicator] = useState<{ top: number; height: number } | null>(null);
const minimapContainerRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  const viewport = scrollContainer;
  if (!viewport) return;
  
  const update = () => {
    const { scrollTop, clientHeight, scrollHeight } = viewport;
    if (scrollHeight === 0) return;
    const minimapHeight = minimapContainerRef.current?.clientHeight ?? 0;
    if (minimapHeight === 0) return;
    const topRatio = scrollTop / scrollHeight;
    const heightRatio = clientHeight / scrollHeight;
    setIndicator({
      top: topRatio * minimapHeight,
      height: Math.max(8, heightRatio * minimapHeight),
    });
  };
  
  update();
  viewport.addEventListener('scroll', update);
  const resizeObs = new ResizeObserver(update);
  resizeObs.observe(viewport);
  return () => {
    viewport.removeEventListener('scroll', update);
    resizeObs.disconnect();
  };
}, [scrollContainer, shouldShow]);
```

在浮窗里添加指示器元素:

```tsx
<div ref={minimapContainerRef} className="relative flex flex-col gap-0.5">
  {/* 消息块 */}
  {...}
  
  {/* 视口指示器 */}
  {indicator && (
    <div
      className="absolute left-0 right-0 bg-foreground/10 border border-foreground/20 rounded-sm pointer-events-none"
      style={{ top: indicator.top, height: indicator.height }}
    />
  )}
</div>
```

### Step 3:手动验证

1. `bun run dev`,hover 触发器展开 Minimap
2. 滚动会话 → 指示器随视口位置实时移动
3. 会话短时指示器较大(占整个 minimap),会话长时指示器较小
4. 点击某块跳转 → 指示器跟着移动
5. 调整窗口大小(resize)→ 指示器按比例更新

### Step 4:Commit

```bash
rtk git add components/agent-chat/MessageMinimap.tsx components/agent-chat/AgentChat.tsx
rtk git commit -m "feat(chat-ui): minimap 视口指示器"
```

---

## 最终验证与 PR

### 全量回归验证清单

在所有 Task 完成后,跑一遍端到端:

1. **基础会话交互**
   - 发送消息、流式输出、工具调用、thinking、权限确认、AskUser 卡片全部正常
   - 编辑重发、分叉、压缩历史、历史消息回放全部正常

2. **⑤ 模型 badge**
   - AI 消息顶部显示扁 badge,简称正确

3. **④-a 去头像 + 外框**
   - 用户消息外框,AI 消息无框,正文向左扩展
   - 微信 Bot 标记仍显示

4. **④-b sticky 悬浮**
   - 滚动时用户消息粘到顶部
   - 收起/展开切换,高度限制合理

5. **③ 消息显示模式**
   - 简化模式默认工具/思考折叠
   - 详细模式默认展开
   - 设置页切换生效

6. **① 搜索**
   - Ctrl+F 浮条、橙色高亮、↑↓跳转、Esc 关闭
   - 不搜工具块、permission、代码块

7. **② Minimap**
   - Hover 展开、点击固定、点击跳转+闪烁、视口指示器
   - 搜索打开时自动隐藏
   - 短会话不显示

### 运行 lint

```bash
rtk bun run lint
```

Expected: 无新增错误。

### 最终 Commit 链

确认:每个 Task 都有独立 commit,commit message 格式一致。

### 建议的 PR 描述

**标题:** feat(chat-ui): 会话界面精细化 — 搜索 / minimap / 去头像 / sticky / 模型 badge

**描述:**
- 设计文档:`docs/plans/2026-04/2026-04-21/chat-ui-refinement-design.md`
- 实施计划:`docs/plans/2026-04/2026-04-21/chat-ui-refinement-plan.md`
- 变更范围:纯前端,集中在 `components/agent-chat/` 和 `types/settings.ts`
- 无 breaking change:`messageDisplayMode` 向后兼容(未设置时默认 `'compact'`)
- 测试:手动验证(详见 plan 各 task 的验证步骤)

---

## 非目标 / YAGNI 提醒(执行时不做)

- 跨会话全局搜索
- 正则 / 大小写敏感 / 全字匹配 toggle
- 代码块内高亮
- Minimap 块显示轮次数字或角色图标
- 工具块展开态持久化
- 悬浮条"跳回原位置"按钮
- Badge 显示人设名、thinking 状态、token 用量
- 引入前端测试框架(无必要,用手动验证)
