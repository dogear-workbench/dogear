# AgentChat 六项改进实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复设置页保存后会话假重启的 bug；统一模型切换路径走 /model；让"始终允许"真正持久化到 permissionRules.allow（细粒度模式）并在设置页可见可删；让 Plan Mode 在 AI 调用 ExitPlanMode 后 UI 自动切回；用"散装胶囊 + 末尾跟随汇总块"渲染新版 Task* 工具；统一 SubAgent/Skill 与工具块的视觉风格。

**Architecture:**
- 6 个独立任务，按依赖排序：① 重启 bug（基础设施）→ ② 模型路径统一 → ③ 权限持久化（含设置页 UI）→ ④ Plan Mode 同步 → ⑤ Todo 聚合渲染 → ⑥ 渲染对齐
- 任务之间无强耦合，可独立提交，单 PR 收口
- 所有改动均在现有目录结构内，不引入新模块

**Tech Stack:** TypeScript + React 19 + Zustand + Electron + @anthropic-ai/claude-agent-sdk 0.3.146 + tipc + Tailwind CSS 4 + shadcn/ui + lucide-react

**验证范围说明：** 项目无统一单元测试基建，UI 类改动靠运行 dev 后在浏览器验证；逻辑类改动尽量提取为可单测的纯函数，必要时直接看代码路径与日志。

---

## Task 1: 修复设置页保存后会话假重启

**问题：** `app/settings/page.tsx:115-119` 的 `handleSaveAndRestart` 调用 `restartActiveSessions()`，但该方法只让主进程 `sessionManager.closeAll()` 销毁后端 session，**没通知前端**。`useAgentSession` 重建副作用依赖 `conversationId/forkParams/sessionRestartTrigger` 变化才会执行，三者都没动，前端 `attachmentId/sessionId/isSessionReady` 仍指向已销毁的后端 session，用户发消息石沉大海。

**Files:**
- Modify: `app/settings/page.tsx:115-119`（`handleSaveAndRestart`）
- Modify: `app/settings/page.tsx:144-150`（`handleClose` 的 saveRestart 分支）

**Step 1: 改 `handleSaveAndRestart`，在 `restartActiveSessions` 后触发前端重建**

打开 `app/settings/page.tsx`，确认顶部已经 `import { useConversationStore } from '@/stores/conversation-store';`（若未导入则补一行）。

修改 `handleSaveAndRestart`：

```ts
const handleSaveAndRestart = async () => {
  await saveToStore(sanitizeForSave(local));
  await restartActiveSessions();
  // 后端 sessionManager.closeAll() 不会通知前端，必须显式触发前端 useAgentSession 重建
  useConversationStore.getState().triggerSessionRestart();
  closeSettings();
};
```

同样修改 `handleClose` 里 `saveRestart` 分支（约第 146-150 行）：

```ts
} else if (result === 'saveRestart') {
  await saveToStore(sanitizeForSave(local));
  await restartActiveSessions();
  useConversationStore.getState().triggerSessionRestart();
  closeSettings();
}
```

**Step 2: 手动验证**

```bash
bun run dev
```

在 dev 模式下：
1. 打开任一对话，发一条消息确认 AI 能回复
2. 打开设置 → 改个无关字段（比如默认提示词加个字符）→ 点"保存并重启会话"
3. 设置页关闭后，**立即发一条消息**——应该能正常收到回复
4. 旧问题：消息发出去无响应、loading 无变化

如果第 3 步失败，看控制台是否有 `useAgentSession` 重建日志和新 `attachmentId`。

**Step 3: Commit**

```bash
rtk git add app/settings/page.tsx
rtk git commit -m "fix(settings): 保存并重启会话后触发前端 session 重建"
```

---

## Task 2: 模型下拉切换走 /model 斜杠命令路径

**问题：** `ChatInputArea.tsx:357` 下拉切换直接调 `client.setSessionModel({ sessionId, tier })`，不进入 SDK 历史，会话回放时看不到切换记录；而手动输入 `/model haiku` 走 SDK，能进入历史并立即在消息流显示居中指示。两条路径不一致，用户看历史时只能看到一种来源的切换。

**方案：** 下拉 onValueChange 改为发送 `/model <tier>` 文本走 sendMessage 路径（仿照 `/compact` 的发送方式），让 SDK 把它当成命令处理。

**Files:**
- Modify: `components/agent-chat/ChatInputArea.tsx:351-368`（模型 DropdownMenuRadioGroup 的 onValueChange）
- Read: `components/agent-chat/hooks/useSendMessage.ts:186-217`（/compact 命令的现有实现，作为参考）

**Step 1: 看清现有 /model 命令在 SDK 端怎么处理**

在 `query-based-session.ts` 中搜索 `/model`，确认 SDK 接受裸字符串 `/model xxx` 作为命令输入。`MessageItem.tsx:102` 的注释明确说明 SDK 会注入 `<command-name>/model` 用户消息，由 MessageItem 渲染为居中系统指示。

确认无需新增前端命令拦截逻辑——直接把字符串当用户消息发送即可。

**Step 2: 修改 ChatInputArea 的 onValueChange**

