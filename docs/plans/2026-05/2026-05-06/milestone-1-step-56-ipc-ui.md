# 里程碑 1 · IPC + UI 执行文档（Step 5-6）

> 创建日期：2026-05-06
> 状态：设计中（待评审 → 实施）
> 对应里程碑：`../2026-05-05/milestone-1-memory-foundation.md` 的 Step 5-6
> 前置条件：后端 Step 1-4 已完成（commit 5b4b962）
> 预估工作量：2-3 天

---

## 一、本文档覆盖范围

方案 A 第②份执行文档，在 Step 1-4 后端基础上补 IPC + UI：

| Step | 内容 | 验证方式 |
|------|------|---------|
| Step 5 | IPC 路由 `memory.ts`（7 个 RPC） | 设置页调用能增删改查 |
| Step 6 | 设置页 `MemoryTab.tsx`（核心档案 + 主题记忆） | 手动操作 UI 验证文件落盘 |

**不在本文档范围**：
- ❌ Step 1-4 后端（已完成）
- ❌ Step 7 端到端联调（→ 第③份，在这两步之上做串测）
- ❌ 做梦系统 / 自动提炼（里程碑 2）

**关键对齐**：
- Memory 数据**独立于 settings**，不进 `settings.json`，不共享全局"保存"按钮
- MemoryTab 采用**独立即时保存**模式（类似 `WorkspaceConfigTab` 的 `CLAUDE.md` 区域），每个操作走 IPC 落盘
- 所有 IPC 入参强制带 `workspacePath`，不从主进程全局读

---

## 二、Step 5：IPC 层

### 2.1 新增文件

`electron/main/tipc/memory.ts`

### 2.2 RPC 列表

| 方法 | 入参 | 出参 | 用途 |
|------|------|------|------|
| `getCoreProfile` | `{ workspacePath }` | `{ profile: CoreProfile \| null }` 或 `{ error }` | 加载核心档案 |
| `updateCoreProfile` | `{ workspacePath, content }` | `{ success: true }` 或 `{ error }` | 保存核心档案 |
| `listMemoryTopics` | `{ workspacePath }` | `{ topics: TopicIndexEntry[] }` 或 `{ error }` | 主题列表 |
| `getMemoryTopic` | `{ workspacePath, slug }` | `{ topic: Topic \| null }` 或 `{ error }` | 主题详情 |
| `upsertMemoryTopic` | `{ workspacePath, topic: TopicInput }` | `{ topic: Topic }` 或 `{ error }` | 创建/更新主题 |
| `deleteMemoryTopic` | `{ workspacePath, slug }` | `{ success: true }` 或 `{ error }` | 删除主题 |
| `rebuildMemoryIndex` | `{ workspacePath }` | `{ index: MemoryIndex, consistency }` 或 `{ error }` | 重建索引 |

**命名前缀 `memory*`**：全局 tipc router 是扁平 key，不能重名。`list` / `get` / `upsert` / `delete` 加 `MemoryTopic` 前缀避免和 persona/workspace/book 的同名方法冲突；`getCoreProfile` / `updateCoreProfile` 够特异，不加前缀。

### 2.3 入参输入类型

```typescript
// 复用 memory-types.ts 的 Topic / TopicIndexEntry / MemoryIndex / CoreProfile
import type { Topic, TopicIndexEntry, MemoryIndex, CoreProfile } from '../services/memory/memory-types.js';

// upsertMemoryTopic 的输入形状：slug/title/keywords/content 必填，时间戳可选（服务层会补）
interface TopicInput {
  slug: string;
  title: string;
  keywords: string[];
  content: string;
  created?: string;
  updated?: string;
  relatedTopics?: string[];
  sourceConversations?: string[];
}
```

### 2.4 骨架

