# 里程碑 2 · Phase A 增强：提炼可观测性 + 独立模型方案

> **For Claude:** REQUIRED SUB-SKILL: 用 superpowers:executing-plans 按任务逐条实施本计划。
> 前置：`./milestone-2-phaseA-digest-design.md` / `-implementation.md`（Phase A 已落地的提炼闭环）。本计划是其上的两个增强。

**Goal:** ①让后台会话提炼任务在「记忆 Tab」里可见（正在提炼谁、产没产卡、失败原因、上次扫描发现几个脏会话）；②让提炼 agent 独立选择「模型方案 + 档位」，与主会话 activeProfile 解耦。

**Architecture:**
- 需求一：`digest-trigger.ts` 从无状态队列升级为带内存活动状态（current / queueDepth / recent 环形缓冲 / lastScan）。关键点：`submitTask` 回调签名 `(taskId, status, result?, error?)` 已经能拿到 worker 返回的 `{ saved, tier, error }`，现在被丢弃，改为采集。新增 `getDigestActivity` IPC，`DigestsPanel` 顶部活动区 2s 轮询展示。
- 需求二：`AppSettings.ai` 新增 `digestProfileId`。从 `agent-query-config.ts` 抽出 `buildProfileEnv` 纯函数，`buildQueryBaseConfig` 与 digest worker 共用；digest worker 用 `digestProfileId` 对应 profile 重建**全部凭证 env**（不只是 `ANTHROPIC_MODEL`），并校验完整性，不完整时返回明确 error（会显示在活动区）。

**Tech Stack:** TypeScript + Electron 主进程 + `@anthropic-ai/claude-agent-sdk` + `@egoist/tipc` + React 19 + Zustand + bun:test。

---

## 通用约定（实施者必读）

- **测试框架是 `bun:test`**：`import { test, expect } from 'bun:test'`；跑 `bun test <文件>`。**不是 vitest**。
- 主进程 TS 改动需 `bun run build:electron` 才生效；前端改动 Vite 热重载。整体编译 `bun run build`。
- 主进程**不能**导入 `types/`；类型镜像在 `electron/main/services/settings-types.ts`（已镜像 `AppSettings`）。新增字段两边都要改。
- digest 系列 IPC 走 tipc 自动类型推导，`types/electron-api.ts` **没有**手动声明 digest 路由，本计划也**不需要**改它。
- 渲染层只能用 `import()`，不能 `require()`；图标用 lucide-react；类名用 `cn()`。
- 命令统一加 `rtk` 前缀（见项目 CLAUDE.md）。
- 提交粒度：每个 Task 末尾 commit 一次；commit 前 `rtk bun run build:electron`（有前端改动再 `rtk bun run build`），有测试先 `rtk bun test`。

---

## Task 1：数据模型 — 新增 `digestProfileId`

**Files:**
- Modify: `types/settings.ts`（`AppSettings.ai`）
- Modify: `electron/main/services/settings-types.ts`（镜像，约 :46 附近）

**Step 1**：`types/settings.ts` 在 `digestModelTier` 字段下方加：

```ts
    /** 会话提炼使用的模型方案 id（缺省回退 activeProfileId，与主会话解耦） */
    digestProfileId?: string;
```

**Step 2**：`electron/main/services/settings-types.ts` 在镜像的 `digestModelTier?:`（:46）下方加同样一行。

**Step 3**：`DEFAULT_SETTINGS.ai` 不需要加默认值（缺省 undefined → 运行时回退 activeProfileId）。确认两处 `AppSettings` 接口一致。

**Step 4**：`rtk bun run build:electron` 必须通过。

**Step 5**：commit `feat(memory): settings 新增 digestProfileId 字段`。

---

## Task 2：抽出 `buildProfileEnv` 纯函数（TDD）

把 `agent-query-config.ts:124-134,159-161` 的「凭证 + 模型映射 + 1M 上下文」env 拼装抽成可复用纯函数，供 `buildQueryBaseConfig` 与 digest worker 共用，避免两处凭证拼装漂移。

**Files:**
- Modify: `electron/main/services/agent-query-config.ts`
- Test: `electron/main/services/agent-query-config.test.ts`（新建）

**Step 1：写失败测试**

