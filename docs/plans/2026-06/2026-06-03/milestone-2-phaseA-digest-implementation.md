# 里程碑 2 · Phase A 实施计划：会话清洗 + 提炼闭环

> **For Claude:** REQUIRED SUB-SKILL: 用 superpowers:executing-plans 按任务逐条实施本计划。
> 设计依据：`./milestone-2-phaseA-digest-design.md`（决策 A–K）。两份配套读。

> **状态（2026-06-04）：** Task 0–9 全部实现并提交（commit ad46d3c…起共 10 个 feat/refactor）。build（renderer+electron）全绿、lint 0 error、bun:test 全通过。Task 10 的确定性项（build/lint/文档）已完成；运行时交互验收（删卡重提炼/留底核对/改模板/改模型看日志）需用户在真实 GUI + API key 下确认。

**Goal:** 让软件自动把每个会话 JSONL 提炼成「会话摘要卡」，存量+增量都覆盖，设置页可巡检。

**Architecture:** 三段——① TS MCP 工具确定性去噪（内联返回+落留底）；② 单个 headless `query()`（照 article-parser 的 `PARSE_ARTICLE`）自主调清洗→读旧卡→写新卡；脏检查（文件 mtime）三触发点驱动。digests 落 `<configDir>/workspaces/<wsId>/digests/`，提示词模板全局单份，摘要模型在设置页选。

**Tech Stack:** TypeScript + Electron 主进程 + `@anthropic-ai/claude-agent-sdk`（`createSdkMcpServer`/`tool`/`query`）+ zod + bun:test。

---

## 通用约定（实施者必读）

- **测试框架是 `bun:test`，不是 vitest**：`import { test, expect } from 'bun:test'`；跑 `bun test <文件>`。
- 主进程 TS 改动需 `bun run build:electron` 才生效（Vite 热重载只管前端）。整体编译 `bun run build`。
- 主进程**不能**导入 `types/`，需要的类型在 `electron/main/types.ts` 镜像；新增类型同理。
- 文件 IO 用 `fs/promises`；多写并发用 `safe-json` / `withFileLock`（见 article.ts 用法）。
- frontmatter 解析/序列化**复用** `electron/main/services/memory/memory-fs.ts` 的 `parseFrontmatter`/`serializeFrontmatter`（先确认导出名，必要时补导出）。
- 路径：`getClaudeConfigDir()`、`getSdkSessionsDir(workspacePath)` 见 `electron/main/tipc/agent.ts:32` / `:43`（Task 0 抽成共享）。
- 提交粒度：每个 Task 末尾 commit 一次。commit 前先 `bun run build:electron` 确认编译通过；有测试的先 `bun test`。

---

## Task 0：抽共享路径 util

**Files:**
- Create: `electron/main/services/memory/session-paths.ts`
- Modify: `electron/main/tipc/agent.ts`（`getClaudeConfigDir`/`getSdkSessionsDir` 改为从新模块导入并 re-export，删本地实现）

**Step 1**：把 agent.ts:32-52 的两个函数原样搬到 `session-paths.ts` 并 `export`：

```ts
import path from 'node:path';
import { app } from 'electron';

export function getClaudeConfigDir(): string {
  const appDir = app.isPackaged ? app.getPath('userData') : process.cwd();
  return path.join(appDir, '.dogear', 'conversations');
}

export function getSdkSessionsDir(projectPath: string): string {
  const normalized = process.platform === 'win32'
    ? projectPath.replace(/\\/g, '-').replace(/:/g, '-')
    : projectPath.replace(/\//g, '-');
  return path.join(getClaudeConfigDir(), 'projects', normalized);
}

export function getSessionJsonlPath(workspacePath: string, sdkSessionId: string): string {
  return path.join(getSdkSessionsDir(workspacePath), `${sdkSessionId}.jsonl`);
}
```

> 注：原 `getSdkSessionsDir` 是 `async` 但无 await；这里改同步。agent.ts 调用处去掉 `await`。

**Step 2**：agent.ts 改为 `import { getClaudeConfigDir, getSdkSessionsDir } from '../services/memory/session-paths.js';`，删本地定义，修正调用点（去 await）。

**Step 3**：`bun run build:electron` 必须通过。

