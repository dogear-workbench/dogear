# 首页工作台重构 实现计划

> **For Claude:** REQUIRED SUB-SKILL: 用 superpowers:executing-plans 按任务逐条实施本计划。

**Goal:** 把「四类信号复盘卡」重构为「记忆（详细全集，给 agent）+ 首页报告（干净 markdown，给用户）」双层模型，首页改为固定 tab，报告增量生成、可对话更新。

**Architecture:** 真实存储用现有工作区主题记忆（`dogear-memory` MCP）；首页 `dashboard.md` 是记忆对人的报告投影，用 `MarkdownRenderer` 渲染。报告 agent（现有 REVIEW_SESSION 链路改造）一次 headless query 内「更新记忆 + 重写报告」，增量判定复用现有"摘要卡 createdAt vs 报告 updatedAt"逻辑。前端钉一个常驻「首页」tab。

**Tech Stack:** Electron 主进程 (TS, ES2020) + tipc + Claude Agent SDK + React 19 + Zustand + Tailwind 4 (@container) + bun:test。

---

## 重要约定（实施者必读）

1. **命名代号**：本功能的主进程"管线"沿用历史代号 **review**（文件名 `review-*.ts`、任务类型 `REVIEW_SESSION`、MCP server `dogear-memory-review`、tipc 路由 `triggerReview` 等、设置键 `reviewModelTier`/`reviewProfileId`、skill 名 `cross-session-review`）。**本次不重命名这些管线**，以控制改动半径。只改"存储的内容形态、工具集、提示词、前端展示"。用户可见的文案/文件名（`dashboard.md`、UI 标签、提示词正文）才体现"报告/首页"新概念。
2. **不做兼容层**（开发阶段约定）：删掉的结构化模型直接删，不留废弃字段。
3. **每个 Phase 结束 commit**。提交信息用仓库风格 `feat(...)/refactor(...)/fix(...)`，结尾加 `Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>`。**仅在用户同意后提交**——若执行环境未授权自动提交，则在每个 Phase 末提示用户提交。
4. **测试**：纯函数用 `bun test <file>` 跑；IO/UI 用 `bun run build:electron` 编译 + 手动验证。
5. **编译验证**：改主进程后必须 `bun run build:electron` 通过；改前端后 `bun run lint` 应无新增错误。

---

## Phase 1 — 报告存储（review-store.ts 改为 markdown 报告）

**Files:**
- Modify: `electron/main/services/memory/review-store.ts`（整文件重写）
- Modify: `electron/main/services/memory/review-store.test.ts`（整文件重写）

**Step 1: 重写 review-store.ts**

整文件替换为：

```ts
// 首页报告存储（历史代号 review）：每工作区一份自由 markdown 报告，
// 落 <configDir>/workspaces/<wsId>/dashboard.md（取代旧的结构化复盘卡 review.md）。
// 报告是记忆对人的投影：纯净语句、无链条；frontmatter 只存 updatedAt 供增量判定。
import fs from 'node:fs/promises';
import path from 'node:path';
import { getWorkspaceDataDir } from '../conversation-service.js';
import { parseFrontmatter, stringifyFrontmatter, type Frontmatter } from './memory-fs.js';

export interface ReportDoc {
  updatedAt: string; // ISO，增量判定与"上次更新"展示用
  markdown: string;  // 报告正文（不含 frontmatter）
}

// ─── 路径 ───

export function getReportPath(wsId: string): string {
  return path.join(getWorkspaceDataDir(wsId), 'dashboard.md');
}

// ─── 序列化 / 解析（纯函数，可单测）───

export function serializeReport(updatedAt: string, markdown: string): string {
  const fm: Frontmatter = { updatedAt };
  return stringifyFrontmatter(fm, markdown);
}

export function parseReport(raw: string): ReportDoc {
  const { fm, body } = parseFrontmatter(raw);
  const updatedAt = typeof fm.updatedAt === 'string' ? fm.updatedAt : '';
  return { updatedAt, markdown: body.replace(/^\r?\n/, '') };
}

// ─── 读写 ───

export async function saveReport(wsId: string, markdown: string): Promise<string> {
  const dir = getWorkspaceDataDir(wsId);
  await fs.mkdir(dir, { recursive: true });
  const updatedAt = new Date().toISOString();
  await fs.writeFile(getReportPath(wsId), serializeReport(updatedAt, markdown), 'utf-8');
  return updatedAt;
}

export async function readReport(wsId: string): Promise<ReportDoc | null> {
  try {
    const raw = await fs.readFile(getReportPath(wsId), 'utf-8');
    return parseReport(raw);
  } catch (err: any) {
    if (err?.code === 'ENOENT') return null;
    throw err;
  }
}
```

**Step 2: 重写 review-store.test.ts**