```ts
import { test, expect } from 'bun:test';
import { buildProfileEnv } from './agent-query-config.js';
import type { ModelProfile } from './settings-types.js';

const profile: ModelProfile = {
  id: 'p1', name: '测试', apiKey: 'sk-test', baseUrl: 'https://api.test',
  haikuModel: 'h', sonnetModel: 's', opusModel: 'o',
  apiTimeoutMs: 3000000, disableNonessentialTraffic: true,
};

test('buildProfileEnv 注入凭证与模型映射', () => {
  const env = buildProfileEnv(profile, '/cfg/conversations');
  expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-test');
  expect(env.ANTHROPIC_BASE_URL).toBe('https://api.test');
  expect(env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe('h');
  expect(env.CLAUDE_CONFIG_DIR).toBe('/cfg/conversations');
  expect(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBeUndefined();
});

test('buildProfileEnv 在 enable1MContext 时设置压缩窗口', () => {
  const env = buildProfileEnv({ ...profile, enable1MContext: true }, '/cfg/conversations');
  expect(env.CLAUDE_CODE_AUTO_COMPACT_WINDOW).toBe('900000');
});
```

**Step 2：运行验证失败**

Run: `rtk bun test electron/main/services/agent-query-config.test.ts`
Expected: FAIL（`buildProfileEnv` is not a function）

**Step 3：实现**

在 `agent-query-config.ts` 导出新函数（放 `buildQueryBaseConfig` 之前）：

```ts
/**
 * 拼装单个 Profile 的凭证 + 模型映射环境变量（不含 ANTHROPIC_MODEL/SUBAGENT 档位决策）。
 * buildQueryBaseConfig 与后台 digest 任务共用，确保换 Profile 时凭证整体切换。
 */
export function buildProfileEnv(
  profile: ModelProfile,
  claudeConfigDir: string,
): Record<string, string> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ANTHROPIC_AUTH_TOKEN: profile.apiKey,
    ANTHROPIC_BASE_URL: profile.baseUrl,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: profile.haikuModel,
    ANTHROPIC_DEFAULT_SONNET_MODEL: profile.sonnetModel,
    ANTHROPIC_DEFAULT_OPUS_MODEL: profile.opusModel,
    API_TIMEOUT_MS: String(profile.apiTimeoutMs),
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: profile.disableNonessentialTraffic ? '1' : '0',
    CLAUDE_CONFIG_DIR: claudeConfigDir,
  };
  if (profile.enable1MContext) {
    env.CLAUDE_CODE_AUTO_COMPACT_WINDOW = '900000';
  }
  return env;
}
```

**Step 4：改 `buildQueryBaseConfig` 复用它**

把 :124-134 的 `const env = {...}` 改为 `const env = buildProfileEnv(activeProfile, claudeConfigDir);`，并删掉 :159-161 重复的 `enable1MContext` 分支（已并入 `buildProfileEnv`）。`ANTHROPIC_MODEL` / `CLAUDE_CODE_SUBAGENT_MODEL` 的注入逻辑（:146-155）保持不动。

**Step 5：运行验证通过**

Run: `rtk bun test electron/main/services/agent-query-config.test.ts` → PASS
Run: `rtk bun run build:electron` → 通过

**Step 6：commit** `refactor(agent): 抽出 buildProfileEnv 复用凭证 env 拼装`

---

## Task 3：digest worker 用独立 Profile 重建 env

**Files:**
- Modify: `electron/main/agents/agent-worker.ts`（`handleDigestSessionTask`，:550-619）

**Step 1**：确认文件顶部已 `import path`（否则补 `import path from 'node:path';`）。

**Step 2**：替换 :565-574 的模型/env 构造块为：

```ts
    // 提炼方案：digestProfileId 指定的 Profile，缺省回退主会话 activeProfile
    const { buildProfileEnv } = await import('../services/agent-query-config.js');
    const { isProfileComplete } = await import('../services/settings-types.js');
    const digestProfileId = baseConfig.appSettings.ai.digestProfileId;
    const digestProfile =
      (digestProfileId && baseConfig.appSettings.profiles[digestProfileId])
      || baseConfig.activeProfile;

    if (!isProfileComplete(digestProfile)) {
      const error = `提炼方案「${digestProfile.name}」配置不完整（缺 API Key / Base URL / 模型映射）`;
      taskLogger.error('会话提炼任务终止:', error);
      return { sdkSessionId, saved: false, error };
    }

    const tier = payload.digestModelTier
      ?? baseConfig.appSettings.ai.digestModelTier
      ?? 'haiku';
    const tierMap: Record<'haiku' | 'sonnet' | 'opus', string> = {
      haiku: digestProfile.haikuModel,
      sonnet: digestProfile.sonnetModel,
      opus: digestProfile.opusModel,
    };
    const claudeConfigDir = path.join(this.configDir, 'conversations');
    const env = {
      ...buildProfileEnv(digestProfile, claudeConfigDir),
      ANTHROPIC_MODEL: tierMap[tier],
    };
```