**Step 4**：commit `refactor(memory): 抽出会话路径解析共享 util`。

---

## Task 1：A1 清洗纯函数 + 单测（TDD 核心）

**Files:**
- Create: `electron/main/services/memory/transcript-cleaner.ts`
- Test: `electron/main/services/memory/transcript-cleaner.test.ts`
- Fixture: 用真实会话 `<configDir>/conversations/projects/C--dogear/<最小会话>.jsonl` 拷一份小样到 `electron/main/services/memory/__fixtures__/sample-session.jsonl`（取一个 ~30KB 的，含 user 字符串 / assistant text+thinking+tool_use / tool_result / isMeta / custom-title 各至少一条）。

**类型（同时加进 `electron/main/types.ts` 镜像，供 IPC 用）：**

```ts
export interface CleanedTranscript {
  sessionId: string;
  transcript: string;
  turnCount: number;
  lastTimestamp: string;
  sourceMtime: number;
  stats: { originalBytes: number; cleanedChars: number; ratio: number };
}
```

**Step 1：写失败测试** `transcript-cleaner.test.ts`：

```ts
import { test, expect } from 'bun:test';
import path from 'node:path';
import { cleanTranscriptFromLines } from './transcript-cleaner.ts';

const FIX = path.join(import.meta.dir, '__fixtures__', 'sample-session.jsonl');

test('丢弃 envelope / tool_result / thinking / isMeta / sidechain', async () => {
  const lines = (await Bun.file(FIX).text()).split('\n').filter(Boolean);
  const t = cleanTranscriptFromLines('sess-1', lines, 123, 1000);
  expect(t.transcript).not.toContain('tool_result');
  expect(t.transcript).not.toContain('custom-title');
  expect(t.transcript).not.toContain('"thinking"');
  // 工具骨架保留为一行 [工具名 ...]
  expect(t.transcript).toMatch(/\[(Read|Edit|Bash|Grep|Skill)\b/);
  // 保留完整 uuid（36 位含连字符）
  expect(t.transcript).toMatch(/· [0-9a-f]{8}-[0-9a-f]{4}-/);
  expect(t.turnCount).toBeGreaterThan(0);
  expect(t.stats.ratio).toBeGreaterThan(3); // 至少 3x 压缩
});

test('user 字符串里的系统标签被剥离', () => {
  const line = JSON.stringify({
    type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00Z',
    message: { role: 'user', content: '<command-name>/foo</command-name>真问题' },
  });
  const t = cleanTranscriptFromLines('s', [line], 10, 1);
  expect(t.transcript).toContain('真问题');
  expect(t.transcript).not.toContain('command-name');
});

test('纯系统行剥完为空则整条丢弃', () => {
  const line = JSON.stringify({
    type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00Z',
    message: { role: 'user', content: '<system-reminder>x</system-reminder>' },
  });
  const t = cleanTranscriptFromLines('s', [line], 10, 1);
  expect(t.turnCount).toBe(0);
});
```

**Step 2：跑确认失败** `bun test electron/main/services/memory/transcript-cleaner.test.ts` → FAIL（模块/函数不存在）。

**Step 3：实现** `transcript-cleaner.ts`。两层：纯解析 `cleanTranscriptFromLines`（可单测，无 IO）+ `cleanTranscript`（读文件后调它）。

