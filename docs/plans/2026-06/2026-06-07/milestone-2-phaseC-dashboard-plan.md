# Phase C 首页仪表盘 + 后台复盘流水线 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把复盘升级为镜像 digest 的后台独立 agent（跟在 digest 后跑、独立 sonnet 档），并升级 `EmptyFocusState` 为首页仪表盘（参谋区渲染复盘卡 + 自由 markdown 速记板）。

**Architecture:** 后端新增 `REVIEW_SESSION` 任务类型 + `review-scanner`（脏检查）+ `review-trigger`（串行队列编排）+ worker headless query（复用 Phase B 的 `dogear-memory-review` 五工具与复盘提示词），编排上 digest idle 后触发复盘。前端把 `EmptyFocusState` 换成 `Dashboard`，经 tipc 读复盘卡与速记。全部 IO 走 `fs.promises`、IPC 走 tipc、TDD（bun:test）、小步提交。

**Tech Stack:** Electron + TypeScript（主进程 tsconfig.electron.json）、@anthropic-ai/claude-agent-sdk、@egoist/tipc、Zustand、React 19、shadcn/ui、bun:test。

**设计依据：** `milestone-2-phaseC-dashboard-design.md`（同目录）。

**通用约定：**
- 测试：`bun:test`，import 带 `.ts` 扩展；跑单文件 `bun test <path>.test.ts`。
- 主进程改完需 `bun run build:electron` 编译验证。
- 提交带 `Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>`，用 `rtk git`。
- 镜像类任务（trigger/worker）以现有 digest 对应文件为蓝本，逐字段对照改名，不要凭空发挥。

---

## Task 1：设置类型加复盘模型档

**Files:**
- Modify: `electron/main/services/settings-types.ts`（在 `ai` 的 `digestModelTier` / `digestProfileId` 附近）
- Modify: `types/settings.ts`（镜像同字段 + 注释）

**Step 1: 加字段**

在两处 `ai` 配置接口里、`digestProfileId` 之后加：

```ts
/** 跨会话复盘（REVIEW_SESSION）使用的模型档位。默认 sonnet */
reviewModelTier?: 'haiku' | 'sonnet' | 'opus';
/** 跨会话复盘使用的模型方案 id。缺省回退 activeProfileId */
reviewProfileId?: string;
```

**Step 2: 编译验证**

Run: `bun run build:electron`
Expected: 编译通过（仅加可选字段，无破坏）。

**Step 3: Commit**

```bash
rtk git add electron/main/services/settings-types.ts types/settings.ts
rtk git commit -m "feat(review): 设置类型加复盘模型档位与方案字段"
```

---

## Task 2：任务类型 REVIEW_SESSION

**Files:**
- Modify: `electron/main/agents/task-types.ts`

**Step 1: 加枚举与 payload**

`TaskType` 枚举里 `DIGEST_SESSION` 之后加：

```ts
  DIGEST_SESSION = 'digest_session', // 会话提炼（清洗 → 摘要卡）
  REVIEW_SESSION = 'review_session'  // 跨会话复盘（摘要卡 → 复盘卡）
```

在 `DigestSessionPayload` 之后加：

```ts
/**
 * 跨会话复盘任务负载
 * 运行时上下文（configDir/isPackaged/cliPath）由 Worker 实例字段提供，不放 payload
 */
export interface ReviewSessionPayload {
  workspaceId: string;   // 工作区 ID（读摘要卡 / 落复盘卡）
  workspacePath: string; // 工作区绝对路径（TraceSource 定位 JSONL 用）
  reviewModelTier?: 'haiku' | 'sonnet' | 'opus'; // 复盘模型档位（缺省读 settings）
}
```

**Step 2: 编译验证**

Run: `bun run build:electron`
Expected: 通过。

**Step 3: Commit**

```bash
rtk git add electron/main/agents/task-types.ts
rtk git commit -m "feat(review): 新增 REVIEW_SESSION 任务类型与 payload"
```

---