```typescript
import { tipc } from '@egoist/tipc/main';
import {
  getCoreProfile,
  updateCoreProfile,
  listTopics,
  getTopic,
  upsertTopic,
  deleteTopic,
  rebuildIndex,
  checkConsistency,
} from '../services/memory/index.js';
import type { Topic } from '../services/memory/memory-types.js';

const t = tipc.create();

type TopicInput = Omit<Topic, 'created' | 'updated'> & { created?: string; updated?: string };

export const memoryRouter = {
  getCoreProfile: t.procedure
    .input<{ workspacePath: string }>()
    .action(async ({ input }) => {
      try {
        const profile = await getCoreProfile(input.workspacePath);
        return { profile };
      } catch (error) {
        console.error('[memory] getCoreProfile 失败:', error);
        return { error: String(error) };
      }
    }),

  updateCoreProfile: t.procedure
    .input<{ workspacePath: string; content: string }>()
    .action(async ({ input }) => {
      try {
        await updateCoreProfile(input.workspacePath, input.content);
        return { success: true };
      } catch (error) {
        console.error('[memory] updateCoreProfile 失败:', error);
        return { error: String(error) };
      }
    }),

  listMemoryTopics: t.procedure
    .input<{ workspacePath: string }>()
    .action(async ({ input }) => {
      try {
        const topics = await listTopics(input.workspacePath);
        return { topics };
      } catch (error) {
        console.error('[memory] listMemoryTopics 失败:', error);
        return { error: String(error) };
      }
    }),

  getMemoryTopic: t.procedure
    .input<{ workspacePath: string; slug: string }>()
    .action(async ({ input }) => {
      try {
        const topic = await getTopic(input.workspacePath, input.slug);
        return { topic };
      } catch (error) {
        console.error('[memory] getMemoryTopic 失败:', error);
        return { error: String(error) };
      }
    }),

  upsertMemoryTopic: t.procedure
    .input<{ workspacePath: string; topic: TopicInput }>()
    .action(async ({ input }) => {
      try {
        const topic = await upsertTopic(input.workspacePath, input.topic);
        return { topic };
      } catch (error) {
        console.error('[memory] upsertMemoryTopic 失败:', error);
        return { error: String(error) };
      }
    }),

  deleteMemoryTopic: t.procedure
    .input<{ workspacePath: string; slug: string }>()
    .action(async ({ input }) => {
      try {
        await deleteTopic(input.workspacePath, input.slug);
        return { success: true };
      } catch (error) {
        console.error('[memory] deleteMemoryTopic 失败:', error);
        return { error: String(error) };
      }
    }),

  rebuildMemoryIndex: t.procedure
    .input<{ workspacePath: string }>()
    .action(async ({ input }) => {
      try {
        const index = await rebuildIndex(input.workspacePath);
        const consistency = await checkConsistency(input.workspacePath);
        return { index, consistency };
      } catch (error) {
        console.error('[memory] rebuildMemoryIndex 失败:', error);
        return { error: String(error) };
      }
    }),
};
```

### 2.5 注册到 tipc 路由表

修改 `electron/main/tipc/index.ts`：

```typescript
import { memoryRouter } from './memory.js';

export const router = {
  ...dbRouter,
  // ... 现有
  ...memoryRouter,
};
```

**顺序建议**：插在 `settingsRouter` 之后、`claudeConfigRouter` 之前（语义相近：都是跨会话的"配置层"资源）。

### 2.6 类型自动推导

tipc 的前端 `client` 类型从 `Router` 推导（`lib/client.ts`），**无需手动维护 `types/electron-api.ts`**——只有渲染器自己定义的领域类型（`Workspace` / `Conversation` 等）才需要镜像到 `types/electron-api.ts`。

但本次 IPC 的**出参**里出现了 `Topic` / `CoreProfile` / `MemoryIndex`——这些是在 `electron/main/services/memory/memory-types.ts` 定义的，渲染器直接通过 tipc client 推导的类型中会使用这些类型。

