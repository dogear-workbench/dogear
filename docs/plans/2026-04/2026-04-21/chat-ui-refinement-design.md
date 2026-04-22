# 会话界面精细化 — 设计文档

> 日期:2026-04-21
> 目标:优化长会话场景下的阅读、导航和聚焦体验

## 背景与动机

当前 AgentChat 在会话变长后存在三类体验问题:

1. **导航定位难** — 找某段历史内容只能滚,没有搜索、没有鸟瞰视图
2. **视觉噪音大** — 工具调用和 thinking 块默认展开,挤占阅读视野;头像占左侧空间
3. **上下文易丢** — 滚到几轮之前看 AI 详细回答时,忘了原问题是什么

本设计对应 5 个改进点,按**实现依赖与风险**排序:

| 顺序 | 改进点 | 改动类型 | 风险 |
|------|--------|---------|------|
| 1 | ④ 去头像 + 用户消息 sticky 悬浮 | 渲染骨架重构 | 高 |
| 2 | ⑤ AI 回复上方模型名 badge | 渲染增量 | 低 |
| 3 | ③ 工具/thinking 块简化模式 | 设置字段 + 两个组件改造 | 中 |
| 4 | ① 会话内搜索 | 新组件 + rehype 文本包裹 | 中 |
| 5 | ② 会话 minimap 浮窗 | 新组件 + 滚动监听 | 中 |

排序原则:④ 是渲染层底层,先做;⑤ 紧随(同组件改造);③ 独立改动两个子组件;① 新增 UI 但要兼容 ④ 新结构;② 最独立,放最后,实现时要和 ① 协调 z-index。

---

## 1. 去头像 + 用户消息悬浮冻结(原需求 ④)

### 目标
消除头像占位,让正文向左扩展;长会话下滚看 AI 回答时,对应的用户问题始终粘在顶部。

### 设计

#### 1.1 去头像改外框

**渲染变更**(在 `components/agent-chat/MessageItem.tsx`):
- 移除用户消息和 AI 消息左侧的 avatar 区域
- **用户消息**:外层容器加淡色外框
  - 样式建议:`border border-muted rounded-lg px-4 py-3 bg-background`
  - 整条消息占满消息区宽度或留左右 padding,依现有布局定
- **AI 消息**:**无外框**,纯文本流式排版,和页面背景平齐
- 角色区分靠"用户 = 带框 / AI = 无框"的结构差异

#### 1.2 用户消息 sticky 悬浮

**核心**:CSS `position: sticky; top: 0`,纯 CSS 实现,零 JS 成本。

**行为**:
- 滚过某条用户消息看下方 AI 回答时,该消息自动粘到消息区顶部
- 继续滚到下一条用户消息,自动替换顶部粘住的消息
- 不粘住的状态下,消息位置不变

**悬浮态尺寸**:
- **收起态(默认)**:`line-clamp-2`,约 40-50px 高
- **展开态(点击悬浮条切换)**:去 `line-clamp`,加 `max-h-[40vh] overflow-y-auto`
- 展开态内部可滚动,超高不爆屏
- 再次点击收起

**渲染复用**:
- 悬浮条 = 原 `MessageItem` 用户消息的渲染结果(引用芯片、文本块、代码块等)
- **不为悬浮态写独立的折叠/徽章逻辑**
- 用户看到的悬浮条和滚回去看到的原消息视觉完全一致
- CSS 控制收起展开,通过 `data-sticky-collapsed` 属性切换样式

**视觉约束**:
- 悬浮条背景**不透明或高对比**,避免下面滚动文字透上来:`bg-background/95 backdrop-blur-sm`
- z-index 层级(从低到高):普通消息 < sticky 悬浮条 < minimap 浮窗 < 搜索浮条 < permission/askUser 卡片

**跳回原位置**:
- **不提供独立"跳回"按钮**,用 ② minimap 跳转代替

### 实现要点

**文件改动**:
- `components/agent-chat/MessageItem.tsx`:移除 avatar 渲染;用户消息外层改 sticky 容器 + 外框样式
- `components/agent-chat/types.ts`:若有 avatar 相关字段考虑清理
- `components/agent-chat/AgentChat.tsx`:确保消息区滚动容器是 sticky 的 containing block

**状态**:
- 悬浮展开态用 local state `expandedStickyId: string | null`(同一时刻最多一条展开)
- 新消息粘上来时自动重置为收起态

**兼容性**:
- 压缩边界(`compact_boundary`)之前的折叠消息内部的用户消息不参与 sticky(因为本身不在视口内渲染)
- `isMeta` 消息不渲染外框(保持原 meta 样式)

---

## 2. AI 回复上方模型名 badge(原需求 ⑤)

### 目标
去头像后需要一种方式标识"这条 AI 回复来自哪个模型",同时保持极简。