## Task 3：复盘提示词抽公共常量（review-prompt.ts）

**Files:**
- Create: `electron/main/services/memory/review-prompt.ts`
- Create: `electron/main/services/memory/review-prompt.test.ts`
- Modify: `electron/main/services/memory/review-skill-service.ts`（SKILL.md 改用公共常量）
- 参考蓝本：`electron/main/services/memory/digest-prompt.ts`

**Step 1: 写失败测试**

`review-prompt.test.ts`：

```ts
import { test, expect } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { loadReviewPrompt, saveReviewPrompt, DEFAULT_REVIEW_PROMPT } from './review-prompt.ts';

async function tmpDir() {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'review-prompt-'));
}

test('首次加载播种默认提示词', async () => {
  const dir = await tmpDir();
  const p = await loadReviewPrompt(dir);
  expect(p).toBe(DEFAULT_REVIEW_PROMPT);
  const onDisk = await fs.readFile(path.join(dir, 'review-prompt.md'), 'utf-8');
  expect(onDisk).toBe(DEFAULT_REVIEW_PROMPT);
});

test('save 后 load 往返一致', async () => {
  const dir = await tmpDir();
  await saveReviewPrompt(dir, '自定义复盘提示词');
  expect(await loadReviewPrompt(dir)).toBe('自定义复盘提示词');
});
```

**Step 2: 跑测试确认失败**

Run: `bun test electron/main/services/memory/review-prompt.test.ts`
Expected: FAIL（模块不存在）。

**Step 3: 实现 review-prompt.ts**

照 `digest-prompt.ts` 结构。`DEFAULT_REVIEW_PROMPT` 用现 `review-skill-service.ts` 里 SKILL.md 正文（"你在为这个工作区维护一张「复盘卡」…完成后简述…"那段，不含 frontmatter）。`loadReviewPrompt(configDir)`：读 `<configDir>/review-prompt.md`，ENOENT 时写入默认并返回。`saveReviewPrompt(configDir, prompt)`：写文件。

**Step 4: 跑测试确认通过**

Run: `bun test electron/main/services/memory/review-prompt.test.ts`
Expected: PASS（2 测试）。

**Step 5: 重构 review-skill-service.ts 共用常量**

把 `SKILL_MD` 改为由 frontmatter + `import { DEFAULT_REVIEW_PROMPT } from './review-prompt.js'` 拼成，正文不再硬编码重复。保持 `ensureReviewSkillInitialized` 幂等行为不变。

**Step 6: 编译 + 回归**

Run: `bun run build:electron && bun test electron/main/services/memory/`
Expected: 编译通过，memory 全套测试无回归。

**Step 7: Commit**

```bash
rtk git add electron/main/services/memory/review-prompt.ts electron/main/services/memory/review-prompt.test.ts electron/main/services/memory/review-skill-service.ts
rtk git commit -m "feat(review): 抽出复盘提示词公共常量，SKILL.md 与后台共用"
```

---

## Task 4：复盘脏检查（review-scanner.ts）

**Files:**
- Create: `electron/main/services/memory/review-scanner.ts`
- Create: `electron/main/services/memory/review-scanner.test.ts`
- 参考蓝本：`digest-scanner.ts`

**Step 1: 写失败测试**

`review-scanner.test.ts`：

```ts
import { test, expect } from 'bun:test';
import { isReviewStale } from './review-scanner.ts';
import type { ReviewCard } from './review-store.ts';

function card(reviewedAt: string): ReviewCard {
  return { reviewedAt, coveredCount: 1, items: [] };
}

test('无复盘卡 → 脏', () => {
  expect(isReviewStale(null, '2026-06-07T00:00:00Z')).toBe(true);
});

test('最新摘要卡晚于上次复盘 → 脏', () => {
  expect(isReviewStale(card('2026-06-06T00:00:00Z'), '2026-06-07T00:00:00Z')).toBe(true);
});

test('最新摘要卡不晚于上次复盘 → 跳过', () => {
  expect(isReviewStale(card('2026-06-07T00:00:00Z'), '2026-06-06T00:00:00Z')).toBe(false);
});

test('无摘要卡（latest 为 null）→ 跳过', () => {
  expect(isReviewStale(card('2026-06-07T00:00:00Z'), null)).toBe(false);
});
```

