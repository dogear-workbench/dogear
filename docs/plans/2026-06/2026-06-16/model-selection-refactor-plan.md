# 模型选择重构实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把"全局选方案 + 档位"改为"对话级选(profileId, tier)二元组"，统一前后台模型解析路径，修复插话状态机 bug。

**Architecture:** 引入 `ModelSelection = { profileId, tier }` 类型贯穿前后台；conversation 创建时从全局默认拷贝；发送前 reconcile 决定走 setModel/重启/直发；后端用统一 `resolveModelSelection` helper 收敛 4 处重复 env 拼装；插话 bug 靠后端 emit `pendingCountChanged` + 前端派生三态 `idle/running/flushing` 解决。

**Tech Stack:** TypeScript / React 19 / Zustand 5 / Electron / @anthropic-ai/claude-agent-sdk / shadcn DropdownMenu

**Design Doc:** `docs/plans/2026-06/2026-06-16/model-selection-refactor-design.md`（强制先读）

**通用规则：**
- 每个 task 完成后跑 `bun run build:electron && bun run lint`，无报错才能 commit
- **不写单元测试**（项目偏好）：验证靠 build/lint 类型检查 + `bun run dev` 启动跑核心路径手测
- UI/Service 任务在 task 末尾跑 `bun run dev` 启动应用手工验证（步骤里会写明验什么）
- commit message 用 `feat(model): xxx` / `refactor(model): xxx` / `fix(model): xxx` 前缀
- 每个 Phase 完成后 review 一次代码再开下一 Phase

---

## Phase 1: 数据层（类型与默认值）

### Task 1.1: 双份 settings 类型加 ModelSelection + 改 AppSettings 字段

**Files:**
- Modify: `types/settings.ts:1-127`
- Modify: `electron/main/services/settings-types.ts:1-192`

**Step 1.1.1: 在 `types/settings.ts` 顶部加类型**

在 L9 `ModelProfile` 之前插入：
```ts
export type ModelTier = 'haiku' | 'sonnet' | 'opus';

export interface ModelSelection {
  profileId: string;
  tier: ModelTier;
}
```

**Step 1.1.2: 改 `AppSettings.ai` 字段**

L42-62 段（`activeProfileId` 起到 `categorizeProfileId` 止），整段替换为：
```ts
activeProfileId?: never;  // 占位，编译时锁死旧字段读取入口；落地后删除
defaultModelSelection: ModelSelection | null;
digestModelSelection: ModelSelection | null;
reviewModelSelection: ModelSelection | null;
categorizeModelSelection: ModelSelection | null;
subagentModelTier?: ModelTier;
```

注意保留 `effort` / `maxTurns` / `permissionMode` / `defaultSystemPrompt` / `settingSources` / `excludeDynamicSections` / `promptSuggestionsEnabled` / `thinkingDisplay` 不动。

**Step 1.1.3: 镜像到 `settings-types.ts`**

L36-56 段对应替换。注意 `settings-types.ts` 是主进程独立定义（不能 import `types/`），手工保持同步。

**Step 1.1.4: 编译验证**

Run: `bun run build:electron`
Expected: 编译报错列表，全是引用旧字段的位置（在 Phase 2/3/4 里逐个改）。**先记下报错文件清单，作为后续 task 的 punch list**。

**Step 1.1.5: Commit**

```bash
git add types/settings.ts electron/main/services/settings-types.ts
git commit -m "refactor(model): introduce ModelSelection type and replace legacy profile/tier fields"
```

---

### Task 1.2: Conversation 加 modelSelection 字段

**Files:**
- Modify: `types/electron-api.ts`（找 `Conversation` 接口定义）

**Step 1.2.1: 加字段**

在 `Conversation` 接口里加：
```ts
modelSelection: ModelSelection | null;
```

import `ModelSelection` from `./settings`。

**Step 1.2.2: 编译验证**

Run: `bun run build:electron`
Expected: 报错位置应只在 `conversation-service.ts`（持久化路径），其他地方还能编译过（字段是可选语义）。

**Step 1.2.3: Commit**

```bash
git add types/electron-api.ts
git commit -m "refactor(model): add modelSelection field to Conversation type"
```

---

### Task 1.3: Task Payload 字段替换

**Files:**
- Modify: `electron/main/agents/task-types.ts:207/L217/L232`（三个 SessionPayload）

**Step 1.3.1: 三个 Payload 字段替换**

对 `DigestSessionPayload / ReviewSessionPayload / CategorizeSessionPayload`：
- 删 `digestModelTier?` / `reviewModelTier?` / `categorizeModelTier?` 字段
- 加 `modelSelection?: ModelSelection;`（统一字段名，因为是 payload 级覆盖）

import `ModelSelection` from `../services/settings-types.js`（主进程侧）。

**Step 1.3.2: 编译验证**

Run: `bun run build:electron`
Expected: 报错集中在 `agent-worker.ts` / 三个 trigger 文件 / 三个 tipc 文件，符合预期。

**Step 1.3.3: Commit**

```bash
git add electron/main/agents/task-types.ts
git commit -m "refactor(model): replace tier fields with modelSelection in task payloads"
```

---

### Task 1.4: DEFAULT_SETTINGS 调整 + 删 getActiveProfile

**Files:**
- Modify: `types/settings.ts:94-126`（DEFAULT_SETTINGS）
- Modify: `electron/main/services/settings-types.ts:87-191`（DEFAULT_SETTINGS + getActiveProfile）

