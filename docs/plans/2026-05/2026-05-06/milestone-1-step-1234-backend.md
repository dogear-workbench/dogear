# 里程碑 1 · 后端执行文档（Step 1-4）

> 创建日期：2026-05-06
> 状态：设计中（待评审 → 实施）
> 对应里程碑：`../2026-05-05/milestone-1-memory-foundation.md` 的 Step 1-4
> 前置条件：Step 0 已完成（systemPromptAppend 已移除、tempPrompt 文案已对齐）
> 预估工作量：4-5 天

---

## 一、本文档覆盖范围

方案 A 第①份执行文档，只做**后端**（无 UI）：

| Step | 内容 | 验证方式 |
|------|------|---------|
| Step 1 | 记忆 Service 层（CRUD + 索引 + 加载器） | 手写测试文件 + node 脚本调用 service |
| Step 2 | Agent 工具层（RecallMemory / SaveMemory / ForgetMemory） | 起会话让 agent 调用工具 |
| Step 3 | systemPrompt 注入 core-profile | debug 日志查看拼接结果 |
| Step 4 | settingSources 固定为 `['user', 'project']` | `~/.claude/CLAUDE.md` 规则生效验证 |

**不在本文档范围**：
- ❌ 设置页 MemoryTab UI（→ 第②份）
- ❌ IPC 层（memory.ts tipc handler，→ 第②份）
- ❌ 端到端联调验收（→ 第③份）

**对齐决策**（来自评审问答）：
- Q1 记忆作用域：**每工作区独立**（MVP），`<workspace>/.dogear/memory/`
- Q2 settingSources：**固定为 `['user', 'project']`**，不做复杂迁移
- Q3 关键词匹配：**小写不敏感 + 子串匹配**
- Q4 core-profile 与 CLAUDE.md 重复：里程碑 1 阶段用户手动维护，不处理

---

## 二、Step 1：Service 层

### 2.1 目录结构

新增 `electron/main/services/memory/`：

```
electron/main/services/memory/
  ├─ memory-service.ts      # CRUD 聚合入口（唯一写入入口）
  ├─ memory-indexer.ts      # index.json 维护
  ├─ memory-loader.ts       # 会话启动时加载 core-profile
  ├─ memory-recall.ts       # RecallMemory 工具的业务逻辑
  ├─ memory-types.ts        # 本模块私有类型（Topic/TopicIndexEntry/MemoryIndex）
  └─ index.ts               # Barrel export
```

**为什么拆这么细**：遵循项目"单文件 <300 行"和"职责分离"约定。`memory-service` 不碰索引读逻辑、`memory-loader` 不碰 topics、`memory-recall` 不碰写入——未来做梦系统（里程碑 2）只扩展 service 写入面，不侵扰加载/召回路径。

### 2.2 目录路径规则

核心函数：`getMemoryDir(workspacePath: string): string`

```typescript
// 位置：memory-service.ts 顶部
function getMemoryDir(workspacePath: string): string {
  return path.join(workspacePath, '.dogear', 'memory');
}

function getCoreProfilePath(workspacePath: string): string {
  return path.join(getMemoryDir(workspacePath), 'core-profile.md');
}

function getTopicsDir(workspacePath: string): string {
  return path.join(getMemoryDir(workspacePath), 'topics');
}

function getIndexPath(workspacePath: string): string {
  return path.join(getMemoryDir(workspacePath), 'index.json');
}
```

**所有 service 方法必须接受 `workspacePath` 作为第一个参数**，不从全局状态读取（避免和未来全局记忆层混淆）。

### 2.3 类型定义（memory-types.ts）

```typescript
/** 主题记忆（对应 topics/<slug>.md 一个文件） */
export interface Topic {
  slug: string;
  title: string;
  keywords: string[];
  content: string;                    // markdown 正文（不含 frontmatter）
  created: string;                    // ISO 8601
  updated: string;                    // ISO 8601
  relatedTopics?: string[];           // 里程碑 3 用，本阶段可空
  sourceConversations?: string[];     // 里程碑 2 用，本阶段可空
}

/** index.json 中的单条主题元数据（不含正文） */
export interface TopicIndexEntry {
  slug: string;
  title: string;
  keywords: string[];
  updated: string;
}

/** index.json 完整结构 */
export interface MemoryIndex {
  version: 1;
  updated: string;
  topics: TopicIndexEntry[];
}

/** 核心档案 */
export interface CoreProfile {
  content: string;                    // markdown 正文（不含 frontmatter）
  updated: string;
}
```