**Step 2: 跑测试确认失败**

Run: `bun test electron/main/services/memory/review-scanner.test.ts`
Expected: FAIL（模块不存在）。

**Step 3: 实现**

```ts
// 复盘脏检查：复盘卡 reviewedAt 与最新摘要卡 createdAt 比对
import * as workspaceService from '../workspace-json-service.js';
import { listDigests } from './digest-store.js';
import { readReview, type ReviewCard } from './review-store.js';

export interface StaleWorkspace {
  workspaceId: string;
  workspacePath: string;
}

/** 脏条件：无复盘卡 || 最新摘要卡晚于上次复盘（纯函数，可单测）。latest 为 null（无摘要卡）→ 不脏 */
export function isReviewStale(card: ReviewCard | null, latestDigestCreatedAt: string | null): boolean {
  if (!card) return latestDigestCreatedAt !== null ? true : true; // 无卡总是脏（即便没摘要卡，首跑也产空卡可省略——见下）
  if (!latestDigestCreatedAt) return false;
  return latestDigestCreatedAt > card.reviewedAt;
}

/** 遍历所有工作区，返回复盘卡过时的工作区 */
export async function findStaleWorkspaces(): Promise<StaleWorkspace[]> {
  const all = await workspaceService.getAll();
  const out: StaleWorkspace[] = [];
  for (const ws of all) {
    const digests = await listDigests(ws.id);
    if (!digests.length) continue; // 没摘要卡，无可复盘
    const latest = digests.reduce((m, d) => (d.createdAt > m ? d.createdAt : m), digests[0].createdAt);
    const card = await readReview(ws.id);
    if (isReviewStale(card, latest)) {
      out.push({ workspaceId: ws.id, workspacePath: ws.path });
    }
  }
  return out;
}
```

> 注意：`isReviewStale(null, ...)` 的两分支都返回 true，化简为 `if (!card) return true;`。实现时写成 `if (!card) return true;`，测试中"无卡 → 脏"仍通过。`findStaleWorkspaces` 已用 `digests.length` 守卫，无摘要卡的工作区不会进来。

**Step 4: 跑测试确认通过**

Run: `bun test electron/main/services/memory/review-scanner.test.ts`
Expected: PASS（4 测试）。

**Step 5: 编译验证**

Run: `bun run build:electron`
Expected: 通过。

**Step 6: Commit**

```bash
rtk git add electron/main/services/memory/review-scanner.ts electron/main/services/memory/review-scanner.test.ts
rtk git commit -m "feat(review): 复盘脏检查 isReviewStale + findStaleWorkspaces"
```

---

## Task 5：digest-trigger 加 whenDigestIdle

**Files:**
- Modify: `electron/main/services/memory/digest-trigger.ts`
- Modify: `electron/main/services/memory/digest-trigger.test.ts`（加 idle resolve 测试）

**Step 1: 写失败测试**

在 `digest-trigger.test.ts` 末尾加（若文件用 bun:test）：

```ts
import { whenDigestIdle } from './digest-trigger.ts';

test('队列空闲时 whenDigestIdle 立即 resolve', async () => {
  await whenDigestIdle(); // 无任务时应立即完成，不挂起
  expect(true).toBe(true);
});
```

**Step 2: 跑测试确认失败**

Run: `bun test electron/main/services/memory/digest-trigger.test.ts`
Expected: FAIL（`whenDigestIdle` 未导出）。

**Step 3: 实现 whenDigestIdle**

在 `digest-trigger.ts` 加：模块级 `const idleWaiters: Array<() => void> = [];`。在 `pump()` 的 `finally { pumping = false; }` 之后、队列确实空时，flush 所有 waiter：