整文件替换为：

```ts
import { test, expect } from 'bun:test';
import { serializeReport, parseReport } from './review-store.ts';

test('报告 markdown + updatedAt 往返一致', () => {
  const md = '> 当前状态总结\n\n## 做了哪些（近 5 天）\n- 改了 X\n';
  const raw = serializeReport('2026-06-08T00:00:00.000Z', md);
  const doc = parseReport(raw);
  expect(doc.updatedAt).toBe('2026-06-08T00:00:00.000Z');
  expect(doc.markdown.trim()).toBe(md.trim());
});

test('无 frontmatter 时 updatedAt 为空串、正文原样', () => {
  const doc = parseReport('## 只有正文\n- a\n');
  expect(doc.updatedAt).toBe('');
  expect(doc.markdown).toContain('只有正文');
});
```

**Step 3: 跑测试**

Run: `bun test electron/main/services/memory/review-store.test.ts`
Expected: 2 passing。

**Step 4: 编译**

Run: `bun run build:electron`
Expected: 报错——`review-scanner.ts` / `review-tools.ts` / `tipc/review.ts` 仍引用已删除的 `readReview`/`saveReview`/`ReviewCard`。**这是预期的**，Phase 2/3/7 会修复。可先记下报错文件清单确认范围，不在本 Phase 提交编译产物。

**Step 5: 暂不 commit**（等 Phase 2-3 修复编译后一起或分步提交；若想分步，先 commit 本文件改动并接受临时编译失败——推荐改完 Phase 3 再 commit 第一批后端）。

---

## Phase 2 — 脏检查改用报告 updatedAt（review-scanner.ts）

**Files:**
- Modify: `electron/main/services/memory/review-scanner.ts`
- Modify: `electron/main/services/memory/review-scanner.test.ts`

**Step 1: 重写 review-scanner.ts**

整文件替换为：

```ts
// 报告脏检查（历史代号 review）：报告 updatedAt 与最新摘要卡 createdAt 比对。
import * as workspaceService from '../workspace-json-service.js';
import { listDigests } from './digest-store.js';
import { readReport, type ReportDoc } from './review-store.js';

export interface StaleWorkspace {
  workspaceId: string;
  workspacePath: string;
}

/** 脏条件：无摘要卡 → 不脏（无可生成）；有摘要卡但无报告 → 脏；最新摘要卡晚于报告 updatedAt → 脏（纯函数，可单测） */
export function isReportStale(report: ReportDoc | null, latestDigestCreatedAt: string | null): boolean {
  if (!latestDigestCreatedAt) return false;
  if (!report) return true;
  return latestDigestCreatedAt > report.updatedAt;
}

/** 遍历所有工作区，返回报告过时（且有摘要卡可生成）的工作区 */
export async function findStaleWorkspaces(): Promise<StaleWorkspace[]> {
  const all = await workspaceService.getAll();
  const out: StaleWorkspace[] = [];
  for (const ws of all) {
    const digests = await listDigests(ws.id);
    if (!digests.length) continue;
    const latest = digests.reduce((m, d) => (d.createdAt > m ? d.createdAt : m), digests[0].createdAt);
    const report = await readReport(ws.id);
    if (isReportStale(report, latest)) {
      out.push({ workspaceId: ws.id, workspacePath: ws.path });
    }
  }
  return out;
}
```

**Step 2: 重写 review-scanner.test.ts**

整文件替换为：

```ts
import { test, expect } from 'bun:test';
import { isReportStale } from './review-scanner.ts';
import type { ReportDoc } from './review-store.ts';

function report(updatedAt: string): ReportDoc {
  return { updatedAt, markdown: '' };
}

test('无摘要卡 → 不脏', () => {
  expect(isReportStale(null, null)).toBe(false);
  expect(isReportStale(report('2026-06-01T00:00:00Z'), null)).toBe(false);
});

test('有摘要卡但无报告 → 脏', () => {
  expect(isReportStale(null, '2026-06-07T00:00:00Z')).toBe(true);
});

test('最新摘要卡晚于报告 → 脏', () => {
  expect(isReportStale(report('2026-06-06T00:00:00Z'), '2026-06-07T00:00:00Z')).toBe(true);
});

test('最新摘要卡不晚于报告 → 不脏', () => {
  expect(isReportStale(report('2026-06-07T00:00:00Z'), '2026-06-07T00:00:00Z')).toBe(false);
});
```

**Step 3: 跑测试**

Run: `bun test electron/main/services/memory/review-scanner.test.ts`
Expected: 4 passing。

> 注：`review-trigger.ts` 引用 `isReviewStale` 了吗？没有——它只用 `findStaleWorkspaces`（名字未变），故 trigger 无需改。自动触发点（启动/夜间/关会话）的接线保持不变，行为自然跟随新的 `isReportStale`。

