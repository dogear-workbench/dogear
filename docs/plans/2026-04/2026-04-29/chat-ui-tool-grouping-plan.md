# 聊天 UI 工具/思考分组 + 双端折叠 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在 compact 模式下把连续工具调用分组收起、工具名替换为中文大类、思考块改为可点击展开；并为所有折叠卡片加上底部"收起"按钮。

**Architecture:** 前端纯 UI 层改造，不触达 IPC / SDK / 持久化。新建 `tool-registry-store` 缓存工具分类，新增 `ToolGroupBlock` 虚拟分组组件，改造 `ToolBlock`/`ThinkingBlock` compact 模式统一走 `CollapsibleBlock`，并在 `CollapsibleBlock` 底部追加"收起"按钮。

**Tech Stack:** React 19 + Zustand 5 + Tailwind CSS 4 + shadcn/ui + lucide-react + TypeScript。

**验证方式：** 用户手动测试；Claude 负责保证 `bun run build:electron` 编译通过、前端 TS 无红线、代码风格和现有模块一致。不写单测、不跑脚本。

**设计文档：** [chat-ui-tool-grouping-design.md](./chat-ui-tool-grouping-design.md)

---

## Task 执行总览

```
Task 1 (store) ──┐
Task 2 (types) ──┤
                 ├─▶ Task 3 (MessageItem 预处理) ─┬─▶ Task 6 (ToolBlock 改造)
Task 4 (ToolGroupBlock) ─────────────────────────┤     Task 7 (ThinkingBlock 改造)
                                                 │     Task 5 (ContentBlockItem 路由)
                                                 └─▶ Task 8 (CollapsibleBlock 双端折叠)
                                                     Task 9 (AgentChat 初始化)
                                                     Task 10 (编译验证 + 最终提交)
```

Task 1、2 可独立先做；Task 3–9 都依赖前两个。Task 10 在所有功能点都改完后做。

---

## Task 1: 新增 `stores/tool-registry-store.ts`

**Files:**
- Create: `stores/tool-registry-store.ts`

**Step 1: 编写 store 代码**

完整内容如下（直接创建此文件）：

```ts
// stores/tool-registry-store.ts
import { create } from 'zustand';
import { client } from '@/lib/client';

interface ToolGroup {
  server: string;
  label: string;
  tools: Array<{ name: string; description: string; server: string; category: string }>;
}

interface ToolRegistryState {
  /** 工具名 → server 名 */
  toolNameToServer: Map<string, string>;
  /** server 名 → 中文标签 */
  serverLabels: Record<string, string>;
  /** 是否已加载过 */
  loaded: boolean;
  /** 正在加载中的 promise（防止并发请求） */
  loadingPromise: Promise<void> | null;

  ensureLoaded: () => Promise<void>;
  /**
   * 根据工具名返回中文大类
   * - 精确匹配优先（toolNameToServer）
   * - 失败时尝试解析 mcp__{server}__xxx 前缀
   * - 全部失败返回 "其他工具"
   */
  getCategoryLabel: (toolName: string) => string;
}

export const useToolRegistryStore = create<ToolRegistryState>((set, get) => ({
  toolNameToServer: new Map(),
  serverLabels: {},
  loaded: false,
  loadingPromise: null,

  ensureLoaded: async () => {
    const state = get();
    if (state.loaded) return;
    if (state.loadingPromise) return state.loadingPromise;

    const promise = (async () => {
      try {
        const result = await client.getRegisteredTools();
        const groups: ToolGroup[] = Array.isArray(result) ? result : [];
        const nameToServer = new Map<string, string>();
        const labels: Record<string, string> = {};
        for (const g of groups) {
          labels[g.server] = g.label;
          for (const t of g.tools || []) {
            nameToServer.set(t.name, g.server);
          }
        }
        set({ toolNameToServer: nameToServer, serverLabels: labels, loaded: true });
      } catch (err) {
        console.warn('[tool-registry-store] failed to load tools:', err);
        // 失败不阻塞 UI，仅 loaded=false，下次触发时重试
      } finally {
        set({ loadingPromise: null });
      }
    })();
    set({ loadingPromise: promise });
    return promise;
  },

  getCategoryLabel: (toolName: string): string => {
    const { toolNameToServer, serverLabels } = get();
    // 1. 精确匹配
    const direct = toolNameToServer.get(toolName);
    if (direct) return serverLabels[direct] || direct;
    // 2. mcp__{server}__xxx 前缀解析
    if (toolName.startsWith('mcp__')) {
      const parts = toolName.split('__');
      if (parts.length >= 3) {
        const server = parts[1];
        return serverLabels[server] || server;
      }
    }
    // 3. 兜底
    return '其他工具';
  },
}));
```