**关键约束**：tipc.d.ts 的 `rootDir: ./electron` 限制，`electron/` 不能 import `types/`；反过来前端可以 import 从 electron 暴露给 tipc 的类型推导。

**本次不镜像**，因为 MemoryTab 只需要"读到 title/slug/keywords/content 字符串即可"，用匿名解构 + 局部 `interface` 即可，无需导入 `Topic`。**如果后续有其他渲染层文件需要 `Topic`，再在 `types/electron-api.ts` 镜像一份**。

### 2.7 Step 5 验证方式

1. `bun run build:electron` 编译通过
2. 写一个临时测试：在 DevTools 里执行
   ```js
   window.client.updateCoreProfile({ workspacePath: '<当前工作区>', content: '# 测试\n' }).then(console.log);
   window.client.getCoreProfile({ workspacePath: '<当前工作区>' }).then(console.log);
   window.client.upsertMemoryTopic({ workspacePath: '<当前工作区>', topic: { slug: 'test', title: '测试', keywords: ['k'], content: 'body' } }).then(console.log);
   window.client.listMemoryTopics({ workspacePath: '<当前工作区>' }).then(console.log);
   ```
3. 检查 `.dogear/memory/` 目录产出 `core-profile.md` / `topics/test.md` / `index.json`

---

## 三、Step 6：前端 MemoryTab

### 3.1 新增文件

`app/settings/MemoryTab.tsx`

### 3.2 数据模型（组件内本地类型）

```typescript
interface TopicIndexEntry {
  slug: string;
  title: string;
  keywords: string[];
  updated: string;
}

interface Topic {
  slug: string;
  title: string;
  keywords: string[];
  content: string;
  created: string;
  updated: string;
}

interface CoreProfile {
  content: string;
  updated: string;
}
```

**不从 `types/electron-api.ts` 导入**（Step 5 决定不镜像）——组件内声明轻量 interface 即可。

### 3.3 UI 总布局

```
┌────────────────────────────────────────────────────────────┐
│ 记忆管理            [ 重建索引 ]                            │
│ 为当前工作区维护核心档案和主题记忆。核心档案会自动注入系统提示词。│
│                                                            │
│  ┌[核心档案][主题记忆]───────────────────────────────────┐ │
│  │                                                      │ │
│  │  <当前子 Tab 内容>                                    │ │
│  │                                                      │ │
│  └────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
```

外层使用 shadcn `Tabs`（水平，复用 `components/ui/tabs.tsx`）。

### 3.4 子 Tab 1：核心档案

```
┌────────────────────────────────────────────────────────┐
│ 核心档案说明：每次会话启动时，这里的内容会作为系统提示      │
│ 词的一部分注入（建议 <2000 字符）                         │
│                                                        │
│ 更新时间：2026-05-06 12:34:56                          │
│                                                        │
│ ┌──────────────────────────────────────────────────┐  │
│ │ # 用户画像                                        │  │
│ │ ## 身份                                           │  │
│ │ ...                                               │  │
│ │ (Textarea，mono 字体，min-h 300px)                │  │
│ └──────────────────────────────────────────────────┘  │
│ 当前字符数：450 / 建议 ≤2000                          │
│                          [取消]          [保存]        │
└────────────────────────────────────────────────────────┘
```

**状态管理**：
- `content` / `savedContent` 双状态，`dirty = content !== savedContent`
- 加载时 `getCoreProfile(workspacePath)`，null → 初始化为空字符串
- 保存走 `updateCoreProfile(workspacePath, content)`，成功后 `setSavedContent(content)` 并重新 `getCoreProfile` 更新 `updated`
- 字符数显示：`content.length`，超过 2000 标红色但**不拦截**（Q2 决策：软限制）

### 3.5 子 Tab 2：主题记忆

**左右分栏**（复用 `PersonaTab.tsx` 的布局）：