`components/agent-chat/ChatInputArea.tsx` 第 351-368 行附近，找到模型 `DropdownMenuRadioGroup` 的 `onValueChange`。

现有代码：
```ts
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
```

改成（保留 `setCurrentTier` 本地状态同步；不再直接调 setSessionModel；改为发送 /model 命令字符串）：

```ts
onValueChange={async (value) => {
  const newTier = value === '' ? undefined : (value as 'haiku' | 'sonnet' | 'opus');
  setCurrentTier(newTier);
  if (!sessionId) return;
  // 改走 SDK /model 命令路径，与用户手动输入 /model 一致：
  // - 会话历史保留 <command-name>/model 记录，回放时显示居中切换提示
  // - 运行中即刻可见（SDK 注入消息走原有渲染链路）
  const modelArg = newTier
    ? { haiku: 'claude-haiku-4-5', sonnet: 'claude-sonnet-4-6', opus: 'claude-opus-4-7' }[newTier]
    : 'default';
  try {
    await client.sendQueryBasedSessionMessage({ sessionId, content: `/model ${modelArg}` });
  } catch (e) {
    console.warn('模型切换发送失败:', e);
  }
}}
```

> **注意：** 模型字符串可能在项目的 model profile 配置里有更准确的映射。先查 `query-based-session.ts` 的 `currentActiveProfile.tiers` 字段或 `app/settings/AgentsTab.tsx` 看实际模型 ID 格式，按真实命名修正上面三个映射值。不要硬编码错的 ID 让 SDK 报错。

**Step 3: 验证模型切换在历史中可见**

```bash
bun run dev
```

1. 新建对话，发一条消息让 AI 回复（建立 sdkSessionId）
2. 下拉切换模型 Haiku → 应立即在消息流出现居中"切换模型至 …" 指示
3. 关闭对话再打开 → 历史回放，居中切换指示仍在
4. 切回"默认" → 同样的指示再出现一次
5. 检查 `.dogear/conversations/<sdkSessionId>.jsonl` 里有 `<command-name>/model` 用户消息记录

**Step 4: 评估是否可删 `client.setSessionModel` RPC**

搜索 `client.setSessionModel` 全项目用法：

```
rtk grep -r "setSessionModel" --include="*.ts" --include="*.tsx"
```

如果只有 `ChatInputArea.tsx` 一个调用点（已被本任务替换），则 `setSessionModel` RPC + `electron/main/tipc/agent.ts:423` 的 procedure + `QueryBasedSession.setModel` 都可以删。**但本任务暂不删** —— 留给后续清理 PR。先确保 /model 路径稳定。

**Step 5: Commit**

```bash
rtk git add components/agent-chat/ChatInputArea.tsx
rtk git commit -m "feat(chat): 模型下拉切换改走 /model 命令路径，历史可见"
```

---

## Task 3: 权限"始终允许"持久化到 permissionRules.allow + 设置页细粒度规则 UI

**问题：**
- `query-based-session.ts:1586-1588` 的 `always_allow` 只把 SDK suggestion 作为 `updatedPermissions` 回传 SDK，存活于 query() 进程内存，**会话结束即丢**。
- 设置页 `ToolsAndPermissionsTab.tsx` 现有 UI 只识别**工具名级别**的 allow/deny（如 `Bash`），不显示 SDK 模式级别规则（如 `Bash(git diff:*)`），用户无法管理细粒度规则。

**方案：**
- 后端：`respondPermissionRequest` 拿到 `always_allow` 时，除了回传 SDK，还要把 suggestions 写入 `AppSettings.permissionRules.allow`，跨会话保留。
- 前端：设置页 `ToolsAndPermissionsTab` 新增"细粒度允许规则"区域，列出所有带括号的规则项（如 `Bash(git diff:*)`），每条一个删除按钮；工具名级别（不带括号）继续用现有 UI。

**Files:**
- Modify: `electron/main/agents/query-based-session.ts:1571-1593`（`respondPermissionRequest`）
- Create: `electron/main/services/permission-rules-service.ts`（新增追加方法）
- Modify: `app/settings/ToolsAndPermissionsTab.tsx`（增"细粒度允许规则"区域）
- Modify: `electron/main/tipc/settings.ts`（暴露追加规则 RPC，可选——也可直接在 query-based-session 里读写 settings-service）

**Step 1: 在 settings-service 暴露 `appendPermissionAllowRules` 方法**

打开 `electron/main/services/settings-service.ts`，找到现有的读写设置方法（`getSettings` / `updateSettings`）。在文件末尾新增：

```ts
/**
 * 追加规则到 permissionRules.allow，自动去重。
 * 用于权限请求"始终允许"按钮的持久化。
 */
export async function appendPermissionAllowRules(rules: string[]): Promise<void> {
  if (!rules.length) return;
  const current = await getSettings();
  const existing = new Set(current.permissionRules?.allow || []);
  const beforeSize = existing.size;
  for (const r of rules) existing.add(r);
  if (existing.size === beforeSize) return; // 全部已存在，跳过写盘
  await updateSettings({
    ...current,
    permissionRules: {
      allow: Array.from(existing),
      deny: current.permissionRules?.deny || [],
    },
  });
}
```

> 注意：`updateSettings` / `getSettings` 的真实签名以现有代码为准，必要时调整。