**Step 2: 检查类型与样式一致**

- 阅读现有 store（如 `stores/settings-store.ts`）确认 zustand `create` 的导入风格与用法一致
- `client` 来自 `@/lib/client`（与 AgentsTab.tsx 一致）
- 不引入新依赖

**Step 3: 编译验证**

Run: `bun run build:electron`
Expected: 通过（此 store 不在 electron/ 目录下，但确认整体无 TS 报错；前端 store 实际由 Vite 编译）

对前端 TS 的验证：打开 IDE 检查 `stores/tool-registry-store.ts`，无红线。

**Step 4: 提交**

```bash
rtk git add stores/tool-registry-store.ts
rtk git commit -m "feat(agent-chat): 新增 tool-registry-store 缓存工具中文大类映射"
```

---

## Task 2: 扩展 `ContentBlock` 类型加入 `tool_group`

**Files:**
- Modify: `components/agent-chat/types.ts:38-45`

**Step 1: 修改 type 联合 + 加 children 字段**

把第 39 行的 `type:` 联合末尾加入 `'tool_group'`，并在 `ContentBlock` 接口底部加一个 `children` 字段：

```ts
export interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'status' | 'error' | 'result' | 'user' | 'permission_request'
    | 'session_start' | 'session_end' | 'stop' | 'tool_failure' | 'notification' | 'task_notification'
    | 'ask_user_question'
    | 'compact_boundary' | 'compacting' | 'local_command_output'
    | 'tool_group';  // 【新增】虚拟分组类型，仅在前端渲染前预处理时生成
  // ...（现有字段不动）
  /** 【新增】tool_group 内部的子 block 列表 */
  children?: ContentBlock[];
}
```

**Step 2: 类型检查**

- IDE 检查 `components/agent-chat/types.ts` 无红线
- 不会影响其他模块——`tool_group` 是扩展，`children` 是可选字段

**Step 3: 提交**

```bash
rtk git add components/agent-chat/types.ts
rtk git commit -m "feat(agent-chat): ContentBlock 增加 tool_group 虚拟分组类型"
```

---

## Task 3: 在 `MessageItem.tsx` 加分组预处理函数

**Files:**
- Modify: `components/agent-chat/MessageItem.tsx`

**Step 1: 在文件顶部工具函数区（import 之后、组件定义之前）加入 `groupBlocks` 函数**

```ts
import type { ContentBlock } from './types';
// ...（原有 import）

/**
 * 将连续的 tool_use（中间可夹 thinking）合并为 tool_group 虚拟 block。
 * - ≥2 个工具才分组；单个工具 / 单个 thinking / Task/Agent 子代理 不分组
 * - 遇到 text / permission_request / ask_user_question / subagent tool_use 等其他类型 → 结束当前分组
 */
function groupBlocks(blocks: ContentBlock[]): ContentBlock[] {
  const result: ContentBlock[] = [];
  let buffer: ContentBlock[] = [];
  let toolCount = 0;

  const flush = () => {
    if (buffer.length === 0) return;
    if (toolCount >= 2) {
      result.push({
        type: 'tool_group',
        children: buffer,
        timestamp: buffer[0].timestamp,
      });
    } else {
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

**Step 2: 在组件中根据 displayMode 决定是否分组**

找到现有的 `message.contentBlocks.map(...)` 位置（约 L189）。改动前需要先在组件顶部读取 displayMode：

```ts
import { useSettingsStore } from '@/stores/settings-store';
// ...