```
┌────────────────────────┬───────────────────────────────┐
│ [+ 新建主题]            │ <详情区>                      │
│                        │                               │
│ Slug  Title (关键词…)  │   Slug: [stock-analysis]     │
│ ◉ stock-analysis        │   Title: [股票分析系统]       │
│   股票分析系统           │   关键词: [股票][stock][+]    │
│ ○ memory-design         │   正文:                       │
│   记忆大脑系统设计        │   ┌─────────────────────┐    │
│                        │   │ (Textarea, mono,    │    │
│ (ScrollArea, 400px)    │   │  min-h 300px)       │    │
│                        │   └─────────────────────┘    │
│                        │   更新时间：...               │
│                        │                               │
│                        │   [取消] [删除] [应用修改]      │
└────────────────────────┴───────────────────────────────┘
```

**操作语义**：

| 操作 | 触发 | 行为 |
|------|------|------|
| 新建主题 | 点击"+ 新建主题" | 生成临时 slug `new-topic-<timestamp>`、空 title/keywords/content，直接进入编辑态（未落盘，保存时调用 upsertMemoryTopic） |
| 选择主题 | 点击列表项 | `getMemoryTopic` 加载详情 → 填充编辑区 → 如当前编辑区 dirty，弹 ConfirmDialog（放弃 / 取消） |
| 修改 slug | 编辑 slug 输入框 | 保存时：若 slug 变了 → upsert 新 slug + delete 旧 slug（两步。slug 是文件名不能原地改） |
| 应用修改 | 点击按钮 | 校验 slug 合法（`/^[a-z0-9-]+$/`）→ 校验 title/keywords 非空 → upsertMemoryTopic → 刷新列表 |
| 删除 | 点击"删除" | confirm → deleteMemoryTopic → 列表刷新 + 清空编辑区 |

**关键词 chip UI**：
- 渲染为一排 pill（`bg-muted text-xs px-2 py-0.5 rounded-full`），每个带 `×` 删除
- 末尾一个 `+ 添加` 按钮 → 点击显示 text input → Enter 或失焦添加 → 重置 input
- 不允许重复关键词，添加时去重

**slug 自动生成（可选）**：
- 新建主题时若 slug 为空，根据 title 自动转 kebab-case（`toKebabCase(title)`）：小写 + 非字母数字转 `-` + 中文直译用 `topic-<timestamp>` 兜底（不调 translate）
- 用户手动改 slug 后关闭自动推导

### 3.6 重建索引按钮

位置：顶部右上角。
行为：
```typescript
const result = await client.rebuildMemoryIndex({ workspacePath });
// result.index.topics.length 个主题已纳入索引
// result.consistency.orphansOnDisk 个文件未在索引中
// result.consistency.orphansInIndex 个索引条目缺少文件
// 用 ConfirmDialog 展示摘要，要求用户知悉
```

不自动修复——用户按钮触发本身就是修复动作（rebuildIndex 会重写 index.json，把孤儿文件纳入）。剩余的 orphansInIndex 是文件丢失的情况，报告给用户让用户决定（通常是手动删了但没删索引）。

### 3.7 工作区缺失的兜底

参考 `WorkspaceConfigTab.tsx`：

```tsx
if (!workspacePath) {
  return (
    <div className="flex-1 flex items-center justify-center text-muted-foreground">
      <div className="text-center space-y-2">
        <FolderOpen className="w-10 h-10 mx-auto opacity-50" />
        <p className="text-sm">请先选择一个工作区</p>
      </div>
    </div>
  );
}
```

### 3.8 MemoryTab 骨架

