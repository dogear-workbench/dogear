# 聊天 UI 工具/思考分组 + 双端折叠设计

**日期**: 2026-04-29
**范围**: `components/agent-chat/` + `components/ToolBlock.tsx` + `stores/tool-registry-store.ts`

## 背景

当前 compact 模式下：
- 工具胶囊用英文参数摘要（如 `Read · page.tsx`、`Grep · "pattern" in .`），用户不直观
- 思考块胶囊只能靠鼠标 hover tooltip 查看原文，不能点击展开
- 连续的工具调用各自占一行，聊天流杂乱

目标：
1. **连续工具/Agent 调用默认收起成一组**，点击展开后可查看内部每个工具/思考
2. **工具简写用中文大类**（来自设置中已有的 `SERVER_LABELS`），代替英文工具名
3. **思考块默认完全收起**，去掉 hover tooltip，改成点击展开/收起
4. **所有折叠卡片支持双端折叠**：顶部和底部都能点击收起（长内容展开后不用回到顶部）

## 核心决策（brainstorming 确认）

| 决策点 | 选择 |
|--------|------|
| 分组边界 | 相邻 tool_use，中间夹 thinking 不影响；遇 text/permission/askUser/subagent 等其他类型截断 |
| 分组最小数量 | ≥2 个 tool_use 才分组；单个工具/单个思考不分组 |
| 分组标题格式 | `中文大类[去重顿号连接] · N 个工具`（如"股票行情、文章解析 · 5 个工具"） |
| 单工具标题格式 | `中文大类 · 摘要`（如"股票行情 · 000001"） |
| 大类映射来源 | `server` / `SERVER_LABELS`（复用 `client.getRegisteredTools()` IPC） |
| 同大类多工具区分 | 不区分，摘要（来自参数）已够用户判断 |
| compact 模式样式 | 单工具/单思考走 CollapsibleBlock，`previewLines=0`，默认收起 |
| detailed 模式 | 不变（`previewLines=2~3`，默认收起，有预览行） |
| 思考交互 | 点击胶囊/标题切换展开/收起，展开后在下方显示完整内容 |
| 分组展开后内部样式 | 每个工具/思考仍是独立可折叠卡片，默认收起（两层折叠） |
| Task/Agent 子代理 | 不纳入分组，保持 SubAgentBlock 独立渲染（且作为分组截断边界） |
| 双端折叠 | 展开时底部追加"收起 ↑"按钮条，只要展开就显示 |

## 变更文件清单

| # | 文件 | 动作 |
|---|------|------|
| 1 | `stores/tool-registry-store.ts` | 新增 |
| 2 | `components/agent-chat/ToolGroupBlock.tsx` | 新增 |
| 3 | `components/agent-chat/types.ts` | 修改（加 `tool_group` type + `children` 字段） |
| 4 | `components/agent-chat/MessageItem.tsx` | 修改（分组预处理） |
| 5 | `components/agent-chat/ContentBlockItem.tsx` | 修改（新增 `case 'tool_group'`） |
| 6 | `components/ToolBlock.tsx` | 修改（compact 走 CollapsibleBlock + 中文大类标题） |
| 7 | `components/agent-chat/ThinkingBlock.tsx` | 修改（compact 走 CollapsibleBlock + 去 tooltip） |
| 8 | `components/agent-chat/CollapsibleBlock.tsx` | 修改（底部加"收起"按钮条） |

## 详细设计

### 1. 工具分类 store（新增）

**文件**：`stores/tool-registry-store.ts`

职责：
- 首次需要时调用 `client.getRegisteredTools()` 拉取工具分组
- 缓存 `toolNameToServer: Map<string, string>` 和 `serverLabels: Record<string, string>`
- 暴露 `getCategoryLabel(toolName): string`，找不到返回 "其他工具"
- 暴露 `ensureLoaded()` 供 AgentChat mount 时预加载

工具名匹配规则：
- SDK 内置工具：`"Read"` → server `"sdk"` → label `"SDK 内置工具"`
- 自定义 MCP 工具：`"mcp__dogear-stock__GetStockQuote"` → 解析出 server `"dogear-stock"` → label `"股票行情"`
- 若 IPC 返回的 `toolNameToServer` 中没有精确匹配，按前缀 `mcp__{server}__` 解析 server 名再查 `serverLabels`

### 2. ToolGroupBlock 组件（新增）

**文件**：`components/agent-chat/ToolGroupBlock.tsx`

Props：
```ts
interface ToolGroupBlockProps {
  children: ContentBlock[];  // 组内原始 blocks（tool_use + thinking 混合）
}
```

实现：
- 计算标题：
  - 从 children 中过滤 `tool_use`，每个过 `getCategoryLabel()` 拿大类，用 `Set` 去重
  - 按 `SERVER_LABELS` 顺序排序（和设置页保持一致）
  - 用顿号（`、`）连接，后接 ` · N 个工具`（N 为 tool_use 数量，thinking 不计）
- 计算状态：
  - 任一 running → `running`（sky loader）
  - 任一 error → `error`（红 X）
  - 全部 success → `success`（淡色 check）