```ts
import fs from 'node:fs/promises';
import { getSessionJsonlPath } from './session-paths.js';
import type { CleanedTranscript } from '../../types.js';

const SYS_TAG_RE = /<(system-reminder|command-name|command-message|command-args|local-command-stdout|user-prompt-submit-hook)>[\s\S]*?<\/\1>/g;

const TOOL_KEY: Record<string, string[]> = {
  Read: ['file_path'], Edit: ['file_path'], Write: ['file_path'], NotebookEdit: ['notebook_path'],
  Bash: ['description', 'command'], Grep: ['pattern'], Glob: ['pattern'],
  Skill: ['skill'], TaskCreate: ['subject'], TaskUpdate: ['status'],
  Agent: ['description'], Task: ['description'], WebFetch: ['url'],
};

function basename(p: string): string { return p.split(/[\\/]/).pop() || p; }

function toolSkeleton(name: string, input: any): string {
  if (name?.startsWith('mcp__')) return `[${name}]`;
  const keys = TOOL_KEY[name];
  if (!keys || !input) return `[${name}]`;
  for (const k of keys) {
    let v = input[k];
    if (typeof v === 'string' && v) {
      if (k === 'file_path' || k === 'notebook_path') v = basename(v);
      if (v.length > 60) v = v.slice(0, 60) + '…';
      return `[${name} ${v}]`;
    }
  }
  return `[${name}]`;
}

export function cleanTranscriptFromLines(
  sessionId: string, lines: string[], originalBytes: number, sourceMtime: number,
): CleanedTranscript {
  const out: string[] = [];
  let turnCount = 0;
  let lastTimestamp = '';
  for (const raw of lines) {
    let o: any;
    try { o = JSON.parse(raw); } catch { continue; }
    const t = o?.type;
    if (t !== 'user' && t !== 'assistant') continue;          // envelope 行
    if (o.isSidechain === true || o.isMeta === true) continue; // 子 agent / 注入
    const m = o.message;
    if (!m) continue;
    const ts = o.timestamp || '';
    const uuid = o.uuid || '';
    if (t === 'user') {
      const c = m.content;
      if (typeof c !== 'string') continue;                    // tool_result 数组 → 丢
      const stripped = c.replace(SYS_TAG_RE, '').trim();
      if (!stripped) continue;                                 // 剥完为空 → 丢
      out.push(`## [user · ${ts} · ${uuid}] ${stripped}`);
      turnCount++; if (ts) lastTimestamp = ts;
    } else {
      const c = m.content;
      if (!Array.isArray(c)) continue;
      const parts: string[] = [];
      const skeletons: string[] = [];
      for (const b of c) {
        if (b?.type === 'text' && b.text?.trim()) parts.push(b.text.trim());
        else if (b?.type === 'tool_use') skeletons.push(toolSkeleton(b.name, b.input));
        // thinking → 丢
      }
      if (!parts.length && !skeletons.length) continue;
      const head = parts.join('\n');
      out.push(`## [assistant · ${ts} · ${uuid}] ${head}` +
        (skeletons.length ? '\n' + skeletons.join('\n') : ''));
      turnCount++; if (ts) lastTimestamp = ts;
    }
  }
  const transcript = out.join('\n\n');
  return {
    sessionId, transcript, turnCount, lastTimestamp, sourceMtime,
    stats: { originalBytes, cleanedChars: transcript.length,
      ratio: transcript.length ? originalBytes / transcript.length : 0 },
  };
}

