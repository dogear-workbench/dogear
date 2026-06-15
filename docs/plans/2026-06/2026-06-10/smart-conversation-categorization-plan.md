# 对话列表智能分类 实现计划

> **For Claude:** REQUIRED SUB-SKILL: 用 superpowers:executing-plans 按任务逐条实施本计划。

**Goal:** 在对话列表左侧栏引入「智能分类」：复用摘要卡能力自动给会话打标签并归类，与手动文件夹分区共存；同一会话可在多处出现但 tab 唯一。

**Architecture:** 摘要卡（既有 DigestCard）扩展 tags 字段（主+辅+适配度），由 `DigestSession` 同一次 query 产出。新增 `CategorizeSession` 任务类型：每次新摘要产生后串行触发，纯阈值代码层先匹配（0 LLM），无匹配再调一次 LLM 决策 `JOIN_EXISTING / NEW_CATEGORY`。手动文件夹结构保留邻接表，但赋予「多引用」新语义（同一 conversationId 可在多个 folder 的 children 里）。前端 `ConversationList.tsx` 重构为四段：手动 → 智能/时间切换 → 归档。

**Tech Stack:** Electron 主进程 (TS, ES2020) + tipc + Claude Agent SDK + React 19 + Zustand + Tailwind 4 + bun:test。

---

## 重要约定（实施者必读）

1. **命名**：分类管线命名为 **categorize**（文件名 `smart-category-*.ts` / `categorize-*.ts`、任务类型 `CATEGORIZE_SESSION`、MCP server `dogear-smart-category`、tipc 路由 `triggerCategorize` 等、设置键 `categorizeModelTier` / `categorizeProfileId`）。
2. **不做兼容层**（开发阶段约定）：删掉的字段直接删，不留废弃壳。
3. **每个 Phase 结束 commit**。提交信息用仓库风格 `feat(...)/refactor(...)/fix(...)`，结尾加 `Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>`。**仅在用户同意后提交**——若执行环境未授权自动提交，则在每个 Phase 末提示用户。
4. **测试**：纯函数用 `bun test <file>` 跑；IO/UI 用 `bun run build:electron` 编译 + 手动验证。
5. **编译验证**：改主进程后必须 `bun run build:electron` 通过；改前端后 `bun run lint` 应无新增错误。
6. **DRY**：新 store/engine 强制参考 `digest-store.ts` / `review-store.ts` 的形态，frontmatter 序列化复用 `memory-fs.ts` 的 `stringifyFrontmatter` / `parseFrontmatter`。

---

## Phase 1 — 类型与设置字段

**Files:**
- Create: `types/smart-category.ts`
- Modify: `types/settings.ts`（追加字段 + DEFAULT_SETTINGS）
- Modify: `electron/main/types.ts`（镜像 SmartCategory 类型，按既有约定主进程不能直接 import `types/`）

**Step 1: 写 `types/smart-category.ts`**

```ts
export interface DigestTags {
  primary: string;
  secondary: string[];                  // 0–3 个
  scores: Record<string, number>;       // 含 primary 与 secondary 全部标签的 0–1 适配度
}

export interface SmartCategory {
  id: string;
  name: string;
  anchorTags: string[];
  conversationIds: string[];
  createdAt: string;                    // ISO
  updatedAt: string;                    // ISO
}

export interface CategorizeDecisionLog {
  time: string;                         // ISO
  conversationId: string;
  decision: 'match' | 'join' | 'new' | 'skip' | 'error';
  reason?: string;
}

export interface SmartCategoriesIndex {
  categories: SmartCategory[];
  recentDecisions: CategorizeDecisionLog[];   // 环形，最多 20 条
}
```

**Step 2: 在 `types/settings.ts` 的 `ai` 块追加字段**

在 `digestModelTier` 后追加：

```ts
/** 智能分类（CATEGORIZE_SESSION）使用的模型档位。默认 haiku */
categorizeModelTier?: 'haiku' | 'sonnet' | 'opus';
/** 智能分类使用的模型方案 id。缺省回退 activeProfileId */
categorizeProfileId?: string;
```

在 `AppSettings` 顶层追加：

```ts
/** 智能分类设置 */
smartCategory?: {
  enabled?: boolean;          // 默认 true
  threshold?: number;         // 0–1，默认 0.5
  maxCategories?: number;     // 默认 10
};
```

`DEFAULT_SETTINGS` 的 `ai` 里加 `categorizeModelTier: 'haiku'`，顶层加：

```ts
smartCategory: { enabled: true, threshold: 0.5, maxCategories: 10 },
```

**Step 3: 镜像主进程类型**

在 `electron/main/types.ts` 末尾追加 `SmartCategory` / `SmartCategoriesIndex` / `DigestTags` 的镜像声明（与 Step 1 完全一致），主进程代码引用主进程镜像而不直接 import `types/smart-category.ts`。

**Step 4: 编译验证**

```bash
bun run build:electron
```

预期：无类型错误。

**Step 5: Commit**

```
feat(types): 智能分类类型与设置字段
```

---

## Phase 2 — 摘要卡 schema 扩展（DigestCard.tags）

**Files:**
- Modify: `electron/main/services/memory/digest-store.ts`（DigestCard 接口加 tags + 序列化/解析支持）
- Modify: `electron/main/services/memory/digest-store.test.ts`（新增 tags round-trip 用例）

**Step 1: DigestCard 接口加字段**

在 `DigestCard` 接口末尾加：

```ts
tags?: DigestTags;   // 智能分类用；旧卡无此字段
```

**Step 2: 修改 `serializeDigestCard`**

frontmatter 序列化时若有 tags 则写入。结构：

```yaml
tags:
  primary: "产品-Dashboard"
  secondary:
    - "UI重构"
    - "用户反馈"
  scores:
    "产品-Dashboard": 0.85
    "UI重构": 0.6
    "用户反馈": 0.4
```

直接用 `stringifyFrontmatter` 支持嵌套对象——若该 helper 不支持嵌套（先确认），就在 `serializeDigestCard` 里把 tags 单独 stringify 后插到 frontmatter 字符串里。

**Step 3: 修改 `parseDigestCard`**

解析 frontmatter 时尝试取 `tags`，结构合法（有 primary 字符串、secondary 数组、scores 对象）则填入；不合法直接置空。

**Step 4: 新增测试**

在 `digest-store.test.ts` 加：