**命名约定**：内部一律 camelCase，文件 frontmatter 也用 camelCase（`relatedTopics` 而非 `related_topics`——和 milestone-1 文档 3.2 节的 snake_case 示例有分歧，**本文档以 camelCase 为准**，理由是项目整体约定"内部 camelCase"）。

### 2.4 memory-service.ts API

```typescript
// 核心档案
export async function getCoreProfile(workspacePath: string): Promise<CoreProfile | null>;
export async function updateCoreProfile(workspacePath: string, content: string): Promise<void>;

// 主题记忆
export async function listTopics(workspacePath: string): Promise<TopicIndexEntry[]>;
export async function getTopic(workspacePath: string, slug: string): Promise<Topic | null>;
export async function upsertTopic(
  workspacePath: string,
  data: Omit<Topic, 'created' | 'updated'> & { created?: string; updated?: string }
): Promise<Topic>;
export async function deleteTopic(workspacePath: string, slug: string): Promise<void>;
```

**实现要点**：
- 文件 IO 走 `safe-json.ts` 的原子写入模式（参考现有 `settings-service.ts` 的 `saveSettings` 实现）
- markdown 文件使用 frontmatter 格式（`---\n<yaml>\n---\n<body>`），用**手写正则解析**，不引入 gray-matter 等依赖（项目约定"不引入新依赖"）
- `upsertTopic`：
  - 不存在 → 写入（`created = updated = now`）
  - 存在 → 覆盖（保留原 `created`，`updated = now`）
  - **本阶段不支持 merge 模式**（里程碑 2 做梦系统才需要）
- 每次写入（upsert / delete / updateCoreProfile）**同步触发** `memory-indexer.updateIndexEntry()` 或 `removeIndexEntry()`
- `deleteTopic` 同时删 markdown 文件 + 更新 index.json
- 所有方法对"目录不存在"容错：`getCoreProfile` / `listTopics` / `getTopic` 返回 null 或 `[]`

**frontmatter 解析的轻量实现**（示意，实现时验证正则边界）：

```typescript
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

function parseFrontmatter(raw: string): { fm: Record<string, unknown>; body: string } {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return { fm: {}, body: raw };
  const fm = parseSimpleYaml(match[1]); // 只处理 key: value 和 key: [a, b] 两种
  return { fm, body: match[2] };
}
```

**不支持完整 YAML**，只处理 topic 文件实际用到的字段类型（string / string[] / ISO 时间戳）。后期需要复杂 yaml 再换库。

### 2.5 memory-indexer.ts API

```typescript
/** 重建索引（扫描 topics/*.md，重写 index.json） */
export async function rebuildIndex(workspacePath: string): Promise<MemoryIndex>;

/** 单条 upsert（upsertTopic 时调用） */
export async function updateIndexEntry(workspacePath: string, entry: TopicIndexEntry): Promise<void>;

/** 单条删除（deleteTopic 时调用） */
export async function removeIndexEntry(workspacePath: string, slug: string): Promise<void>;

/** 读取索引（不存在返回空索引） */
export async function readIndex(workspacePath: string): Promise<MemoryIndex>;

/** 一致性检查：索引声明的文件是否都存在；返回孤儿 slug 和 index 里缺失的 slug */
export async function checkConsistency(workspacePath: string): Promise<{
  orphansInIndex: string[];      // index 里有但文件不在
  orphansOnDisk: string[];       // 文件在但 index 里没
}>;
```

**`rebuildIndex` 实现**：
1. `fs.readdir(topicsDir)` 过滤 `.md`
2. 逐个读 frontmatter → 构造 `TopicIndexEntry`
3. 写入 index.json

**不提供 `checkConsistency` 的自动修复**——只报告，调用方（设置页的"重建索引"按钮）决定是否触发 `rebuildIndex`。

### 2.6 memory-loader.ts API