---

## Phase 3 — MCP 工具改造（review-tools.ts：报告读写 + 去结构化）

**Files:**
- Modify: `electron/main/agents/tools/review-tools.ts`

**Step 1: 重写 review-tools.ts**

整文件替换为（保留 ListDigests/ReadDigest/TraceSource；删除 ReadReviewCard/SaveReviewCard/REVIEW_KINDS；新增 ReadReport/WriteReport）：

```ts
/**
 * 首页报告 MCP Server 工具（dogear-memory-review，历史代号 review）
 *
 * 工具：ListDigests / ReadDigest / TraceSource / ReadReport / WriteReport
 * 全是薄 IO，零分析逻辑——判断、归并、分流（沉淀进记忆 vs 待办进报告）全在提示词里引导 agent。
 * 沉淀进记忆由独立的 dogear-memory server（RecallMemory/SaveMemory/ForgetMemory）承担。
 */
import fs from 'node:fs/promises';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { listDigests, readDigest } from '../../services/memory/digest-store.js';
import { readReport, saveReport } from '../../services/memory/review-store.js';
import { traceSourceFromLines } from '../../services/memory/trace-source.js';
import { getSessionJsonlPath } from '../../services/memory/session-paths.js';
import { registerTools } from './tool-registry.js';

registerTools([
  { name: 'ListDigests', description: '列出本工作区所有会话摘要卡（含 createdAt）', server: 'dogear-memory-review', category: 'memory' },
  { name: 'ReadDigest', description: '读取单张摘要卡（含条目与回溯 uuid）', server: 'dogear-memory-review', category: 'memory' },
  { name: 'TraceSource', description: '按 uuid 回溯原始会话原文，供查证含义', server: 'dogear-memory-review', category: 'memory' },
  { name: 'ReadReport', description: '读取当前首页报告（拿 updatedAt 与正文，用于增量）', server: 'dogear-memory-review', category: 'memory' },
  { name: 'WriteReport', description: '覆盖写入首页报告（纯净 markdown，给用户看）', server: 'dogear-memory-review', category: 'memory' },
]);

function errText(prefix: string, error: unknown) {
  return {
    content: [{ type: 'text' as const, text: `${prefix}: ${error instanceof Error ? error.message : String(error)}` }],
    isError: true,
  };
}

/**
 * 创建首页报告 MCP Server
 * @param workspaceId 工作区 ID（读写摘要卡 / 报告）
 * @param workspacePath 工作区绝对路径（定位原始会话 JSONL 用）
 * @param onSaved 可选：WriteReport 成功时回调（worker 用来判断是否真正落报告）
 */
export function createReviewMcpServer(workspaceId: string, workspacePath: string, onSaved?: () => void) {
  return createSdkMcpServer({
    name: 'dogear-memory-review',
    version: '2.0.0',
    tools: [
      tool(
        'ListDigests',
        '列出本工作区所有会话摘要卡（sessionId · createdAt · 标题）。用它和报告的 updatedAt 对比，判断哪些是新卡（createdAt 晚于 updatedAt 即新，不管几张都要处理）。',
        {},
        async () => {
          try {
            const list = await listDigests(workspaceId);
            const text = list.length
              ? list.map((d) => `- ${d.sessionId} · ${d.createdAt} · ${d.title}`).join('\n')
              : '(无摘要卡)';
            return { content: [{ type: 'text' as const, text }] };
          } catch (error) {
            return errText('列出摘要卡失败', error);
          }
        },
      ),

      tool(
        'ReadDigest',
        '读取单张摘要卡，返回概述 + 条目（每条带回溯 uuid）。',
        { sessionId: z.string().describe('摘要卡的 SDK 会话 ID') },
        async (args) => {
          try {
            const card = await readDigest(workspaceId, args.sessionId);
            if (!card) return { content: [{ type: 'text' as const, text: '(无此摘要卡)' }] };
            const itemsText = card.items.map((i) => `- [${i.kind}] ${i.text} ⟶ ${i.uuid}`).join('\n');
            return {
              content: [{
                type: 'text' as const,
                text: `标题：${card.title}\ncreatedAt：${card.createdAt}\n\n## 概述\n${card.summary}\n\n## 条目\n${itemsText}`,
              }],
            };
          } catch (error) {
            return errText('读取摘要卡失败', error);
          }
        },
      ),

      tool(
        'TraceSource',
        '按 uuid 回溯原始会话，返回该消息及前后对话原文。拿不准某条含义时用它查证；找不到则不要据此条臆断。',
        {
          sessionId: z.string().describe('出处的 SDK 会话 ID'),
          uuid: z.string().describe('出处 uuid（取自摘要卡条目）'),
        },
        async (args) => {
          try {
            const file = getSessionJsonlPath(workspacePath, args.sessionId);
            const raw = await fs.readFile(file, 'utf-8');
            const lines = raw.split('\n').filter(Boolean);
            const r = traceSourceFromLines(lines, args.uuid, 2);
            if (!r.found) {
              return {
                content: [{
                  type: 'text' as const,
                  text: `未在会话 ${args.sessionId} 中找到 uuid ${args.uuid} 对应原文。请勿据此条臆断，宁可不写。`,
                }],
              };
            }
            const text = r.messages
              .map((m) => `[${m.role}${m.uuid === args.uuid ? ' · ★目标' : ''}]\n${m.text}`)
              .join('\n\n');
            return { content: [{ type: 'text' as const, text }] };
          } catch (error) {
            return errText('回溯原文失败', error);
          }
        },
      ),

      tool(
        'ReadReport',
        '读取当前首页报告。返回 updatedAt（上次更新时间，用于判断哪些摘要卡是新的）和正文 markdown。无报告时返回「(无报告)」，据此走全量分支。',
        {},
        async () => {
          try {
            const report = await readReport(workspaceId);
            if (!report) return { content: [{ type: 'text' as const, text: '(无报告)' }] };
            return {
              content: [{
                type: 'text' as const,
                text: `updatedAt：${report.updatedAt}\n\n${report.markdown}`,
              }],
            };
          } catch (error) {
            return errText('读取报告失败', error);
          }
        },
      ),

      tool(
        'WriteReport',
        '覆盖写入首页报告（updatedAt 由工具自动生成）。markdown 是给用户看的纯净报告：' +
        '只放需用户主动处理的待办/中断（简述）、近 5 天做了哪些、建议、最新少量沉淀。' +
        '不要放链条/refs/sessionId（那些进记忆）。增量更新：没变的段落原样保留。',
        {
          markdown: z.string().min(1).describe('报告正文（纯净 markdown，无 frontmatter）'),
        },
        async (args) => {
          try {
            const updatedAt = await saveReport(workspaceId, args.markdown);
            onSaved?.();
            return { content: [{ type: 'text' as const, text: `已写入报告（updatedAt=${updatedAt}）` }] };
          } catch (error) {
            return errText('写入报告失败', error);
          }
        },
      ),
    ],
  });
}
```

**Step 2: 编译**

Run: `bun run build:electron`
Expected: 仍有 `tipc/review.ts` 引用 `readReview` 的报错（Phase 7 修）。其余 review-store/scanner/tools 相关报错应消失。

---

## Phase 4 — 提示词重写（review-prompt.ts）

**Files:**
- Modify: `electron/main/services/memory/review-prompt.ts`（只改 `DEFAULT_REVIEW_PROMPT` 常量，函数签名不动）
- Check: `electron/main/services/memory/review-prompt.test.ts`（若断言旧正文则更新）

**Step 1: 替换 DEFAULT_REVIEW_PROMPT 常量**

把 `export const DEFAULT_REVIEW_PROMPT = \`...\`;` 整段替换为：