### 设计

**位置**:AI 消息顶部**左对齐**,贴着第一行文字上方,几像素间距(`mb-1`)。

**样式**:
- 扁(`h-5` ~ 20px 高)
- 圆角小(`rounded-sm` 或 `rounded-md`)
- 低饱和度底色(`bg-muted text-muted-foreground`)
- 小字号(`text-xs`)
- 复用 shadcn `Badge` 组件,variant="secondary" 或 "outline"
- 不加图标

**内容**:只显示模型简称。

**模型名转换规则**:
```
claude-opus-4-7          → Opus 4.7
claude-sonnet-4-6        → Sonnet 4.6
claude-haiku-4-5-20251001 → Haiku 4.5
claude-opus-4-6          → Opus 4.6
(未知模型)              → 原 ID(fallback)
```

转换函数放在 `components/agent-chat/utils.ts`,例如 `formatModelName(modelId: string): string`。

### 实现要点

**数据来源**:
- 流式消息每个 chunk 带 `model` 字段(SDK 返回)
- 在 `useSessionMessages` 聚合时,把第一个 chunk 的 `model` 记到 message 对象上
- `MessageItem` 渲染 AI 消息时读 `message.model` 并通过 badge 显示

**边界情况**:
- 流式过程中 `model` 未到时,badge 短暂不显示;到达后 fade in
- 历史消息(JSONL 回放)里的 AI 消息,从 SDK 历史文件中提取 `model` 字段
- 会话中途换模型(fork 或设置调整后)时,每条消息各自显示自己那条的模型,**不统一显示**

---

## 3. 工具/Thinking 块简化模式(原需求 ③)

### 目标
默认给出最干净的视图,把工具调用和思考过程折叠成小标题;高级用户可在设置里切回详细模式。

### 设计

#### 3.1 两种显示模式

**简化模式(默认)**:
- 工具块默认折叠,只显示小标题(格式见下)
- Thinking 块默认折叠,只显示小标题
- 点击标题可展开查看详情
- 关闭再打开后**不记住展开态**,回到折叠

**详细模式(现状)**:
- 工具块默认展开,显示完整输入/输出
- Thinking 块默认展开

#### 3.2 折叠态小标题格式

**工具块**:`🔧 ToolName(参数摘要)` (或用 lucide 图标替代 emoji,视项目风格)

参数摘要按工具类型提取:
- `Read` → 文件路径:`🔧 Read(src/App.tsx)`
- `Bash` → 命令:`🔧 Bash(bun run lint)`
- `Edit` → 文件名:`🔧 Edit(MessageItem.tsx)`
- `Write` → 文件名:`🔧 Write(new-component.tsx)`
- `Grep` → 模式:`🔧 Grep("useEffect")`
- `Glob` → 模式:`🔧 Glob("**/*.tsx")`
- `Agent` → 子代理描述:`🔧 Agent("Explore...")`
- 未知工具 → `🔧 ToolName(...)`

**Thinking 块**:`💭 Thinking(25 字)` — 显示字数,让用户判断思考量,决定是否展开。

#### 3.3 不受影响的块

这些块**始终保持原行为**:
- `permission` 卡片(交互必需)
- `askUser` 卡片(交互必需)
- `compact_boundary`(保持现有压缩折叠行为)
- `text`(文本回复,始终展开)

### 实现要点

**设置字段**:
- `types/settings.ts` 的 `AppSettings` 新增:`messageDisplayMode: 'compact' | 'detailed'`
- `DEFAULT_SETTINGS` 加默认值 `'compact'`
- `.dogear/settings.json` 下次读写时自动带上

**设置 UI**:
- 设置页「AI 行为」Tab 新增分组:**消息显示**
- 下拉选择:`简化(默认)` / `详细`
- 切换立即生效,不需重启会话(Zustand reactive)

**组件改造**:
- `ToolBlock.tsx`:从 `settings-store` 读 `messageDisplayMode`,初始 `expanded` state 为 `mode === 'detailed'`
- `ThinkingBlock.tsx`:同上
- 参数摘要提取函数放在 `ToolBlock.tsx` 内或 `utils.ts`:`summarizeToolInput(toolName: string, input: unknown): string`
- 用户手动点击展开/折叠仍生效(覆盖初始态)

**切换生效范围**:
- 仅影响**初始展开态**
- 不覆盖用户本次会话内的手动操作
- 关闭并重新进入会话后重置

---

## 4. 会话内搜索(原需求 ①)

### 目标
在当前会话消息流里快速查找文本,高亮匹配并跳转。不做跨会话搜索。

### 设计

#### 4.1 触发与 UI

**快捷键**:`Ctrl+F`(消息区聚焦时)唤起搜索浮条,`Esc` 或点 × 关闭。