> 注：原来用 `{ ...baseConfig.env, ANTHROPIC_MODEL }`，只换了模型名却仍用 activeProfile 的凭证；现在整体用 digestProfile 的 env。`tier` 的 effort 透传逻辑（:591 `tier !== 'haiku'`）保持不变。

**Step 3**：成功返回值带上方案名，便于活动区显示：把 :613 改为
`return { sdkSessionId, saved, tier, profileName: digestProfile.name };`

**Step 4**：`rtk bun run build:electron` 通过。

**Step 5**：commit `feat(memory): 提炼任务使用独立模型方案重建凭证 env`

---

## Task 4：`digest-trigger` 有状态化 + 活动采集（TDD 纯函数）

**Files:**
- Modify: `electron/main/services/memory/digest-trigger.ts`
- Test: `electron/main/services/memory/digest-trigger.test.ts`（新建，只测纯函数 `classifyOutcome`）

**Step 1：写失败测试**

```ts
import { test, expect } from 'bun:test';
import { classifyOutcome } from './digest-trigger.js';

test('有 error 判为 error', () => {
  expect(classifyOutcome({ saved: false }, 'boom')).toBe('error');
  expect(classifyOutcome({ saved: false, error: 'x' })).toBe('error');
});
test('saved=true 判为 saved', () => {
  expect(classifyOutcome({ saved: true })).toBe('saved');
});
test('saved=false 且无 error 判为 no-card', () => {
  expect(classifyOutcome({ saved: false })).toBe('no-card');
});
```

**Step 2**：Run `rtk bun test electron/main/services/memory/digest-trigger.test.ts` → FAIL

**Step 3：实现活动状态**

在 `digest-trigger.ts` 顶部（`import` 后）加类型与模块状态：

```ts
import { TaskStatus as TS } from '../../agents/task-types.js'; // 若已 import TaskStatus 则复用

export type DigestOutcome = 'saved' | 'no-card' | 'error';

export interface DigestRecentEntry {
  workspaceId: string;
  sessionId: string;
  finishedAt: number;
  outcome: DigestOutcome;
  tier?: string;
  profileName?: string;
  error?: string;
  durationMs: number;
}

export interface DigestActivity {
  current: { workspaceId: string; sessionId: string; startedAt: number } | null;
  queueDepth: number;
  recent: DigestRecentEntry[];
  lastScan: { at: number; dirtyCount: number } | null;
}

const RECENT_MAX = 15;
let current: DigestActivity['current'] = null;
const recent: DigestRecentEntry[] = [];
let lastScan: DigestActivity['lastScan'] = null;

/** 由 worker result + error 判定结果类别（纯函数，可单测） */
export function classifyOutcome(result: any, error?: string): DigestOutcome {
  if (error || result?.error) return 'error';
  return result?.saved ? 'saved' : 'no-card';
}

export function getDigestActivity(): DigestActivity {
  return {
    current,
    queueDepth: queue.length + inFlight.size,
    recent: recent.slice(),
    lastScan,
  };
}
```

> `queue` / `inFlight` 是文件内已有的模块变量，直接引用。`TaskStatus` 文件已 import（`runOne` 用到），复用即可，无需新别名——上面 `import TS` 行仅在尚未 import 时才加。

**Step 4：改 `runOne` 采集生命周期**（替换现有 :50-76）：

```ts
function runOne(d: DirtySession): Promise<void> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    current = { workspaceId: d.workspaceId, sessionId: d.sdkSessionId, startedAt };

    const pushRecent = (outcome: DigestOutcome, extra: Partial<DigestRecentEntry>) => {
      recent.unshift({
        workspaceId: d.workspaceId,
        sessionId: d.sdkSessionId,
        finishedAt: Date.now(),
        outcome,
        durationMs: Date.now() - startedAt,
        ...extra,
      });
      if (recent.length > RECENT_MAX) recent.length = RECENT_MAX;
      current = null;
    };

    const task: AgentTask = {
      id: `digest-${d.sdkSessionId}-${Date.now()}`,
      type: TaskType.DIGEST_SESSION,
      status: TaskStatus.PENDING,
      payload: {
        workspaceId: d.workspaceId,
        workspacePath: d.workspacePath,
        sdkSessionId: d.sdkSessionId,
      } as DigestSessionPayload,
      createdAt: Date.now(),
    };

    getAgentManager().submitTask(task, (_taskId, status, result, error) => {
      if (
        status === TaskStatus.COMPLETED ||
        status === TaskStatus.FAILED ||
        status === TaskStatus.CANCELLED
      ) {
        const outcome = status === TaskStatus.CANCELLED ? 'error' : classifyOutcome(result, error);
        pushRecent(outcome, {
          tier: result?.tier,
          profileName: result?.profileName,
          error: error ?? result?.error ?? (status === TaskStatus.CANCELLED ? '已取消' : undefined),
        });
        resolve();
      }
    }).catch((err) => {
      mainLogger.warn('[digest] 提交提炼任务失败:', key(d), err);
      pushRecent('error', { error: String(err) });
      resolve();
    });
  });
}
```