```tsx
import { useState, useEffect, useCallback } from 'react';
import { FolderOpen, Plus, Trash2, Pencil, Check, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useConfirmStore } from '@/stores/confirm-store';

interface TopicIndexEntry { slug: string; title: string; keywords: string[]; updated: string }
interface Topic extends TopicIndexEntry { content: string; created: string }
interface CoreProfile { content: string; updated: string }

const SLUG_RE = /^[a-z0-9-]+$/;

export function MemoryTab() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const workspacePath = workspace?.path;

  // 核心档案
  const [profileContent, setProfileContent] = useState('');
  const [savedProfileContent, setSavedProfileContent] = useState('');
  const [profileUpdated, setProfileUpdated] = useState<string | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);

  // 主题列表
  const [topics, setTopics] = useState<TopicIndexEntry[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [editTopic, setEditTopic] = useState<Topic | null>(null);
  const [savedTopic, setSavedTopic] = useState<Topic | null>(null);
  const [newKeyword, setNewKeyword] = useState('');
  const [topicSaving, setTopicSaving] = useState(false);

  // ... (load / save / delete / chip handlers)

  if (!workspacePath) { /* 兜底 */ }

  return (
    <div className="max-w-4xl py-6 px-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-lg font-semibold">记忆管理</h2>
        <Button variant="outline" size="sm" onClick={handleRebuildIndex}>
          <RefreshCw className="w-4 h-4 mr-1" /> 重建索引
        </Button>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        为当前工作区维护核心档案和主题记忆。核心档案每次会话启动时注入系统提示词。
      </p>

      <Tabs defaultValue="core" className="w-full">
        <TabsList>
          <TabsTrigger value="core">核心档案</TabsTrigger>
          <TabsTrigger value="topics">主题记忆 ({topics.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="core" className="pt-4">
          {/* 核心档案 Textarea + 保存 */}
        </TabsContent>

        <TabsContent value="topics" className="pt-4">
          <div className="flex gap-6">
            {/* 左侧列表 */}
            {/* 右侧编辑器 */}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
```

### 3.9 注册到设置页

修改 `app/settings/page.tsx`：

1. import：
   ```typescript
   import { MemoryTab } from './MemoryTab';
   ```

2. `TabsList` 在 `workspace` 之后、`agents` 之前插入：
   ```tsx
   <TabsTrigger value="memory" className="justify-start px-3 py-2 data-[state=active]:bg-background">
     记忆管理
   </TabsTrigger>
   ```

3. `TabsContent`：
   ```tsx
   <TabsContent value="memory" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
     <MemoryTab />
   </TabsContent>
   ```

**为什么排在工作区之后**：记忆和工作区同源（`.dogear/memory/` 在工作区内），放一起用户好找。

### 3.10 dirty 态与设置页保存按钮的关系

MemoryTab 有**独立保存按钮**，不参与设置页顶栏的"保存 / 保存并重启会话"流程。

**原因**：
1. Memory 数据不在 `settings.json`，顶栏保存只写 settings。
2. Memory 更改不需要重启会话（core-profile 下次会话生效即可，符合现有"重启会话"语义）。
3. 避免混合来源的 dirty 态让顶栏按钮禁用逻辑复杂化。

**但是**：需处理"用户在 MemoryTab 里有未保存编辑，然后切到其他 Tab 或关闭设置页"。采取宽松策略——
- 切换子 Tab（核心档案 ↔ 主题记忆）：dirty 不丢失，useState 仍在
- 切换主 Tab（记忆管理 → AI 行为）：MemoryTab 卸载，dirty 丢失。**首期接受这一行为**（UI 交互状态不跨会话持久化的项目偏好），后期评估是否加提示。
- 关闭设置页：走顶栏现有的 `handleClose`，它只检查 `settings` 的 isDirty，MemoryTab 的 dirty 不影响。**为保护用户数据，MemoryTab 自己维护一个"离开保护"不做，保存按钮醒目即可**。

### 3.11 Step 6 验证方式（无自动测试）

1. 启动 dogear，打开任意工作区
2. 设置页 → 记忆管理
3. 核心档案：写一段文字 → 保存 → 重开设置页验证内容保留 + 更新时间
4. 主题记忆：新建 → 填写 → 保存 → 列表出现 → 选中 → 修改 → 保存 → 列表更新
5. 删除一个主题 → 列表消失 + `.dogear/memory/topics/` 文件消失
6. 重建索引 → 查看报告对话框