```ts
export const DEFAULT_REVIEW_PROMPT = `# 首页报告 / 跨会话记忆维护

你在为这个工作区维护两样东西：
1. **记忆**（给 agent 用，详细全集）：用 dogear-memory 的 SaveMemory / RecallMemory / ForgetMemory 读写。沉淀、有价值结论、注意事项、需主动处理项的详细版（含链条/状态）都在这里。它靠 recall 在未来会话浮现、影响策略。
2. **首页报告**（给用户看，简述）：用 ReadReport / WriteReport 读写。纯净语句、无链条/refs。

只用 ListDigests / ReadDigest / TraceSource / ReadReport / WriteReport / RecallMemory / SaveMemory / ForgetMemory 这些工具。

## 步骤

1. ReadReport() 看现有报告，记下 updatedAt。
2. ListDigests()，挑出 createdAt 晚于 updatedAt 的摘要卡（**不管几张，都要处理**）；没有新卡就什么都不做，直接结束。
3. 逐张 ReadDigest 读新卡。拿不准某条含义时，TraceSource(sessionId, uuid) 翻原始会话再下笔，禁止凭只言片语臆断。
4. RecallMemory 拿相关已有记忆，避免重复或与既有沉淀冲突。
5. **分流**（最重要，判断标准是"靠谁、在什么时机被触发"）：
   - 沉淀 / 有价值结论 / 注意事项 → 写进**记忆**（SaveMemory）。这些未来靠 recall 浮现。
   - 需用户主动处理的待办 / 中断 / 搁置 → 详细版（含链条/状态）写进**记忆**，简述放进**报告**。它放记忆里不会被主动提起，所以必须上报告让用户看见。
   - 已解决的待办 → 从报告移除；若解决过程有经验，转成一条记忆。