**Step 1.4.1: 替换 DEFAULT_SETTINGS.ai 内容**

```ts
ai: {
  effort: 'high',
  permissionMode: 'default',
  settingSources: ['user', 'project'],
  defaultSystemPrompt: BUILTIN_DEFAULT_SYSTEM_PROMPT,
  excludeDynamicSections: true,
  promptSuggestionsEnabled: true,
  thinkingDisplay: 'summarized',
  defaultModelSelection: null,
  digestModelSelection: null,
  reviewModelSelection: null,
  categorizeModelSelection: null,
},
```

**Step 1.4.2: 删 `getActiveProfile` 函数**

`settings-types.ts:167-191` 整段删除。后续靠 `resolveModelSelection` 替代（Phase 2 写）。

**Step 1.4.3: 编译验证**

Run: `bun run build:electron`
Expected: 引用 `getActiveProfile` 的位置全部报错（agent-query-config.ts 等）—— Phase 2 修。

**Step 1.4.4: Commit**

```bash
git add types/settings.ts electron/main/services/settings-types.ts
git commit -m "refactor(model): drop getActiveProfile and reset DEFAULT_SETTINGS ai fields"
```

---

## Phase 2: 后端统一 helper

### Task 2.1: 写 resolveModelSelection 纯函数

**Files:**
- Modify: `electron/main/agents/agent-query-config.ts`（在 `buildProfileEnv` 后插入新函数）

**Step 2.1.1: 写实现**

在 `agent-query-config.ts:126` `buildProfileEnv` 函数后插入：

```ts
import type { ModelSelection, ModelTier } from '../services/settings-types.js';

export function resolveModelSelection(
  appSettings: AppSettings,
  selection: ModelSelection | null,
  fallback: ModelSelection | null,
  configDir: string,
): { profile: ModelProfile; tier: ModelTier; modelId: string; env: Record<string, string> } {
  const target = selection ?? fallback;
  if (!target) {
    throw new Error('未指定模型，请先在对话或设置中选择模型');
  }
  const profile = appSettings.profiles[target.profileId];
  if (!profile) {
    throw new Error(`模型方案「${target.profileId}」不存在`);
  }
  if (!isProfileComplete(profile)) {
    throw new Error(`模型方案「${profile.name}」配置不完整（缺 API Key / Base URL / 模型映射）`);
  }
  const claudeConfigDir = path.join(configDir, 'conversations');
  const env = buildProfileEnv(profile, claudeConfigDir);
  const tierMap: Record<ModelTier, string> = {
    haiku: profile.haikuModel,
    sonnet: profile.sonnetModel,
    opus: profile.opusModel,
  };
  env.ANTHROPIC_MODEL = tierMap[target.tier];
  const subagentTier = appSettings.ai.subagentModelTier;
  if (subagentTier) {
    env.CLAUDE_CODE_SUBAGENT_MODEL = tierMap[subagentTier];
  }
  return { profile, tier: target.tier, modelId: tierMap[target.tier], env };
}
```

`isProfileComplete` 已在文件 import 中（如未导入则补 import）。

**Step 2.1.2: 编译验证**

Run: `bun run build:electron && bun run lint`
Expected: 编译通过（新函数还没人调用，但类型自洽即可）

**Step 2.1.3: Commit**

```bash
git add electron/main/agents/agent-query-config.ts
git commit -m "feat(model): add resolveModelSelection helper"
```

---

### Task 2.2: 重构 buildQueryBaseConfig 用新 helper

**Files:**
- Modify: `electron/main/agents/agent-query-config.ts:136-186`

**Step 2.2.1: 重写函数签名 + 实现**

替换 `buildQueryBaseConfig`：

```ts
export interface QueryRuntimeContext {
  configDir: string;
  isPackaged: boolean;
  cliPath?: string;
  /** 主会话路径传入对话级选择；后台任务自己 resolve 不走这里 */
  conversationModelSelection?: ModelSelection | null;
}

export async function buildQueryBaseConfig(ctx: QueryRuntimeContext): Promise<QueryBaseConfig> {
  const appSettings = await loadSettingsFromDir(ctx.configDir);
  const { profile, tier, env } = resolveModelSelection(
    appSettings,
    ctx.conversationModelSelection ?? null,
    appSettings.ai.defaultModelSelection,  // 主会话兜底回到全局默认；理论上 conversation 创建时已拷贝
    ctx.configDir,
  );
  const pathToClaudeCodeExecutable = ctx.isPackaged && ctx.cliPath ? ctx.cliPath : undefined;
  return {
    env,
    effort: appSettings.ai.effort,
    permissionMode: appSettings.ai.permissionMode,
    permissionRules: appSettings.permissionRules,
    maxTurns: appSettings.ai.maxTurns,
    pathToClaudeCodeExecutable,
    settingSources: appSettings.ai.settingSources,
    appSettings,
    resolvedProfile: profile,
    resolvedTier: tier,
  };
}
```

**Step 2.2.2: 改 QueryBaseConfig 类型**

在同文件找 `QueryBaseConfig`，把 `activeProfile: ModelProfile` 重命名为 `resolvedProfile: ModelProfile`，新增 `resolvedTier: ModelTier`。

**Step 2.2.3: 编译验证**

Run: `bun run build:electron`
Expected: 引用 `activeProfile` 的旧位置报错（在 agent-worker.ts），其余应该过——Task 3 修。

**Step 2.2.4: Commit**