```ts
export function whenDigestIdle(): Promise<void> {
  if (!pumping && queue.length === 0 && inFlight.size === 0) return Promise.resolve();
  return new Promise<void>((resolve) => idleWaiters.push(resolve));
}
```

在 `pump()` 的 `finally` 块（`pumping = false;` 之后）加：

```ts
  } finally {
    pumping = false;
    if (queue.length === 0 && inFlight.size === 0) {
      const waiters = idleWaiters.splice(0);
      for (const w of waiters) w();
    }
  }
```

**Step 4: 跑测试确认通过**

Run: `bun test electron/main/services/memory/digest-trigger.test.ts`
Expected: PASS（含原有 + 新增）。

**Step 5: Commit**

```bash
rtk git add electron/main/services/memory/digest-trigger.ts electron/main/services/memory/digest-trigger.test.ts
rtk git commit -m "feat(digest): digest-trigger 增加 whenDigestIdle 空闲信号"
```

---

## Task 6：review-tools 加 onSaved 回调

**Files:**
- Modify: `electron/main/agents/tools/review-tools.ts`
- 参考：`digest-tools.ts` 的 `createDigestTools(workspaceId, workspacePath, onSaved)`

**Step 1: 改签名**

`createReviewMcpServer(workspaceId, workspacePath, onSaved?: () => void)`。在 `SaveReviewCard` 的 `await saveReview(...)` 成功之后调用 `onSaved?.();`。

**Step 2: 确认对话内调用方仍兼容**

`query-based-session.ts:340` 调 `createReviewMcpServer(this.config.workspaceId!, this.config.workspacePath!)` 不传第三参——onSaved 可选，兼容。

**Step 3: 编译验证**

Run: `bun run build:electron`
Expected: 通过。

**Step 4: Commit**

```bash
rtk git add electron/main/agents/tools/review-tools.ts
rtk git commit -m "feat(review): createReviewMcpServer 增加 onSaved 回调"
```

---

## Task 7：复盘触发编排（review-trigger.ts）

**Files:**
- Create: `electron/main/services/memory/review-trigger.ts`
- Create: `electron/main/services/memory/review-trigger.test.ts`
- 参考蓝本：`digest-trigger.ts`（逐字段对照：DirtySession→StaleWorkspace，sdkSessionId→workspaceId 维度，DIGEST_SESSION→REVIEW_SESSION）

**Step 1: 写失败测试**

`review-trigger.test.ts`（测纯函数 classifyOutcome + 初始 activity）：

```ts
import { test, expect } from 'bun:test';
import { classifyReviewOutcome, getReviewActivity } from './review-trigger.ts';

test('error 优先', () => {
  expect(classifyReviewOutcome({ saved: true }, 'boom')).toBe('error');
  expect(classifyReviewOutcome({ error: 'x' })).toBe('error');
});
test('saved → saved', () => {
  expect(classifyReviewOutcome({ saved: true })).toBe('saved');
});
test('未保存 → no-card', () => {
  expect(classifyReviewOutcome({ saved: false })).toBe('no-card');
});
test('初始活动为空闲', () => {
  const a = getReviewActivity();
  expect(a.current).toBeNull();
  expect(a.queueDepth).toBe(0);
});
```

**Step 2: 跑测试确认失败**

Run: `bun test electron/main/services/memory/review-trigger.test.ts`
Expected: FAIL（模块不存在）。

**Step 3: 实现**

复制 `digest-trigger.ts` 改造：
- 队列元素类型 `StaleWorkspace`，去重 key = `workspaceId`。
- `classifyReviewOutcome(result, error)`：同 digest 逻辑。
- `ReviewActivity { current, queueDepth, recent, lastScan }`、`getReviewActivity()`。
- `enqueueReviews(items: StaleWorkspace[])` + 串行 `pump`。
- `runOne(w)`：构造 `AgentTask { type: REVIEW_SESSION, payload: { workspaceId, workspacePath } as ReviewSessionPayload }`，`getAgentManager().submitTask`，完成时 pushRecent。
- `triggerReviewScan()`：`findStaleWorkspaces()` → 入队 + 记 lastScan。
- `triggerReview(wsId, wsPath)`：单个入队（手动按钮用）。

