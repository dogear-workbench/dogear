# DeepSeek V4 接入与模型配置增强 — 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 简化思考模式配置、补齐 effort 档位、新增默认/子代理模型选择、支持输入框运行时切换模型层级。

**Architecture:**
- 删除 `ThinkingConfig` 类型与相关 UI（设置页 + 输入框），代码层固定 `thinking: { type: 'adaptive' }`
- `AppSettings.ai` 新增 `defaultModelTier` / `subagentModelTier` 两个可选字段 → 注入 `ANTHROPIC_MODEL` / `CLAUDE_CODE_SUBAGENT_MODEL` 环境变量
- `effort` 枚举从 4 档扩展到 5 档，加入 `xhigh`
- `QueryBasedSession` 新增 `setModel(tier)` 方法，通过 tipc 暴露给前端，输入框用下拉切换

**Tech Stack:**
- Electron + Vite + React 19 + Zustand 5
- `@anthropic-ai/claude-agent-sdk` 0.2.119
- tipc（IPC 通信）、shadcn/ui（DropdownMenu）
- 包管理器：Bun

**关联设计文档:** `docs/plans/2026-04/2026-04-26/deepseek-v4-integration-design.md`

**偏好提示:**
- 遵循 [feedback_no_compat.md](memory/feedback_no_compat.md) — 开发阶段不做兼容
- 遵循 [feedback_ephemeral_ui_state.md](memory/feedback_ephemeral_ui_state.md) — UI 交互状态不跨会话持久化

---

## 任务序列（共 8 个任务）

1. 类型层变更：主进程 settings-types
2. 类型层变更：前端 types/settings
3. 主进程：agent-query-config 删 thinking + 加 env 注入
4. 主进程：QueryBasedSession 删 thinking + 加 setModel
5. 主进程：agent-worker.ts 删 thinking
6. 主进程：tipc 加 setSessionModel RPC + 删 setMaxThinkingTokens
7. 前端设置页：删思考模式 UI + 加 xhigh + 加两个 tier 下拉
8. 前端输入框：删思考按钮 + 加模型层级下拉

---

## Task 1: 主进程 settings-types 类型重构

**Files:**
- Modify: `electron/main/services/settings-types.ts`

**Step 1: 删除 ThinkingConfig 类型定义**

修改 `electron/main/services/settings-types.ts`，删除第 10-13 行：

```ts
// 删除这段（第 10-13 行）
export interface ThinkingConfig {
  type: 'adaptive' | 'enabled' | 'disabled';
  budgetTokens?: number;
}
```

**Step 2: 修改 AppSettings.ai 接口**

修改 `AppSettings.ai`（第 37-46 行），做三件事：
1. 删除 `thinking: ThinkingConfig;` 行
2. `effort` 枚举加 `'xhigh'`
3. 新增两个可选字段

改后应为：

```ts
export interface AppSettings {
  ai: {
    effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    activeProfileId: string;
    maxTurns?: number;
    permissionMode: 'default' | 'acceptEdits' | 'plan' | 'dontAsk';
    defaultSystemPrompt?: string;
    systemPromptAppend?: string;
    settingSources?: ('user' | 'project')[];
    /** 注入 ANTHROPIC_MODEL，决定 CLI 默认模型 */
    defaultModelTier?: 'haiku' | 'sonnet' | 'opus';
    /** 注入 CLAUDE_CODE_SUBAGENT_MODEL，决定 Task 工具子代理模型 */
    subagentModelTier?: 'haiku' | 'sonnet' | 'opus';
  };
  permissionRules?: {
    allow?: string[];
    deny?: string[];
  };
  personas: Persona[];
  profiles: Record<string, ModelProfile>;
}
```

**Step 3: 修改 DEFAULT_SETTINGS**

修改 `DEFAULT_SETTINGS.ai`（第 63-70 行），删除 `thinking: { type: 'adaptive' }` 行。改后应为：

```ts
export const DEFAULT_SETTINGS: AppSettings = {
  ai: {
    effort: 'high',
    activeProfileId: 'default',
    permissionMode: 'default',
    settingSources: ['project'],
    defaultSystemPrompt: BUILTIN_DEFAULT_SYSTEM_PROMPT,
    // defaultModelTier / subagentModelTier 不设默认值（undefined = 不注入 env）
  },
  personas: [],
  // ... profiles 保持不变
};
```