```bash
git add electron/main/agents/agent-query-config.ts
git commit -m "refactor(model): rewrite buildQueryBaseConfig to use resolveModelSelection"
```

---

### Task 2.3: QueryBasedSession 接收并传递 modelSelection

**Files:**
- Modify: `electron/main/agents/query-based-session.ts:242-310`（启动配置读取处）
- Modify: `electron/main/agents/query-based-session.ts:177-179`（缓存字段）
- Modify: `electron/main/agents/query-based-session.ts:1771-1793`（setModel 签名）

**Step 2.3.1: 创建参数加 modelSelection**

找到 `QueryBasedSessionConfig` interface（同文件），加字段：
```ts
modelSelection: ModelSelection | null;
```

**Step 2.3.2: 启动时透传到 buildQueryBaseConfig**

在 L242-310 范围内找到调 `buildQueryBaseConfig({...})` 处，加 `conversationModelSelection: this.config.modelSelection`。

把 `currentActiveProfile` 缓存（L177-179）改名 `currentModelSelection: ModelSelection | null`，记录用了哪个 selection（用于 setModel 判断同 profile）：
```ts
this.currentModelSelection = this.config.modelSelection
  ?? baseConfig.appSettings.ai.defaultModelSelection;
```

**Step 2.3.3: 改写 setModel 方法**

L1771-1793 重写：
```ts
async setModel(selection: ModelSelection): Promise<{ ok: true; needsRestart?: boolean } | { ok: false; error: string }> {
  if (!this.currentModelSelection) {
    return { ok: false, error: '当前会话未初始化模型' };
  }
  if (this.currentModelSelection.profileId !== selection.profileId) {
    // 跨 profile：上层负责重启
    return { ok: true, needsRestart: true };
  }
  // 同 profile 换 tier：走 SDK 快速路径
  const profile = this.appSettings.profiles[selection.profileId];
  if (!profile) return { ok: false, error: `方案 ${selection.profileId} 不存在` };
  const tierMap = { haiku: profile.haikuModel, sonnet: profile.sonnetModel, opus: profile.opusModel };
  const modelId = tierMap[selection.tier];
  await this.sdkQuery?.setModel(modelId);
  this.currentModelSelection = selection;
  return { ok: true };
}
```

如果 `this.appSettings` 不在 scope 内，从 `baseConfig.appSettings` 缓存到 `this.appSettings` 字段。

**Step 2.3.4: 编译验证**

Run: `bun run build:electron`
Expected: query-based-session 本身过，调用方（agent-worker create 处 + tipc/agent setSessionModel）报错——下个 task 修。

**Step 2.3.5: Commit**

```bash
git add electron/main/agents/query-based-session.ts
git commit -m "refactor(model): QueryBasedSession accepts modelSelection and signals needsRestart on profile switch"
```

---

## Phase 3: 后端三任务统一

### Task 3.1: 改造 digest handler

**Files:**
- Modify: `electron/main/agents/agent-worker.ts:560-659`（handleDigestSessionTask）

**Step 3.1.1: 替换 env 拼装段**

把 L578-604 段（从 `// 提炼方案：digestProfileId...` 到 `const env = {...}` 结束）替换为：
```ts
const { resolveModelSelection } = await import('./agent-query-config.js');
const selection = payload.modelSelection
  ?? baseConfig.appSettings.ai.digestModelSelection
  ?? baseConfig.appSettings.ai.defaultModelSelection;
let env: Record<string, string>;
let tier: ModelTier;
let resolvedProfile: ModelProfile;
try {
  const r = resolveModelSelection(baseConfig.appSettings, selection, null, this.configDir);
  env = r.env; tier = r.tier; resolvedProfile = r.profile;
} catch (e) {
  const error = e instanceof Error ? e.message : String(e);
  taskLogger.error('会话提炼任务终止:', error);
  return { sdkSessionId, saved: false, error };
}
```

L646-647 的返回值 `profileName: digestProfile.name` 改为 `resolvedProfile.name`。
L625 的 `tier !== 'haiku'` 判断保留（haiku 不传 effort 仍然成立）。

import `ModelTier / ModelProfile` 类型放文件顶部（如缺）。

**Step 3.1.2: 编译验证**

Run: `bun run build:electron`
Expected: digest 部分过；review/category 仍报错。

**Step 3.1.3: Commit**

```bash
git add electron/main/agents/agent-worker.ts
git commit -m "refactor(model): digest handler uses resolveModelSelection"
```

---

### Task 3.2: 改造 review handler

**Files:**
- Modify: `electron/main/agents/agent-worker.ts:668-772`（handleReviewSessionTask）

**Step 3.2.1: 同 Task 3.1 模式**

把 L683-709 段替换为同 3.1.1 结构，但 selection 来源是：
```ts
const selection = payload.modelSelection
  ?? baseConfig.appSettings.ai.reviewModelSelection
  ?? baseConfig.appSettings.ai.defaultModelSelection;
```

`profileName: reviewProfile.name` → `resolvedProfile.name`。

**Step 3.2.2: 编译验证**

Run: `bun run build:electron`

**Step 3.2.3: Commit**

```bash
git add electron/main/agents/agent-worker.ts
git commit -m "refactor(model): review handler uses resolveModelSelection"
```

---

### Task 3.3: 改造 categorize handler

**Files:**
- Modify: `electron/main/agents/agent-worker.ts:793-840+`

**Step 3.3.1: 同 Task 3.2**