**Step 2: `query-based-session.ts` 在 always_allow 时调用持久化**

修改 `electron/main/agents/query-based-session.ts:1580-1593`：

```ts
if (behavior === 'allow' || behavior === 'always_allow') {
  const result: PermissionResult = {
    behavior: 'allow',
    updatedInput: updatedInput || pending.input,
  };
  if (behavior === 'always_allow' && pending.suggestions?.length) {
    // 当前会话立即生效
    result.updatedPermissions = pending.suggestions;
    // 持久化到 AppSettings.permissionRules.allow，跨会话保留
    // suggestions 通常是 SDK 给的精确模式，如 Bash(git diff:*)
    const ruleStrings = pending.suggestions
      .map((s: any) => typeof s === 'string' ? s : s.rule || s.pattern || s.tool)
      .filter((s: any): s is string => typeof s === 'string' && s.length > 0);
    if (ruleStrings.length) {
      appendPermissionAllowRules(ruleStrings).catch((e) =>
        this.logger.warn('持久化 always_allow 规则失败:', e)
      );
      this.logger.info('已持久化 always_allow 规则:', ruleStrings);
    }
  }
  pending.resolve(result);
}
```

顶部 import：

```ts
import { appendPermissionAllowRules } from '../services/settings-service';
```

> **关键：** SDK suggestion 的实际数据结构需先确认。打 `console.log` 或读 `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` 找 `PermissionResult.updatedPermissions` 的类型。上面的 `.rule || .pattern || .tool` 是兜底，按真实字段调整。

**Step 3: 验证后端持久化生效**

```bash
bun run build:electron
bun run dev
```

1. 新建对话，问 AI："运行 `git status`"（触发 Bash 权限请求）
2. 权限卡片出现 → 点"始终允许"
3. **重启应用**
4. 打开 `.dogear/settings.json`（开发环境在项目根 `.dogear/`），确认 `permissionRules.allow` 数组里有新增规则（很可能是 `Bash(git status:*)` 之类）
5. 重启后再次问 AI"运行 git status" → 应该**不再弹权限请求**

**Step 4: 设置页 ToolsAndPermissionsTab 加"细粒度允许规则"区域**

打开 `app/settings/ToolsAndPermissionsTab.tsx`。在文件中先找到 `local.permissionRules` 的使用位置（约 71-95 行）。

新增一个 helper（紧挨现有 `getSdkToolPermission` 等定义之后）：

```ts
/**
 * 提取细粒度规则（带括号的模式，如 Bash(git diff:*)）。
 * 工具名级别（如 Bash）由现有工具列表 UI 管理，不进入此列表。
 */
const getFineGrainedAllowRules = (): string[] => {
  const allow = local.permissionRules?.allow || [];
  return allow.filter((r) => r.includes('('));
};

const removeFineGrainedRule = (rule: string) => {
  const rules = local.permissionRules || { allow: [], deny: [] };
  const allow = (rules.allow || []).filter((r) => r !== rule);
  setLocal((prev) => ({ ...prev, permissionRules: { allow, deny: rules.deny || [] } }));
};
```

在 JSX 末尾（最后一个 `</section>` 之后、根 `</div>` 之前）增加新 section：

```tsx
{/* ── 细粒度允许规则 ───────────────────────────────────── */}
<section>
  <div className="flex items-center gap-2 mb-2">
    <ShieldCheck className="w-4 h-4 text-muted-foreground" />
    <h3 className="text-sm font-semibold">细粒度允许规则</h3>
    <span className="text-xs text-muted-foreground">
      点击会话权限卡的"始终允许"后自动写入
    </span>
  </div>
  <div className="border rounded-lg overflow-hidden">
    {getFineGrainedAllowRules().length === 0 ? (
      <div className="text-xs text-muted-foreground px-4 py-3">
        暂无细粒度规则
      </div>
    ) : (
      <div className="divide-y">
        {getFineGrainedAllowRules().map((rule) => (
          <div key={rule} className="flex items-center justify-between gap-3 px-4 py-2 text-xs">
            <span className="font-mono text-foreground truncate">{rule}</span>
            <button
              type="button"
              onClick={() => removeFineGrainedRule(rule)}
              className="text-muted-foreground hover:text-red-600 shrink-0"
              title="删除此规则"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    )}
  </div>
</section>
```

顶部 import 补 `ShieldCheck` 和 `X`：

```ts
import { Sparkles, /* 现有 imports */, ShieldCheck, X } from 'lucide-react';
```

**Step 5: 验证设置页 UI**

```bash
bun run dev
```

1. 触发一次"始终允许"（用 Task 3 Step 3 的方法）
2. 打开设置页 → 工具与权限 → 滚动到底，应看到"细粒度允许规则"区域，列出刚刚的规则
3. 点删除按钮 → 规则从列表移除
4. 点"保存"或"保存并重启会话" → 检查 `.dogear/settings.json` 中该规则已不在 allow 数组
5. 再次问 AI 同样问题 → 权限卡片又出现（因为规则已删）

**Step 6: 改"始终允许"按钮文案（可选但推荐）**