```ts
test('tags round-trip 保持等价', () => {
  const card: DigestCard = {
    ...sample,
    tags: {
      primary: '产品-Dashboard',
      secondary: ['UI重构', '用户反馈'],
      scores: { '产品-Dashboard': 0.85, 'UI重构': 0.6, '用户反馈': 0.4 },
    },
  };
  const back = parseDigestCard(serializeDigestCard(card))!;
  expect(back.tags).toEqual(card.tags);
});

test('旧卡无 tags 字段，解析后 tags 为 undefined', () => {
  const back = parseDigestCard(serializeDigestCard(sample))!;
  expect(back.tags).toBeUndefined();
});
```

**Step 5: 跑测试**

```bash
bun test electron/main/services/memory/digest-store.test.ts
```

预期：全部通过。

**Step 6: Commit**

```
feat(digest): 摘要卡支持 tags 字段（主+辅+适配度）
```

---

## Phase 3 — DigestSession 提示词与 SaveDigest 工具

**Files:**
- Modify: `electron/main/services/memory/digest-prompt.ts`（提示词追加 tags 产出要求）
- Modify: `electron/main/agents/tools/digest-tools.ts`（SaveDigest schema 加 tags）

**Step 1: SaveDigest schema 接受 tags**

`SaveDigest` 工具的 zod schema 加：

```ts
tags: z.object({
  primary: z.string().min(1),
  secondary: z.array(z.string()).max(3).default([]),
  scores: z.record(z.string(), z.number().min(0).max(1)),
}).optional()
```

handler 把 tags 透传给 `saveDigest`（即写到 DigestCard）。

**Step 2: 提示词追加要求**

在 `DEFAULT_DIGEST_PROMPT`（`digest-prompt.ts`）末尾追加章节：

```
## 标签产出（必填）

调用 SaveDigest 时必须同时提供 tags 字段：
- primary: 1 个主标签，自由文本，描述会话主导主题（如 "产品-Dashboard"、"股票-估值"、"代码-重构"）
- secondary: 0–3 个辅标签，覆盖次要主题或方法面
- scores: 给每个标签（含主+辅）打 0–1 的适配度，表示会话与该标签的契合程度
  - 0.8+：会话主要内容就是这个主题
  - 0.5–0.8：明确涉及但非主导
  - 0.5 以下：边角不必加进 secondary

**复用现有标签优先**：调用 ListExistingTags 工具（若启用）查看本工作区已用标签清单与频次；语义相同时复用原名，避免 "产品-Dashboard" 与 "产品/Dashboard" 这种近义割裂。

**归一化**：标签内部用中划线分层（如 "股票-估值-DCF"），不用斜杠/空格做分隔。
```

> ListExistingTags 这个工具暂不做（Phase 8 视情况再加）。当前先靠提示词约束 + 单工作区粗粒度，agent 标签发散程度可接受。

**Step 3: 编译验证**

```bash
bun run build:electron
```

**Step 4: Commit**

```
feat(digest): 提示词与 SaveDigest 支持 tags 产出
```

---

## Phase 4 — smart-category-store（持久化）

**Files:**
- Create: `electron/main/services/memory/smart-category-store.ts`
- Create: `electron/main/services/memory/smart-category-store.test.ts`

**Step 1: 写 store 模块**

仿 `digest-store.ts` 风格。完整代码：

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getWorkspaceDataDir } from '../conversation-service.js';
import type { SmartCategoriesIndex, SmartCategory, CategorizeDecisionLog } from '../../types.js';

const FILE_NAME = 'smart-categories.json';
const MAX_DECISIONS = 20;

export function getIndexPath(wsId: string): string {
  return path.join(getWorkspaceDataDir(wsId), FILE_NAME);
}

export async function readIndex(wsId: string): Promise<SmartCategoriesIndex> {
  try {
    const raw = await fs.readFile(getIndexPath(wsId), 'utf-8');
    const parsed = JSON.parse(raw) as SmartCategoriesIndex;
    if (!Array.isArray(parsed.categories)) parsed.categories = [];
    if (!Array.isArray(parsed.recentDecisions)) parsed.recentDecisions = [];
    return parsed;
  } catch {
    return { categories: [], recentDecisions: [] };
  }
}