6. WriteReport 写报告。结构参考（不强制）：
   \`\`\`
   > 一句话总结当前状态
   ## 做了哪些（近 5 天）
   ## 需主动处理 / 中断 / 搁置
   ## 建议
   ## 沉淀（最新少量几条）
   \`\`\`
   增量合并：没变的段落原样保留；沉淀只列最新少量几条，不堆历史。

## 契约
- 报告纯净、给人看：不放 sessionId/uuid/链条。
- 记忆可详细：链条、refs、状态都可以写。
- 价值判断交给你：低价值、误判（如"测过但没回复"不等于失败）不要往报告塞；宁可不写，不可瞎造。

完成后简述这次更新/沉淀了哪几条，再结束。
`;
```

**Step 2: 跑提示词测试**

Run: `bun test electron/main/services/memory/review-prompt.test.ts`
Expected: 若该测试只验"缺失则播种、存在则读取"（不断言正文内容）→ PASS。若断言了旧正文片段 → 改断言为新正文的稳定片段（如 `expect(p).toContain('首页报告')`）。

---

## Phase 5 — 报告 agent 接线（agent-worker.ts handleReviewSessionTask）

**Files:**
- Modify: `electron/main/agents/agent-worker.ts:706-738`（MCP servers + allowedTools 段）

**Step 1: 在 createReviewMcpServer 之后挂载 memory server**

把第 706-708 行附近：

```ts
    const { createReviewMcpServer } = await import('./tools/review-tools.js');
    let saved = false;
    const reviewServer = createReviewMcpServer(workspaceId, workspacePath, () => { saved = true; });
```

改为：

```ts
    const { createReviewMcpServer } = await import('./tools/review-tools.js');
    const { createMemoryTools } = await import('./tools/memory-tools.js');
    let saved = false;
    const reviewServer = createReviewMcpServer(workspaceId, workspacePath, () => { saved = true; });
    const memoryServer = createMemoryTools(workspacePath);
```

**Step 2: 更新 mcpServers 与 allowedTools**

把第 729-738 行：

```ts
          mcpServers: {
            'dogear-memory-review': reviewServer,
          },
          allowedTools: [
            'mcp__dogear-memory-review__ListDigests',
            'mcp__dogear-memory-review__ReadDigest',
            'mcp__dogear-memory-review__ReadReviewCard',
            'mcp__dogear-memory-review__TraceSource',
            'mcp__dogear-memory-review__SaveReviewCard',
          ],
```

改为：

```ts
          mcpServers: {
            'dogear-memory-review': reviewServer,
            'dogear-memory': memoryServer,
          },
          allowedTools: [
            'mcp__dogear-memory-review__ListDigests',
            'mcp__dogear-memory-review__ReadDigest',
            'mcp__dogear-memory-review__TraceSource',
            'mcp__dogear-memory-review__ReadReport',
            'mcp__dogear-memory-review__WriteReport',
            'mcp__dogear-memory__RecallMemory',
            'mcp__dogear-memory__SaveMemory',
            'mcp__dogear-memory__ForgetMemory',
          ],
```

**Step 3: 更新该函数顶部注释**（663 行附近的 JSDoc），把"综合成一张复盘卡"改为"更新记忆 + 重写首页报告"。`saved` 语义现在是"是否写了报告"，注释同步。

**Step 4: 编译**

Run: `bun run build:electron`
Expected: 仅剩 `tipc/review.ts` 的 `readReview` 报错。

---

## Phase 6 — skill 提示词与描述同步（review-skill-service.ts）

> SKILL.md 供普通会话交互式「聊聊首页」用。`ensureReviewSkillInitialized` 现在是"存在则不覆盖"，开发机上旧 SKILL.md 会过时。改为内容不一致时覆盖。

**Files:**
- Modify: `electron/main/services/memory/review-skill-service.ts`

**Step 1: 更新 SKILL_MD 描述**

把 `description:` 那行改为：

```
description: 当用户要求复盘、回顾进展、聊聊首页/报告、串一下做过什么、看哪些待办没落实/搁置、或要更新首页报告与记忆时使用。读会话摘要卡 + 现有报告，增量更新记忆与首页报告。
```

（正文 `${DEFAULT_REVIEW_PROMPT}` 部分自动跟随 Phase 4。）

**Step 2: 改为内容不一致则覆盖**

把 `ensureReviewSkillInitialized` 的 try/catch 块：

```ts
  try {
    await fs.access(skillPath);
  } catch {
    await fs.writeFile(skillPath, SKILL_MD, 'utf-8');
  }