打开 `components/agent-chat/PermissionRequestCard.tsx`，找到"始终允许"按钮文本。改为"永久允许"或保留"始终允许"——视觉上让用户知道这是持久化操作。

**这一步如有疑虑可跳过**——文案问题不影响功能。

**Step 7: Commit**

```bash
rtk git add electron/main/agents/query-based-session.ts \
            electron/main/services/settings-service.ts \
            app/settings/ToolsAndPermissionsTab.tsx \
            components/agent-chat/PermissionRequestCard.tsx
rtk git commit -m "feat(permissions): 始终允许持久化到 permissionRules.allow + 设置页细粒度规则管理"
```

---

## Task 4: Plan Mode 双向同步（AI 调用 ExitPlanMode 后 UI 自动切回）

**问题：** SDK 在 `ExitPlanMode` 工具被 AI 调用后，会发一条 `SDKStatusMessage`（`subtype='status'`），其 `permissionMode` 字段携带新模式。但 `query-based-session.ts:1085-1192` 的 `convertSDKMessage` 在 `system` 分支只处理 `compacting`，**直接丢弃了带 `permissionMode` 的 status 消息**，UI 上的 PermissionMode 选择器无法跟随。

**Files:**
- Modify: `electron/main/agents/query-based-session.ts:1164-1171`（status/compacting 分支附近）
- Read: `node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts` 第 3503-3511 行（确认 SDKStatusMessage 字段）

**Step 1: 验证 SDK status 消息携带 permissionMode**

```bash
rtk grep -n "permissionMode" "C:/dogear/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts"
```

确认 `SDKStatusMessage` 类型上有 `permissionMode?: PermissionMode` 字段。

**Step 2: 在 status 分支识别 permissionMode 并同步**

修改 `electron/main/agents/query-based-session.ts:1164-1171`，把原有的：

```ts
if (sdkMessage.subtype === 'status' && (sdkMessage as any).status === 'compacting') {
  this.logger.info('对话正在压缩...');
  return {
    type: 'compacting',
    timestamp,
  };
}
```

扩展为（保留 compacting 分支，新增 permissionMode 识别）：

```ts
if (sdkMessage.subtype === 'status') {
  const statusMsg = sdkMessage as any;

  // 压缩中状态
  if (statusMsg.status === 'compacting') {
    this.logger.info('对话正在压缩...');
    return {
      type: 'compacting',
      timestamp,
    };
  }

  // AI 调用 ExitPlanMode 等工具后，SDK 会推送带 permissionMode 的 status 消息
  // 复用现有 setPermissionMode 链路，让前端 UI 选择器自动切回
  if (statusMsg.permissionMode && typeof statusMsg.permissionMode === 'string') {
    this.logger.info('SDK status 推送 permissionMode 变更:', statusMsg.permissionMode);
    this.setPermissionMode(statusMsg.permissionMode);
    // status 消息无需在消息流单独渲染（setPermissionMode 内部已发 permissionModeChanged 事件，
    // 触发 useSessionEvents 的 insertModeChangeNotice）
    return null;
  }

  return null;
}
```

> **关键：** 确认 `this.setPermissionMode` 已经会 emit `permissionModeChanged` 事件并被 `useSessionEvents.ts:109-113` 监听消费——是的（之前调查已验证），所以这里直接调用即可，**不要重复 emit**。

**Step 3: 同步前端 ChatInputArea 选择器的本地状态**

`useSessionEvents.ts:109-113` 监听 `permissionModeChanged` 后会怎么处理？打开看一下：

```bash
rtk grep -n "permissionModeChanged" "C:/dogear/components/agent-chat/hooks/useSessionEvents.ts"
```

确认会调用 `setPermissionMode`（在 `useAgentSession` 返回的状态上）。如果只更新了 store 没更新 ChatInputArea 的 dropdown value，下拉框 UI 不会跟随——这一步要确认。

打开 `ChatInputArea.tsx:393-394`：

```tsx
value={permissionMode}
onValueChange={async (value) => {
```

`permissionMode` 来自 props，由 useAgentSession 提供。只要 `useSessionEvents` 监听到事件后更新了同一份 state，UI 会自动重新渲染。**这一步通常无需改代码，但要肉眼验证链路**。

**Step 4: 验证 Plan Mode 切换 + 自动退出**

```bash
bun run build:electron
bun run dev
```

1. 新建对话，权限模式选"仅规划"
2. 让 AI 做点事（任意需要工具的任务，如"列出 src 下的 ts 文件"）
3. AI 应该先做计划描述，调用 `ExitPlanMode` 工具
4. **观察输入框的权限模式下拉框 UI 是否自动从"仅规划"切回到"需确认"或别的**
5. 同时消息流应出现一条权限模式变更通知（来自 `insertModeChangeNotice`）

如果第 4 步失败，加日志在 `useSessionEvents.ts` 的 permissionModeChanged 监听器里，确认事件确实到达前端。

**Step 5: Commit**

```bash
rtk git add electron/main/agents/query-based-session.ts
rtk git commit -m "feat(agent): SDK status 消息识别 permissionMode，Plan Mode 双向同步"
```

---

## Task 5: Todo 散装胶囊 + 末尾跟随汇总块