**Step 4: 验证编译**

运行: `bun run build:electron`

Expected: 编译通过（此时还有引用错误，下个任务修，先记下错误数量）

**Step 5: Commit**

```bash
rtk git add electron/main/services/settings-types.ts
rtk git commit -m "refactor(settings): 删除 ThinkingConfig 类型，effort 加 xhigh，新增 tier 字段"
```

---

## Task 2: 前端 types/settings 同步

**Files:**
- Modify: `types/settings.ts`

**Step 1: 删除 ThinkingConfig 接口**

修改 `types/settings.ts`，删除第 1-4 行：

```ts
// 删除整个 ThinkingConfig 接口（第 1-4 行）
export interface ThinkingConfig {
  type: 'adaptive' | 'enabled' | 'disabled';
  budgetTokens?: number;
}
```

**Step 2: 修改 AppSettings.ai**

修改 `AppSettings.ai`（第 42-53 行），删 `thinking`、扩展 `effort`、加两个 tier 字段。改后应为：

```ts
export interface AppSettings {
  ai: {
    effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
    activeProfileId: string;
    maxTurns?: number;
    permissionMode: 'default' | 'acceptEdits' | 'plan' | 'dontAsk';
    defaultSystemPrompt?: string;
    systemPromptAppend?: string;
    settingSources?: ('user' | 'project')[];
    /** 注入 ANTHROPIC_MODEL，决定 CLI 默认模型 */
    defaultModelTier?: 'haiku' | 'sonnet' | 'opus';
    /** 注入 CLAUDE_CODE_SUBAGENT_MODEL，决定 Task 工具子代理模型 */
    subagentModelTier?: 'haiku' | 'sonnet' | 'opus';
  };
  // 其他字段保持不变
  permissionRules?: { allow?: string[]; deny?: string[]; ask?: string[]; };
  personas: Persona[];
  profiles: Record<string, ModelProfile>;
  ui?: {
    messageDisplayMode: 'compact' | 'detailed';
  };
}
```

**Step 3: 修改 DEFAULT_SETTINGS**

修改 `DEFAULT_SETTINGS`（第 69-95 行），删除 `thinking: { type: 'adaptive' }` 行。

**Step 4: 验证前端类型**

运行: `bun run lint`

Expected: 前端 lint 可能报几处引用错误（`AgentChat.tsx`、`useSendMessage.ts`、`app/settings/page.tsx` 等），记录下来，后续任务修

**Step 5: Commit**

```bash
rtk git add types/settings.ts
rtk git commit -m "refactor(types): 前端 settings 类型同步删除 ThinkingConfig、加 tier 字段"
```

---

## Task 3: agent-query-config 改造

**Files:**
- Modify: `electron/main/agents/agent-query-config.ts`

**Step 1: 修改 QueryBaseConfig 接口**

打开 `electron/main/agents/agent-query-config.ts`，找到 `QueryBaseConfig` 接口（第 66-87 行）。

删除：
```ts
/** 思考配置 */
thinking: AppSettings['ai']['thinking'];
```

保留其他字段。

**Step 2: 修改 buildQueryBaseConfig 返回值**

找到 `buildQueryBaseConfig()` 函数的 return 语句（第 141-152 行）。

删除返回对象中的 `thinking: appSettings.ai.thinking,` 行。

**Step 3: 新增 env 注入**

在 `buildQueryBaseConfig()` 内，env 构建代码（第 126-136 行）之后，return 之前，新增以下代码：

```ts
// 根据用户配置注入 ANTHROPIC_MODEL / CLAUDE_CODE_SUBAGENT_MODEL
const tierMap: Record<'haiku' | 'sonnet' | 'opus', string> = {
  haiku:  activeProfile.haikuModel,
  sonnet: activeProfile.sonnetModel,
  opus:   activeProfile.opusModel,
};

if (appSettings.ai.defaultModelTier) {
  env.ANTHROPIC_MODEL = tierMap[appSettings.ai.defaultModelTier];
}
if (appSettings.ai.subagentModelTier) {
  env.CLAUDE_CODE_SUBAGENT_MODEL = tierMap[appSettings.ai.subagentModelTier];
}
```

**Step 4: 验证编译**