selection 来源是 `categorizeModelSelection`。

**Step 3.3.2: 编译验证 + Commit**

```bash
bun run build:electron
git add electron/main/agents/agent-worker.ts
git commit -m "refactor(model): categorize handler uses resolveModelSelection"
```

---

### Task 3.4: 三个 tipc 路由字段更新

**Files:**
- Modify: `electron/main/tipc/digest.ts:62-102`
- Modify: `electron/main/tipc/review.ts:73-110`
- Modify: `electron/main/tipc/category.ts:112-149`

**Step 3.4.1: digest.ts**

把 `getDigestProfileId / setDigestProfileId / getDigestModelTier / setDigestModelTier` 四个 RPC **删除**，新增两个：

```ts
getDigestModelSelection: t.procedure.action(async () => {
  const s = await loadSettings();
  return s.ai.digestModelSelection ?? null;
}),
setDigestModelSelection: t.procedure
  .input<{ selection: ModelSelection | null }>()
  .action(async ({ input }) => {
    await updateSettings(s => { s.ai.digestModelSelection = input.selection; });
    return { ok: true };
  }),
```

**Step 3.4.2: review.ts / category.ts 同模式**

字段名替换为 `reviewModelSelection` / `categorizeModelSelection`。

**Step 3.4.3: 检查 trigger 文件是否需要改**

Run: `grep -n "ModelTier\|ProfileId" electron/main/services/memory/digest-trigger.ts electron/main/services/memory/review-trigger.ts electron/main/services/memory/category-trigger.ts`

如果 trigger 在 task payload 里塞 modelTier，改为塞 `modelSelection`（或干脆不塞，由 worker 从 settings 读）。

**Step 3.4.4: 编译验证**

Run: `bun run build:electron && bun run lint`

**Step 3.4.5: Commit**

```bash
git add electron/main/tipc/digest.ts electron/main/tipc/review.ts electron/main/tipc/category.ts electron/main/services/memory/
git commit -m "refactor(model): rewrite digest/review/category tipc to use modelSelection"
```

---

### Task 3.5: 拒绝迁移、settings 加载行为确认

**Files:**
- Read only: `electron/main/services/settings-service.ts`

**Step 3.5.1: 确认 deepMerge 自动兜底**

设置文件里若残留旧字段，`deepMerge(saved, DEFAULT_SETTINGS)` 会把新字段（null）补上，旧字段忽略（因为新结构里没了，TS 上也访问不到）。

**Step 3.5.2: 不写 migration**

CLAUDE.md 硬约定。

**Step 3.5.3: 跑应用做冒烟**

Run: `bun run dev`
Expected: 应用能启动；之前选过 activeProfileId 的设置文件不会崩；设置页此时还显示旧 UI（Phase 4 改），但不会爆。

不 commit（只是验证）。

---

## Phase 4: 前端 UI

### Task 4.1: 写 modelSelection 工具函数

**Files:**
- Create: `lib/model-selection.ts`

**Step 4.1.1: 写实现**

`lib/model-selection.ts`:
```ts
import type { ModelProfile, ModelSelection, ModelTier } from '@/types/settings';

const TIER_PRIORITY: ModelTier[] = ['opus', 'sonnet', 'haiku'];

export function dedupeProfileTiers(profile: ModelProfile): Array<{ tier: ModelTier; modelId: string }> {
  const seen = new Set<string>();
  const result: Array<{ tier: ModelTier; modelId: string }> = [];
  for (const tier of TIER_PRIORITY) {
    const modelId = profile[`${tier}Model` as 'haikuModel' | 'sonnetModel' | 'opusModel'];
    if (!modelId || seen.has(modelId)) continue;
    seen.add(modelId);
    result.push({ tier, modelId });
  }
  return result;
}

export function sameSelection(a: ModelSelection | null, b: ModelSelection | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.profileId === b.profileId && a.tier === b.tier;
}
```

**Step 4.1.2: 编译验证 + Commit**

```bash
bun run build:electron && bun run lint
git add lib/model-selection.ts
git commit -m "feat(model): add dedupeProfileTiers and sameSelection helpers"
```

---

### Task 4.2: 创建可复用的 ModelSelector 组件

**Files:**
- Create: `components/ModelSelector.tsx`

**Step 4.2.1: 写组件**