**问题：** SDK 0.3.146 把 TodoWrite 拆成 `TaskCreate / TaskUpdate / TaskGet / TaskList` 四个 CRUD 工具。当前 `ContentBlockItem.tsx:116-122` 只识别旧的 `TodoWrite` 一次性写整张表，新的 CRUD 流变成一串散装工具块、没有"当前清单"汇总视图。

**方案：** 双层渲染：
1. **散装胶囊层** —— 每条 TaskCreate/TaskUpdate 仍渲染为一行紧凑工具块（已有 `ToolBlock` 通用渲染 + compact 模式）。展示时间维度（"AI 在第几回合做了什么"）。
2. **汇总块层** —— 整个会话内**唯一**的"当前任务清单"块，吸附在**最后一次** Task* 操作所在的 assistant 消息末尾，跟随移动。
   - 历史回放：transformers 扫一遍累积所有 Task* 状态 → 在最后一条含 Task* 的 assistant 消息 contentBlocks 末尾追加一个 `type: 'task_summary'` 块。
   - 流式：新 Task* 消息到达时，前端 hook 维护累积态 + 移动汇总块位置。

**Files:**
- Modify: `components/agent-chat/types.ts`（增 `task_summary` content block type）
- Modify: `components/agent-chat/transformers.ts`（历史回放时聚合 Task* 并注入 task_summary）
- Create: `components/agent-chat/hooks/useTaskListAggregator.ts`（流式聚合）
- Modify: `components/agent-chat/AgentChat.tsx`（调用新 hook）
- Modify: `components/agent-chat/ContentBlockItem.tsx`（新增 case 'task_summary'，复用 TodoListBlock）
- Modify: `components/ToolBlock.tsx`（保留 TaskCreate/TaskUpdate 散装渲染，确保 compact 模式 previewLines=0）
- Read（参考）: `components/agent-chat/hooks/useSubAgentMessages.ts`（流式聚合的模式）

**Step 1: 定义新内容块类型**

打开 `components/agent-chat/types.ts`，找到 `ContentBlock` 联合类型定义。新增分支：

```ts
| {
    type: 'task_summary';
    /** 当前会话累积的任务列表（从所有 Task* 工具调用合成） */
    tasks: Array<{
      id: string;
      subject: string;
      activeForm?: string;
      status: 'pending' | 'in_progress' | 'completed';
    }>;
    /** 用于 React key */
    timestamp: number;
  }
```

**Step 2: 实现纯函数 `aggregateTasks` 与 `injectTaskSummary`**

新建文件 `components/agent-chat/task-aggregator.ts`：

```ts
import type { ExtendedSessionMessage } from '@/types/electron-api';
import type { Message, ContentBlock } from './types';

interface TaskState {
  id: string;
  subject: string;
  activeForm?: string;
  status: 'pending' | 'in_progress' | 'completed';
  // 用于稳定排序
  createdAt: number;
}

/**
 * 从一组消息中累积所有 Task* 工具调用的最终状态。
 * - TaskCreate({ subject, activeForm }) → 新增（id 由 SDK 在结果里给，未知则用 input.subject）
 * - TaskUpdate({ taskId, status, subject? }) → 更新
 * - TaskList / TaskGet → 忽略（只读）
 */
export function aggregateTasks(messages: Message[]): TaskState[] {
  const state = new Map<string, TaskState>();
  let lastTaskUseAt = 0;

  for (const msg of messages) {
    if (msg.role !== 'assistant' || !msg.contentBlocks) continue;
    for (const block of msg.contentBlocks) {
      if (block.type !== 'tool_use') continue;
      const name = block.toolName;
      const input = block.toolInput as any;
      const output = block.toolOutput as any;

      if (name === 'TaskCreate') {
        // 优先使用 SDK 返回的 taskId（output），fallback 到 input 字段
        const id = output?.taskId || output?.id || input?.id || input?.subject;
        if (!id) continue;
        state.set(id, {
          id,
          subject: input?.subject || id,
          activeForm: input?.activeForm,
          status: 'pending',
          createdAt: block.timestamp || Date.now(),
        });
        lastTaskUseAt = block.timestamp || lastTaskUseAt;
      } else if (name === 'TaskUpdate') {
        const id = input?.taskId;
        if (!id) continue;
        const existing = state.get(id);
        if (!existing) continue;
        state.set(id, {
          ...existing,
          status: input?.status || existing.status,
          subject: input?.subject || existing.subject,
          activeForm: input?.activeForm || existing.activeForm,
        });
        lastTaskUseAt = block.timestamp || lastTaskUseAt;
      }
    }
  }

  return Array.from(state.values()).sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * 在消息数组中找到最后一条含 Task* 调用的 assistant 消息，
 * 在它的 contentBlocks 末尾追加 task_summary 块（如已有则替换）。
 * 不修改原数组：返回新数组。
 */
export function injectTaskSummary(messages: Message[]): Message[] {
  const tasks = aggregateTasks(messages);
  if (tasks.length === 0) return messages;

  let lastTaskMsgIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant' || !msg.contentBlocks) continue;
    if (msg.contentBlocks.some(b =>
      b.type === 'tool_use' &&
      (b.toolName === 'TaskCreate' || b.toolName === 'TaskUpdate')
    )) {
      lastTaskMsgIdx = i;
      break;
    }
  }
  if (lastTaskMsgIdx < 0) return messages;

  const result = [...messages];
  const targetMsg = result[lastTaskMsgIdx];
  // 移除可能已有的 task_summary（避免重复）
  const blocks = (targetMsg.contentBlocks || []).filter(b => b.type !== 'task_summary');
  blocks.push({
    type: 'task_summary',
    tasks: tasks.map(({ id, subject, activeForm, status }) => ({ id, subject, activeForm, status })),
    timestamp: Date.now(),
  });
  result[lastTaskMsgIdx] = { ...targetMsg, contentBlocks: blocks };

  // 同时确保其他消息中不存在 task_summary（吸附在唯一位置）
  for (let i = 0; i < result.length; i++) {
    if (i === lastTaskMsgIdx) continue;
    const m = result[i];
    if (!m.contentBlocks?.some(b => b.type === 'task_summary')) continue;
    result[i] = {
      ...m,
      contentBlocks: m.contentBlocks.filter(b => b.type !== 'task_summary'),
    };
  }

  return result;
}
```