export async function writeIndex(wsId: string, idx: SmartCategoriesIndex): Promise<void> {
  const dir = getWorkspaceDataDir(wsId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(getIndexPath(wsId), JSON.stringify(idx, null, 2), 'utf-8');
}

// 纯函数：把 conversationId 加进指定分类（去重）
export function pushConversation(cat: SmartCategory, conversationId: string): SmartCategory {
  if (cat.conversationIds.includes(conversationId)) return cat;
  return {
    ...cat,
    conversationIds: [...cat.conversationIds, conversationId],
    updatedAt: new Date().toISOString(),
  };
}

// 纯函数：从所有分类中移除 conversationId（用于归档级联清理时可调用，但默认渲染过滤够用，留作显式删除场景）
export function removeConversationEverywhere(idx: SmartCategoriesIndex, conversationId: string): SmartCategoriesIndex {
  return {
    ...idx,
    categories: idx.categories.map((c) =>
      c.conversationIds.includes(conversationId)
        ? { ...c, conversationIds: c.conversationIds.filter((x) => x !== conversationId), updatedAt: new Date().toISOString() }
        : c
    ),
  };
}

// 纯函数：追加一条决策日志（环形）
export function appendDecision(idx: SmartCategoriesIndex, log: CategorizeDecisionLog): SmartCategoriesIndex {
  const next = [log, ...idx.recentDecisions];
  return { ...idx, recentDecisions: next.slice(0, MAX_DECISIONS) };
}

export function newCategory(name: string, anchorTags: string[]): SmartCategory {
  const now = new Date().toISOString();
  return { id: `cat_${randomUUID().slice(0, 8)}`, name, anchorTags, conversationIds: [], createdAt: now, updatedAt: now };
}
```

**Step 2: 测试**

```ts
import { test, expect } from 'bun:test';
import { pushConversation, removeConversationEverywhere, appendDecision, newCategory } from './smart-category-store.ts';
import type { SmartCategoriesIndex } from '../../types.ts';

test('pushConversation 去重', () => {
  const c = newCategory('A', ['t1']);
  const c1 = pushConversation(c, 'conv1');
  const c2 = pushConversation(c1, 'conv1');
  expect(c2.conversationIds).toEqual(['conv1']);
});

test('removeConversationEverywhere 从所有分类清除', () => {
  const idx: SmartCategoriesIndex = {
    categories: [
      { ...newCategory('A', ['t1']), conversationIds: ['c1', 'c2'] },
      { ...newCategory('B', ['t2']), conversationIds: ['c1', 'c3'] },
    ],
    recentDecisions: [],
  };
  const next = removeConversationEverywhere(idx, 'c1');
  expect(next.categories[0].conversationIds).toEqual(['c2']);
  expect(next.categories[1].conversationIds).toEqual(['c3']);
});

test('appendDecision 环形截断到 20 条', () => {
  let idx: SmartCategoriesIndex = { categories: [], recentDecisions: [] };
  for (let i = 0; i < 25; i++) {
    idx = appendDecision(idx, { time: `t${i}`, conversationId: 'c', decision: 'match' });
  }
  expect(idx.recentDecisions).toHaveLength(20);
  expect(idx.recentDecisions[0].time).toBe('t24');
});
```

**Step 3: 跑测试**

```bash
bun test electron/main/services/memory/smart-category-store.test.ts
```

**Step 4: Commit**

```
feat(smart-category): store 与纯函数 helpers
```

---

## Phase 5 — smart-category-engine（决策纯函数）

**Files:**
- Create: `electron/main/services/memory/smart-category-engine.ts`
- Create: `electron/main/services/memory/smart-category-engine.test.ts`

**Step 1: 写 engine 模块**

```ts
import type { DigestTags, SmartCategory } from '../../types.js';

// Step A: 纯阈值匹配
// 返回所有 score >= threshold 的分类 id 列表（按 score 倒序）
export function matchByThreshold(
  tags: DigestTags,
  categories: SmartCategory[],
  threshold: number
): Array<{ categoryId: string; score: number }> {
  const allTags = [tags.primary, ...tags.secondary];
  const results = categories.map((c) => {
    let score = 0;
    for (const t of allTags) {
      if (c.anchorTags.includes(t)) {
        score += tags.scores[t] ?? 0;
      }
    }
    return { categoryId: c.id, score };
  });
  return results.filter((r) => r.score >= threshold).sort((a, b) => b.score - a.score);
}

// Step C: 召回受影响候选名单（不调 LLM，只挑出来给 LLM 看）
// 输入：所有分类 + 一个会话级别的"标签视图"（用于做 anchor 重叠匹配）
// 输出：相邻最多 2 个老分类，每个分类挑适配度最低的 5 条 + 标签有重叠的 5 条（去重，≤10）
export interface RedistributeCandidate {
  conversationId: string;
  fromCategoryId: string;
  originalScore: number;
}

export function pickRedistributeCandidates(
  categories: SmartCategory[],
  newAnchorTags: string[],
  // 拿到候选会话在原分类里的 score 需要额外信息。简化：本函数只返回候选 conversationId 列表，
  // 实际 score 由 trigger 处在 LLM prompt 组装时再补
): Array<{ categoryId: string; conversationIds: string[] }> {
  // 找出与 newAnchorTags 有重叠的老分类
  const neighbors = categories
    .map((c) => ({ cat: c, overlap: c.anchorTags.filter((t) => newAnchorTags.includes(t)).length }))
    .filter((x) => x.overlap > 0)
    .sort((a, b) => b.overlap - a.overlap)
    .slice(0, 2);

  return neighbors.map(({ cat }) => ({
    categoryId: cat.id,
    // 简化：取该分类的全部会话；后续 LLM prompt 那侧再按"标签重叠 + 适配度低"截断到 10 条
    // 真正的"适配度排序"需要每个会话的 tags，这里 engine 层不存所以由 trigger 处理
    conversationIds: cat.conversationIds,
  }));
}

// 工具：标签归一化（小写、trim、统一中划线）
export function normalizeTag(tag: string): string {
  return tag.trim().replace(/[/\s]+/g, '-').replace(/-+/g, '-');
}

// 工具：把 DigestTags 整个归一化（写入摘要卡前调一次，保证一致性）
export function normalizeTags(tags: DigestTags): DigestTags {
  const remap = (t: string) => normalizeTag(t);
  const scores: Record<string, number> = {};
  for (const [k, v] of Object.entries(tags.scores)) scores[remap(k)] = v;
  return {
    primary: remap(tags.primary),
    secondary: tags.secondary.map(remap),
    scores,
  };
}
```

**Step 2: 测试**

```ts
import { test, expect } from 'bun:test';
import { matchByThreshold, pickRedistributeCandidates, normalizeTag, normalizeTags } from './smart-category-engine.ts';
import type { SmartCategory, DigestTags } from '../../types.ts';

const cats: SmartCategory[] = [
  { id: 'c1', name: '产品', anchorTags: ['产品-Dashboard', 'UI重构'], conversationIds: [], createdAt: '', updatedAt: '' },
  { id: 'c2', name: '股票', anchorTags: ['股票-估值'], conversationIds: [], createdAt: '', updatedAt: '' },
];

test('matchByThreshold 命中单个分类', () => {
  const tags: DigestTags = {
    primary: '产品-Dashboard',
    secondary: ['UI重构'],
    scores: { '产品-Dashboard': 0.8, 'UI重构': 0.4 },
  };
  const r = matchByThreshold(tags, cats, 0.5);
  expect(r).toHaveLength(1);
  expect(r[0].categoryId).toBe('c1');
  expect(r[0].score).toBeCloseTo(1.2);
});

test('matchByThreshold 阈值过滤', () => {
  const tags: DigestTags = {
    primary: '股票-估值',
    secondary: [],
    scores: { '股票-估值': 0.3 },
  };
  expect(matchByThreshold(tags, cats, 0.5)).toEqual([]);
});

test('matchByThreshold 命中多个分类（多标签归类）', () => {
  const tags: DigestTags = {
    primary: '产品-Dashboard',
    secondary: ['股票-估值'],
    scores: { '产品-Dashboard': 0.6, '股票-估值': 0.6 },
  };
  const r = matchByThreshold(tags, cats, 0.5);
  expect(r.map((x) => x.categoryId).sort()).toEqual(['c1', 'c2']);
});

test('pickRedistributeCandidates 只返回邻近 2 个分类', () => {
  const more = [...cats, { id: 'c3', name: '代码', anchorTags: ['UI重构'], conversationIds: ['x'], createdAt: '', updatedAt: '' }];
  const r = pickRedistributeCandidates(more, ['UI重构', '产品-Dashboard']);
  expect(r).toHaveLength(2);
  expect(r.map((x) => x.categoryId).sort()).toEqual(['c1', 'c3']);
});

test('normalizeTag 统一分隔符', () => {
  expect(normalizeTag('  产品 / Dashboard ')).toBe('产品-Dashboard');
  expect(normalizeTag('股票--估值')).toBe('股票-估值');
});

test('normalizeTags 整体归一化', () => {
  const t = normalizeTags({
    primary: '产品 / Dashboard',
    secondary: ['UI 重构'],
    scores: { '产品 / Dashboard': 0.8, 'UI 重构': 0.5 },
  });
  expect(t.primary).toBe('产品-Dashboard');
  expect(t.secondary).toEqual(['UI-重构']);
  expect(t.scores).toEqual({ '产品-Dashboard': 0.8, 'UI-重构': 0.5 });
});
```

**Step 3: 跑测试**

```bash
bun test electron/main/services/memory/smart-category-engine.test.ts
```

**Step 4: Commit**

```
feat(smart-category): 决策引擎纯函数（Step A 匹配 + Step C 候选 + 归一化）
```

---

## Phase 6 — categorize-prompt 提示词模板

**Files:**
- Create: `electron/main/services/memory/categorize-prompt.ts`
- Create: `electron/main/services/memory/categorize-prompt.test.ts`

**Step 1: 写模板模块**

仿 `digest-prompt.ts` 风格。完整代码：

```ts
import fs from 'node:fs/promises';
import path from 'node:path';
import { getConfigDir } from '../../utils/paths.js';

export const DEFAULT_CATEGORIZE_PROMPT = `# 智能分类决策

你是「对话智能分类师」。每次新摘要卡产生后，由代码层先做纯阈值匹配；只有完全没匹配上才会调你。你的任务：给这次新摘要卡决定**归入哪个分类**（或新建一个）。

## 工具

- ListCategories：读取当前工作区所有现有分类（含 name、anchorTags、样例会话标题）
- SaveCategory：选择动作并保存
  - 动作 1: JOIN_EXISTING { categoryId, addAnchorTags?: string[] }
  - 动作 2: NEW_CATEGORY { name, anchorTags, redistribute?: [{conversationId, moveToCategoryId}] }

## 输入

你会收到：
1. 新摘要卡的 overview + tags（primary / secondary / scores）
2. 现有所有分类的快照（来自 ListCategories）
3. 候选迁移名单（仅在你可能选 NEW_CATEGORY 时由代码提前召回 ≤10 条邻近老分类里的会话，含标题/标签/在原分类的适配度分）

## 决策原则（按优先级）

1. **分类宁可宽不要窄**。新摘要卡能与任何现有分类有合理语义关联 → JOIN_EXISTING。
2. **仅当与所有现有分类语义距离都明显较远**时 → NEW_CATEGORY。
3. JOIN_EXISTING 时，新标签若语义贴近且能丰富分类画像 → 加进 addAnchorTags；若只是边角、加进去会稀释 → 不加。
4. NEW_CATEGORY 时，整理候选只移动「明显更适合新分类」的，**不为对称/平衡/清空而强行迁移** —— 宁可少动。
5. **已达上限**（默认 10 个）则禁止 NEW_CATEGORY，必须 JOIN。

## 命名规范

- 分类名为短词组（2–6 字），描述主题，不带前缀。例："产品设计"、"代码优化"、"股票分析"。
- 不要用情绪/形容词命名（避免"重要"、"杂项"、"其他"）。

## 输出

只调用一次 SaveCategory，不要重复调用。
`;

export async function getCategorizePromptPath(): Promise<string> {
  return path.join(await getConfigDir(), 'categorize-prompt.md');
}

export async function loadCategorizePrompt(): Promise<string> {
  const p = await getCategorizePromptPath();
  try {
    return await fs.readFile(p, 'utf-8');
  } catch {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, DEFAULT_CATEGORIZE_PROMPT, 'utf-8');
    return DEFAULT_CATEGORIZE_PROMPT;
  }
}