```tsx
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuItem, DropdownMenuGroup } from '@/components/ui/dropdown-menu';
import { Cpu, ChevronRight } from 'lucide-react';
import { InputGroupButton } from '@/components/ui/input-group';
import { cn } from '@/lib/utils';
import { dedupeProfileTiers, sameSelection } from '@/lib/model-selection';
import type { ModelSelection } from '@/types/settings';
import type { AppSettings } from '@/types/settings';

interface Props {
  settings: AppSettings;
  value: ModelSelection | null;
  onChange: (v: ModelSelection | null) => void;
  allowUnset?: boolean;     // 是否提供"不指定"项；输入框默认 false，设置默认 true
  triggerVariant?: 'inline' | 'block';  // inline = 输入框工具栏小按钮；block = 设置页大块下拉
  disabled?: boolean;
}

export function ModelSelector({ settings, value, onChange, allowUnset = false, triggerVariant = 'inline', disabled }: Props) {
  const profiles = Object.values(settings.profiles);
  const currentLabel = value
    ? (settings.profiles[value.profileId]?.[`${value.tier}Model` as 'opusModel'] ?? '已删除的模型')
    : (allowUnset ? '不指定' : '请选择模型');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        {triggerVariant === 'inline' ? (
          <InputGroupButton size="xs" className={cn('gap-1', value ? 'text-primary' : 'text-destructive')} title="模型">
            <Cpu size={14} />
            <span className="text-xs max-w-[160px] truncate">{currentLabel}</span>
            <ChevronRight size={12} className="rotate-90" />
          </InputGroupButton>
        ) : (
          <button className="h-9 w-full px-3 text-sm border rounded bg-background flex items-center justify-between">
            <span className={cn(value ? '' : 'text-muted-foreground')}>{currentLabel}</span>
            <ChevronRight size={14} className="rotate-90" />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[240px] max-h-[400px] overflow-y-auto">
        {allowUnset && (
          <>
            <DropdownMenuItem onSelect={() => onChange(null)} className={cn(!value && 'font-semibold')}>
              不指定
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {profiles.map(profile => {
          const items = dedupeProfileTiers(profile);
          if (items.length === 0) return null;
          return (
            <DropdownMenuGroup key={profile.id}>
              <DropdownMenuLabel className="text-xs text-muted-foreground">{profile.name}</DropdownMenuLabel>
              {items.map(({ tier, modelId }) => {
                const isActive = sameSelection(value, { profileId: profile.id, tier });
                return (
                  <DropdownMenuItem
                    key={`${profile.id}-${tier}`}
                    onSelect={() => onChange({ profileId: profile.id, tier })}
                    className={cn(isActive && 'font-semibold bg-accent')}
                  >
                    {modelId}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          );
        })}
        {profiles.length === 0 && (
          <DropdownMenuLabel className="text-xs text-muted-foreground">尚未配置模型方案</DropdownMenuLabel>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

**Step 4.2.2: 编译 + 视觉验证**

Run: `bun run dev:renderer`
Open: localhost:3000

> 暂时找不到使用方，先编译过就行。

Run: `bun run lint` 通过即可。

**Step 4.2.3: Commit**

```bash
git add components/ModelSelector.tsx
git commit -m "feat(model): add ModelSelector component (profile-grouped, model-name only)"
```

---

### Task 4.3: ChatInputArea 改用 ModelSelector

**Files:**
- Modify: `components/agent-chat/ChatInputArea.tsx:82-83`（props）
- Modify: `components/agent-chat/ChatInputArea.tsx:333-387`（原档位下拉）

**Step 4.3.1: 改 props 类型**

L82-83 替换为：
```ts
currentSelection: ModelSelection | null;
onSelectionChange: (s: ModelSelection | null) => void;
settings: AppSettings;
```

删除 `currentTier / setCurrentTier`。import 新类型。

**Step 4.3.2: 替换下拉**

L333-387 整段（从 `{/* 模型层级 */}` 到 `</DropdownMenu>`）替换为：
```tsx
{/* 模型选择 */}
<ModelSelector
  settings={settings}
  value={currentSelection}
  onChange={onSelectionChange}
  allowUnset={false}
  triggerVariant="inline"
/>
```

**Step 4.3.3: 调用方（AgentChat.tsx）暂时塞占位**

`AgentChat.tsx` 里传：
```tsx
<ChatInputArea
  ...
  currentSelection={null}
  onSelectionChange={() => {}}
  settings={settings}
/>
```

settings 从 `useSettingsStore` 读。**真正的状态串联在 Task 4.8 做**。

**Step 4.3.4: 编译验证**

Run: `bun run build:electron && bun run lint && bun run dev`
Open: localhost:3000，进任意对话
Expected: 输入框工具栏看到"请选择模型"红字按钮；点开下拉看到按方案分组、列出 modelId

**Step 4.3.5: Commit**

```bash
git add components/agent-chat/ChatInputArea.tsx components/agent-chat/AgentChat.tsx
git commit -m "feat(model): ChatInputArea uses ModelSelector instead of tier dropdown"
```

---

### Task 4.4: 设置页 AI 行为 tab 替换默认模型控件

**Files:**
- Modify: `app/settings/page.tsx:302-320`（默认模型 section）

**Step 4.4.1: 替换控件**

L302-320 整段替换为：
```tsx
{/* 默认模型 */}
<div className="space-y-2">
  <label className="text-sm font-medium">默认模型</label>
  <p className="text-xs text-muted-foreground">
    新建对话将使用此模型；选「不指定」时新对话需手动选择模型才能发送消息。
    此处的修改仅影响之后新建的对话，不会改动已存在对话的模型设置。
  </p>
  <ModelSelector
    settings={local}
    value={local.ai.defaultModelSelection}
    onChange={(v) => updateAI({ defaultModelSelection: v })}
    allowUnset={true}
    triggerVariant="block"
  />