```

改为：

```ts
  // 生成内容，与磁盘不一致则覆盖（提示词随版本演进，避免开发机残留旧 skill）。
  let existing: string | null = null;
  try {
    existing = await fs.readFile(skillPath, 'utf-8');
  } catch { /* 不存在 */ }
  if (existing !== SKILL_MD) {
    await fs.writeFile(skillPath, SKILL_MD, 'utf-8');
  }
```

**Step 3: 编译**

Run: `bun run build:electron`（仍剩 tipc/review.ts 报错，Phase 7 修）

---

## Phase 7 — tipc + 前端 store（getReport + dashboard-store）

**Files:**
- Modify: `electron/main/tipc/review.ts`
- Modify: `stores/dashboard-store.ts`
- Modify: `lib/client.ts`（若手写了 getReviewCard 类型）→ 通常 tipc 自动推断，检查即可
- Check: `types/electron-api.ts`（grep `ReviewCard`，若有显式引用则清理）

**Step 1: tipc/review.ts 改 getReviewCard → getReport**

把顶部 import：

```ts
import { readReview } from '../services/memory/review-store.js';
```

改为：

```ts
import { readReport } from '../services/memory/review-store.js';
```

把 `getReviewCard` 这段：

```ts
  getReviewCard: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const card = await readReview(input.workspaceId);
        return { card };
      } catch (error) {
        console.error('[review] getReviewCard 失败:', error);
        return { error: String(error) };
      }
    }),
```

改为：

```ts
  getReport: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const report = await readReport(input.workspaceId);
        return { report };
      } catch (error) {
        console.error('[review] getReport 失败:', error);
        return { error: String(error) };
      }
    }),
```

其余路由（triggerReview / getReviewActivity / prompt / tier / profile / cancelReview）不动。

**Step 2: 编译主进程**

Run: `bun run build:electron`
Expected: **PASS**（后端全部修复）。

**Step 3: 重写 dashboard-store.ts 的报告部分**

删除 `ReviewRef` / `ReviewItem` / `ReviewCard` 三个 interface。`reviewActivity` / `ReviewActivity` / `ReviewRecentEntry` / notes / 轮询 / triggerReview 全部保留。把状态字段与 loadReview 改为报告：

- 删除 `reviewCard: ReviewCard | null;`，新增：
  ```ts
  reportMarkdown: string | null;
  reportUpdatedAt: string | null;
  ```
- 接口里 `loadReview` 改名 `loadReport`（签名同：`(workspaceId: string) => Promise<void>`）。
- 初始值：`reviewCard: null` → `reportMarkdown: null, reportUpdatedAt: null`。
- `loadReview` 实现替换为：
  ```ts
  loadReport: async (workspaceId) => {
    try {
      const result = await client.getReport({ workspaceId });
      if ('report' in result) {
        const report = result.report as { markdown: string; updatedAt: string } | null;
        set({
          reportMarkdown: report?.markdown ?? null,
          reportUpdatedAt: report?.updatedAt ?? null,
        });
      }
    } catch (error) {
      console.error('[dashboard] loadReport 失败:', error);
    }
  },
  ```
- 轮询里第 80 行 `get().loadReview(finishedWs);` 改为 `get().loadReport(finishedWs);`。

**Step 4: lint**

Run: `bun run lint`
Expected: dashboard-store 无错（AdvisorSection 仍引用旧字段的错留到 Phase 8）。

---

## Phase 8 — 前端 UI：报告区 + 布局 + 删除四类分组

**Files:**
- Create: `components/dashboard/ReportSection.tsx`
- Delete: `components/dashboard/AdvisorSection.tsx`
- Delete: `components/dashboard/ReviewItemGroup.tsx`
- Modify: `components/dashboard/Dashboard.tsx`

**Step 1: 新建 ReportSection.tsx**

```tsx
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusPulse } from '@/components/StatusPulse';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { useDashboardStore } from '@/stores/dashboard-store';

function relativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

interface ReportSectionProps {
  workspaceId: string;
  workspacePath: string;
}