export async function cleanTranscript(
  workspacePath: string, sdkSessionId: string,
): Promise<CleanedTranscript> {
  const file = getSessionJsonlPath(workspacePath, sdkSessionId);
  const stat = await fs.stat(file);
  const text = await fs.readFile(file, 'utf-8');
  const lines = text.split('\n').filter(Boolean);
  return cleanTranscriptFromLines(sdkSessionId, lines, stat.size, stat.mtimeMs);
}
```

**Step 4：跑测试通过** `bun test electron/main/services/memory/transcript-cleaner.test.ts` → PASS。

**Step 5：手验压缩比**（临时脚本，验完删）：对一个真实大会话调 `cleanTranscript`，打印 `stats`，确认 ratio 接近 ~30x、transcript 可读。

**Step 6：commit** `feat(memory): A1 会话清洗纯函数 + 单测`。

---

## Task 2：CleanTranscript MCP 工具（内联返回 + 留底）

**Files:**
- Create: `electron/main/agents/tools/digest-tools.ts`
- Create: `electron/main/services/memory/digest-store.ts`（卡 + 留底 + 路径，本任务先建留底部分）

**digest-store.ts 路径函数（决策 J）：**

```ts
import path from 'node:path';
import { getClaudeConfigDir } from './session-paths.js';
function workspaceDir(wsId: string) {
  return path.join(getClaudeConfigDir(), '..', 'workspaces', wsId); // = <configDir>/workspaces/<wsId>
}
```

> 注意 `getClaudeConfigDir()` = `<.dogear>/conversations`，工作区数据在 `<.dogear>/workspaces`。所以用 `path.join(getClaudeConfigDir(), '..', 'workspaces', wsId)`，或直接复用 conversation-service 的 `getWorkspaceDataDir`（**优先**：把它从 conversation-service 导出复用，避免 `..` 拼接）。

落留底：`getDigestsDir(wsId)/_cleaned/<sessionId>.md`，写入 `cleaned.transcript`。

**digest-tools.ts**：照 `memory-tools.ts` 的 `createSdkMcpServer`/`tool` 范式，`createDigestTools(workspaceId, workspacePath)` 暴露 `CleanTranscript`：

```ts
tool('CleanTranscript',
  '对指定会话做确定性去噪，返回干净逐字稿（已剥工具结果/系统行/思考块，保留用户+助手文字与一行工具骨架，每段带完整 uuid）。同时落一份留底到磁盘供排查。',
  { sdkSessionId: z.string().describe('SDK 会话 ID') },
  async (args) => {
    const cleaned = await cleanTranscript(workspacePath, args.sdkSessionId);
    await saveCleanedBackup(workspaceId, args.sdkSessionId, cleaned.transcript);
    return { content: [{ type: 'text' as const, text:
      `turnCount=${cleaned.turnCount} ratio=${cleaned.stats.ratio.toFixed(1)}\n` +
      `lastTimestamp=${cleaned.lastTimestamp}\n\n${cleaned.transcript}` }] };
  },
)
```

`registerTools([...])` 注册元数据（server:`dogear-memory-digest`, category:`memory`）。

**验证**：`bun run build:electron` 通过。commit `feat(memory): CleanTranscript MCP 工具 + 留底`。

---

## Task 3：摘要卡读写 + SaveDigest/ReadExistingDigest 工具

**Files:**
- Modify: `electron/main/services/memory/digest-store.ts`（加卡读写）
- Modify: `electron/main/agents/tools/digest-tools.ts`（加两工具）
- Test: `electron/main/services/memory/digest-store.test.ts`

**卡结构（设计 4.3，无 topics）**。digest-store 提供：

```ts
export interface DigestCard {
  sessionId: string; conversationId?: string; title: string;
  createdAt: string; sourceMtime: number; turnCount: number;
  summary: string; items: { kind: string; text: string; uuid: string }[];
}
export async function saveDigest(wsId: string, card: DigestCard): Promise<void>;
export async function readDigest(wsId: string, sessionId: string): Promise<DigestCard | null>;
export function getDigestPath(wsId: string, sessionId: string): string; // <digests>/<sessionId>.md
```

序列化：frontmatter（sessionId/conversationId/title/createdAt/sourceMtime/turnCount）+ `## 概述`（summary）+ `## 想法 / 注意 / 决策`（items 每条 `- [kind] text ⟶ uuid`）。复用 memory-fs 的 frontmatter helper；items 序列化/解析自写小函数。

**Step 1：写测试**（round-trip：saveDigest 后 readDigest 得到等价对象；items 顺序/kind/uuid 保留）→ FAIL → 实现 → PASS。

**SaveDigest 工具**入参 zod：`{ sessionId, title, summary, items: array({kind:enum(['决策','想法','注意','搁置']), text, uuid}) }`，内部补 `createdAt=now`、从 `cleanTranscript` 的结果或单独 stat 补 `sourceMtime`/`turnCount`（实现时：SaveDigest 再 stat 一次 JSONL 拿 mtime，或让 prompt 把 CleanTranscript 返回的 lastTimestamp 透传——**采用 SaveDigest 内部 stat JSONL 拿 mtime/turnCount**，避免依赖模型透传）。`conversationId` 由 SaveDigest 反查 conversations.json（见 Task 6 的枚举，可空）。

**ReadExistingDigest 工具**：`{ sessionId }` → 返回旧卡正文（无则 `(无旧摘要)`）。

**验证**：`bun test` + `bun run build:electron`。commit `feat(memory): 摘要卡读写 + SaveDigest/ReadExistingDigest 工具`。

---

## Task 4：settings 增加提炼模型档位

**Files:**
- Modify: `types/settings.ts`（`ai.digestModelTier?: 'haiku'|'sonnet'|'opus'`，默认 `'haiku'`）
- Modify: `electron/main/types.ts`（镜像，若有 AppSettings 镜像）
- Modify: `DEFAULT_SETTINGS.ai` 加 `digestModelTier: 'haiku'`