```typescript
/**
 * 会话启动时调用，加载核心档案并返回注入用的字符串。
 * 文件不存在或为空 → 返回 null，buildSystemPrompt 不拼接。
 * 文件超过 2000 字符 → 记警告日志，仍然返回完整内容。
 */
export async function loadCoreProfileForSession(workspacePath: string): Promise<string | null>;
```

**注入格式**（返回字符串的形状）：

```
\n---\n\n## 用户画像（自动加载）\n\n<core-profile body 内容>\n\n---\n
```

**为什么 loader 直接返回拼好的字符串**：让 `buildSystemPrompt` 的调用点只做 `parts.push(coreProfileText)`，不需要再包装。

**异常处理**：任何读文件失败都 catch 并返回 null，不让记忆系统崩溃拖垮会话启动。

### 2.7 memory-recall.ts API

```typescript
export interface RecallResult {
  topics: Array<{
    slug: string;
    title: string;
    content: string;   // 完整 markdown（含 frontmatter 解析后的正文）
    updated: string;
  }>;
  hint?: string;       // 有更多未返回主题时的提示，例如 "还有 3 个相关主题未返回，可缩小关键词范围"
}

export async function recall(
  workspacePath: string,
  keywords: string[],
  limit: number = 3
): Promise<RecallResult>;
```

**匹配算法**（对齐 Q3 决策）：

```
对 keywords 做小写归一化 → 得到 normalizedKeywords
对每个 topic 的 (title + keywords join) 做小写归一化 → 得到 haystack
如果 normalizedKeywords 中任一个是 haystack 的子串 → 该 topic 命中
按"命中关键词数量"降序排，平手按 updated 降序
截取 top-limit
返回结果，如果实际命中数 > limit，设置 hint
```

**不做中文分词**（Q3 明确排除 D）。

**limit 上限**：服务层硬限制 5，超过 5 直接截到 5（防止 agent 滥用占 context）。

### 2.8 index.ts（barrel export）

```typescript
export * from './memory-service.js';
export * from './memory-indexer.js';
export * from './memory-loader.js';
export * from './memory-recall.js';
export type { Topic, TopicIndexEntry, MemoryIndex, CoreProfile } from './memory-types.js';
```

### 2.9 Step 1 验证方式（无 UI）

手写一个一次性脚本 `scripts/test-memory-service.ts`（跑完就删）：

1. 准备一个临时工作区目录（`os.tmpdir()` 下）
2. `updateCoreProfile(path, '# 测试\n用户喜欢喝咖啡')` → 断言文件创建成功、frontmatter.updated 存在
3. `upsertTopic(path, { slug: 'coffee', title: '咖啡偏好', keywords: ['咖啡', 'coffee'], content: '...' })` → 断言文件创建 + index.json 包含该条目
4. `listTopics(path)` → 断言返回 1 条
5. `recall(path, ['Coffee'], 3)` → 断言返回该主题（大小写不敏感验证）
6. `recall(path, ['咖'], 3)` → 断言返回该主题（子串验证）
7. `deleteTopic(path, 'coffee')` → 断言文件删除 + index.json 为空
8. `checkConsistency(path)` → 断言双空数组

脚本执行 `bun run scripts/test-memory-service.ts`，打印 pass/fail。

---

## 三、Step 2：Agent 工具层

### 3.1 新增文件

`electron/main/agents/tools/memory-tools.ts`

### 3.2 Server 名与分类

在 `tool-registry.ts` 补充：
- `SERVER_LABELS` 新增 `'dogear-memory': '记忆大脑'`
- `serverOrder` 把 `'dogear-memory'` 加到 `'sdk'` 之后（优先级最高，记忆是跨所有工作的基础设施）
- `ToolMeta.category` 联合类型新增 `'memory'`

### 3.3 工具实现模板