</div>
```

import `ModelSelector`。

**Step 4.4.2: 移除「激活方案」UI**

L73-83 / L191-198 / L494-515 段（profiles tab 内的激活方案单选）—— **暂时保留 profile 列表的增删改 CRUD，只删除"激活"按钮和 active 标记**。具体在 L494-515 范围内：
- 删 `setting.ai.activeProfileId === profile.id` 的高亮判断
- 删"设为激活"按钮（如有）

profile 列表本身（增删改方案）保留。

**Step 4.4.3: 编译 + UI 验证**

Run: `bun run build:electron && bun run lint && bun run dev`
Open: localhost:3000 → 设置 → AI 行为
Expected:
- 看到"默认模型"按方案分组下拉，含"不指定"项
- 选中某模型后保存关闭设置，重新打开 settings 仍是选中状态（settings-service 透传通过 deepMerge 自动支持）

设置 → Profiles tab
Expected: 增删改方案功能正常，不再有"激活方案"红色徽标

**Step 4.4.4: Commit**

```bash
git add app/settings/page.tsx
git commit -m "feat(model): replace tier dropdown with ModelSelector in settings AI behavior tab"
```

---

### Task 4.5: 设置页摘要 tab 替换三个后台模型控件

**Files:**
- Modify: `app/settings/memory/SmartCategoryPanel.tsx`（categorize 控件位置）
- Modify: 同目录其他文件中 digest / review 控件（grep 找：`digestProfileId|reviewProfileId`）

**Step 4.5.1: 定位现有控件**

Run grep: `grep -rn "digestModelTier\|digestProfileId\|reviewModelTier\|reviewProfileId\|categorizeModelTier\|categorizeProfileId" app/`

**Step 4.5.2: 逐个替换**

每个旧的 `<select>` 控件替换为：
```tsx
<ModelSelector
  settings={local}
  value={local.ai.digestModelSelection}   // 或 review/categorize
  onChange={(v) => updateAI({ digestModelSelection: v })}
  allowUnset={true}
  triggerVariant="block"
/>
```

文案补充："选「不指定」时回退到默认模型。"

**Step 4.5.3: 调用方 client 同步**

`lib/client.ts` 里 `setDigestProfileId / setDigestModelTier / getDigestProfileId / getDigestModelTier` 等方法 → 改为 `setDigestModelSelection / getDigestModelSelection` 对接 Task 3.4 的新 RPC。review / category 同样。

**Step 4.5.4: 编译 + UI 验证**

Run: `bun run build:electron && bun run lint && bun run dev`
Open: 设置 → 会话摘要 tab
Expected: 三个模型选择器都改成新组件；调整保存 → 重启应用 → 仍生效

**Step 4.5.5: Commit**

```bash
git add app/settings/memory/ app/settings/page.tsx lib/client.ts
git commit -m "feat(model): replace digest/review/categorize tier selects with ModelSelector"
```

---

### Task 4.6: conversation-service 创建时拷贝 modelSelection

**Files:**
- Modify: `electron/main/services/conversation-service.ts`（找 createConversation / addConversation 之类的入口）

**Step 4.6.1: 在创建入口加拷贝**

定位 `createConversation()` / `appendConversation()` 之类入口（用 grep `function.*Conversation` 找）。在写入 conversations.json 之前，把 `settings.ai.defaultModelSelection` 拷贝到新对象的 `modelSelection` 字段：

```ts
const newConv: Conversation = {
  ...input,
  modelSelection: settings.ai.defaultModelSelection
    ? { ...settings.ai.defaultModelSelection }  // 浅拷贝，避免引用
    : null,
  // ...
};
```

`settings` 通过 `loadSettings()` 在函数内读取（如果还未读）。

**Step 4.6.2: 检查分叉路径**

分叉对话（`fork`）会复制父对话——保留父对话的 `modelSelection`（不重读默认）。

**Step 4.6.3: 编译验证**

Run: `bun run build:electron`

**Step 4.6.4: 手工 UI 验证**

Run: `bun run dev`
- 设置默认模型为某个具体模型，新建对话 → 进入对话看输入框，应该显示该模型
- 把默认改成"不指定"，新建对话 → 输入框显示"请选择模型"红字
- 在某对话里改模型，回到设置改默认 → 该对话**不**跟着变

**Step 4.6.5: Commit**

```bash
git add electron/main/services/conversation-service.ts
git commit -m "feat(model): conversation inherits defaultModelSelection at creation time"
```

---

### Task 4.7: conversation-store + IPC 持久化 modelSelection 变更

**Files:**
- Modify: `stores/conversation-store.ts`
- Modify: `electron/main/tipc/conversations.ts`（找 update 入口）
- Modify: `lib/client.ts`

**Step 4.7.1: tipc 新增 setConversationModelSelection**

`conversations.ts`:
```ts
setConversationModelSelection: t.procedure
  .input<{ conversationId: string; selection: ModelSelection | null }>()
  .action(async ({ input }) => {
    await conversationService.updateConversation(input.conversationId, c => {
      c.modelSelection = input.selection;
    });
    return { ok: true };
  }),
```

**Step 4.7.2: store action**

`conversation-store.ts` 加：
```ts
setConversationModelSelection: async (id, selection) => {
  await client.setConversationModelSelection({ conversationId: id, selection });
  set(state => ({
    conversations: state.conversations.map(c =>
      c.id === id ? { ...c, modelSelection: selection } : c
    ),
  }));
},
```

**Step 4.7.3: 编译验证 + Commit**

```bash
bun run build:electron && bun run lint
git add stores/conversation-store.ts electron/main/tipc/conversations.ts lib/client.ts
git commit -m "feat(model): wire setConversationModelSelection through store and IPC"
```

---

### Task 4.8: 串联 ChatInputArea 状态 + 发送前 reconcile

**Files:**
- Modify: `components/agent-chat/AgentChat.tsx`（把真实 selection 串下去）
- Modify: `components/agent-chat/hooks/useSendMessage.ts:447 附近`

**Step 4.8.1: AgentChat 串状态**

```tsx
const conversation = useConversationStore(s => s.conversations.find(c => c.id === conversationId));
const setConvSelection = useConversationStore(s => s.setConversationModelSelection);
const settings = useSettingsStore(s => s.settings);