export function ReportSection({ workspaceId, workspacePath }: ReportSectionProps) {
  const reportMarkdown = useDashboardStore((s) => s.reportMarkdown);
  const reportUpdatedAt = useDashboardStore((s) => s.reportUpdatedAt);
  const reviewRunning = useDashboardStore((s) => s.reviewRunningWorkspaceId === workspaceId);
  const triggerReview = useDashboardStore((s) => s.triggerReview);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">首页报告</h2>
        <div className="flex items-center gap-3">
          {reportUpdatedAt && (
            <span className="text-xs text-muted-foreground">更新于 {relativeTime(reportUpdatedAt)}</span>
          )}
          <Button size="xs" variant="outline" disabled={reviewRunning} onClick={() => triggerReview(workspaceId, workspacePath)}>
            {reviewRunning ? (
              <><StatusPulse isPending={false} size="sm" />生成中…</>
            ) : (
              <><RefreshCw className="size-3" />刷新</>
            )}
          </Button>
        </div>
      </div>

      {reportMarkdown ? (
        <div className="rounded-lg border border-border bg-card px-4 py-3">
          <MarkdownRenderer content={reportMarkdown} />
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 px-6 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            {reviewRunning ? '正在生成报告，请稍候…' : '还没有报告，点上方「刷新」生成，或在对话里说"聊聊首页"'}
          </p>
        </div>
      )}
    </section>
  );
}
```

> 注意：核对 `components/MarkdownRenderer.tsx` 的导出名与 props。若是 default export，改成 `import MarkdownRenderer from ...`；若 prop 不叫 `content`（如 `children`/`markdown`），按实际调整。**实施前先读该文件确认。**

**Step 2: 删除旧组件**

```bash
git rm components/dashboard/AdvisorSection.tsx components/dashboard/ReviewItemGroup.tsx
```

**Step 3: 重写 Dashboard.tsx（@container 横纵自适应 + loadReport）**

```tsx
import { useEffect } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useDashboardStore } from '@/stores/dashboard-store';
import { ReportSection } from './ReportSection';
import { ScratchpadSection } from './ScratchpadSection';