运行: `bun run build:electron`

Expected: 本文件应编译通过，但其他依赖 `baseConfig.thinking` 的文件会报错（下个任务修）

**Step 5: Commit**

```bash
rtk git add electron/main/agents/agent-query-config.ts
rtk git commit -m "feat(agent): 删除 thinking 配置，新增 ANTHROPIC_MODEL / CLAUDE_CODE_SUBAGENT_MODEL 注入"
```

---

## Task 4: QueryBasedSession 改造（删 thinking + 加 setModel）

**Files:**
- Modify: `electron/main/agents/query-based-session.ts`

**Step 1: 删除 thinking 传参**

找到 `queryOptions` 构建处（第 191-201 行）：

```ts
// 删除这一行
thinking: baseConfig.thinking,
```

保留 `effort: baseConfig.effort,` 行（effort 继续走 SDK option）。

**Step 2: 修改日志输出**

找到日志输出处（第 219-223 行）：

```ts
// 改前
this.logger.info('已从 settings.json 加载 AI 配置:', {
  thinking: appSettings.ai.thinking.type,
  effort: appSettings.ai.effort,
  profileName: activeProfile.name,
});

// 改后（删除 thinking 字段）
this.logger.info('已从 settings.json 加载 AI 配置:', {
  effort: appSettings.ai.effort,
  profileName: activeProfile.name,
});
```

**Step 3: 删除 setMaxThinkingTokens 方法**

找到 `setMaxThinkingTokens` 方法（第 1530-1540 行附近），完全删除此方法及其上方的注释。

查找方法：
```bash
rtk grep "setMaxThinkingTokens" electron/main/agents/query-based-session.ts -n
```

**Step 4: 新增 setModel 方法**

在 `setPermissionMode` 方法的下方，新增 `setModel` 方法：

```ts
/**
 * 运行时切换模型层级
 * @param tier 模型层级（haiku/sonnet/opus），传 undefined 回退到默认
 */
async setModel(tier?: 'haiku' | 'sonnet' | 'opus'): Promise<void> {
  if (!this.query) {
    this.logger.warn('setModel: 没有活跃的 query');
    return;
  }

  // 读取当前 activeProfile，获取对应 tier 的模型字符串
  let modelStr: string | undefined = undefined;
  if (tier) {
    // 从运行时缓存的 activeProfile 读取（避免重新加载 settings.json）
    const profile = this.currentActiveProfile;
    if (!profile) {
      this.logger.warn('setModel: currentActiveProfile 未初始化');
      return;
    }
    const tierMap = {
      haiku: profile.haikuModel,
      sonnet: profile.sonnetModel,
      opus: profile.opusModel,
    };
    modelStr = tierMap[tier];
  }

  this.logger.info(`setModel: tier=${tier}, modelStr=${modelStr}`);
  await this.query.setModel(modelStr);
  this.currentTier = tier;
}
```

**Step 5: 新增成员变量**

在 class 的成员变量声明区域（searchable: 找 `currentPermissionMode` 声明），新增：

```ts
private currentTier?: 'haiku' | 'sonnet' | 'opus';
private currentActiveProfile?: ModelProfile;
```

**Step 6: 缓存 activeProfile**

在 query 初始化处（约第 180 行之前有 `baseConfig.activeProfile`），新增：

```ts
// 缓存 activeProfile，供 setModel 使用
this.currentActiveProfile = activeProfile;
```

确认 `activeProfile` 变量名与现有代码一致（通常来自 `baseConfig.activeProfile`）。

**Step 7: 添加 ModelProfile 类型导入**

如果 `ModelProfile` 类型未导入，在文件顶部的 import 语句中添加：

```ts
import type { ModelProfile } from '../services/settings-types.js';
```

**Step 8: 验证编译**

运行: `bun run build:electron`

Expected: 编译通过（仅剩 agent-worker 引用错误）

**Step 9: Commit**

```bash
rtk git add electron/main/agents/query-based-session.ts
rtk git commit -m "feat(agent): QueryBasedSession 删除 thinking/setMaxThinkingTokens，新增 setModel"
```

---

## Task 5: agent-worker 清理

**Files:**
- Modify: `electron/main/agents/agent-worker.ts`

**Step 1: 删除两处 thinking 传参**