**浮条位置**:消息区**顶部**绝对定位的浮条,覆盖在消息上方(不挤布局)。

**浮条结构**:
```
[输入框...........] [3/12] [↑] [↓] [×]
```
- 输入框:实时匹配
- `3/12`:当前第几个 / 总共几个
- `↑` / `↓`:上一个 / 下一个(或用 `Shift+Enter` / `Enter`)
- `×`:关闭(或 `Esc`)

#### 4.2 匹配策略

- **子串匹配**
- **大小写不敏感**
- **不支持**正则、全字匹配、大小写 toggle(YAGNI)

#### 4.3 高亮样式

**只改字体颜色,不加底色**:
- 所有匹配文字:`text-orange-500`,字重不变
- 当前激活的那个:`text-orange-600 font-medium`(比所有匹配加深一档 + 轻微加粗)
- 激活项 `scrollIntoView({ block: 'center' })` 滚到视口中央
- 关闭搜索时清除高亮

#### 4.4 搜索范围

**只搜纯文本**,覆盖:
- 用户消息的文本块
- AI 回复的文本块
- Thinking 块的文本

**排除**:
- 工具块的输入/输出(避免大段 JSON 制造噪音命中)
- Permission / AskUser 卡片
- 引用芯片的元数据
- Compact boundary 系统消息
- Meta 消息

### 实现要点

**文件**:
- 新建 `components/agent-chat/SearchBar.tsx`:浮条组件
- 新建 `components/agent-chat/hooks/useMessageSearch.ts`:搜索状态与匹配逻辑
- `AgentChat.tsx`:挂载浮条,监听 `Ctrl+F`
- `MessageItem.tsx` / `ContentBlockItem.tsx`:接收 `searchQuery` + `activeMatchId` props

**匹配算法**:
- `useMessageSearch(messages, query)` 返回:
  ```ts
  {
    matches: Array<{ messageId: string; blockIndex: number; textStart: number; textEnd: number; id: string }>
    activeIndex: number
    total: number
    next: () => void
    prev: () => void
    clear: () => void
  }
  ```
- 遍历 messages,对每个文本块用 `indexOf`(toLowerCase 对比)找所有出现位置
- 工具块/permission 卡片跳过

**高亮实现**:
- 渲染文本块时,如果有匹配,用自定义 rehype 插件或直接在 `react-markdown` 的 `components.text` 中替换:把匹配片段替换成 `<mark data-match-id="..." className="...">`
- 通过 `activeMatchId` 判断哪个 `<mark>` 是当前激活的,动态加 `text-orange-600 font-medium`
- 注意:代码块(rehype-highlight 渲染的)内部**不高亮**(已决策,范围外)

**滚动**:
- 激活项通过 `document.querySelector(`[data-match-id="${id}"]`)` 定位
- `scrollIntoView({ block: 'center', behavior: 'smooth' })`

**快捷键**:
- `AgentChat` 层 `useEffect` 监听 `keydown`
- `Ctrl+F`(Windows/Linux)或 `Cmd+F`(Mac)触发 `preventDefault` + 打开浮条
- `Esc` 关闭
- 只在会话区有焦点或浮条打开时生效,避免全局冲突

---

## 5. 会话 Minimap 浮窗(原需求 ②)

### 目标
提供鸟瞰视图,长会话中快速定位任意一轮,并感知当前所在位置。

### 设计

#### 5.1 触发与位置

- 会话区**右上角**一个小触发器图标(~24px,`Map` / `MapPin` lucide 图标)
- **Hover 触发器 → 浮窗展开**
- 浮窗内右上角有**图钉图标**,点击**固定**(`pinned = true`),再次点击取消固定
- 非固定态下,鼠标离开浮窗 + 触发器 500ms 后收起
- 固定态下始终显示

#### 5.2 浮窗形态

- 绝对定位,浮在消息区右上
- 宽 **~40px**,高覆盖消息区 ~70%
- 不挤布局,纯浮层
- 样式:`bg-background/95 backdrop-blur-sm`,边框 + 阴影

#### 5.3 块渲染

- 每条**用户消息** = 蓝色短块(如 `bg-blue-500`)
- 每条**AI 消息** = 灰色短块(`bg-muted-foreground`)
- **不**为 thinking / 工具块 / permission / askUser 单独成块(合并到所属 AI 消息里)
- 压缩边界之前的旧消息**不进 minimap**(因为在 UI 上也看不到,跳不过去)
- 会话消息数 **< 5 条时不显示触发器**(没必要)

#### 5.4 交互

- **Hover 某块** → Tooltip(Radix Tooltip)显示:该消息前 30 字(纯文本,去 markdown/引用标签)
- **Click 某块** → 对应消息 `scrollIntoView({ block: 'center' })`,并短暂闪烁(复用搜索跳转的闪烁样式)
- **滚动会话** → 视口指示器实时更新
- **视口指示器**:半透明矩形覆盖在当前视口对应的块上