**Step 4: 跑测试确认通过**

Run: `bun test electron/main/services/memory/review-trigger.test.ts`
Expected: PASS（4 测试）。

**Step 5: 编译验证**

Run: `bun run build:electron`
Expected: 通过。

**Step 6: Commit**

```bash
rtk git add electron/main/services/memory/review-trigger.ts electron/main/services/memory/review-trigger.test.ts
rtk git commit -m "feat(review): 复盘触发编排 review-trigger（串行队列 + 活动采集）"
```

---

## Task 8：worker 执行 handleReviewSessionTask

**Files:**
- Modify: `electron/main/agents/agent-worker.ts`（dispatch case + 新方法）
- 参考蓝本：同文件 `handleDigestSessionTask`（约 :555-651）

**Step 1: 加 dispatch 分支**

在 `handleDigestSessionTask` 的 case 旁加：

```ts
        case TaskType.REVIEW_SESSION:
          result = await this.handleReviewSessionTask(task, taskLogger);
          break;
```

**Step 2: 实现 handleReviewSessionTask**

复制 `handleDigestSessionTask`，改动点：
- payload 类型 `ReviewSessionPayload`，取 `workspaceId, workspacePath`。
- 方案：`reviewProfileId = appSettings.ai.reviewProfileId`；`reviewProfile = (reviewProfileId && profiles[reviewProfileId]) || activeProfile`；`isProfileComplete` 守卫。
- 档位：`tier = payload.reviewModelTier ?? appSettings.ai.reviewModelTier ?? 'sonnet'`。
- env：`ANTHROPIC_MODEL: tierMap[tier]`，effort 仅非 haiku 透传（sonnet 默认会传 effort）。
- tools：`createReviewMcpServer(workspaceId, workspacePath, () => { saved = true; })`，mcpServers `{ 'dogear-memory-review': server }`，allowedTools 五个 `mcp__dogear-memory-review__{ListDigests,ReadDigest,ReadReviewCard,TraceSource,SaveReviewCard}`。
- prompt：`loadReviewPrompt(this.configDir)`（复盘是工作区级，无需追加 sessionId；如需可附"当前工作区：<id>"，按开放问题 1 决定，先不加）。
- 返回 `{ workspaceId, saved, tier, profileName: reviewProfile.name }`。
- AbortController 接 cancel，同 digest。

**Step 3: 编译验证**

Run: `bun run build:electron`
Expected: 通过。

**Step 4: Commit**

```bash
rtk git add electron/main/agents/agent-worker.ts
rtk git commit -m "feat(review): worker 执行 handleReviewSessionTask（headless 复盘）"
```

---

## Task 9：触发点接线（index.ts）

**Files:**
- Modify: `electron/main/index.ts`（约 :428-447 digest 触发点）

**Step 1: 启动触发链**

把启动 `setTimeout`（:430）的 digest 之后接复盘：

```ts
  setTimeout(() => {
    void import('./services/memory/digest-trigger.js')
      .then(async (m) => {
        await m.triggerScanAll();
        await m.whenDigestIdle();
        const r = await import('./services/memory/review-trigger.js');
        await r.triggerReviewScan();
      })
      .catch((err) => console.error('启动会话提炼/复盘扫描失败:', err));
  }, 8000);
```

**Step 2: 夜间触发链**

夜间定时器（:438）的 digest 之后同样接 `whenDigestIdle → triggerReviewScan`。

**Step 3: 编译验证**

Run: `bun run build:electron`
Expected: 通过。

**Step 4: Commit**

```bash
rtk git add electron/main/index.ts
rtk git commit -m "feat(review): 启动/夜间触发点接复盘（digest idle 后跑）"
```

---

## Task 10：速记板存储（notes-store.ts）