查找所有 `thinking: baseConfig.thinking` 出现位置：

```bash
rtk grep "thinking: baseConfig.thinking" electron/main/agents/agent-worker.ts -n
```

至少在两处：第 478 行附近（book-analysis 任务）和第 759 行附近（article-parse 任务）。

在每处都删除 `thinking: baseConfig.thinking,` 行，保留 `effort: baseConfig.effort,`。

**Step 2: 检查日志或其他引用**

```bash
rtk grep "thinking" electron/main/agents/agent-worker.ts -n
```

如果还有其他引用（如日志输出），一并清理。

**Step 3: 验证编译**

运行: `bun run build:electron`

Expected: 全部通过

**Step 4: Commit**

```bash
rtk git add electron/main/agents/agent-worker.ts
rtk git commit -m "refactor(agent): agent-worker 删除 thinking 传参"
```

---

## Task 6: tipc RPC 改造

**Files:**
- Modify: `electron/main/tipc/agent.ts`
- Modify: `types/electron-api.ts`（如果类型需要同步）

**Step 1: 删除 setMaxThinkingTokens RPC**

查找：
```bash
rtk grep "setMaxThinkingTokens" electron/main/tipc/agent.ts -n
```

删除该 RPC 定义（约第 639-648 行）。

**Step 2: 新增 setSessionModel RPC**

在原 `setMaxThinkingTokens` 的位置（或 `setPermissionMode` RPC 旁边）新增：

```ts
setSessionModel: t.procedure
  .input<{ sessionId: string; tier?: 'haiku' | 'sonnet' | 'opus' }>()
  .action(async ({ input }) => {
    const session = getSession(input.sessionId);
    if (!session) {
      throw new Error(`会话不存在: ${input.sessionId}`);
    }
    await session.setModel(input.tier);
  }),
```

注意：`getSession` 的实际函数名可能不同，参考同文件中 `setPermissionMode` RPC 的实现方式获取 session 实例。

**Step 3: 清理前端类型（如需要）**

如果 `types/electron-api.ts` 或其他地方引用了 `setMaxThinkingTokens` 的类型定义，一并清理。

搜索：
```bash
rtk grep "setMaxThinkingTokens" types/
rtk grep "setMaxThinkingTokens" lib/
```

**Step 4: 验证编译**

运行: `bun run build:electron && bun run lint`

Expected: 后端编译通过。前端 lint 可能仍有 ChatInputArea 引用错误（Task 8 修）

**Step 5: Commit**

```bash
rtk git add electron/main/tipc/agent.ts types/electron-api.ts
rtk git commit -m "feat(ipc): 删除 setMaxThinkingTokens RPC，新增 setSessionModel"
```

---

## Task 7: 设置页 UI 改造

**Files:**
- Modify: `app/settings/page.tsx`

**Step 1: 定位思考模式 UI**

打开 `app/settings/page.tsx`，搜索 `thinking`：

```bash
rtk grep "thinking" app/settings/page.tsx -n
```

应找到第 403-438 行的思考模式三个 radio（adaptive / enabled / disabled）。

**Step 2: 删除整个思考模式区块**

删除第 403-438 行（包含：
- "自适应思考" radio
- "手动启用" radio + budgetTokens 输入框
- "禁用" radio）

连同其上方的标题（如有，如 `<h3>思考模式</h3>`）一起删除。

**Step 3: effort 选项加 xhigh**

定位 effort 选项数组（约第 440-460 行，searchable: `effort === opt.value`）。

找到 options 数组（通常在组件顶部或文件内常量），应类似：

```ts
const EFFORT_OPTIONS = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'max', label: '最大' },
];
```

改为：

```ts
const EFFORT_OPTIONS = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'xhigh', label: '超高' },
  { value: 'max', label: '最大' },
];
```

**Step 4: 新增"默认模型层级"下拉**

在 effort 选项下方，新增一个 section：

```tsx
{/* 默认模型层级 */}
<div className="space-y-2">
  <label className="text-sm font-medium">默认模型</label>
  <p className="text-xs text-muted-foreground">
    注入 ANTHROPIC_MODEL 环境变量，决定 CLI 的默认模型层级。不指定时由 SDK 决定。
  </p>
  <select
    className="h-9 w-full px-3 text-sm border rounded bg-background"
    value={local.ai.defaultModelTier || ''}
    onChange={(e) => updateAI({
      defaultModelTier: e.target.value ? e.target.value as 'haiku' | 'sonnet' | 'opus' : undefined
    })}
  >
    <option value="">不指定</option>
    <option value="haiku">Haiku</option>
    <option value="sonnet">Sonnet</option>
    <option value="opus">Opus</option>
  </select>
</div>
```