export async function saveCategorizePrompt(content: string): Promise<void> {
  const p = await getCategorizePromptPath();
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, content, 'utf-8');
}
```

> `getConfigDir` 的具体路径以 `digest-prompt.ts` 当前的引用为准（可能在 `../../utils/paths.js` 或 `../../config.js`）；按 digest-prompt.ts 的实际 import 跟随。

**Step 2: 测试**

```ts
import { test, expect } from 'bun:test';
import { DEFAULT_CATEGORIZE_PROMPT } from './categorize-prompt.ts';

test('默认提示词包含决策原则与工具说明', () => {
  expect(DEFAULT_CATEGORIZE_PROMPT).toContain('JOIN_EXISTING');
  expect(DEFAULT_CATEGORIZE_PROMPT).toContain('NEW_CATEGORY');
  expect(DEFAULT_CATEGORIZE_PROMPT).toContain('分类宁可宽不要窄');
  expect(DEFAULT_CATEGORIZE_PROMPT).toContain('已达上限');
});
```

**Step 3: 跑测试**

```bash
bun test electron/main/services/memory/categorize-prompt.test.ts
```

**Step 4: Commit**

```
feat(smart-category): 决策提示词模板与读写
```

---

## Phase 7 — category-tools MCP server

**Files:**
- Create: `electron/main/agents/tools/category-tools.ts`
- Modify: `electron/main/agents/tools/tool-registry.ts`（注册 dogear-smart-category server）

**Step 1: 写 MCP server**

仿 `digest-tools.ts` 风格。三个工具：

- `ListCategories(workspaceId)` → 返回当前工作区所有分类（name / anchorTags / 样例 3 个会话标题，从 conversations 索引取）
- `SaveCategory(workspaceId, conversationId, action)`：
  - action.type = 'JOIN_EXISTING' → 把 conversationId push 到指定分类；可选 addAnchorTags 合并去重
  - action.type = 'NEW_CATEGORY' → 新建分类（检查上限）+ push conversationId；redistribute 数组里的每条迁移按 (conversationId, moveToCategoryId) 处理（先从原分类移除，再 push 到新分类）
  - 所有动作都 append 一条 CategorizeDecisionLog（含 reason 字段，agent 用提示词鼓励填写）

代码骨架：

```ts
import { z } from 'zod';
import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { readIndex, writeIndex, pushConversation, appendDecision, newCategory } from '../../services/memory/smart-category-store.js';
import { getConversationsByIds } from '../../services/conversation-service.js';
import { readSettings } from '../../services/settings-service.js';

const listCategoriesArgs = z.object({ workspaceId: z.string() });