<ChatInputArea
  ...
  currentSelection={conversation?.modelSelection ?? null}
  onSelectionChange={(v) => setConvSelection(conversationId, v)}
  settings={settings}
/>
```

**Step 4.8.2: ChatInputArea null 门禁**

在 ChatInputArea 内，把 `disabled` 条件改为：
```ts
const isModelMissing = !currentSelection;
const sendDisabled = !isSessionReady || isModelMissing || /* 其他原条件 */;
```

textarea 也 disable，placeholder 改为"请先选择模型"。

**Step 4.8.3: useSendMessage 加 reconcile**

在 L447 附近 send 函数入口，按设计文档 5.3 节代码块加 reconcile 逻辑：
```ts
// 插话特例：agent 在跑直接 push 队列
if (isAgentRunning) {
  await client.sendQueryBasedSessionMessage(...);
  return;
}

if (!conversation.modelSelection) {
  toast.error('请先选择模型');
  return;
}

const wanted = conversation.modelSelection;
const current = currentSessionModelSelection;  // 从 query-based-session 取
if (!sameSelection(current, wanted)) {
  if (current?.profileId === wanted.profileId) {
    // 同 profile 换 tier
    await client.setSessionModel({ sessionId, selection: wanted });
  } else {
    // 跨 profile：重启
    incrementSessionRestartTrigger();
    await waitForSessionReady();
  }
}
await client.sendQueryBasedSessionMessage(...);
```

`waitForSessionReady` 是个 helper：监听 `useAgentSession` 暴露的 `sessionId` 字段变化（重启后会变），用 Promise 包一下等待。如果实现复杂，先 polling `useAgentSession.state.isSessionReady`。

`currentSessionModelSelection` 从 `useAgentSession` hook 暴露（需要后端 emit 出来；如果暂时拿不到，简化逻辑：每次都比 `setSessionModel` 返回 `needsRestart`，按需重启）。

**Step 4.8.4: lib/client.ts setSessionModel 签名更新**

```ts
setSessionModel: ipcRenderer.invoke<{ sessionId: string; selection: ModelSelection }, ...>('agent/setSessionModel'),
```

**Step 4.8.5: tipc/agent.ts 同步**

L344-357 改 schema 和实现，返回 `{ ok: true, needsRestart?: boolean }` 或 `{ ok: false, error }`。

**Step 4.8.6: 编译 + 完整 UI 验证**

Run: `bun run dev`

测试矩阵：
1. 新对话（默认模型已设）→ 输入框显示模型，正常发送
2. 新对话（默认不指定）→ 输入框 disable + "请先选择模型"；选了 → 能发
3. 已有对话切同 profile 不同 tier → 发送：观察网络请求 model 已变，未重启
4. 已有对话切跨 profile → 发送：会话重启（控制台 log），历史保留
5. 对话跑着时切模型 → UI 立即反映；继续插话 → 按上次模型跑

**Step 4.8.7: Commit**

```bash
git add components/agent-chat/ stores/ lib/client.ts electron/main/tipc/agent.ts
git commit -m "feat(model): reconcile model selection before sending; insert null gating"
```

---

## Phase 5: 插话状态机

### Task 5.1: query-based-session 暴露 pendingCount 事件

**Files:**
- Modify: `electron/main/agents/query-based-session.ts:155/L1482-1493`

**Step 5.1.1: 加事件 emit**

在 `pendingMessages.push(...)` 后插入：
```ts
this.emitEvent('pendingCountChanged', { count: this.pendingMessages.length });
```

`pendingMessages.shift()` 后同样。

interrupt 方法里清队列时：
```ts
this.pendingMessages.length = 0;
this.emitEvent('pendingCountChanged', { count: 0 });
this.abortController?.abort();
```

`emitEvent` 是 session 现有的事件 emit 入口（如果叫别的名比如 `dispatch`/`pushMessage`，用现有那个）。

**Step 5.1.2: getStatus 加字段**

如果 session 有 getStatus 方法，加 `pendingMessagesCount: this.pendingMessages.length`。

**Step 5.1.3: 编译验证 + Commit**

```bash
bun run build:electron && bun run lint
git add electron/main/agents/query-based-session.ts
git commit -m "feat(model): emit pendingCountChanged on pendingMessages push/shift/clear"
```

---

### Task 5.2: tipc renderer-handlers 加 pendingCountChanged

**Files:**
- Modify: `electron/main/tipc/renderer-handlers.ts`

**Step 5.2.1: 事件定义**

```ts
pendingCountChanged: t.procedure
  .input<{ sessionId: string; count: number }>()
  .action(({ input }) => input),  // 透传
```

按文件现有事件风格定义。

**Step 5.2.2: Commit**

```bash
bun run build:electron
git add electron/main/tipc/renderer-handlers.ts
git commit -m "feat(model): add pendingCountChanged renderer event"
```

---

### Task 5.3: useAgentSession 订阅 pendingCount + usePendingState hook

**Files:**
- Modify: `components/agent-chat/hooks/useAgentSession.ts`
- Create: `components/agent-chat/hooks/usePendingState.ts`

**Step 5.3.1: 写 usePendingState 实现**

```ts
export type PendingState = 'idle' | 'running' | 'flushing';

export function derivePendingState(input: { isRunning: boolean; pendingCount: number }): PendingState {
  if (input.isRunning) return 'running';
  if (input.pendingCount > 0) return 'flushing';
  return 'idle';
}