**Step 5: 新增"子代理模型层级"下拉**

紧跟上面，新增一个类似 section：

```tsx
{/* 子代理模型层级 */}
<div className="space-y-2">
  <label className="text-sm font-medium">子代理模型</label>
  <p className="text-xs text-muted-foreground">
    注入 CLAUDE_CODE_SUBAGENT_MODEL 环境变量，决定 Task 工具启动的子代理用哪一层。
  </p>
  <select
    className="h-9 w-full px-3 text-sm border rounded bg-background"
    value={local.ai.subagentModelTier || ''}
    onChange={(e) => updateAI({
      subagentModelTier: e.target.value ? e.target.value as 'haiku' | 'sonnet' | 'opus' : undefined
    })}
  >
    <option value="">不指定</option>
    <option value="haiku">Haiku</option>
    <option value="sonnet">Sonnet</option>
    <option value="opus">Opus</option>
  </select>
</div>
```

**Step 6: 验证设置页可打开**

运行: `bun run dev`

在应用中打开设置页，切换到 AI 行为 Tab，检查：
- [ ] 思考模式区块已消失
- [ ] effort 多了一个"超高"选项
- [ ] 出现"默认模型"下拉（选项：不指定/Haiku/Sonnet/Opus）
- [ ] 出现"子代理模型"下拉
- [ ] 选择后点保存，能成功保存

**Step 7: Commit**

```bash
rtk git add app/settings/page.tsx
rtk git commit -m "feat(settings): AI 行为 Tab 删除思考模式、加 xhigh effort、加默认/子代理模型下拉"
```

---

## Task 8: 输入框删思考按钮 + 加模型下拉

**Files:**
- Modify: `components/agent-chat/ChatInputArea.tsx`
- Modify: `components/agent-chat/AgentChat.tsx`
- Modify: `components/agent-chat/hooks/useSendMessage.ts`

**Step 1: 删除 useSendMessage 中的 thinkingLevel 状态**

打开 `components/agent-chat/hooks/useSendMessage.ts`：

```bash
rtk grep "thinkingLevel" components/agent-chat/hooks/useSendMessage.ts -n
```

删除：
- 第 57 行：`const [thinkingLevel, setThinkingLevel] = useState<number>(10000);`
- 第 519-520 行：return 对象中的 `thinkingLevel` 和 `setThinkingLevel`

**Step 2: 新增 currentTier state**

在 useSendMessage.ts 中，原 `thinkingLevel` 删除的位置，新增：

```ts
const [currentTier, setCurrentTier] = useState<'haiku' | 'sonnet' | 'opus' | undefined>(undefined);
```

在 return 对象中新增：

```ts
currentTier,
setCurrentTier,
```

**Step 3: 修改 AgentChat.tsx 中的 prop 传递**

```bash
rtk grep "thinkingLevel" components/agent-chat/AgentChat.tsx -n
```

找到传给 ChatInputArea 的地方（约第 405-407 行），把：

```tsx
thinkingLevel={sendMessage.thinkingLevel}
setThinkingLevel={sendMessage.setThinkingLevel}
```

改为：

```tsx
currentTier={sendMessage.currentTier}
setCurrentTier={sendMessage.setCurrentTier}
```

**Step 4: 修改 ChatInputArea 的 props 接口**

打开 `components/agent-chat/ChatInputArea.tsx`，找到 props 接口定义（第 78-82 行附近）：

```tsx
// 改前
thinkingLevel: number;
setThinkingLevel: (level: number) => void;

// 改后
currentTier?: 'haiku' | 'sonnet' | 'opus';
setCurrentTier: (tier: 'haiku' | 'sonnet' | 'opus' | undefined) => void;
```

同步修改解构（第 111-112 行附近）：

```tsx
// 改前
thinkingLevel,
setThinkingLevel,

// 改后
currentTier,
setCurrentTier,
```

**Step 5: 删除思考深度 DropdownMenu**