**Step 5：记录 lastScan**：在 `triggerScanAll` 里 `const dirty = await scanAllWorkspaces();` 之后加 `lastScan = { at: Date.now(), dirtyCount: dirty.length };`；在 `triggerScanByConversation` 里 `const dirty = await findDirtySessions(...)` 之后加同样一行。

**Step 6**：Run `rtk bun test electron/main/services/memory/digest-trigger.test.ts` → PASS；`rtk bun run build:electron` → 通过。

**Step 7**：commit `feat(memory): digest-trigger 采集提炼活动状态`

---

## Task 5：IPC — profileId get/set + getDigestActivity

**Files:**
- Modify: `electron/main/tipc/digest.ts`

**Step 1**：在 `digestRouter` 末尾（`setDigestModelTier` 之后）追加：

```ts
  /** 读取提炼模型方案 id（缺省回退主会话 activeProfileId） */
  getDigestProfileId: t.procedure
    .action(async () => {
      try {
        const settings = await loadSettings();
        return { profileId: settings.ai.digestProfileId ?? settings.ai.activeProfileId };
      } catch (error) {
        console.error('[digest] getDigestProfileId 失败:', error);
        return { error: String(error) };
      }
    }),

  /** 设置提炼模型方案 id */
  setDigestProfileId: t.procedure
    .input<{ profileId: string }>()
    .action(async ({ input }) => {
      try {
        const settings = await loadSettings();
        settings.ai.digestProfileId = input.profileId;
        await saveSettings(settings);
        return { success: true };
      } catch (error) {
        console.error('[digest] setDigestProfileId 失败:', error);
        return { error: String(error) };
      }
    }),

  /** 读取提炼活动状态（前端轮询用） */
  getDigestActivity: t.procedure
    .action(async () => {
      try {
        const { getDigestActivity } = await import('../services/memory/digest-trigger.js');
        return { activity: getDigestActivity() };
      } catch (error) {
        console.error('[digest] getDigestActivity 失败:', error);
        return { error: String(error) };
      }
    }),
```

**Step 2**：`rtk bun run build:electron` 通过（tipc 自动推导类型，`electron-api.ts` 不动）。

**Step 3**：commit `feat(memory): digest 新增 profileId 与 activity IPC`

---

## Task 6：`DigestsPanel` UI — 方案/档位双下拉 + 活动区 + 轮询

**Files:**
- Modify: `app/settings/memory/DigestsPanel.tsx`

**Step 1：加状态与加载**。在组件内现有 state 后加：

```ts
  const [profiles, setProfiles] = useState<{ id: string; name: string }[]>([]);
  const [profileId, setProfileId] = useState<string>('');
  const [activity, setActivity] = useState<DigestActivity | null>(null);
```

`DigestActivity` 类型在前端本地声明（与主进程结构一致，避免跨界 import）：

```ts
interface DigestActivity {
  current: { workspaceId: string; sessionId: string; startedAt: number } | null;
  queueDepth: number;
  recent: Array<{
    sessionId: string; finishedAt: number;
    outcome: 'saved' | 'no-card' | 'error';
    tier?: string; profileName?: string; error?: string; durationMs: number;
  }>;
  lastScan: { at: number; dirtyCount: number } | null;
}
```

**Step 2：初始化加载方案 + 提炼方案选择**。在现有 `useEffect`（:65-70）里补：

```ts
    client.getSettings().then((s) => {
      const list = Object.values(s.profiles ?? {}).map((p: any) => ({ id: p.id, name: p.name }));
      setProfiles(list);
    });
    client.getDigestProfileId().then((r) => {
      if ('profileId' in r && r.profileId) setProfileId(r.profileId);
    });
```

**Step 3：活动轮询**。新增 `useEffect`：