**Step 3: 在 transformers 历史回放完毕时调用 injectTaskSummary**

打开 `components/agent-chat/transformers.ts`，找到把 SDK 历史转成 `Message[]` 的主函数末尾（在所有循环结束、return historyMessages 之前）。

```ts
import { injectTaskSummary } from './task-aggregator';

// ... 原有 transform 逻辑 ...

// 末尾追加 task_summary 吸附块
return injectTaskSummary(historyMessages);
```

**Step 4: 流式聚合 hook**

新建 `components/agent-chat/hooks/useTaskListAggregator.ts`：

```ts
import { useEffect } from 'react';
import type { Message } from '../types';
import { injectTaskSummary } from '../task-aggregator';

/**
 * 监听 messages 变化，自动维护 task_summary 块。
 * 每次 messages 数组（或其中 Task* 工具调用）变化时，重新计算汇总并吸附到最后一次 Task* 调用所在消息。
 *
 * 注意：此 hook 通过 setMessages 改写消息数组，须确保 messages 来自同一个 setState 源，
 * 否则会触发无限循环。实现上用浅引用比较防抖（只在 Task* 块数量或内容变化时才写回）。
 */
export function useTaskListAggregator(
  messages: Message[],
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
) {
  useEffect(() => {
    // 统计当前 Task* 调用的"签名"：(toolName, toolInput JSON) 拼接
    const taskSignature = messages
      .flatMap(m =>
        (m.contentBlocks || [])
          .filter(b => b.type === 'tool_use' && (b.toolName === 'TaskCreate' || b.toolName === 'TaskUpdate'))
          .map(b => `${(b as any).toolName}:${JSON.stringify((b as any).toolInput || {})}`)
      )
      .join('|');

    // 已有 summary 的签名（避免重复写）
    const existingSummary = messages
      .flatMap(m => (m.contentBlocks || []).filter(b => b.type === 'task_summary'))
      .map(b => JSON.stringify((b as any).tasks))
      .join('|');

    const next = injectTaskSummary(messages);
    const nextSummary = next
      .flatMap(m => (m.contentBlocks || []).filter(b => b.type === 'task_summary'))
      .map(b => JSON.stringify((b as any).tasks))
      .join('|');

    if (existingSummary === nextSummary) return; // 无变化，不写回避免循环

    setMessages(next);
    // taskSignature 仅用于在依赖数组中体现"我看的是 Task* 内容变化"
    void taskSignature;
  }, [
    messages,
    setMessages,
  ]);
}
```

**Step 5: AgentChat.tsx 调用新 hook**

打开 `components/agent-chat/AgentChat.tsx`，找到使用 `setMessages` 的位置（约第 200-300 行附近，主组件内部，messages/setMessages 从 useSessionMessages 或类似 hook 拿）。

在 messages 与 setMessages 都可用的作用域里加：

```ts
import { useTaskListAggregator } from './hooks/useTaskListAggregator';

// 组件内：
useTaskListAggregator(messages, setMessages);
```

**Step 6: ContentBlockItem 识别 task_summary 渲染**

打开 `components/agent-chat/ContentBlockItem.tsx:100-153`，在 switch 中新增 case：

```tsx
case 'task_summary': {
  const todos = (block.tasks || []).map(t => ({
    content: t.subject,
    activeForm: t.activeForm || t.subject,
    status: t.status,
  }));
  return <TodoListBlock todos={todos} />;
}
```

确认 `TodoListBlock` import 已存在。

**Step 7: 调整旧 TaskList 输出渲染（避免双重显示）**

`ContentBlockItem.tsx:119-122` 现有 TaskList 输出渲染要保留——这是 AI 主动调用 `TaskList()` 查询当前状态的可视化（散装的"查询动作"），跟吸附的 task_summary 不冲突。**不动**。

但是 `TodoWrite` 那条 (`:116-118`) 如果项目里旧会话还有 TodoWrite 调用，保留即可，新 SDK 不会再生成。

**Step 8: 确保散装 TaskCreate/TaskUpdate 工具块走 compact 路径**