在 ChatInputArea.tsx 中定位（约第 328-368 行）：

```tsx
{/* 思考等级 DropdownMenu */}
<DropdownMenu>
  ...
</DropdownMenu>
```

完全删除这个 DropdownMenu 区块（不保留注释）。

**Step 6: 新增模型层级 DropdownMenu**

在原思考 DropdownMenu 的位置（权限模式 DropdownMenu 之前），新增：

```tsx
{/* 模型层级 DropdownMenu */}
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <InputGroupButton
      size="xs"
      className={cn(
        "gap-1",
        currentTier ? 'text-primary' : 'text-muted-foreground'
      )}
      title="模型层级"
    >
      <Cpu size={14} />
      <span className="text-xs">
        {currentTier === 'haiku' ? 'Haiku' :
         currentTier === 'sonnet' ? 'Sonnet' :
         currentTier === 'opus' ? 'Opus' : '默认'}
      </span>
      <ChevronRight size={12} className="rotate-90" />
    </InputGroupButton>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="start" className="min-w-[120px]">
    <DropdownMenuLabel>模型层级</DropdownMenuLabel>
    <DropdownMenuSeparator />
    <DropdownMenuRadioGroup
      value={currentTier ?? ''}
      onValueChange={async (value) => {
        const newTier = value === '' ? undefined : (value as 'haiku' | 'sonnet' | 'opus');
        setCurrentTier(newTier);
        if (sessionId) {
          await client.setSessionModel({
            sessionId,
            tier: newTier,
          });
        }
      }}
    >
      <DropdownMenuRadioItem value="">默认</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="haiku">Haiku</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="sonnet">Sonnet</DropdownMenuRadioItem>
      <DropdownMenuRadioItem value="opus">Opus</DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
  </DropdownMenuContent>
</DropdownMenu>
```

**Step 7: 修改 import**

在 ChatInputArea.tsx 顶部 import 中：
- 删除 `Brain`（如果仅此处使用）
- 新增 `Cpu`

```tsx
import { Cpu, ChevronRight, Shield, ImagePlus /* ... */ } from 'lucide-react';
```

验证 `Brain` 是否还有其他用处：
```bash
rtk grep "Brain" components/agent-chat/ChatInputArea.tsx -n
```

如果没有其他使用，从 import 删除。

**Step 8: 验证 lint 和运行时**

```bash
rtk lint
rtk bun run build:electron
rtk bun run dev
```

在应用中：
- [ ] 输入框工具栏原"思考"按钮消失
- [ ] 新增"默认 ▾"按钮，下拉显示 4 个选项
- [ ] 切换到 Haiku 后，发送消息观察响应速度（应更快）
- [ ] 关闭重开会话后，模型层级回到"默认"
- [ ] 设置页仍可正常打开/保存

**Step 9: Commit**

```bash
rtk git add components/agent-chat/
rtk git commit -m "feat(chat): 输入框删思考按钮，新增模型层级下拉（运行时 setModel）"
```

---

## 最终验收清单

全部任务完成后，手动验证：

- [ ] 应用启动无报错
- [ ] 设置页 AI 行为 Tab 无思考模式，effort 有 5 档，两个模型下拉正常工作
- [ ] 保存设置并重启会话，观察日志能看到 `ANTHROPIC_MODEL` / `CLAUDE_CODE_SUBAGENT_MODEL` env 已注入（当用户配置了对应字段时）
- [ ] 输入框工具栏显示模型层级下拉（默认显示"默认"）
- [ ] 切换层级后调用 `setSessionModel`，下一条消息用新模型（可通过响应速度差异验证 haiku 更快）
- [ ] 旧 settings.json（含 `thinking` 字段）加载不报错，字段被忽略
- [ ] `effort: 'xhigh'` 发送消息不报错
- [ ] 历史对话加载/分叉/编辑重发功能不受影响（回归测试）

## 不做的事（YAGNI 检查）

- ❌ 不添加 settings.json 迁移脚本
- ❌ 不为 DeepSeek 做 Profile 预设模板
- ❌ 不添加 CLAUDE_CODE_EFFORT_LEVEL env（effort option 已覆盖）
- ❌ 不暴露 supportedModels() 列表
- ❌ 不做运行时 effort 切换（SDK 无此能力）