### 实现要点

**文件**:
- 新建 `components/agent-chat/MessageMinimap.tsx`
- `AgentChat.tsx` 挂载

**数据**:
- 从 `useSessionMessages` 的 messages 数组派生
- 过滤掉 meta / compact 边界之前的消息

**视口指示器**:
- 监听 `AgentChat` 滚动容器的 `scrollTop` + `clientHeight`
- 映射到 minimap 坐标系:`indicatorTop = scrollTop / totalHeight * minimapHeight`
- `indicatorHeight = clientHeight / totalHeight * minimapHeight`
- 用 `position: absolute` 的半透明 div 覆盖

**跳转**:
- 每条消息 DOM 加 `data-message-id` 属性
- minimap 块点击:`document.querySelector(`[data-message-id="${id}"]`)?.scrollIntoView(...)`
- 闪烁:临时加 CSS class `animate-flash`(项目里可能已有或需新增 tailwind animation)

**Tooltip 内容**:
- 提取该消息第一个文本块,去 markdown 和 XML 引用标签,截前 30 字
- 函数:`extractMessagePreview(message: Message): string`,放 `utils.ts`

**固定态状态**:
- Local state `pinned: boolean`
- 非固定态下用 `onMouseLeave` + setTimeout 收起

---

## 设置项与数据结构变更汇总

### `types/settings.ts` - AppSettings 新增字段

```ts
interface AppSettings {
  // ... 现有字段
  messageDisplayMode: 'compact' | 'detailed'  // ③ 新增,默认 'compact'
}
```

### `DEFAULT_SETTINGS`
```ts
messageDisplayMode: 'compact'
```

### 无需变更的部分

- 不新增 JSON 存储文件
- 不改数据库/IPC 协议
- 所有变更局限在前端 + settings.json

---

## 文件改动清单(预估)

### 新建
- `components/agent-chat/SearchBar.tsx`
- `components/agent-chat/MessageMinimap.tsx`
- `components/agent-chat/hooks/useMessageSearch.ts`

### 修改
- `components/agent-chat/MessageItem.tsx` — 去头像 / 外框 / sticky / 搜索高亮 prop / 模型 badge
- `components/agent-chat/ContentBlockItem.tsx` — 传递 searchQuery 到文本块
- `components/agent-chat/ToolBlock.tsx` — 读 messageDisplayMode,折叠态标题格式
- `components/agent-chat/ThinkingBlock.tsx` — 同上
- `components/agent-chat/AgentChat.tsx` — 挂载 SearchBar + Minimap,监听 Ctrl+F
- `components/agent-chat/utils.ts` — `formatModelName` / `summarizeToolInput` / `extractMessagePreview`
- `components/agent-chat/types.ts` — 如有需要扩展 Message 类型带 model
- `types/settings.ts` — AppSettings 加 messageDisplayMode
- `app/settings/*Tab.tsx` — AI 行为 Tab 加显示模式下拉

### 不改
- 主进程 IPC
- 服务层(settings-service 除了字段定义)
- Store 层(除了 settings-store 自动跟随 settings.json)

---

## 实现顺序与阶段性验证

### 阶段 1:④ 去头像 + sticky(渲染重构)
- 验证:用户消息粘住顶部,AI 消息正文左对齐,无头像空白
- 风险缓解:先在 debug 页(`app/debug/page.tsx`)验证,再应用到主工作区和独立会话窗口

### 阶段 2:⑤ 模型 badge
- 验证:AI 消息上方显示 `Opus 4.7` 等简称
- 风险缓解:测试流式过程、历史回放、fork 会话三种场景

### 阶段 3:③ 工具简化模式
- 验证:默认折叠,设置页切换生效,手动展开仍可用
- 风险缓解:确保所有工具类型都有可读的参数摘要,未知工具 fallback

### 阶段 4:① 搜索
- 验证:Ctrl+F 浮条、文字高亮、↑↓ 跳转、Esc 关闭
- 风险缓解:测试 Markdown 渲染后的文本匹配,避免破坏代码块结构

### 阶段 5:② Minimap
- 验证:右上角触发、hover 展开、固定功能、视口指示器、跳转闪烁
- 风险缓解:长会话(100+ 消息)下的性能,需用 memo + 虚拟化(如性能差)

---

## 非目标 / YAGNI

以下明确**不做**,如未来有反馈再加:

- 跨会话全局搜索
- 搜索的正则 / 大小写敏感 / 全字匹配
- 代码块内搜索高亮
- Minimap 块显示轮次数字或角色图标
- 工具块展开态持久化
- 悬浮条"跳回原位置"按钮(用 minimap 代替)
- Badge 显示人设名 / thinking 状态 / token 用量