仅类型 + 默认值，无逻辑。`bun run build:electron` 通过。commit `feat(settings): 新增会话提炼模型档位 digestModelTier`。

---

## Task 5：DIGEST_SESSION 任务 + handler + 默认提示词模板

**Files:**
- Modify: `electron/main/agents/task-types.ts`（枚举 `DIGEST_SESSION='digest_session'` + `DigestSessionPayload { workspaceId; workspacePath; sdkSessionId; configDir; isPackaged; cliPath; digestModelTier }`）
- Modify: `electron/main/agents/agent-worker.ts`（switch 加 `case TaskType.DIGEST_SESSION` → `handleDigestSessionTask`）
- Create: `electron/main/services/memory/digest-prompt.ts`（默认模板常量 + 播种/读取 `<configDir>/digest-prompt.md`）

**digest-prompt.ts**：
```ts
export const DEFAULT_DIGEST_PROMPT = `你在为一段开发会话写「会话摘要卡」……
1. 调 ReadExistingDigest(sessionId) 看是否已有旧摘要；
2. 调 CleanTranscript(sessionId) 拿干净逐字稿；
3. 若有旧摘要且内容有新增，对比后重写/增补，否则全新提炼；
4. 提炼：概述「这次会话做了几件事 + 简述」；抓「想法/注意/决策/搁置」条目，每条带出处 uuid（取自逐字稿每段 · 后的 uuid）；
5. 调 SaveDigest 落卡。only 用这三个工具，不要用别的工具。`;
export async function loadDigestPrompt(): Promise<string>; // 缺失则写入 DEFAULT 再返回
```

**handleDigestSessionTask**：照 `handleParseArticleTask`（agent-worker.ts:347）写：
- `buildQueryBaseConfig({configDir,isPackaged,cliPath})`
- **覆盖模型**：`env.ANTHROPIC_MODEL = activeProfile[`${digestModelTier}Model`]`（从 settings 读 active profile；参考 agent-query-config.ts 的 tierMap 用法）
- `mcpServers: { 'dogear-memory-digest': createDigestTools(workspaceId, workspacePath) }`
- `allowedTools: ['mcp__dogear-memory-digest__CleanTranscript','...__ReadExistingDigest','...__SaveDigest']`
- `permissionMode:'dontAsk'`
- `prompt = (await loadDigestPrompt()) + `\n\n目标会话 sessionId: ${sdkSessionId}``
- 消费 `query()` 流直到结束，返回 `{ saved: boolean }`（检测是否调过 SaveDigest，可在工具回调里置标志）

**验证**：`bun run build:electron`。commit `feat(memory): DIGEST_SESSION 任务 + handler + 默认提示词模板`。

---

## Task 6：脏检查 + 枚举

**Files:**
- Create: `electron/main/services/memory/digest-scanner.ts`
- 复用：`conversation-service.getByWorkspaceId(wsId)`（拿 sdkSessionId 列表）、`workspace-json-service`（拿 workspace path + 列全部工作区）

```ts
export interface DirtySession { workspaceId: string; workspacePath: string; sdkSessionId: string; }

export async function findDirtySessions(wsId: string, wsPath: string): Promise<DirtySession[]> {
  // 1. getByWorkspaceId(wsId) → 过滤 sdkSessionId 非空、未归档
  // 2. 对每个：stat JSONL（getSessionJsonlPath，不存在则跳过）拿 mtimeMs
  // 3. readDigest(wsId, sid)：无卡 || card.sourceMtime !== mtimeMs → dirty
}
export async function scanAllWorkspaces(): Promise<DirtySession[]>; // 遍历所有工作区
```

**Test** `digest-scanner.test.ts`：构造临时目录 + 假 JSONL + 假卡，断言「无卡命中」「mtime 变了命中」「mtime 一致跳过」。`bun test` PASS。

commit `feat(memory): 会话脏检查扫描`。

---

## Task 7：三触发点接线