**Files:**
- Create: `electron/main/services/memory/notes-store.ts`
- Create: `electron/main/services/memory/notes-store.test.ts`

**Step 1: 写失败测试**

```ts
import { test, expect } from 'bun:test';
import { serializeNoOp } from './notes-store.ts'; // 占位，见下；实际测 read/save 需 mock configDir
```

> notes-store 依赖 `getWorkspaceDataDir(wsId)`（来自 conversation-service，基于 configDir）。为可单测，把纯读写逻辑参数化：导出 `readNotesFrom(dir)` / `saveNotesTo(dir, content)`（纯 IO，吃绝对目录），再用 `readNotes(wsId)=readNotesFrom(getWorkspaceDataDir(wsId))` 包装。测试只测 `*From/*To`：

```ts
import { test, expect } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readNotesFrom, saveNotesTo } from './notes-store.ts';

test('空目录读 → 空串', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'notes-'));
  expect(await readNotesFrom(dir)).toBe('');
});

test('save 后 read 往返', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'notes-'));
  await saveNotesTo(dir, '# 速记\n买牛奶');
  expect(await readNotesFrom(dir)).toBe('# 速记\n买牛奶');
});
```

**Step 2: 跑测试确认失败**

Run: `bun test electron/main/services/memory/notes-store.test.ts`
Expected: FAIL（模块不存在）。

**Step 3: 实现**

```ts
// 工作区速记板存储（里程碑 2 Phase C），落 <configDir>/workspaces/<wsId>/notes.md
import fs from 'node:fs/promises';
import path from 'node:path';
import { getWorkspaceDataDir } from '../conversation-service.js';

export async function readNotesFrom(dir: string): Promise<string> {
  try {
    return await fs.readFile(path.join(dir, 'notes.md'), 'utf-8');
  } catch (err: any) {
    if (err?.code === 'ENOENT') return '';
    throw err;
  }
}

export async function saveNotesTo(dir: string, content: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'notes.md'), content, 'utf-8');
}

export const readNotes = (wsId: string) => readNotesFrom(getWorkspaceDataDir(wsId));
export const saveNotes = (wsId: string, content: string) => saveNotesTo(getWorkspaceDataDir(wsId), content);
```

**Step 4: 跑测试确认通过**

Run: `bun test electron/main/services/memory/notes-store.test.ts`
Expected: PASS（2 测试）。

**Step 5: Commit**

```bash
rtk git add electron/main/services/memory/notes-store.ts electron/main/services/memory/notes-store.test.ts
rtk git commit -m "feat(notes): 工作区速记板存储 notes-store"
```

---

## Task 11：复盘 IPC（tipc/review.ts）

**Files:**
- Create: `electron/main/tipc/review.ts`
- Modify: `electron/main/tipc/index.ts`（注册 reviewRouter）
- Modify: `types/electron-api.ts`（如有手工返回类型镜像则同步）
- 参考蓝本：`tipc/digest.ts`

**Step 1: 实现 review.ts**

镜像 digest.ts 的路由：
- `getReviewCard({ workspaceId })` → `readReview` → `{ card }`
- `triggerReview({ workspaceId, workspacePath })` → `(await import('../services/memory/review-trigger.js')).triggerReview(...)` → `{ success }`
- `getReviewActivity()` → `{ activity: getReviewActivity() }`
- `getReviewPrompt() / setReviewPrompt({ prompt })` → load/saveReviewPrompt(getConfigDir())
- `getReviewModelTier / setReviewModelTier({ tier })` → settings.ai.reviewModelTier（缺省 'sonnet'）
- `getReviewProfileId / setReviewProfileId({ profileId })` → settings.ai.reviewProfileId（缺省 activeProfileId）

**Step 2: 注册**

`tipc/index.ts` 聚合处加 `...reviewRouter`（照现有 digestRouter 注册方式）。

**Step 3: 编译验证**

Run: `bun run build:electron`
Expected: 通过。

**Step 4: Commit**