const saveCategoryArgs = z.object({
  workspaceId: z.string(),
  conversationId: z.string(),
  action: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('JOIN_EXISTING'),
      categoryId: z.string(),
      addAnchorTags: z.array(z.string()).optional(),
      reason: z.string().optional(),
    }),
    z.object({
      type: z.literal('NEW_CATEGORY'),
      name: z.string().min(1).max(20),
      anchorTags: z.array(z.string()).min(1),
      redistribute: z.array(z.object({
        conversationId: z.string(),
        moveToCategoryId: z.string(),  // 新分类 id 在工具内部生成，agent 用 "__NEW__" 占位
      })).optional(),
      reason: z.string().optional(),
    }),
  ]),
});

export const categoryTools = createSdkMcpServer({
  name: 'dogear-smart-category',
  version: '0.1.0',
  tools: [
    tool('ListCategories', '读取当前工作区的智能分类列表（含名称、anchorTags、样例会话标题）', listCategoriesArgs, async (args) => {
      const idx = await readIndex(args.workspaceId);
      const enriched = await Promise.all(idx.categories.map(async (c) => {
        const sampleIds = c.conversationIds.slice(-3);
        const samples = await getConversationsByIds(sampleIds);
        return {
          id: c.id,
          name: c.name,
          anchorTags: c.anchorTags,
          conversationCount: c.conversationIds.length,
          sampleTitles: samples.map((s) => s.title),
        };
      }));
      const settings = await readSettings();
      const maxCategories = settings.smartCategory?.maxCategories ?? 10;
      return { content: [{ type: 'text', text: JSON.stringify({ categories: enriched, atLimit: enriched.length >= maxCategories, maxCategories }, null, 2) }] };
    }),

    tool('SaveCategory', '保存分类决策（JOIN_EXISTING 或 NEW_CATEGORY）', saveCategoryArgs, async (args) => {
      let idx = await readIndex(args.workspaceId);
      const settings = await readSettings();
      const maxCategories = settings.smartCategory?.maxCategories ?? 10;

      if (args.action.type === 'JOIN_EXISTING') {
        const cat = idx.categories.find((c) => c.id === args.action.categoryId);
        if (!cat) return { content: [{ type: 'text', text: `Error: category ${args.action.categoryId} not found` }], isError: true };
        const updated = pushConversation(cat, args.conversationId);
        const addTags = args.action.addAnchorTags ?? [];
        updated.anchorTags = [...new Set([...updated.anchorTags, ...addTags])];
        idx.categories = idx.categories.map((c) => (c.id === cat.id ? updated : c));
        idx = appendDecision(idx, { time: new Date().toISOString(), conversationId: args.conversationId, decision: 'join', reason: args.action.reason });
      } else {
        if (idx.categories.length >= maxCategories) {
          return { content: [{ type: 'text', text: `Error: 已达分类上限 ${maxCategories}，必须 JOIN_EXISTING` }], isError: true };
        }
        const cat = newCategory(args.action.name, args.action.anchorTags);
        cat.conversationIds = [args.conversationId];
        idx.categories.push(cat);

        // 处理 redistribute
        for (const m of args.action.redistribute ?? []) {
          const targetId = m.moveToCategoryId === '__NEW__' ? cat.id : m.moveToCategoryId;
          // 先从所有分类移除
          for (const c of idx.categories) {
            if (c.id !== targetId) c.conversationIds = c.conversationIds.filter((x) => x !== m.conversationId);
          }
          // 再加到目标分类
          const target = idx.categories.find((c) => c.id === targetId);
          if (target && !target.conversationIds.includes(m.conversationId)) target.conversationIds.push(m.conversationId);
        }
        idx = appendDecision(idx, { time: new Date().toISOString(), conversationId: args.conversationId, decision: 'new', reason: args.action.reason });
      }

      await writeIndex(args.workspaceId, idx);
      return { content: [{ type: 'text', text: 'OK' }] };
    }),
  ],
});
```

> 若 `getConversationsByIds` 不存在则在 `conversation-service.ts` 里补一个简单版。

**Step 2: 在 tool-registry.ts 注册**

仿 digest-tools 的注册方式，把 `categoryTools` 加进 builtin MCP servers 列表。

**Step 3: 编译验证**

```bash
bun run build:electron
```

**Step 4: Commit**

```
feat(smart-category): MCP 工具 server（ListCategories / SaveCategory）
```

---

## Phase 8 — CATEGORIZE_SESSION 任务类型 + agent-worker handler

**Files:**
- Modify: `electron/main/agents/task-types.ts`（加任务类型与 payload 定义）
- Modify: `electron/main/agents/agent-worker.ts`（加 handler）

**Step 1: task-types.ts 加类型**

```ts
export type TaskType = 'SUMMARIZE' | 'CHAT_SESSION' | 'PARSE_ARTICLE' | 'DIGEST_SESSION' | 'REVIEW_SESSION' | 'CATEGORIZE_SESSION';