export function Dashboard() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const newConversation = useConversationStore((s) => s.newConversation);
  const setCurrentWorkspace = useDashboardStore((s) => s.setCurrentWorkspace);
  const loadReport = useDashboardStore((s) => s.loadReport);
  const loadNotes = useDashboardStore((s) => s.loadNotes);

  useEffect(() => {
    if (!workspace?.id) return;
    setCurrentWorkspace(workspace.id);
    loadReport(workspace.id);
    loadNotes(workspace.id);
  }, [workspace?.id, setCurrentWorkspace, loadReport, loadNotes]);

  if (!workspace) {
    return (
      <div className="flex-1 flex items-center justify-center bg-muted/10">
        <p className="text-sm text-muted-foreground">请选择工作区</p>
      </div>
    );
  }

  return (
    <div className="@container flex-1 overflow-auto bg-muted/10">
      <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-semibold text-foreground truncate">{workspace.name}</h1>
          <Button size="sm" onClick={() => newConversation()}>
            <Plus className="w-4 h-4" />新建对话
          </Button>
        </div>

        {/* 窄屏上下堆叠，宽屏（容器 ≥ 48rem）左报告右速记 */}
        <div className="flex flex-col gap-6 @3xl:flex-row @3xl:items-start">
          <div className="@3xl:flex-1 min-w-0">
            <ReportSection workspaceId={workspace.id} workspacePath={workspace.path} />
          </div>
          <div className="@3xl:w-80 shrink-0">
            <ScratchpadSection workspaceId={workspace.id} />
          </div>
        </div>
      </div>
    </div>
  );
}
```

**Step 4: lint + 编译前端**

Run: `bun run lint`
Expected: 无新增错误（旧 AdvisorSection/ReviewItemGroup 已删，无悬空引用）。

Run: `bun run build:renderer`
Expected: 编译通过。

---

## Phase 9 — 固定「首页」Tab（session-store + WorkspaceTabBar + page.tsx）

**Files:**
- Modify: `stores/session-store.ts`
- Modify: `components/WorkspaceTabBar.tsx`
- Modify: `app/page.tsx`

**Step 1: session-store 加哨兵 + 默认停首页**

- 文件顶部（import 后）加导出常量：
  ```ts
  /** 常驻「首页」tab 的哨兵 id（非真实会话） */
  export const HOME_TAB_ID = '__home__';
  ```
- 初始 state：`activeTabId: null` → `activeTabId: HOME_TAB_ID`。
- `closeTab`：关闭后回退目标从 `null` 改为 `HOME_TAB_ID`：
  ```ts
  newActive = newTabs.length > 0 ? newTabs[newTabs.length - 1].conversationId : HOME_TAB_ID;
  ```
- `reset`：`activeTabId: null` → `activeTabId: HOME_TAB_ID`。

> `switchTab(HOME_TAB_ID)` 无需特判：它只 `set({ activeTabId })`，会话 tab 不匹配该 id → 内容区据此显示 Dashboard。

**Step 2: WorkspaceTabBar 钉首页 tab**

- import 加 `HOME_TAB_ID`、lucide 的 `Home`：
  ```ts
  import { ExternalLink, X, Home } from 'lucide-react';
  import { useSessionStore, type SessionTab, HOME_TAB_ID } from '@/stores/session-store';
  ```
- 删除 `if (tabs.length === 0) return null;`（首页 tab 要常驻）。
- 在 `<div className="flex items-center">` 内、`{tabs.map(...)}` **之前**插入首页 tab：
  ```tsx
  <button
    onClick={() => switchTab(HOME_TAB_ID)}
    className={cn(
      'flex items-center gap-1.5 px-3 py-2 text-sm cursor-pointer border-r shrink-0',
      activeTabId === HOME_TAB_ID ? 'bg-background font-medium' : 'hover:bg-muted/50 text-muted-foreground',
    )}
    title="首页"
  >
    <Home className="w-3.5 h-3.5" />
    <span>首页</span>
  </button>
  ```

**Step 3: page.tsx 内容区同时挂载 Dashboard + 会话**

- import 加 `HOME_TAB_ID`：
  ```ts
  import { useSessionStore } from '@/stores/session-store';
  // ↓ 已有的解构旁边加
  ```
  在组件内取：`const activeTabId = useSessionStore((s) => s.activeTabId);`（已有，确认存在）。
- 把第 295-314 行的三元：
  ```tsx
  {allTabs.length > 0 ? (
    <div className="flex-1 overflow-hidden relative">
      {allTabs.map((tab) => ( ... ))}
    </div>
  ) : (
    <Dashboard />
  )}
  ```
  改为两者都挂载、按 activeTabId 切 display：
  ```tsx
  <div className="flex-1 overflow-hidden relative">
    {/* 首页：activeTabId 为哨兵时显示 */}
    <div
      className="absolute inset-0 flex flex-col"
      style={{ display: activeTabId === HOME_TAB_ID ? 'flex' : 'none' }}
    >
      <Dashboard />
    </div>
    {/* 会话：各自按 activeTabId 切显示，保持 AgentChat 挂载 */}
    {allTabs.map((tab) => (
      <div
        key={tab.conversationId}
        className="absolute inset-0"
        style={{ display: activeTabId === tab.conversationId && !sessionWindowIds.has(tab.conversationId) ? 'block' : 'none' }}
      >
        <AgentChat
          placeholder="向 AI 助手提问..."
          showStatusHint={false}
          conversationIdOverride={tab.conversationId}
          rightPanelToggle={{ open: rightPanelOpen, onToggle: toggleRightPanel }}
        />
      </div>
    ))}
  </div>
  ```
- 顶部 `import { HOME_TAB_ID } from '@/stores/session-store';`（与现有 useSessionStore import 合并）。

**Step 4: lint + 编译**

Run: `bun run lint && bun run build:renderer`
Expected: 通过。

---

## Phase 10 — 手动验证 + 文档同步

**Step 1: 起开发环境手动验证**

Run: `bun run dev`

逐项验证（无法验证的明确说明）：
1. 应用启动默认停在「首页」tab，左侧能看到常驻 Home tab，不可关闭。
2. 首页：报告区（空态文案）+ 速记板，宽屏左右、拖窄变上下。
3. 新建对话 → 出现会话 tab 且自动聚焦；点「首页」tab 切回仪表盘，会话不丢状态；切回会话流式正常。
4. 点报告「刷新」→ 进入"生成中"，agent 任务跑完后报告区出现 markdown（需该工作区已有摘要卡；可先正常用几轮对话并关会话以产出 digest）。
5. 普通会话里说「聊聊首页」→ agent 应能调 ReadReport/WriteReport/SaveMemory 更新报告与记忆。
6. 速记板输入 → 800ms 后"已保存"，切工作区再切回内容保留。

**Step 2: 文档同步**

调用 `/doc-sync` 或手动更新 `.claude/rules/codebase-map.md`：
- dashboard 组件：`AdvisorSection`/`ReviewItemGroup` 删除，新增 `ReportSection`。
- review-store 改为 `dashboard.md` 报告存储；review-tools 工具集变更；新增固定首页 tab（session-store `HOME_TAB_ID`）。
- 数据存储节：`review.md`（四类卡）→ `dashboard.md`（报告，frontmatter updatedAt）。
- 会话提炼链路尾注：复盘卡 → 首页报告 + 记忆分流。

**Step 3: 最终全量编译**

Run: `bun run build`
Expected: 前端 + 主进程均通过。

---

## 不在本次范围（YAGNI）

- 设置页「复盘」分节的文案改名（功能不变，标签可后续微调）。
- `review-*` 管线文件/任务类型/MCP server/设置键的彻底重命名（保留代号，详见"重要约定"）。
- 回溯徽章/短链渲染（已决定报告无链条）。
- 报告的多版本历史 / 归档。

## 开放项（实施中确认）

- `MarkdownRenderer` 的导出形态与 prop 名（Phase 8 Step 1 实施前读文件确认）。
- `review-prompt.test.ts` 是否断言旧正文（Phase 4 Step 2 处理）。
- 自动触发点（关会话/夜间）是否已调用 `findStaleWorkspaces`/`triggerReviewScan`：若 phaseC 已接线则无需动；若未接，属另一处增强，本计划不含。