`ToolBlock.tsx` 通用工具渲染当 `displayMode === 'compact'` 时 `previewLines=0`，行为正确。`ContentBlockItem.tsx:135-152` 没有针对 TaskCreate/Update 的特殊处理 → 走通用 `ToolBlock` 路径。**无需改代码**。

但是检查 `ToolBlock.tsx` 的标题摘要逻辑（前面 Grep 结果显示已识别 TaskCreate/Update/Get/List），确保散装行如下：
- TaskCreate → "📋 TaskCreate · 做X"
- TaskUpdate → "📋 TaskUpdate · id1 → completed"

视觉风格统一，无需多余调整。

**Step 9: 端到端验证**

```bash
bun run dev
```

构造一个需要 todo 的任务：
1. 让 AI 做："请用 TaskCreate 列三个任务 A B C，然后逐个 TaskUpdate 标记完成"
2. **预期**：
   - 消息流中能看到 3 行 "TaskCreate · A/B/C" 胶囊
   - 接着 3 行 "TaskUpdate · A/B/C → completed" 胶囊
   - 在**最新**的 assistant 消息底部出现一个 "📋 任务清单" 块，里面 A B C 三个都是 ✓ 状态
3. 切走后再打开对话（触发历史回放）→ task_summary 块还在最新位置，旧位置无重复
4. 让 AI 继续创建新任务 D → task_summary 块**移动**到这条新消息底部，A B C 已完成位置依然显示历史胶囊但 task_summary 不再在那里

**Step 10: Commit**

```bash
rtk git add components/agent-chat/types.ts \
            components/agent-chat/task-aggregator.ts \
            components/agent-chat/transformers.ts \
            components/agent-chat/hooks/useTaskListAggregator.ts \
            components/agent-chat/AgentChat.tsx \
            components/agent-chat/ContentBlockItem.tsx
rtk git commit -m "feat(chat): 新版 Task 工具散装胶囊 + 末尾跟随汇总块渲染"
```

---

## Task 6: SubAgent / Skill 渲染与工具块对齐

**问题：**
- `SubAgentBlock.tsx:87` `previewLines={2}` 硬编码，不响应 `displayMode='compact'`，在 compact 模式下仍泄露 2 行预览，与 Edit/Write/Bash 的 0 行预览不一致。
- Skill 工具无专属 renderer，展开后是 JSON 原始 args，与 Read/Glob/Grep 的精致渲染相比体验落差大。

**Files:**
- Modify: `components/agent-chat/SubAgentBlock.tsx:75-124`
- Create: `components/agent-chat/tool-renderers/SkillRenderer.tsx`
- Modify: `components/ToolBlock.tsx`（注入 SkillRenderer 路由）

**Step 1: SubAgentBlock previewLines 跟随 displayMode**

打开 `components/agent-chat/SubAgentBlock.tsx`，在组件顶部读 displayMode：

```ts
import { useSettingsStore } from '@/stores/settings-store';

// 组件内：
const displayMode = useSettingsStore(s => s.settings.ui?.messageDisplayMode || 'compact');
```

把 `previewLines={2}` 改为：

```tsx
previewLines={displayMode === 'compact' ? 0 : 2}
```

> 与 `ToolBlock` 一致：compact 模式下不显示任何预览，必须点开看。

**Step 2: 验证 SubAgent 在 compact 下不泄露行**

```bash
bun run dev
```

1. 设置 → 显示 → 消息显示模式：紧凑（compact）
2. 触发任一 SubAgent 调用（让 AI"用一个子代理调研 X"）
3. SubAgent 块应只显示标题行，**无下方 2 行预览**
4. 切换到详细模式（detailed）→ 重新显示 2 行预览

**Step 3: 创建 SkillRenderer**

新建 `components/agent-chat/tool-renderers/SkillRenderer.tsx`：

```tsx
import { Zap } from 'lucide-react';
import { ToolDetailShell, KeyValueList, OutputBox } from './ToolDetailShell';
import { CollapsibleBlock } from '../CollapsibleBlock';

interface SkillRendererProps {
  toolInput: { skill?: string; args?: string } | undefined;
  toolOutput?: string | undefined;
  isError?: boolean;
  displayMode: 'compact' | 'detailed';
}

export function SkillRenderer({ toolInput, toolOutput, isError, displayMode }: SkillRendererProps) {
  const skillName = toolInput?.skill || '未知 Skill';
  const argsText = toolInput?.args || '';

  return (
    <CollapsibleBlock
      icon={
        <span className="flex items-center justify-center w-5 h-5 rounded border border-amber-200 bg-amber-50">
          <Zap className="w-3 h-3 text-amber-600" />
        </span>
      }
      title={`Skill · ${skillName}`}
      titleClassName={isError ? 'text-red-600' : undefined}
      previewLines={displayMode === 'compact' ? 0 : 2}
    >
      <ToolDetailShell>
        <KeyValueList items={[
          { label: 'Skill', value: skillName },
          ...(argsText ? [{ label: '参数', value: argsText }] : []),
        ]} />
        {toolOutput && (
          <OutputBox label="输出" content={toolOutput} maxHeight="max-h-96" />
        )}
      </ToolDetailShell>
    </CollapsibleBlock>
  );
}
```