export interface CategorizeSessionPayload {
  workspaceId: string;
  conversationId: string;
  digestPath: string;          // 用于 worker 读取摘要卡（含 tags）
  mode: 'incremental' | 'full-rebuild';
  // full-rebuild 时一次性给所有摘要卡，由 worker 串行处理
}
```

**Step 2: agent-worker.ts 加 handler**

新增方法 `handleCategorizeSessionTask(payload)`：

1. 读 settings：拿 `categorizeProfileId`（缺省回退 activeProfileId） + `categorizeModelTier`（默认 haiku） + `smartCategory.threshold`
2. 读摘要卡（incremental 模式）拿 tags
3. 先做 **Step A 纯函数匹配**：
   ```ts
   const matches = matchByThreshold(tags, idx.categories, threshold);
   if (matches.length > 0) {
     // 命中：直接 push 到所有命中分类，记 'match'，结束
     for (const m of matches) {
       const cat = idx.categories.find(c => c.id === m.categoryId)!;
       idx.categories = idx.categories.map(c => c.id === cat.id ? pushConversation(cat, conversationId) : c);
     }
     idx = appendDecision(idx, { time, conversationId, decision: 'match' });
     await writeIndex(workspaceId, idx);
     return;
   }
   ```
4. 无匹配 → 上 LLM：
   - 重建 env（按 categorizeProfileId 取 profile，缺省回退；缺凭证返回明确 error）
   - haiku 档不传 effort
   - 接 AbortController
   - prompt = `loadCategorizePrompt()` + 当前会话信息（overview + tags）+ 候选迁移名单（用 pickRedistributeCandidates，再补每个候选的 title + tags）
   - tools = 仅 `dogear-smart-category` MCP server
   - 一次 query 完成

5. full-rebuild 模式：
   - 清空 `smart-categories.json`
   - 读所有摘要卡（按 createdAt 升序）
   - 串行对每张走上面同样的流程；前面写入的分类自然成为后续的"现有分类"
   - 注意：所有摘要卡共享同一次 LLM 调用比较省，但实现复杂。一期先用「逐张走相同流程」，性能可接受（一个工作区一般 < 100 张）

**Step 3: 编译验证**

```bash
bun run build:electron
```

**Step 4: Commit**

```
feat(smart-category): CATEGORIZE_SESSION 任务类型与 worker handler
```

---

## Phase 9 — category-trigger（编排 + 活动采集）

**Files:**
- Create: `electron/main/services/memory/category-trigger.ts`
- Create: `electron/main/services/memory/category-trigger.test.ts`

**Step 1: 写 trigger 模块**

仿 `digest-trigger.ts` 风格：
- 串行队列（并发 1）
- in-flight 去重（同一 conversationId 不重复入队）
- 活动采集：current / queueDepth / recent（环形 ≤ 10）/ lastScan
- 暴露：
  - `triggerCategorize(workspaceId, conversationId, digestPath)`：入单条
  - `triggerFullRebuild(workspaceId)`：清空索引并入"全量"任务
  - `getActivity(workspaceId)`：返回活动状态
  - `cancelCurrent(workspaceId)`：取消正在跑的 worker 任务
  - `classifyOutcome(result)`：把 worker 结果分类为 match / join / new / error

**Step 2: 测试（仅纯函数部分）**

测 `classifyOutcome` 与活动环形截断。

**Step 3: 跑测试**

```bash
bun test electron/main/services/memory/category-trigger.test.ts
```

**Step 4: Commit**

```
feat(smart-category): trigger 编排与活动采集
```

---

## Phase 10 — 串联 DigestSession → CategorizeSession

**Files:**
- Modify: `electron/main/services/memory/digest-trigger.ts`（任务成功后串联触发 categorize）

**Step 1: 在 digest-trigger 任务完成回调里加触发**

伪代码：

```ts
// digest-trigger 任务执行成功 → 拿到 digestPath + conversationId
// 检查 settings.smartCategory.enabled
const settings = await readSettings();
if (settings.smartCategory?.enabled !== false) {
  await triggerCategorize(workspaceId, conversationId, digestPath);
}
```

> 注意：digest 失败时不触发 categorize；digest 成功但摘要卡里没 tags（旧逻辑兜底）也不触发 categorize（worker 内会再次校验，但 trigger 层先 short-circuit 省一次入队）。

**Step 2: 编译验证 + Commit**

```bash
bun run build:electron
```

```
feat(smart-category): DigestSession 成功后串联触发 CategorizeSession
```

---

## Phase 11 — 手动文件夹结构语义调整 + 散落迁移

**Files:**
- Modify: `electron/main/services/workspace-json-service.ts`（启动时跑一次 `children[__root__]` 散落清理）
- Modify: `electron/main/tipc/conversations.ts`（加 IPC：`addToFolder` / `removeFromFolder` / `moveToFolder`，允许同一 conversationId 在多个 folder 的 children 里）
- Modify: `electron/main/services/conversation-service.ts`（去掉文件夹内 conversationId 去重的硬约束）

**Step 1: 迁移脚本**

在 `workspace-json-service.ts` 启动时（或首次 `getConversationTree` 调用时），扫每个工作区的对话树：

```ts
async function migrateScatterConversations(wsId: string) {
  const tree = await readConversationTree(wsId);
  const rootChildren = tree.children['__root__'] ?? [];
  const folderIds = new Set(Object.keys(tree.folders));
  const cleaned = rootChildren.filter((id) => folderIds.has(id));
  if (cleaned.length === rootChildren.length) return; // 没有散落
  tree.children['__root__'] = cleaned;
  await writeConversationTree(wsId, tree);
}
```

幂等：跑多次也不会破坏。

**Step 2: IPC 新增/调整**

- `addConversationToFolder(workspaceId, conversationId, folderId)`：把 conversationId 加到 `children[folderId]`（去重）
- `removeConversationFromFolder(workspaceId, conversationId, folderId)`：从 `children[folderId]` 移除（不动其他 folder）
- `moveConversationBetweenFolders(workspaceId, conversationId, fromFolderId, toFolderId)`：从 from 移除 + 加到 to

**Step 3: 渲染过滤归档**

在 `getConversationTree` 输出前，扫所有 children 数组，过滤掉 `archived_at != null` 的会话 id；归档节点反向只列归档会话。注意 SmartCategory.conversationIds 也要在 IPC `getCategories` 输出时同样过滤。

**Step 4: 编译 + Commit**

```bash
bun run build:electron
```

```
refactor(conversations): 手动文件夹支持多引用 + 散落自动迁移到智能区
```

---

## Phase 12 — IPC 路由

**Files:**
- Create: `electron/main/tipc/category.ts`
- Modify: `electron/main/tipc/index.ts`（注册新路由）
- Modify: `electron/main/tipc/renderer-handlers.ts`（如需新增事件，例如 `categoriesUpdated`）

**Step 1: 写 IPC 路由**

仿 `digest.ts` / `review.ts` 风格，提供：

```ts
getCategories({ workspaceId })            // 读 smart-categories.json，过滤归档
triggerCategorize({ workspaceId, conversationId, digestPath })
triggerFullRebuild({ workspaceId })       // 清空 + 全量
cancelCategorize({ workspaceId })
getCategorizeActivity({ workspaceId })
getCategorizePrompt() / setCategorizePrompt({ content })
getCategorizeProfileId() / setCategorizeProfileId({ profileId })
getCategorizeModelTier() / setCategorizeModelTier({ tier })
getSmartCategorySettings() / setSmartCategorySettings({ enabled?, threshold?, maxCategories? })
```

**Step 2: 注册事件**

`renderer-handlers.ts` 加 `categoriesUpdated(workspaceId)`，每次 trigger 完成后 worker 发出，前端 store 监听刷新。

**Step 3: 编译 + Commit**

```bash
bun run build:electron
```

```
feat(smart-category): tipc 路由
```

---

## Phase 13 — 前端 smart-category-store + 数据流接入

**Files:**
- Create: `stores/smart-category-store.ts`
- Modify: `lib/events.ts`（订阅 `categoriesUpdated`）

**Step 1: 写 store**

```ts
import { create } from 'zustand';
import { client } from '@/lib/client';
import type { SmartCategory } from '@/types/smart-category';