```ts
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const r = await client.getDigestActivity();
      if (alive && 'activity' in r && r.activity) setActivity(r.activity as DigestActivity);
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => { alive = false; clearInterval(id); };
  }, []);
```

**Step 4：方案选择 handler**：

```ts
  const handleProfileChange = async (next: string) => {
    setProfileId(next);
    await client.setDigestProfileId({ profileId: next });
  };
```

**Step 5：渲染**。把顶部「提炼模型」那一块（:93-110）的模型选择改为「方案下拉 + 档位下拉」，并在其下方加活动区。方案下拉：

```tsx
          <select
            className="h-9 px-3 text-sm border rounded bg-background"
            value={profileId}
            onChange={(e) => handleProfileChange(e.target.value)}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
```

档位下拉沿用现有 `tier` 的 select。活动区（放在 `flex items-center justify-between` 那一行下方）：

```tsx
      {activity && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm space-y-2">
          <div className="flex items-center gap-2">
            {activity.current ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-primary" />
                <span>正在提炼 <code className="text-xs">{activity.current.sessionId.slice(0, 12)}…</code></span>
              </>
            ) : (
              <span className="text-muted-foreground">空闲</span>
            )}
            {activity.queueDepth > 0 && (
              <Badge variant="secondary">队列 {activity.queueDepth}</Badge>
            )}
            {activity.lastScan && (
              <span className="ml-auto text-xs text-muted-foreground">
                上次扫描发现 {activity.lastScan.dirtyCount} 个待提炼 ·{' '}
                {new Date(activity.lastScan.at).toLocaleTimeString()}
              </span>
            )}
          </div>
          {activity.recent.length > 0 && (
            <ul className="space-y-1">
              {activity.recent.slice(0, 5).map((r, i) => (
                <li key={i} className="flex items-center gap-2 text-xs">
                  <span>
                    {r.outcome === 'saved' ? '✅' : r.outcome === 'no-card' ? '⚠️' : '❌'}
                  </span>
                  <code className="truncate max-w-[160px]">{r.sessionId.slice(0, 12)}…</code>
                  {r.tier && <span className="text-muted-foreground">{r.tier}</span>}
                  {r.outcome === 'no-card' && <span className="text-muted-foreground">未产卡</span>}
                  {r.error && <span className="text-destructive truncate max-w-[200px]" title={r.error}>{r.error}</span>}
                  <span className="ml-auto text-muted-foreground">
                    {new Date(r.finishedAt).toLocaleTimeString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
```

**Step 6**：`rtk bun run build`（含前端）通过；`rtk bun run lint` 0 error。开发态 `bun run dev` 打开设置→记忆 Tab 目视：方案/档位两个下拉、活动区随轮询刷新。

**Step 7**：commit `feat(memory): 记忆 Tab 提炼活动区 + 独立模型方案选择`

---

## Task 7：文档同步 + 运行时验收

**Files:**
- Modify: `.claude/rules/codebase-map.md`（digest-trigger 描述加「+ 活动状态采集」；digest.ts 加 3 个新 IPC；settings.ts 加 digestProfileId；DigestsPanel 加活动区/双下拉）

**Step 1**：跑 `/doc-sync` 或手动更新 codebase-map.md 对应行。

**Step 2：运行时验收清单**（需真实 GUI + API key）：
- 设置→记忆 Tab：方案下拉列出所有已配置 profile，档位下拉三档；切换后重开面板保持选择。
- 点某卡「重新提炼」→ 活动区出现「正在提炼…」+ 队列计数，完成后 recent 出现 ✅/⚠️/❌。
- 故意把 digest 方案切到一个未填 API Key 的 profile → 重新提炼 → 活动区 recent 显示 ❌ + "配置不完整" error。
- 关一个有新消息的会话 → 等几秒看活动区 lastScan「发现 N 个待提炼」与自动提炼。

**Step 3**：commit `docs(memory): 同步提炼可观测性 + 独立模型方案`

---

## 验证矩阵

| 关注点 | 验证方式 |
|--------|----------|
| `buildProfileEnv` 凭证拼装 | `bun test agent-query-config.test.ts` |
| `classifyOutcome` 结果分类 | `bun test digest-trigger.test.ts` |
| 独立方案换凭证生效 | 运行时：未配置方案 → 活动区报 error |
| 活动区实时性 | 运行时：重新提炼 → 2s 内出现 current/recent |
| 主进程编译 | `rtk bun run build:electron` |
| 全量编译 + lint | `rtk bun run build` / `rtk bun run lint` |