**Files:**
- Create: `electron/main/services/memory/digest-trigger.ts`（统一：把 DirtySession 转成 DIGEST_SESSION 任务提交 `getAgentManager().submitTask`，带串行/限流，避免一次塞几十个）
- Modify: `electron/main/index.ts:~410`（app.whenReady、getAgentManager 之后）→ 启动后 `scanAllWorkspaces()` 后台扫一遍（决策：延迟几秒、低优先，不阻塞窗口）
- Modify: `electron/main/index.ts`（注册 `setInterval`，每小时检查本地时间命中夜间档位 03:xx 且软件开着 → 扫一遍；app 退出 `clearInterval`）
- Modify: `electron/main/tipc/agent.ts:153 closeSession`（关会话后，对该 session 跑单条脏检查→提交任务）

**digest-trigger.ts** 关键：维护 `Set<sessionId>` 在途去重；每条提交后等完成或限并发=1（提炼是后台、不赶时间）。

**验证**：`bun run build:electron`；dev 跑起来，开软件观察日志是否对存量会话逐个提炼、digests 目录是否产出卡。commit `feat(memory): 提炼三触发点（启动扫/夜间定时/关会话）`。

---

## Task 8：A3 IPC

**Files:**
- Create: `electron/main/tipc/digest.ts`（`listDigests({workspaceId})` / `readDigest({workspaceId,sessionId})` / `triggerDigest({workspaceId,workspacePath,sdkSessionId})` 手动提炼 / `getDigestModelTier` / `setDigestModelTier`）
- Modify: `electron/main/tipc/index.ts`（注册 digestRouter）
- Modify: `lib/client.ts` 若需类型（tipc 自动推导，一般无需手改）

`listDigests`：读 `getDigestsDir(wsId)` 下 `*.md`（排除 `_cleaned/`），解析 frontmatter 返回卡列表摘要（sessionId/title/createdAt/turnCount）。

**验证**：`bun run build:electron`。commit `feat(memory): 摘要卡巡检 IPC`。

---

## Task 9：A3 MemoryTab 巡检视图 + 模型下拉

**Files:**
- Modify: `app/settings/MemoryTab.tsx`（内层 Tabs 加「会话摘要」）
- Create: `app/settings/memory/DigestsPanel.tsx`（卡列表 + 点开看正文 + 条目 uuid 回溯链接 + 顶部「提炼模型」下拉 + 手动「提炼此会话」入口）

- 列表：`client.listDigests({workspaceId})`；点击 `client.readDigest` 看正文（MarkdownRenderer 渲染）。
- 模型下拉：选 haiku/sonnet/opus → `client.setDigestModelTier`（落 settings）。
- 回溯：uuid → 复用现有「跳到会话某条消息」能力（查 conversation-store/会话窗口的定位 API；无则先只展示 uuid 文本，跳转留 TODO 注释说明）。

**验证**：`bun run dev`，进设置→记忆→会话摘要，确认列表/正文/下拉可用（UI 改动必须真在浏览器里点过）。commit `feat(memory): MemoryTab 会话摘要巡检 + 提炼模型下拉`。

---

## Task 10：端到端验收

- 删掉一两张已生成卡 → 开软件 → 确认脏检查重新提炼。
- 打开一张差卡的 `_cleaned/<sessionId>.md` 留底，核对去噪质量。
- 调整 `<configDir>/digest-prompt.md` → 手动「提炼此会话」→ 确认模板生效。
- 改提炼模型档位 → 手动提炼 → 日志确认用了对应模型。
- `bun run build`（前端+主进程）全绿、`bun run lint` 无新增错误。
- 更新 `.claude/rules/codebase-map.md`（新增 memory digest 模块条目）+ 在设计文档/里程碑文档勾掉 Phase A。commit。

---

## 风险 / 待实施时确认

1. `memory-fs` 的 frontmatter helper 导出名与能力（数组/时间戳够用）——Task 3 前先读确认。
2. `buildQueryBaseConfig` 后覆盖 `ANTHROPIC_MODEL` 是否被 SDK 尊重——Task 5 实测一条。
3. 启动扫描对 ~30 存量会话的节流：必须串行/限并发=1，否则一次起几十个 query 烧钱卡机（Task 7 务必做）。
4. uuid 回溯跳转的现成 API 是否存在——Task 9 查；没有就先只读展示。
</content>