```bash
rtk git add electron/main/tipc/review.ts electron/main/tipc/index.ts types/electron-api.ts
rtk git commit -m "feat(review): 复盘 IPC（读卡/手动触发/活动/提示词/模型档）"
```

---

## Task 12：速记 IPC（tipc/notes.ts）

**Files:**
- Create: `electron/main/tipc/notes.ts`
- Modify: `electron/main/tipc/index.ts`

**Step 1: 实现**

```ts
import { tipc } from '@egoist/tipc/main';
import { readNotes, saveNotes } from '../services/memory/notes-store.js';
const t = tipc.create();
export const notesRouter = {
  getNotes: t.procedure.input<{ workspaceId: string }>().action(async ({ input }) => {
    try { return { content: await readNotes(input.workspaceId) }; }
    catch (e) { return { error: String(e) }; }
  }),
  saveNotes: t.procedure.input<{ workspaceId: string; content: string }>().action(async ({ input }) => {
    try { await saveNotes(input.workspaceId, input.content); return { success: true }; }
    catch (e) { return { error: String(e) }; }
  }),
};
```

**Step 2: 注册 + 编译**

`tipc/index.ts` 加 `...notesRouter`。Run: `bun run build:electron` → 通过。

**Step 3: Commit**

```bash
rtk git add electron/main/tipc/notes.ts electron/main/tipc/index.ts
rtk git commit -m "feat(notes): 速记 IPC（读/存）"
```

---

## Task 13：前端 dashboard-store

**Files:**
- Create: `stores/dashboard-store.ts`
- 参考：现有 stores 的 zustand 写法 + `lib/client.ts` 调用

**Step 1: 实现 store**

字段：`reviewCard | null`、`reviewActivity`、`notesContent`、`notesSaving`。
Actions：
- `loadReview(wsId)`：`client.getReviewCard` → set。
- `triggerReview(wsId, wsPath)`：`client.triggerReview` + 启动轮询 `getReviewActivity`，活动从"在跑"变"空闲"时 `loadReview` 刷新卡，停轮询。
- `loadNotes(wsId)`：`client.getNotes` → set notesContent。
- `setNotesLocal(content)`：仅置本地。
- `flushNotes(wsId)`：`client.saveNotes`（由组件防抖调用），置 notesSaving。

> 轮询用 `setInterval` 2s，组件卸载/活动空闲时清理。UI 编辑中的文本用组件内 state，store 只持已加载/已保存值。

**Step 2: 编译验证（前端）**

Run: `bun run build:renderer`
Expected: 通过（或 `bunx tsc --noEmit -p tsconfig.json` 仅类型检查）。

**Step 3: Commit**

```bash
rtk git add stores/dashboard-store.ts
rtk git commit -m "feat(dashboard): dashboard-store（复盘卡 + 活动轮询 + 速记）"
```

---

## Task 14：仪表盘组件

**Files:**
- Create: `components/dashboard/Dashboard.tsx`
- Create: `components/dashboard/AdvisorSection.tsx`
- Create: `components/dashboard/ReviewItemGroup.tsx`
- Create: `components/dashboard/ScratchpadSection.tsx`
- 参考：`components/EmptyFocusState.tsx`、`StatusPulse.tsx`、shadcn `Button`

**Step 1: Dashboard.tsx（容器）**

顶部栏：工作区名 + "新建对话"按钮（复用 `useConversationStore.newConversation`）。下方纵向滚动：`<AdvisorSection>` + `<ScratchpadSection>`。挂载时按当前 workspace `loadReview` + `loadNotes`。

**Step 2: AdvisorSection.tsx（参谋区）**

- 头部：`上次复盘 X 天前`（reviewedAt 距今，无卡时"尚未复盘"）+ `覆盖 N 张` + 刷新按钮（在跑时 `StatusPulse` 橙 + 禁用）。
- 主体：按 `['悬而未决','未闭环','反复出现','已否决']` 顺序，从 reviewCard.items 过滤分组，每组渲染 `<ReviewItemGroup kind count items>`。
- 空态：无卡 → 引导文案 + 刷新按钮。