interface SmartCategoryStore {
  categories: SmartCategory[];
  loading: boolean;
  activity: { current?: string; queueDepth: number; recent: any[] } | null;
  load: (workspaceId: string) => Promise<void>;
  triggerFullRebuild: (workspaceId: string) => Promise<void>;
  cancel: (workspaceId: string) => Promise<void>;
  refreshActivity: (workspaceId: string) => Promise<void>;
}

export const useSmartCategoryStore = create<SmartCategoryStore>((set) => ({
  categories: [],
  loading: false,
  activity: null,
  load: async (workspaceId) => {
    set({ loading: true });
    const r = await client.getCategories({ workspaceId });
    set({ categories: r.categories, loading: false });
  },
  triggerFullRebuild: async (workspaceId) => {
    await client.triggerFullRebuild({ workspaceId });
  },
  cancel: async (workspaceId) => {
    await client.cancelCategorize({ workspaceId });
  },
  refreshActivity: async (workspaceId) => {
    const a = await client.getCategorizeActivity({ workspaceId });
    set({ activity: a });
  },
}));
```

**Step 2: 订阅事件**

`lib/events.ts` 里订阅 `categoriesUpdated`，触发 `useSmartCategoryStore.getState().load(currentWorkspaceId)`。

**Step 3: Commit**

```
feat(smart-category): 前端 store 与事件接入
```

---

## Phase 14 — 前端 ConversationList 重构（拆子组件）

**Files:**
- Modify: `components/ConversationList.tsx`（拆分主体）
- Create: `components/conversation-list/ManualSection.tsx`
- Create: `components/conversation-list/SmartSection.tsx`
- Create: `components/conversation-list/TimeSection.tsx`
- Create: `components/conversation-list/ArchiveSection.tsx`
- Create: `components/conversation-list/ViewTabs.tsx`（智能 / 时间切换）
- Create: `components/conversation-list/RecentVirtualGroup.tsx`（5 天虚拟分组）
- Create: `components/conversation-list/utils.ts`（共享：openOrFocusTab、appearance counter 等）

**Step 1: 抽出 ManualSection**

- 只渲染 `children[__root__]` 里的 folderId 节点（迁移已保证只有文件夹）
- 文件夹下展开仍用 headless-tree
- 零文件夹时只显示「＋ 新建文件夹」按钮
- 右键菜单：手动文件夹内会话 = 移动到文件夹 ▸ + 从文件夹移除 + 既有项

**Step 2: 抽出 SmartSection**

- 顶部「近期（5 天内，X 个）」分组：跨整个 conversations 列表筛 `created_at > now - 5d && !archived`
- 然后按 `smartCategory.categories` 渲染分类节点（按 `conversationIds.length` 倒序、空分类隐藏）
- 智能区会话无右键编辑能力，只有「添加到文件夹 ▸」+ 既有项（分叉/归档/重命名）
- 角标 `⟂N`：用 `utils.countAppearances(conversationId)` 算（手动 folder 数 + 智能分类数 - 1），N≥1 显示，N≥5 变橙

**Step 3: 抽出 TimeSection**

- 同 SmartSection 顶部「近期」
- 然后两组：「30 天内」、「更早」
- 全量会话（含未分类的）

**Step 4: 抽出 ArchiveSection**

- 列归档会话（archived_at != null）
- 右键：恢复 / 永久删除（既有）

**Step 5: ViewTabs**

- 智能 / 时间 二选一
- 默认智能、不持久化
- 用 local state（不进 store），切换时仅触发上方 SmartSection / TimeSection 渲染切换

**Step 6: 主体 ConversationList.tsx**

```
<ScrollArea>
  <ManualSection />
  <ViewTabs value={view} onChange={setView} />
  {view === 'smart' ? <SmartSection /> : <TimeSection />}
  <ArchiveSection />