- 用 `<CollapsibleBlock icon={<Boxes size={14}/>} title={title} previewLines={0} defaultOpen={false} statusIcon={...}>` 包裹
- 展开内容：`children.map(block => <ContentBlockItem block={block} ... />)`
  - tool_use → `<ToolBlock>`（compact 模式下也是默认收起的 CollapsibleBlock）
  - thinking → `<ThinkingBlock>`（compact 模式下也是默认收起的 CollapsibleBlock）

### 3. types.ts 修改

给 `ContentBlock` 加：
```ts
type: ... | 'tool_group';
children?: ContentBlock[];  // 仅 tool_group 用
```

> 注：这是**虚拟 block 类型**，不经过网络传输、不持久化，只在 MessageItem 渲染前的预处理阶段生成。

### 4. MessageItem 分组预处理

在现有 `blocks.map(...)` 之前插入 `groupBlocks(blocks)` 函数：

```ts
function groupBlocks(blocks: ContentBlock[]): ContentBlock[] {
  const result: ContentBlock[] = [];
  let buffer: ContentBlock[] = [];
  let toolCount = 0;

  const flush = () => {
    if (buffer.length === 0) return;
    if (toolCount >= 2) {
      // ≥2 个工具 → 生成 tool_group 虚拟 block
      result.push({ type: 'tool_group', children: buffer });
    } else {
      // 单个工具或单个 thinking → 原样推入
      result.push(...buffer);
    }
    buffer = [];
    toolCount = 0;
  };

  for (const block of blocks) {
    const isSubAgent = block.type === 'tool_use'
      && (block.isSubAgent || block.toolName === 'Agent' || block.toolName === 'Task');

    if (block.type === 'tool_use' && !isSubAgent) {
      buffer.push(block);
      toolCount++;
    } else if (block.type === 'thinking' && buffer.length > 0) {
      // 夹在工具之间的 thinking 计入分组
      buffer.push(block);
    } else {
      flush();
      result.push(block);
    }
  }
  flush();
  return result;
}
```

只在 compact 模式下调用 `groupBlocks`，detailed 模式直接用原 blocks。
（读 `useSettingsStore(s => s.settings?.ui?.messageDisplayMode)` 判断）

### 5. ContentBlockItem 新增 case

```ts
case 'tool_group':
  return <ToolGroupBlock blocks={block.children || []} />;
```

### 6. ToolBlock.tsx 改造

- **去掉现有的 compact 胶囊实现**（L221-L245）
- compact 与 detailed 统一走 `<CollapsibleBlock>`，只在 `previewLines` 上区别：
  - detailed: `previewLines={2}`（现状）
  - compact: `previewLines={0}`
- 标题改造：
  - 原：`${formatToolName(toolName)} ${summary}`（英文工具名）
  - 新：`${getCategoryLabel(toolName)}${summary ? ' · ' + summary : ''}`（中文大类）
- 图标保留（现有 TOOL_ICONS）

### 7. ThinkingBlock.tsx 改造

- **去掉现有的 compact 胶囊实现**（L16-L30）
- compact 与 detailed 统一走 `<CollapsibleBlock>`：
  - detailed: `previewLines={3}`（现状）
  - compact: `previewLines={0}`
- 标题：`思考` 或 `思考 · ${charCount}字`
- 去掉 `title` 属性的 hover tooltip

### 8. CollapsibleBlock 双端折叠

在现有展开分支的 `max-h-[500px] overflow-y-auto` 后追加：

```tsx
{isOpen && (
  <button
    onClick={() => setIsOpen(false)}
    className="flex items-center justify-center gap-1 w-full py-1 mt-0.5 text-xs text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/30 rounded transition-colors"
  >
    <ChevronUp className="w-3 h-3" />
    <span>收起</span>
  </button>
)}
```

引入 `ChevronUp` from `lucide-react`。

## 初始化时机

在 `AgentChat.tsx` mount 时调用：
```ts
useEffect(() => {
  useToolRegistryStore.getState().ensureLoaded();
}, []);
```

保证在渲染第一条消息前，分类数据已就绪。未加载完时 `getCategoryLabel()` 兜底返回英文工具名或 "工具"。

## 不动的部分

- SubAgentBlock（Task/Agent 子代理）保持独立渲染，不纳入分组
- detailed 模式完全不变
- ToolBlock 的 `getToolSummary`（参数摘要提取逻辑）不动
- `renderer-handlers.ts` / SDK 消息格式 / 类型定义（除了前端内部的 `tool_group`）不动
- 不影响持久化、不影响 IPC 协议

## 验收标准

1. compact 模式下：
   - 单个工具调用显示为一行 CollapsibleBlock 标题，默认收起，标题格式 `中文大类 · 摘要`
   - 单个思考显示为一行 CollapsibleBlock 标题，默认收起，标题格式 `思考 · N字`
   - 连续 ≥2 个工具 (+ 中间可夹 thinking) 合并成 ToolGroupBlock，默认收起
   - ToolGroupBlock 展开后，内部每个工具/思考仍是独立收起卡片，需各自点击展开
2. detailed 模式完全保持现状
3. 任何 CollapsibleBlock 展开后，底部都有"收起 ↑"按钮条，点击可收起
4. Task/Agent 子代理不受影响，也会截断分组