---

## 四、实施顺序

```
Step 5 IPC
  ├─ memory.ts (新建)
  └─ index.ts 注册
       ↓
  [build:electron 验证]
  [DevTools 手动调用验证]
       ↓
Step 6 MemoryTab
  ├─ MemoryTab.tsx
  └─ settings/page.tsx 注册
       ↓
  [UI 手动操作验证]
```

**节奏建议**：
- Day 1：Step 5（IPC）+ 编译 + DevTools 验证
- Day 2：Step 6 核心档案子 Tab + UI 验证
- Day 3：Step 6 主题记忆子 Tab + 重建索引 + 整体 polish

---

## 五、风险与兜底

| 风险 | 兜底 |
|------|------|
| MemoryTab 卸载导致未保存编辑丢失 | UI 上保存按钮醒目，dirty 态用 Button 强调色。首期不做 beforeunload。 |
| 用户改 slug 时新旧文件都存在（upsert 新 + delete 旧） | 两步操作之间若新 upsert 失败，旧文件仍在，数据不丢。反之若 delete 旧失败，会留下孤儿文件，用户可通过"重建索引"按钮扫描孤儿处理。 |
| 关键词输入框空字符串 / 纯空格 | `trim()` 后为空就不添加 |
| 主题列表上千条 | 首期不做虚拟列表，ScrollArea 固定高度 400-500px 足够。真超千条再优化（Q：路线图上里程碑 2 会限制上限） |
| IPC 并发写 core-profile（用户连续点保存） | `safeFileWrite` 已有文件锁，服务层串行；前端保存按钮保存中禁用避免双击 |
| 重建索引时正有 upsert 并发 | `memory-indexer.rebuildIndex` 全量重写 index.json，`safeJsonWrite` 保证原子性。极端竞态下某次 upsert 的 index 更新被 rebuild 覆盖—可接受（重建已经是"声明基准"动作） |

---

## 六、评审检查单

- [ ] `memory.ts` 在 `tipc/index.ts` 注册
- [ ] 所有 RPC 的 `workspacePath` 必填（input 类型强制）
- [ ] IPC 错误全部 catch + 返回 `{ error }`（和现有 router 一致）
- [ ] MemoryTab 文件 <300 行（预计 250 行左右，超了可拆 `CoreProfilePanel` / `TopicsPanel`）
- [ ] 不在 `types/electron-api.ts` 新增 Topic/CoreProfile 类型（组件内 interface 即可）
- [ ] 保存按钮禁用逻辑正确（!dirty || saving）
- [ ] confirm 弹窗走 `useConfirmStore`，不用 `window.confirm`
- [ ] slug 校验正则和后端一致（`/^[a-z0-9-]+$/`）
- [ ] 工作区缺失时不调 IPC，显示兜底 UI
- [ ] 关键词 chip 去重 + trim

---

## 七、未决事项

1. **是否要做 slug 冲突提示**？用户新建时若 slug 已存在，`upsertTopic` 会静默覆盖。建议保存前 `getMemoryTopic(slug)` 预检，若存在弹 ConfirmDialog 询问"是否覆盖"。**首期做**：新建场景（slug 首次定下）预检，编辑场景（slug 未改）不检。
2. **是否要 Markdown 预览**？`content` 是 markdown。PersonaTab 的 prompt 也是 md 但没做预览。**首期不做**，和现有 UI 一致（用户可以复制到别处预览）。
3. **core-profile 的字符数限制是否要硬限制**？Q2 决策是软限制（纯提示），保持不变。
4. **IPC 是否支持批量操作**？首期 7 个 RPC 已覆盖 UI 需求，批量不做。

---

## 修订历史

- 2026-05-06：初版，方案 A 拆分后的第②份 IPC + UI 执行文档。