</ScrollArea>
```

**Step 7: 验证**

```bash
bun run dev
```

手测：
- 默认进入显示智能视图
- 切到时间视图能看到全量
- 同一会话在手动文件夹 + 智能分类里都有，⟂N 角标正确
- 点任一节点都开同一 tab

**Step 8: Commit**

```
feat(conversation-list): 拆分四段结构 + 智能/时间视图切换
```

---

## Phase 15 — Tab 唯一性 + 双层高亮

**Files:**
- Modify: `stores/session-store.ts`（确保 `openOrFocusTab` 已经按 conversationId 收敛——若现有就是这样则免改）
- Modify: `components/conversation-list/utils.ts`（暴露 hook `useNodeHighlight(conversationId)`）
- Modify: 上述四个 Section 组件（用 hook 给节点加 className）

**Step 1: 确认 openOrFocusTab 行为**

读 `session-store.ts` 的 tabs 逻辑，确认 key = conversationId。若已有则免改；若按 `tabId` 之类的唯一 id 则改造为按 conversationId 命中。

**Step 2: 实现 useNodeHighlight hook**

```ts
export function useNodeHighlight(conversationId: string): { isSelected: boolean; isOpen: boolean } {
  const activeTabId = useSessionStore((s) => s.activeTabId);
  const tabs = useSessionStore((s) => s.tabs);
  const isOpen = tabs.some((t) => t.conversationId === conversationId);
  const isSelected = activeTabId !== HOME_TAB_ID && tabs.find((t) => t.id === activeTabId)?.conversationId === conversationId;
  return { isSelected, isOpen };
}
```

**Step 3: Section 里应用样式**

每个会话节点：
- `isSelected` → 深色背景（`bg-accent`）
- `isOpen && !isSelected` → 淡色背景（`bg-muted`）
- 否则无背景

注意：`isSelected` 只对你点击的那一处生效（视觉上有"唯一焦点"）；其他指向同一 tab 的节点只显示 `isOpen` 的淡色。这一点的实现是：点击节点时把"哪一个节点被点击"记到一个**本地 state（Section 内或共享 utils）**，不进 session-store——因为它是"视觉聚焦"而非"业务选中"。

替代方案：直接用 `activeTabId === tab.id` 判定 isSelected，但因为 tab 是按 conversationId 唯一，多节点都会 isSelected=true。这就回到"双层高亮分不清"的问题。所以需要"最后点击的节点 id"这个本地状态。

> 实施者注意：节点 id 在 headless-tree 里是稳定的（如 `conv:xxxx::manual::folderA` 或 `conv:xxxx::smart::cat_yyy`），可以唯一标识"哪一处"。把"最后聚焦的节点 id"放到 SessionStore 里也行（叫 `lastFocusedNodeId`），但只用作 UI 状态，跟 tab 业务解耦。建议放 SessionStore，便于跨 Section 共享。

**Step 4: 验证**

手测：
- 点手动文件夹的会话节点 → 该节点深色，智能区里的"同一会话"节点淡色
- 切到智能区点同一会话节点 → 智能区节点深色，手动区淡色
- tab 没切换，因为是同一 conversationId

**Step 5: Commit**

```
feat(conversation-list): tab 唯一性 + 选中/已打开双层高亮
```

---

## Phase 16 — 右键菜单分流 + 角标

**Files:**
- Modify: 上述 Section 组件中的会话节点
- Create: `components/conversation-list/AppearanceBadge.tsx`（⟂N 角标）
- Create: `components/conversation-list/AddToFolderMenu.tsx`（多选子菜单）
- Create: `components/conversation-list/MoveToFolderMenu.tsx`（单选子菜单）

**Step 1: AppearanceBadge**

```tsx
export function AppearanceBadge({ count }: { count: number }) {
  if (count < 1) return null;
  const orange = count >= 5;
  return (
    <span className={cn('ml-1 text-[10px] px-1 rounded', orange ? 'text-orange-500 bg-orange-500/10' : 'text-muted-foreground bg-muted/40')}
          title={`此会话还出现在 ${count} 处`}>
      ⟂{count}
    </span>
  );
}
```

每个 Section 里渲染会话节点时用 `useAppearanceCount(conversationId)` 算 count 并塞角标。

**Step 2: AddToFolderMenu**

多选 ContextMenuCheckboxItem 列表，遍历当前工作区所有文件夹；勾选状态来自"该 conversationId 是否在该 folder 的 children 里"。toggle 时调对应 IPC。

**Step 3: MoveToFolderMenu**

单选子菜单。仅在手动文件夹内会话节点出现。

**Step 4: 应用到 Section**

- 智能区 / 时间区会话节点 ContextMenu = AddToFolderMenu + 分叉 + 归档 + 重命名
- 手动文件夹内会话节点 ContextMenu = MoveToFolderMenu + 从文件夹移除 + 分叉 + 归档 + 重命名
- 智能分类节点本身：无 ContextMenu（只读）

**Step 5: Commit**

```
feat(conversation-list): ⟂N 角标 + 添加/移动到文件夹子菜单
```

---

## Phase 17 — 设置页 UI

**Files:**
- Modify: `app/settings/DigestTab.tsx`（在"会话摘要卡"Tab 里追加智能分类分节）
  - 若文件不存在则按现有的 settings tab 命名结构创建
- 复用 digest/review 已有的模型方案选择控件、提示词编辑器、活动状态组件（提取到 `app/settings/_shared/` 若尚未提取）

**Step 1: 分节内容**

在「会话摘要卡」Tab 末尾追加 `<div>智能分类</div>` 分节，包含：

- **总开关** Switch（`smartCategory.enabled`）
- **匹配阈值** Slider（0.3–0.8，默认 0.5）
- **分类数上限** NumberInput（5–15，默认 10，先锁死禁用）
- **模型方案** Select（profiles 下拉）+ **档位** Select（haiku/sonnet/opus）
- **提示词** Textarea（categorize-prompt）+ 「恢复默认」按钮
- **批量重新提炼** Button（已有 digest 重新提炼基础上加批量；按钮里 confirm）
- **立即重跑全部分类** Button（confirm 提示 "将清空现有分类并重新决策所有摘要卡"）
- **分类活动状态** —— 当前任务名 / 队列深度 / 最近 10 条结果；取消按钮

**Step 2: 验证**

```bash
bun run dev
```

手测：
- 关闭开关 → 新摘要卡产生时智能区不再更新
- 调阈值 0.3 → 边缘会话能被归类
- 触发"立即重跑" → 看到活动列表跑起来、几秒内分类重建完毕

**Step 3: Commit**

```
feat(settings): 智能分类设置分节
```

---

## Phase 18 — 文档同步

**Files:**
- Modify: `.claude/rules/codebase-map.md`（新增 smart-category 模块条目 + IPC + 任务类型 + 数据存储路径）
- Modify: `CLAUDE.md`（若有相关章节，无则免改）

**Step 1: codebase-map 更新清单**

在「Agent 框架」段加：
- `task-types.ts` 加 `CATEGORIZE_SESSION`
- `tools/category-tools.ts` —— dogear-smart-category MCP server

在「业务服务」段加：
- `memory/smart-category-store.ts`
- `memory/smart-category-engine.ts`
- `memory/categorize-prompt.ts`
- `memory/category-trigger.ts`

在「IPC 路由」段加：
- `category.ts` — 智能分类（getCategories / triggerCategorize / triggerFullRebuild / cancel / activity / prompt / profile / tier / 设置）

在「数据存储」段加：
- `workspaces/{workspaceId}/smart-categories.json` — 智能分类索引
- `categorize-prompt.md` — 智能分类提示词模板（全局单份）

在「关键数据流」段加：
- **会话智能分类链路**：DigestSession 成功 → category-trigger 串行起 CATEGORIZE_SESSION → agent-worker.handleCategorizeSessionTask：Step A 纯阈值匹配（0 LLM），无匹配则上 LLM（按 categorizeProfileId+tier 重建 env，可取消）→ agent 自调 category-tools（ListCategories / SaveCategory）→ smart-categories.json 落 `<configDir>/workspaces/<wsId>/`

**Step 2: Commit**

```
docs(map): 智能分类模块索引
```

---

## 完工核对清单

实施完所有 Phase 后，确认以下行为符合设计：

- [ ] 新会话产生摘要卡时 tags 字段自动填充
- [ ] 新摘要卡能被自动归入现有分类（阈值匹配命中场景）
- [ ] 新摘要卡无匹配时触发一次 LLM，决策 JOIN/NEW，必要时附带 redistribute
- [ ] 分类达上限（10）后禁止新建，只能 JOIN
- [ ] 同一会话出现在手动文件夹 + 智能分类时，⟂N 角标显示正确
- [ ] 点任何位置的同一会话都开同一 tab
- [ ] 已打开 tab 的会话在树里多处显示淡色，被你点击那处显示深色
- [ ] 智能/时间视图切换正常，默认进入是智能
- [ ] 「近期」5 天虚拟分组在两种视图里都显示
- [ ] 归档后会话从所有位置消失，恢复后自动复原
- [ ] 设置页能调阈值、切方案/档位、改提示词、立即重跑
- [ ] 散落会话自动从手动区根迁移到智能/时间区，不丢失
- [ ] 关闭智能分类总开关后回退到时间视图为主、智能区为空（或隐藏）