```typescript
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import * as memoryService from '../../services/memory/memory-service.js';
import * as memoryRecall from '../../services/memory/memory-recall.js';
import { registerTools } from './tool-registry.js';

registerTools([
  { name: 'RecallMemory', description: '按关键词查询历史主题记忆', server: 'dogear-memory', category: 'memory' },
  { name: 'SaveMemory', description: '保存或更新主题记忆（仅在用户明确要求记住时使用）', server: 'dogear-memory', category: 'memory' },
  { name: 'ForgetMemory', description: '删除指定主题记忆', server: 'dogear-memory', category: 'memory' },
]);

export function createMemoryTools(workspacePath: string) {
  return createSdkMcpServer({
    name: 'dogear-memory',
    version: '1.0.0',
    tools: [
      tool(
        'RecallMemory',
        '按关键词查询与主题相关的历史记忆。每个主题记忆包含关键词索引和 markdown 正文。\n' +
        '使用时机：在讨论具体主题（股票分析、架构设计、用户偏好等）的开头主动调用，不要等用户追问历史才查。\n' +
        '每次最多返回 5 个主题，超出会有 hint 提示，请优化关键词再调。',
        {
          keywords: z.array(z.string()).min(1).describe('关键词数组，会做小写+子串匹配'),
          limit: z.number().int().min(1).max(5).optional().describe('返回主题数上限，默认 3，最大 5'),
        },
        async (args) => {
          const result = await memoryRecall.recall(workspacePath, args.keywords, args.limit ?? 3);
          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            }],
          };
        }
      ),
      tool(
        'SaveMemory',
        '保存新的主题记忆或覆盖现有主题。\n' +
        '⚠️ 仅在用户**明确表达**"记住 XX"、"把这个存到记忆里"等意图时调用，不要自行猜测。\n' +
        '写错可以通过 ForgetMemory 删除，但会污染 RecallMemory 的检索结果。',
        {
          slug: z.string().regex(/^[a-z0-9-]+$/).describe('kebab-case slug，仅小写字母数字和连字符'),
          title: z.string().describe('主题中文标题'),
          keywords: z.array(z.string()).min(1).describe('关键词数组，用于 RecallMemory 检索'),
          content: z.string().describe('主题正文（markdown 格式）'),
        },
        async (args) => {
          await memoryService.upsertTopic(workspacePath, args);
          return {
            content: [{ type: 'text' as const, text: `已保存主题「${args.title}」(slug=${args.slug})` }],
          };
        }
      ),
      tool(
        'ForgetMemory',
        '删除指定 slug 的主题记忆。仅在用户明确要求"忘记 XX"时使用。',
        { slug: z.string() },
        async (args) => {
          await memoryService.deleteTopic(workspacePath, args.slug);
          return { content: [{ type: 'text' as const, text: `已删除主题 slug=${args.slug}` }] };
        }
      ),
    ],
  });
}
```

### 3.4 注入到会话

修改 `electron/main/services/conversation-runtime-service.ts` 的 `buildQueryConfig`（当前在 89-97 行附近添加 article / stock tools 的地方）：

```typescript
import { createMemoryTools } from '../agents/tools/memory-tools.js';

// ... 在 createArticleTools 之后
if (workspacePath) {
  const memoryTools = createMemoryTools(workspacePath);
  mcpServers['dogear-memory'] = memoryTools;
}
```

**注意**：`workspacePath` 为空时不注入 memory tools（和 article tools 的策略一致）。

### 3.5 Step 2 验证方式

起一个对话 → 在输入框发"调用 SaveMemory 工具，slug 为 test-save，title 为测试，keywords 为 [测试]，content 为 Hello" → 权限确认 → 查看 `.dogear/memory/topics/test-save.md` 文件是否生成 + index.json 是否包含。

---

## 四、Step 3：SystemPrompt 注入

### 4.1 修改点

文件：`electron/main/agents/query-based-session.ts`
方法：`buildSystemPrompt(appSettings)`（当前约 1382 行）

**当前实现**：

```typescript
private buildSystemPrompt(appSettings: AppSettings): { type: 'preset'; preset: 'claude_code'; append: string } {
  const parts: string[] = [];
  if (appSettings.ai.defaultSystemPrompt) parts.push(appSettings.ai.defaultSystemPrompt);
  if (this.config.personaId && appSettings.personas) { /* persona */ }
  if (this.config.tempPrompt) { /* tempPrompt */ }
  return { type: 'preset', preset: 'claude_code', append: parts.join('\n') };
}
```