> 字段名 `skill` / `args` 按 Skill 工具真实 input schema 调整。从前面调查看 `ToolBlock.tsx` 的标题摘要已经识别 Skill —— 翻一下确认。

**Step 4: ToolBlock 路由分发到 SkillRenderer**

打开 `components/ToolBlock.tsx`。找到 ReadRenderer/GlobRenderer/GrepRenderer 的路由分发点（应该在主组件 render 函数早期）。

如果该路由是按 toolName 写 if/else，加一段：

```tsx
if (toolName === 'Skill') {
  return (
    <SkillRenderer
      toolInput={toolInput}
      toolOutput={typeof toolOutput === 'string' ? toolOutput : undefined}
      isError={isError}
      displayMode={displayMode}
    />
  );
}
```

顶部 import：

```ts
import { SkillRenderer } from './agent-chat/tool-renderers/SkillRenderer';
```

> 如果 ToolBlock 没有 displayMode prop，从 settings store 内部读：参考 ReadRenderer 等是怎么拿到的，照抄。

**Step 5: 验证 Skill 渲染**

```bash
bun run dev
```

1. 让 AI 调用一个 Skill（例如 `/skill-creator` 或别的会话内可见的 skill）
2. 工具块显示为"⚡ Skill · <name>"（lucide Zap 图标 + 琥珀色），不是默认 emoji ⚡
3. 展开后是 ToolDetailShell 风格的 KeyValueList + OutputBox，不是原始 JSON
4. compact 模式不显示预览，detailed 显示 2 行

**Step 6: Commit**

```bash
rtk git add components/agent-chat/SubAgentBlock.tsx \
            components/agent-chat/tool-renderers/SkillRenderer.tsx \
            components/ToolBlock.tsx
rtk git commit -m "style(chat): SubAgent compact 模式不泄露行 + Skill 专属 renderer"
```

---

## Task 7: 文档同步与 lint 检查

**Files:**
- Run: `bun run lint`
- Maybe modify: `.claude/rules/codebase-map.md`（如有新增文件需登记）

**Step 1: lint**

```bash
rtk lint
```

修复所有报错。如果有 unused import / 未使用变量，先看是不是计划里漏写了，再删。

**Step 2: codebase-map.md 增补**

打开 `.claude/rules/codebase-map.md`，在"业务组件（components/）"→ `agent-chat/` → `tool-renderers/` 下加：
- `SkillRenderer.tsx` — Skill 工具：⚡ 琥珀色图标 + Skill 名 + 参数 + 输出

在 `agent-chat/` 下加：
- `task-aggregator.ts` — Task* CRUD 聚合纯函数（aggregateTasks / injectTaskSummary）
- `hooks/useTaskListAggregator.ts` — 流式 task_summary 维护 hook

在"服务（electron/main/services/）"下，如果加了 `appendPermissionAllowRules`，更新 settings-service 描述行。

**Step 3: Commit**

```bash
rtk git add .claude/rules/codebase-map.md
rtk git commit -m "docs: 同步 codebase-map（新增 Task 聚合与 Skill renderer）"
```

---

## 最终验证清单

把全部 6 个任务做完后，依次过这张单子：

- [ ] Task 1：设置页改无关字段 → 保存并重启 → 立即发消息能正常收到 AI 回复
- [ ] Task 2：模型下拉切换 → 消息流立即出现"切换模型至 …"居中指示；关闭对话再打开，历史中仍可见
- [ ] Task 3a：触发 Bash 权限 → 点"始终允许" → 重启应用 → 同样请求**不再弹**权限卡片
- [ ] Task 3b：设置页"工具与权限"标签底部存在"细粒度允许规则"区域，含刚才的规则
- [ ] Task 3c：在设置页删除该规则，保存 → 同样请求重新弹权限卡片
- [ ] Task 4：权限模式选"仅规划" → AI 自动 ExitPlanMode → 下拉框 UI 自动切回
- [ ] Task 5a：让 AI 走 TaskCreate/TaskUpdate 流 → 消息流胶囊 + 末尾唯一汇总块
- [ ] Task 5b：继续追加 Task → 汇总块**移动**到新消息末尾，旧位置无遗留
- [ ] Task 5c：重新打开对话 → 历史回放下汇总块仍在最新位置
- [ ] Task 6a：compact 模式下 SubAgent 块无 2 行预览
- [ ] Task 6b：Skill 调用显示 lucide Zap 琥珀色图标 + KeyValueList 风格展开
- [ ] `bun run lint` 全绿
- [ ] `bun run build:electron` 通过

---

## 顺带清理（可选，不在本计划范围）

- 若 Task 2 后 `client.setSessionModel` 完全无人调用，下个 PR 删除：
  - `electron/main/tipc/agent.ts:423` setSessionModel procedure
  - `QueryBasedSession.setModel` 方法（如不再被任何路径调用）
  - 前端 `client.setSessionModel` 类型
- 若 Task 5 后 `TodoWrite` 在 SDK 0.3.146 真的彻底消失，`ContentBlockItem.tsx:116-118` 和 `ToolBlock.tsx:49` 的 TodoWrite 分支可清理