export function MessageItem({ ... }) {
  // 【新增】读取显示模式
  const displayMode = useSettingsStore(s => s.settings?.ui?.messageDisplayMode ?? 'compact');
  // ...现有逻辑...

  // 【改动】渲染前计算 blocksToRender
  const blocksToRender = (message.contentBlocks && displayMode === 'compact')
    ? groupBlocks(message.contentBlocks)
    : (message.contentBlocks || []);
```

然后把 `message.contentBlocks.map((block, idx) => ...)` 改成 `blocksToRender.map((block, idx) => ...)`。

**Step 3: 类型检查**

- 确认 `useSettingsStore` 已在文件中可用（如已 import 则复用，否则加 import）
- `groupBlocks` 的返回类型是 `ContentBlock[]`，和原本的 `message.contentBlocks` 类型匹配

**Step 4: 提交**

```bash
rtk git add components/agent-chat/MessageItem.tsx
rtk git commit -m "feat(agent-chat): MessageItem compact 模式下合并连续工具为 tool_group"
```

---

## Task 4: 新建 `ToolGroupBlock.tsx` 组件

**Files:**
- Create: `components/agent-chat/ToolGroupBlock.tsx`

**Step 1: 编写组件**

完整内容：

```tsx
// components/agent-chat/ToolGroupBlock.tsx
import { Boxes, Check, X, Loader2 } from 'lucide-react';
import { CollapsibleBlock } from './CollapsibleBlock';
import { ContentBlockItem } from './ContentBlockItem';
import { useToolRegistryStore } from '@/stores/tool-registry-store';
import type { ContentBlock } from './types';
import { cn } from '@/lib/utils';

interface ToolGroupBlockProps {
  blocks: ContentBlock[];
  sessionId?: string | null;
  onPermissionResolved?: (requestId: string, behavior: 'allow' | 'deny' | 'always_allow', denyMessage?: string) => void;
  onAskUserResolved?: (requestId: string, answers: Record<string, string>) => void;
  searchQuery?: string;
  activeMatchId?: string | null;
  messageIndex?: number;
  blockIndex?: number;
}

/**
 * 连续工具调用分组容器
 * - 标题：中文大类去重 · N 个工具
 * - 默认完全收起（previewLines=0）
 * - 展开后内部每个工具/思考仍是独立收起的卡片
 */
export function ToolGroupBlock({
  blocks,
  sessionId,
  onPermissionResolved,
  onAskUserResolved,
  searchQuery,
  activeMatchId,
  messageIndex,
  blockIndex,
}: ToolGroupBlockProps) {
  const getCategoryLabel = useToolRegistryStore(s => s.getCategoryLabel);

  // 仅统计 tool_use
  const toolBlocks = blocks.filter(b => b.type === 'tool_use');
  const toolCount = toolBlocks.length;

  // 去重的大类列表（保留首次出现顺序）
  const categorySet = new Set<string>();
  const categories: string[] = [];
  for (const b of toolBlocks) {
    const label = getCategoryLabel(b.toolName || '');
    if (!categorySet.has(label)) {
      categorySet.add(label);
      categories.push(label);
    }
  }
  const title = `${categories.join('、')} · ${toolCount} 个工具`;

  // 组内聚合状态
  const hasRunning = toolBlocks.some(b => b.toolOutput === undefined);
  const hasError = toolBlocks.some(b => b.isError);
  const status: 'running' | 'error' | 'success' =
    hasRunning ? 'running' : hasError ? 'error' : 'success';

  const statusIcon =
    status === 'running' ? <Loader2 className="w-4 h-4 text-sky-500 animate-spin" /> :
    status === 'error'   ? <X className="w-4 h-4 text-red-500" /> :
                           <Check className="w-4 h-4 text-muted-foreground" />;

  return (
    <CollapsibleBlock
      icon={<Boxes size={14} className="text-muted-foreground/70" />}
      title={title}
      titleClassName={cn(
        status === 'running' && 'text-sky-600',
        status === 'error' && 'text-red-600',
      )}
      statusIcon={statusIcon}
      previewLines={0}
      defaultOpen={false}
    >
      <div className="space-y-2">
        {blocks.map((child, idx) => (
          <ContentBlockItem
            key={idx}
            block={child}
            sessionId={sessionId}
            onPermissionResolved={onPermissionResolved}
            onAskUserResolved={onAskUserResolved}
            searchQuery={searchQuery}
            activeMatchId={activeMatchId}
            messageIndex={messageIndex}
            blockIndex={blockIndex !== undefined ? blockIndex * 100 + idx : undefined}
          />
        ))}
      </div>
    </CollapsibleBlock>
  );
}
```

**Step 2: 类型检查**

- `ContentBlockItem` 目前的 props 中 `blockIndex` 是 `number | undefined`，我们生成子 index 时用 `blockIndex * 100 + idx` 避免和顶层冲突（这是为了搜索高亮 matchIdPrefix 不冲突，而非业务必要；如 ContentBlockItem 的 `blockIndex` 可以省略，也可直接传 `idx`）
- 确认 lucide-react 已有 `Boxes` 导出（通常有；若无则改用 `LayoutGrid` 或 `Layers`）

**Step 3: 提交**

```bash
rtk git add components/agent-chat/ToolGroupBlock.tsx
rtk git commit -m "feat(agent-chat): 新增 ToolGroupBlock 连续工具分组组件"
```

---

## Task 5: `ContentBlockItem.tsx` 新增 `tool_group` 路由

**Files:**
- Modify: `components/agent-chat/ContentBlockItem.tsx:68`（在 `case 'tool_use':` 之前）

**Step 1: 引入组件**

在文件顶部 import 区追加：
```ts
import { ToolGroupBlock } from './ToolGroupBlock';
```

**Step 2: 在 switch 中加 case**

在 `case 'tool_use':` 之前插入：

```ts
case 'tool_group':
  return (
    <ToolGroupBlock
      blocks={block.children || []}
      sessionId={sessionId}
      onPermissionResolved={onPermissionResolved}
      onAskUserResolved={onAskUserResolved}
      searchQuery={searchQuery}
      activeMatchId={activeMatchId}
      messageIndex={messageIndex}
      blockIndex={blockIndex}
    />
  );
```

**Step 3: 类型检查**

- `block.children` 是 `ContentBlock[] | undefined`（Task 2 已加）
- 不破坏原有 case 顺序

**Step 4: 提交**

```bash
rtk git add components/agent-chat/ContentBlockItem.tsx
rtk git commit -m "feat(agent-chat): ContentBlockItem 支持 tool_group 渲染"
```

---

## Task 6: `ToolBlock.tsx` compact 改走 CollapsibleBlock + 中文大类标题

**Files:**
- Modify: `components/ToolBlock.tsx`

**Step 1: 引入 tool-registry-store**

在文件顶部追加：
```ts
import { useToolRegistryStore } from '@/stores/tool-registry-store';
```

**Step 2: 删除 compact 胶囊分支**

删除 L221–L245 的整段 `if (displayMode === 'compact') { return (...) }`。

**Step 3: 改造标题文案**

把现在的：
```ts
const titleText = summary
  ? `${formatToolName(toolName)} ${summary}`
  : formatToolName(toolName);
```

改成：
```ts
const getCategoryLabel = useToolRegistryStore(s => s.getCategoryLabel);
const categoryLabel = getCategoryLabel(toolName);
const titleText = summary
  ? `${categoryLabel} · ${summary}`
  : categoryLabel;
```

**Step 4: compact 模式下的 previewLines 区分**

在 `return <CollapsibleBlock ...>` 那里：

```tsx
<CollapsibleBlock
  icon={...}
  title={titleText}
  titleClassName={...}
  statusIcon={<StatusIcon status={actualStatus} />}
  previewLines={displayMode === 'compact' ? 0 : 2}
  defaultOpen={false}
  className={className}
>
```

**Step 5: 类型检查 + 清理**

- `formatToolName` 可保留（未使用不报错，但为整洁可删；删除时顺带删掉它的依赖 `TOOL_ICONS.default` 等不变）。**保险起见保留 formatToolName 不删**，避免漏改引用
- 检查 IDE 是否有红线

**Step 6: 提交**

```bash
rtk git add components/ToolBlock.tsx
rtk git commit -m "refactor(agent-chat): ToolBlock compact 改走 CollapsibleBlock + 标题用中文大类"
```

---

## Task 7: `ThinkingBlock.tsx` compact 改走 CollapsibleBlock

**Files:**
- Modify: `components/agent-chat/ThinkingBlock.tsx`

**Step 1: 删除 compact 胶囊分支**

删除 L16–L30 的整段 `if (displayMode === 'compact') { return (...) }`。

**Step 2: 将 detailed 分支改为统一分支，按 displayMode 区分 previewLines**

```tsx
export function ThinkingBlock({ block }: { block: ContentBlock }) {
  const hasContent = !!block.content;
  const displayMode = useSettingsStore(s => s.settings?.ui?.messageDisplayMode ?? 'compact');
  const charCount = block.content?.length ?? 0;

  return (
    <CollapsibleBlock
      icon={
        hasContent
          ? <Brain size={14} className="text-muted-foreground/60" />
          : <div className="w-2 h-2 bg-muted-foreground rounded-full animate-pulse" />
      }
      title={hasContent ? (displayMode === 'compact' ? `思考 · ${charCount}字` : '思考') : '思考中...'}
      previewLines={displayMode === 'compact' ? 0 : 3}
      defaultOpen={false}
    >
      {hasContent && (
        <div className="border-l-2 border-muted-foreground/20 pl-2.5 text-xs text-muted-foreground/80 whitespace-pre-wrap break-words leading-relaxed">
          {block.content}
        </div>
      )}
    </CollapsibleBlock>
  );
}
```

**Step 3: 类型检查**

- 保留原有 import
- 不再用 `title` HTML 属性（已随 compact 胶囊一起删掉）

**Step 4: 提交**

```bash
rtk git add components/agent-chat/ThinkingBlock.tsx
rtk git commit -m "refactor(agent-chat): ThinkingBlock compact 改走 CollapsibleBlock 去掉 hover tooltip"
```

---

## Task 8: `CollapsibleBlock.tsx` 展开底部加"收起"按钮

**Files:**
- Modify: `components/agent-chat/CollapsibleBlock.tsx`

**Step 1: 引入 ChevronUp**

```ts
import { ChevronRight, ChevronUp } from 'lucide-react';
```

**Step 2: 在展开分支追加底部收起按钮**

找到 `{isOpen ? (...完整内容...) : (...预览...)}` 中的展开分支：

```tsx
{isOpen ? (
  <>
    <div className="max-h-[500px] overflow-y-auto">
      {children}
    </div>
    <button
      onClick={() => setIsOpen(false)}
      className="flex items-center justify-center gap-1 w-full py-1 mt-0.5 text-xs text-muted-foreground/50 hover:text-muted-foreground hover:bg-muted/30 rounded transition-colors"
    >
      <ChevronUp className="w-3 h-3" />
      <span>收起</span>
    </button>
  </>
) : (
  /* 收起：预览 N 行 + 渐隐（保持原样） */
  ...
)}
```

注意：原来展开分支只返回一个 `<div>`，加了底部按钮就变成多个兄弟节点，**必须用 Fragment `<>...</>` 包裹**。

**Step 3: 类型检查**

- `ChevronUp` 来自 lucide-react（确认存在）
- `setIsOpen` 已在上方定义
- JSX 结构合法

**Step 4: 提交**

```bash
rtk git add components/agent-chat/CollapsibleBlock.tsx
rtk git commit -m "feat(agent-chat): CollapsibleBlock 展开时底部增加收起按钮"
```

---

## Task 9: `AgentChat.tsx` mount 时预加载工具分类

**Files:**
- Modify: `components/agent-chat/AgentChat.tsx`

**Step 1: 在组件顶层加 useEffect**

在 `AgentChat` 组件内的其他 useEffect 附近追加：

```ts
import { useToolRegistryStore } from '@/stores/tool-registry-store';
// ...

useEffect(() => {
  useToolRegistryStore.getState().ensureLoaded();
}, []);
```

**Step 2: 类型检查**

- 不会影响现有逻辑（`ensureLoaded` 内部自带防重入）

**Step 3: 提交**

```bash
rtk git add components/agent-chat/AgentChat.tsx
rtk git commit -m "feat(agent-chat): AgentChat mount 时预加载工具分类映射"
```

---

## Task 10: 全量编译验证 + 回归检查

**目标：** 确保所有改动联动编译通过、无 TS 红线、无视觉错乱

**Step 1: 编译主进程**

Run: `rtk bun run build:electron`
Expected: 无报错（本次改动主要在前端，但 electron 不应被影响）

**Step 2: TypeScript 前端类型检查**

Run: `rtk bun run tsc --noEmit` （若项目没有该脚本，则靠 IDE / Vite 编译报错为准）
Expected: 无新增 TS 错误

如果没有 tsc 脚本，观察以下关键文件在 IDE 中是否有红线：
- `stores/tool-registry-store.ts`
- `components/agent-chat/types.ts`
- `components/agent-chat/MessageItem.tsx`
- `components/agent-chat/ToolGroupBlock.tsx`
- `components/agent-chat/ContentBlockItem.tsx`
- `components/ToolBlock.tsx`
- `components/agent-chat/ThinkingBlock.tsx`
- `components/agent-chat/CollapsibleBlock.tsx`
- `components/agent-chat/AgentChat.tsx`

**Step 3: Lint**

Run: `rtk bun run lint`
Expected: 无新增 lint 错误

**Step 4: 交付给用户手动测试**

通知用户：所有变更已提交，可用 `bun run dev` 启动验证以下场景：
1. compact 模式下单个工具 → 默认收起的 CollapsibleBlock 卡片，标题用中文大类
2. compact 模式下单个思考 → 默认收起的 CollapsibleBlock 卡片，点击展开看全文
3. compact 模式下连续 ≥2 个工具（含中间夹 thinking）→ 合并成 ToolGroupBlock
4. ToolGroupBlock 展开后 → 内部每个子项仍独立收起，需各自点击
5. Task/Agent 子代理 → 仍用 SubAgentBlock 独立渲染，作为分组截断边界
6. 任何展开后的卡片 → 底部有"收起 ↑"按钮，点击可收起
7. detailed 模式 → 完全保持现状，不受影响

**Step 5: 无额外提交**

（前面的 Task 每个都已独立提交，这步只是验证）

---

## 回滚策略

每个 Task 都独立提交，若某一步在用户测试时发现问题，可用：
```bash
rtk git revert <commit-sha>
```
单独回滚对应提交，其他部分不受影响。

---

## 备注

- **不依赖工具分类加载完成就能显示 UI**：`getCategoryLabel` 在未加载时返回 "其他工具"，首次消息渲染时刚好 `ensureLoaded` 也在请求中，下一次重渲染会自动拿到正确标签
- **ToolGroupBlock 是前端纯虚拟 block**，不持久化、不经过 SDK，刷新后依然根据原 contentBlocks 重新分组
- **blockIndex 的 `idx + 100*parent` 计算**只用于搜索高亮 match id 前缀，不影响业务；如后续有更干净的方案可优化