**改造方向**：`buildSystemPrompt` 不能直接 await（它是同步的）。有两个选择：

**方案 A（推荐）**：把 core-profile 加载移到 `start()` 方法里（`buildSystemPrompt` 调用前），作为参数传给 `buildSystemPrompt`：

```typescript
// 在 start() 方法中（约 182-184 行附近）
const coreProfileText = this.config.workspacePath
  ? await memoryLoader.loadCoreProfileForSession(this.config.workspacePath)
  : null;
const systemPrompt = this.buildSystemPrompt(appSettings, coreProfileText);

// buildSystemPrompt 签名调整
private buildSystemPrompt(
  appSettings: AppSettings,
  coreProfileText: string | null
): { type: 'preset'; preset: 'claude_code'; append: string } {
  const parts: string[] = [];
  // ... 原有三部分保持不变 ...
  if (coreProfileText) parts.push(coreProfileText);
  return { type: 'preset', preset: 'claude_code', append: parts.join('\n') };
}
```

**方案 B（不推荐）**：把 `buildSystemPrompt` 改成 async。会导致调用链上多处要 await，scope 超出本 Step。

**采用方案 A**。

### 4.2 拼接顺序

```
defaultSystemPrompt → persona.prompt → tempPrompt → coreProfileText
```

core-profile 放**最后**的理由：
- 前三者是项目/人设/对话维度的"规则"
- core-profile 是用户画像，作为上下文基础，让 agent 读完规则再看画像
- 未来 systemPromptAppend（已删）的位置由 core-profile 承接

### 4.3 日志

修改 `start()` 方法中已有的 system prompt 日志（约 530 行附近）：

```typescript
this.logger.info('  • coreProfile 已注入:', !!coreProfileText, coreProfileText?.length ?? 0, '字符');
```

### 4.4 Step 3 验证方式

1. 手动创建 `<workspace>/.dogear/memory/core-profile.md`：
   ```
   ---
   updated: 2026-05-06T12:00:00Z
   ---
   # 用户画像
   ## 身份
   测试用户，爱吃芒果。
   ```
2. 重启会话，查看主进程日志 `coreProfile 已注入: true 45 字符`
3. 在对话里问"我爱吃什么？" → agent 应答出"芒果"

---

## 五、Step 4：settingSources 固定

### 5.1 改动点

**决策**（来自 Q2 回答）：不做迁移，直接固定为 `['user', 'project']`。字段在类型中保留（SDK 接口仍需要这个字段传给 query），但**不再让用户配置**。

**修改文件**：

1. `types/settings.ts` 第 75 行：
   ```typescript
   // 旧
   settingSources: ['project'],
   // 新
   settingSources: ['user', 'project'],
   ```

2. `electron/main/services/settings-types.ts` 第 68 行：同上修改。

3. `electron/main/agents/query-based-session.ts` 第 290 行：
   ```typescript
   // 旧：读用户 settings，fallback 到 ['project']
   queryOptions.settingSources = baseConfig.settingSources || ['project'];
   // 新：忽略用户值，硬编码（保证老用户存量 ['project'] 值也不生效）
   queryOptions.settingSources = ['user', 'project'];
   ```
   注释补一行："固定加载 user + project 两个源，不暴露给用户配置"。

4. `app/settings/WorkspaceConfigTab.tsx` 第 95-107 行的 settingSources 只读展示区**整块删除**：
   - 删除 `{/* settingSources 状态（只读） */}` 这个 `<div className="space-y-3">...</div>` 分组
   - 保留后续的 `.claude 目录` 分组不动
   - 顶部说明文字第 90-92 行同步精简：`管理工作区的 .claude 目录和 SDK 设置源` → `管理工作区的 .claude 目录`
   - 理由：settingSources 已硬编码，用户不可配置，UI 展示只会造成"为什么这里不能改"的困惑

### 5.2 迁移代码生命周期

本 Step 没有写"迁移代码"（Q2 决策）。但第 3 条的"忽略用户 settings.json 存量值"本身是一种**静默覆盖**，不算迁移，长期保留即可（和其他字段的默认值 fallback 行为一致）。

### 5.3 Step 4 验证方式