export function usePendingState(sessionId: string | null): { state: PendingState; pendingCount: number } {
  const isRunning = /* useAgentSession.isRunning */
  const pendingCount = /* useAgentSession.pendingCount */
  return { state: derivePendingState({ isRunning, pendingCount }), pendingCount };
}
```

具体如何从 useAgentSession 拿数据按现有 hook 风格做。

**Step 5.3.2: useAgentSession 加 pendingCount 订阅**

在 L26-27 附近 useEffect 内加：
```ts
const offPending = events.on('pendingCountChanged', (e) => {
  if (e.sessionId === sessionId) setPendingCount(e.count);
});
return () => { offPending(); /* 其他 cleanup */ };
```

并 useState 加 `const [pendingCount, setPendingCount] = useState(0);` + 返回值里加 `pendingCount`。

**Step 5.3.3: 编译验证 + Commit**

```bash
bun run build:electron && bun run lint
git add components/agent-chat/hooks/
git commit -m "feat(model): add usePendingState hook deriving idle/running/flushing"
```

---

### Task 5.4: ChatInputArea 按钮改用 pendingState + StreamingIndicator flushing 文案

**Files:**
- Modify: `components/agent-chat/AgentChat.tsx`（hook 调用）
- Modify: `components/agent-chat/ChatInputArea.tsx`（按钮判定）
- Modify: `components/agent-chat/StreamingIndicator.tsx`

**Step 5.4.1: AgentChat 用 hook**

```tsx
const { state: pendingState, pendingCount } = usePendingState(sessionId);
const isBusy = pendingState !== 'idle';
```

把原 `isAgentRunning / isRunning` 用到的位置改用 `isBusy`。

**Step 5.4.2: 按钮判定**

ChatInputArea 接收 `pendingState` props，按 `pendingState !== 'idle'` 显示"停止"，否则"发送"。

**Step 5.4.3: StreamingIndicator 文案**

```tsx
{pendingState === 'flushing' && (
  <span>队列还有 {pendingCount} 条插话待回复…</span>
)}
```

**Step 5.4.4: 完整 UI 验证**

Run: `bun run dev`

测试场景：
1. 发消息 → indicator 显示"思考中/执行工具..." → 完成 → 回到 idle ✓
2. 发消息，agent 跑到一半再发一条插话 → 第一轮 result 后 indicator 切到"队列还有 1 条插话待回复" → 第二轮跑完 → idle
3. 在 flushing 态点停止按钮 → 队列清空 + abort → 立即 idle
4. 同时插 3 条 → 看 pendingCount 递减

**Step 5.4.5: Commit**

```bash
git add components/agent-chat/
git commit -m "fix(model): chat UI uses pendingState to avoid premature idle during interjection"
```

---

## Phase 6: 文档同步

### Task 6.1: 更新 codebase-map.md

**Files:**
- Modify: `.claude/rules/codebase-map.md`

**Step 6.1.1: 找到相关章节更新**

- 「类型定义」段加 `ModelSelection / ModelTier` 在 `types/settings.ts`
- 「Agent 框架」段提到 `resolveModelSelection` 是统一入口、删除 `getActiveProfile` 提法
- 「业务组件」段 ChatInputArea 描述更新（按方案分组的二级菜单 + 去重）
- 加 `components/ModelSelector.tsx` 条目
- 「状态管理」段 conversation-store 提到 `setConversationModelSelection`
- 「关键数据流」段加一条「模型选择：conversation 创建时拷贝 settings.defaultModelSelection；发送时 reconcile 决定 setModel/重启/直发；后台任务运行时 fallback」
- 「业务服务」段 conversation-service 强调创建时拷贝
- agent-chat hooks 加 `usePendingState` 条目

**Step 6.1.2: 自检**

Run: `bun run lint`

Open 设置页和聊天界面再点一遍 P0 流程（发消息、切模型、插话）确认无回归。

**Step 6.1.3: Commit**

```bash
git add .claude/rules/codebase-map.md
git commit -m "docs(map): update codebase-map for model selection refactor"
```

---

## 收尾检查清单

执行完所有 task 后逐项确认：

- [ ] `bun run build:electron && bun run lint` 全绿
- [ ] 设置页 AI 行为 / 会话摘要 / Profiles 三个 tab 视觉与行为正常
- [ ] 输入框模型选择器按方案分组、只显示 modelId、有去重
- [ ] 新建对话继承默认模型；改默认不影响已存在对话
- [ ] 切模型同 profile 换 tier 不重启；跨 profile 重启
- [ ] 插话场景下 UI 不再误判 idle，二次轮次能跑完
- [ ] 手动停止能一次清干净

完成后推荐运行 `superpowers:requesting-code-review` 全量审查。

---

## 风险与回滚

- **影响面大**：触碰 settings 类型 + Worker handler + 前端核心 hook。建议每 Phase 完成后 review 一次，避免一口气改完踩坑难定位。
- **回滚**：每 task 独立 commit，可 `git revert` 单步回退。
- **未覆盖的边角**：wechat-bot 走 ConversationRuntimeService 共享 session，多附件场景下 modelSelection 仍按 conversation 走（这套设计天然兼容，不必特殊处理；但需要在 Phase 5 完成后跑一次 wechat-bot 冒烟）。

---

## 待办

- [ ] 用户拍板实施方式（Subagent-Driven / 新会话）
- [ ] 执行