**Step 3: ReviewItemGroup.tsx**

组标题（kind + 计数）+ 条目列表：每条 `text` + refs 小徽章（`{refs.length} 处来源`，title=各 sessionId 前 8 位）。v1 不可点跳转。

**Step 4: ScratchpadSection.tsx（我的区）**

`<textarea>` 受控（组件内 state 初始化自 store.notesContent），onChange 置本地 + 防抖 800ms 调 `flushNotes`。标题旁"已保存 / 保存中"。占位"随手记点什么…"。

**Step 5: 前端类型检查**

Run: `bun run build:renderer`
Expected: 通过。

**Step 6: Commit**

```bash
rtk git add components/dashboard/
rtk git commit -m "feat(dashboard): 仪表盘组件（参谋区 + 速记板）"
```

---

## Task 15：接入 Dashboard 替换 EmptyFocusState

**Files:**
- Modify: `app/page.tsx`（渲染 `<EmptyFocusState>` 处）
- Modify: `app/session-window/page.tsx`（同）
- Grep 定位：`EmptyFocusState`

**Step 1: 替换**

把无聚焦对话分支的 `<EmptyFocusState />` 换成 `<Dashboard />`。确认仅在"已选工作区 + 无聚焦对话"时渲染（保持原触发条件）。`EmptyFocusState.tsx` 暂保留（Dashboard 内可复用其"新建对话"片段）。

**Step 2: 前端类型检查 + 跑 dev 目测**

Run: `bun run build:renderer`，必要时 `bun run dev` 目视。
Expected: 通过；仪表盘正常渲染。

**Step 3: Commit**

```bash
rtk git add app/page.tsx app/session-window/page.tsx
rtk git commit -m "feat(dashboard): 无聚焦对话时渲染仪表盘替换空态"
```

---

## Task 16：设置页复盘分节

**Files:**
- Modify: 会话摘要相关设置 Tab（Grep `getDigestModelTier` / `getDigestPrompt` 定位组件）
- 参考：digest 已有的档位/方案/提示词编辑 UI

**Step 1: 加复盘分节**

对称加：复盘模型方案 + 档位（reviewProfileId/reviewModelTier，默认 sonnet）、复盘提示词编辑（getReviewPrompt/setReviewPrompt）。可选复盘活动展示（getReviewActivity）。位置：并入「会话摘要」Tab 加分节，或新分节——按 Tab 现状定。

**Step 2: 前端类型检查**

Run: `bun run build:renderer`
Expected: 通过。

**Step 3: Commit**

```bash
rtk git add <改动的设置组件>
rtk git commit -m "feat(review): 设置页加复盘模型档位与提示词编辑"
```

---

## Task 17：端到端人工验证

**Step 1: 全量编译 + 测试**

Run: `bun run build && bun test electron/main/services/memory/`
Expected: 编译通过，memory 全套测试无回归。

**Step 2: 启动验证**

Run: `bun run dev`
验证清单：
1. 启动约 8s 后，日志可见 digest 扫描 → idle → 复盘扫描跟跑。
2. 无聚焦对话时显示仪表盘；有复盘卡的工作区参谋区按四类渲染、排序正确。
3. 点"刷新复盘"→ 按钮转脉冲 → 跑完卡刷新。
4. 速记板输入 → 防抖落盘 → 切走再回来内容还在。
5. 换工作区：复盘卡 + 速记都跟随切换。
6. 设置页改复盘档位/提示词 → 持久化。

**Step 3: 记录结果**

把验证结果（通过/问题）回报，未过项不算完成。

---

## 备注

- 镜像 digest 的任务（5/7/8/9/11）务必逐字段对照蓝本，避免漏 effort/haiku 守卫、AbortController、活动采集等细节。
- refs 跳原会话、复盘取消按钮（cancelReview）为后续迭代，本计划不含。