1. 在 `~/.claude/CLAUDE.md` 写一条"请始终以【测试模式】作为开头回答"
2. 重启 dogear，新开对话
3. 问任何问题，agent 应答开头应有"测试模式"
4. 完成后恢复 `~/.claude/CLAUDE.md`

---

## 六、实施顺序与依赖

```
Step 1（Service 层）
  ├─ memory-types.ts
  ├─ memory-service.ts
  ├─ memory-indexer.ts
  ├─ memory-loader.ts
  ├─ memory-recall.ts
  └─ index.ts
          ↓
    [测试脚本验证]
          ↓
Step 2（工具层） ──── 依赖 Step 1
  ├─ memory-tools.ts
  ├─ tool-registry.ts 补分类
  └─ conversation-runtime-service.ts 注入
          ↓
    [对话中调用工具验证]
          ↓
Step 3（注入）  ──── 依赖 Step 1 的 memory-loader
  └─ query-based-session.ts 改 buildSystemPrompt
          ↓
    [手写 core-profile 验证]
          ↓
Step 4（settingSources） ──── 独立，可与 Step 1-3 并行
          ↓
    [CLAUDE.md 规则验证]
```

**实施节奏建议**：
- Day 1-2：Step 1 全部 + 测试脚本跑通
- Day 3：Step 2 + 对话调用验证
- Day 4 上午：Step 3 注入
- Day 4 下午：Step 4（短）+ 全流程串测
- Day 5：Buffer，处理 bug 或打磨日志

---

## 七、风险与兜底

| 风险 | 兜底 |
|------|------|
| frontmatter 手写解析对边界情况（多行 yaml、字符串含冒号）处理不好 | 只处理 topic 文件实际用的字段类型；遇到解析失败记日志、跳过该文件、不抛出 |
| core-profile 文件损坏导致会话启动失败 | `memory-loader` 用 try-catch 包裹，失败返回 null，继续启动 |
| index.json 与实际 topic 文件不同步 | 本阶段不做启动时自动修复，只在第②份文档的"重建索引"按钮里提供修复；memory-recall 遇到 index 中存在但文件不存在的条目，跳过 + 记日志 |
| Agent 滥用 SaveMemory 堆垃圾 | 工具 description 明确"仅在用户明确要求时使用"；用户在第②份文档的 MemoryTab 里巡检删除 |
| `settingSources` 改为 `['user', 'project']` 后，用户 `~/.claude/CLAUDE.md` 有不兼容内容 | 用户自己负责（单用户自用定位）；文档里提醒检查该文件 |
| `workspacePath` 为空（新工作区未初始化） | 所有 memory 路径函数返回合理默认值 / 不触发 IO；工具层不注入 |

---

## 八、评审检查单

- [ ] 每个文件职责单一，均 <300 行（memory-service 预计最接近上限，如超要拆）
- [ ] 所有方法第一参数是 `workspacePath`，不从全局读
- [ ] 文件 IO 走 safe-json 模式
- [ ] 不引入新依赖（frontmatter 手写解析）
- [ ] 内部数据类型使用 camelCase
- [ ] `buildSystemPrompt` 保持同步（core-profile 在 start() 里加载）
- [ ] 工具 description 明确"仅用户明确要求时使用 SaveMemory"
- [ ] settingSources 修改后，QueryBasedSession 硬编码，不读用户值
- [ ] Step 1 测试脚本覆盖 CRUD + recall 大小写/子串匹配

---

## 九、本文档未决事项（交付实施前可再议）

1. **`memory-service` 文件超过 300 行怎么办？** 预估不会超（CRUD + 聚合调用 indexer），但如超了可以拆出 `memory-fs.ts`（IO 层）和 `memory-service.ts`（业务聚合层）。
2. **frontmatter yaml 手写解析是否风险过高？** 如果 Step 1 实施时发现边界太多，可引入 `gray-matter` 包（约 10KB）——这是本文档里唯一可能破坏"不引入新依赖"约定的点，届时单独确认。
<!-- 已定：Step 4 的 WorkspaceConfigTab settingSources 展示区直接删除 -->

---

## 修订历史

- 2026-05-06：初版，方案 A 拆分后的第①份后端执行文档。
