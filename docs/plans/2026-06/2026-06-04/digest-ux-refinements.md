# 会话提炼 UX 完善：方案下拉修复 + 提示词编辑 + 独立 Tab + 停止按钮

> **For Claude:** REQUIRED SUB-SKILL: 用 superpowers:executing-plans 按任务逐条实施本计划。
> 前置：`./milestone-2-phaseA-digest-observability-model.md`（提炼可观测性 + 独立模型方案，已落地）。本计划是其上的 4 个体验修正。

**Goal:** ①修好「提炼方案」下拉为空的 bug；②让提炼提示词在设置里可见可编辑；③把「会话摘要」从记忆 Tab 子标签提升为设置页顶级 Tab；④给后台提炼加真正能中断的停止按钮。

**Architecture:**
- A 是一行 bug 修复：`DigestsPanel` 取 profiles 写成了 `s.profiles`，而 `getSettings()` 返回 `{ settings }`，应为 `s.settings.profiles`。
- B 暴露 `digest-prompt.md`：新增读写 IPC，UI 加折叠编辑区。
- C 结构调整：`page.tsx` 加顶级 Tab，`MemoryTab` 删子标签，`DigestsPanel` 改为自取 workspace-store（去 props）。
- D 真中断：SDK `query` 支持 `options.abortController`（sdk.d.ts:1205）。worker 维护 per-task AbortController，cancel 时 abort；`digest-trigger.current` 暴露 taskId，新增 `cancelDigest` IPC。

**Tech Stack:** TypeScript + Electron 主进程 + `@anthropic-ai/claude-agent-sdk` + `@egoist/tipc` + React 19 + Zustand + bun:test。

---

## 通用约定（实施者必读）

- 中文注释/commit；不写大段注释；开发阶段不做兼容代码。
- 主进程改动 `rtk bun run build:electron`；前端/整体 `rtk bun run build`；检查 `rtk bun run lint`；测试 `rtk bun test`（bun:test，不是 vitest）。命令统一加 `rtk` 前缀。
- digest 系列 IPC 走 tipc 自动类型推导，`types/electron-api.ts` 无需手动改。
- 渲染层用 `import()` 不用 `require()`；图标 lucide-react；类名 `cn()`；UI 状态用组件内 state。
- 关键路径事实：
  - `client.getSettings()` 返回 `{ settings: AppSettings }`（见 `stores/settings-store.ts:20`）。
  - `getConfigDir()` 在 `electron/main/services/settings-service.ts:26` 是私有函数，需 export 后复用。
  - `loadDigestPrompt(configDir)` / `DEFAULT_DIGEST_PROMPT` 在 `electron/main/services/memory/digest-prompt.ts`。
  - worker 取消入口：`agent-worker.ts:726 cancelTask(taskId)`（现仅标记 CANCELLED，不中断 query）；manager 侧 `agent-manager.ts:170 cancelTask`（队列即时移除 / 通知 worker）。
  - SDK `query` options 支持 `abortController?: AbortController`（`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1205`）。
- 每个 Task 末尾 commit 一次；commit 前先 build（有测试先 test）。commit message 末尾加：
  `Co-Authored-By: Claude Opus 4 (1M context) <noreply@anthropic.com>`

---

## Task 1：修复「提炼方案」下拉为空（bug）

**Files:**
- Modify: `app/settings/memory/DigestsPanel.tsx`

**Step 1**：找到现有这段（约 :88-91）：
```ts
    client.getSettings().then((s) => {
      const list = Object.values(s.profiles ?? {}).map((p) => ({ id: p.id, name: p.name }));
      setProfiles(list);
    });
```
`getSettings()` 返回的是 `{ settings }`，`s.profiles` 永远 undefined。改为从 `s.settings.profiles` 取：
```ts
    client.getSettings().then((s) => {
      const profilesMap = ('settings' in s && s.settings?.profiles) ? s.settings.profiles : {};
      const list = Object.values(profilesMap).map((p) => ({ id: p.id, name: p.name }));
      setProfiles(list);
    });
```

**Step 2**：`rtk bun run build` 通过、`rtk bun run lint` 0 error。

**Step 3**：commit `fix(memory): 修复提炼方案下拉读取 settings.profiles 路径错误`

---

## Task 2：提炼提示词读写 IPC

**Files:**
- Modify: `electron/main/services/memory/digest-prompt.ts`（新增 `saveDigestPrompt`）
- Modify: `electron/main/services/settings-service.ts`（export `getConfigDir`）
- Modify: `electron/main/tipc/digest.ts`（新增 2 个 procedure）

**Step 1**：`digest-prompt.ts` 末尾新增：
```ts
/** 覆盖写入提示词模板 */
export async function saveDigestPrompt(configDir: string, content: string): Promise<void> {
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(getDigestPromptPath(configDir), content, 'utf-8');
}
```

**Step 2**：`settings-service.ts` 把 `function getConfigDir()`（:26）改为 `export function getConfigDir()`。

**Step 3**：`digest.ts` 顶部补 import：
```ts
import { loadDigestPrompt, saveDigestPrompt, DEFAULT_DIGEST_PROMPT } from '../services/memory/digest-prompt.js';
import { loadSettings, saveSettings, getConfigDir } from '../services/settings-service.js';
```
（`loadSettings, saveSettings` 那行已存在，合并 `getConfigDir`。）

**Step 4**：在 `digestRouter` 末尾追加：
```ts
  /** 读取提炼提示词模板（缺失返回内置默认并播种） */
  getDigestPrompt: t.procedure
    .action(async () => {
      try {
        const prompt = await loadDigestPrompt(getConfigDir());
        return { prompt, defaultPrompt: DEFAULT_DIGEST_PROMPT };
      } catch (error) {
        console.error('[digest] getDigestPrompt 失败:', error);
        return { error: String(error) };
      }
    }),

  /** 保存提炼提示词模板 */
  setDigestPrompt: t.procedure
    .input<{ prompt: string }>()
    .action(async ({ input }) => {
      try {
        await saveDigestPrompt(getConfigDir(), input.prompt);
        return { success: true };
      } catch (error) {
        console.error('[digest] setDigestPrompt 失败:', error);
        return { error: String(error) };
      }
    }),
```

**Step 5**：`rtk bun run build:electron` 通过。

**Step 6**：commit `feat(memory): 提炼提示词读写 IPC`

---

## Task 3：digest 取消链路（worker 真中断 + trigger 暴露 taskId + IPC）

**Files:**
- Modify: `electron/main/agents/agent-worker.ts`（AbortController 接线）
- Modify: `electron/main/services/memory/digest-trigger.ts`（current 加 taskId）
- Modify: `electron/main/tipc/digest.ts`（cancelDigest）

**Step 1：worker 维护 per-task AbortController。** 在 `AgentWorker` 类加字段（与 `currentTask` 相邻）：
```ts
  private currentAbortController: AbortController | null = null;
```

**Step 2**：`handleDigestSessionTask` 里，在 `const agentQuery = query({` 之前建 controller，并把它传入 options。找到现有 query 调用（约 :585-604），改成：
```ts
    const abortController = new AbortController();
    this.currentAbortController = abortController;
    try {
      const agentQuery = query({
        prompt,
        options: {
          permissionMode: 'dontAsk',
          env,
          abortController,
          // ...其余 options 原样保留（effort 透传、pathToClaudeCodeExecutable、mcpServers、allowedTools）
```
并在该方法的 `finally`（若无则在 try/catch 末尾）清理：`this.currentAbortController = null;`。若方法当前是 try/catch 无 finally，给它补一个 `finally { this.currentAbortController = null; }`。

**Step 3**：catch 里区分「被中断」与真错误。在现有 catch 内最前面加：
```ts
      if (abortController.signal.aborted) {
        taskLogger.info('会话提炼被取消:', sdkSessionId);
        return { sdkSessionId, saved: false, cancelled: true };
      }
```

**Step 4：worker.cancelTask 触发 abort。** 把 `cancelTask`（:726-732）改为：
```ts
  cancelTask(taskId: string) {
    if (this.currentTask && this.currentTask.id === taskId) {
      this.logger.info('取消任务:', taskId);
      this.currentAbortController?.abort();
      this.sendTaskUpdate(taskId, TaskStatus.CANCELLED);
      this.currentTask = null;
    }
  }
```

**Step 5：digest-trigger.current 暴露 taskId。** 在 `digest-trigger.ts`：
- `DigestActivity['current']` 类型加 `taskId: string`：
```ts
  current: { workspaceId: string; sessionId: string; startedAt: number; taskId: string } | null;
```
- `runOne` 里 task.id 在 `const task: AgentTask = {...}` 之后才有；把 `current = {...}` 移到 task 定义之后，并带上 taskId：
```ts
    const task: AgentTask = { /* 原样 */ };
    current = { workspaceId: d.workspaceId, sessionId: d.sdkSessionId, startedAt, taskId: task.id };
```
（注意：`startedAt` 仍在最前定义；只把 `current=` 赋值挪到 task 之后。）

**Step 6**：`digest.ts` 末尾追加：
```ts
  /** 取消提炼任务（队列中即时移除；正在跑的中断 query） */
  cancelDigest: t.procedure
    .input<{ taskId: string }>()
    .action(async ({ input }) => {
      try {
        const { getAgentManager } = await import('../agents/agent-manager.js');
        getAgentManager().cancelTask(input.taskId);
        return { success: true };
      } catch (error) {
        console.error('[digest] cancelDigest 失败:', error);
        return { error: String(error) };
      }
    }),
```

**Step 7**：`rtk bun run build:electron` 通过。`rtk bun test electron/main/services/memory/digest-trigger.test.ts` 仍 3 pass（classifyOutcome 未变）。

**Step 8**：commit `feat(memory): digest 提炼支持中断取消`

---

## Task 4：会话摘要提升为设置页顶级 Tab

**Files:**
- Modify: `app/settings/memory/DigestsPanel.tsx`（去 props，自取 workspace）
- Modify: `app/settings/MemoryTab.tsx`（删 digests 子标签）
- Modify: `app/settings/page.tsx`（加顶级 Tab）

**Step 1：DigestsPanel 自取 workspace。** 改组件签名，去掉 `Props`：
```ts
import { useWorkspaceStore } from '@/stores/workspace-store';
// ...
export function DigestsPanel() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const workspaceId = workspace?.id;
  const workspacePath = workspace?.path;
```
文件内原本用 `workspaceId` / `workspacePath` 的地方保持不变（现在来自 store）。在 return 顶部加未选工作区的兜底：
```ts
  if (!workspaceId || !workspacePath) {
    return <div className="text-sm text-muted-foreground py-8 text-center">请先选择一个工作区</div>;
  }
```
> 注意：原 `loadList` 等 useCallback/useEffect 依赖 `workspaceId`，store 值变化时会自然重跑，逻辑不变。

**Step 2：MemoryTab 删 digests 子标签。** 在 `MemoryTab.tsx`：
- 删 `import { DigestsPanel } from './memory/DigestsPanel';`
- 删 `<TabsTrigger value="digests">会话摘要</TabsTrigger>`
- 删对应的 `<TabsContent value="digests">...</TabsContent>`
- `Tabs defaultValue="core"` 保持；只剩 core / topics 两个子标签。

**Step 3：page.tsx 加顶级 Tab。**
- 顶部 import：`import { DigestsPanel } from './memory/DigestsPanel';`
- 左侧导航在「记忆管理」TabsTrigger 之后加：
```tsx
          <TabsTrigger value="digests" className="justify-start px-3 py-2 data-[state=active]:bg-background">
            会话摘要
          </TabsTrigger>
```
- 在「记忆管理」TabsContent 之后加：
```tsx
        <TabsContent value="digests" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <div className="max-w-4xl py-6 px-6">
            <h2 className="text-lg font-semibold mb-1">会话摘要</h2>
            <p className="text-sm text-muted-foreground mb-6">后台自动把每个会话提炼成摘要卡，可在此查看、重新提炼、配置提炼方案与提示词。</p>
            <DigestsPanel />
          </div>
        </TabsContent>
```

**Step 4**：`rtk bun run build` 通过、`rtk bun run lint` 0 error（确认 MemoryTab 无未使用 import 残留）。

**Step 5**：commit `feat(memory): 会话摘要提升为设置页顶级 Tab`

---

## Task 5：DigestsPanel UI — 提示词编辑区 + 停止按钮

**Files:**
- Modify: `app/settings/memory/DigestsPanel.tsx`

依赖 Task 2（prompt IPC）、Task 3（cancelDigest IPC + current.taskId）、Task 4（已自取 workspace）。

**Step 1：DigestActivity 类型补 taskId。** 本地 interface 的 current 加 `taskId: string`：
```ts
  current: { workspaceId: string; sessionId: string; startedAt: number; taskId: string } | null;
```

**Step 2：提示词编辑区 state + 加载。**
```ts
  const [prompt, setPrompt] = useState('');
  const [defaultPrompt, setDefaultPrompt] = useState('');
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptDirty, setPromptDirty] = useState(false);
```
在现有初始化 useEffect 里补：
```ts
    client.getDigestPrompt().then((r) => {
      if ('prompt' in r && r.prompt) setPrompt(r.prompt);
      if ('defaultPrompt' in r && r.defaultPrompt) setDefaultPrompt(r.defaultPrompt);
    });
```
handler：
```ts
  const handleSavePrompt = async () => {
    await client.setDigestPrompt({ prompt });
    setPromptDirty(false);
  };
  const handleResetPrompt = () => {
    setPrompt(defaultPrompt);
    setPromptDirty(true);
  };
```

**Step 3：停止按钮 handler。**
```ts
  const handleCancel = async (taskId: string) => {
    await client.cancelDigest({ taskId });
  };
```

**Step 4：渲染 — 活动区停止按钮。** 在活动区「正在提炼」那一行，`activity.current` 分支里，紧跟 session 文案后加（用 lucide 的 `Square` 或 `X` 图标，import 之）：
```tsx
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-destructive"
                  onClick={() => handleCancel(activity.current!.taskId)}
                >
                  <Square className="w-3 h-3 mr-1" />
                  停止
                </Button>
```

**Step 5：渲染 — 提示词编辑区。** 放在活动区下方、左右布局之前。用一个可折叠块（点标题展开）：
```tsx
      <div className="rounded-md border">
        <button
          className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium hover:bg-muted/50"
          onClick={() => setPromptOpen((v) => !v)}
        >
          <span>提炼提示词</span>
          <ChevronDown className={cn('w-4 h-4 transition-transform', promptOpen && 'rotate-180')} />
        </button>
        {promptOpen && (
          <div className="p-3 space-y-2 border-t">
            <textarea
              className="w-full min-h-[200px] px-3 py-2 text-sm border rounded-md bg-background font-mono resize-y"
              value={prompt}
              onChange={(e) => { setPrompt(e.target.value); setPromptDirty(true); }}
            />
            <div className="flex items-center gap-2">
              <Button size="sm" disabled={!promptDirty} onClick={handleSavePrompt}>保存提示词</Button>
              <Button size="sm" variant="outline" onClick={handleResetPrompt}>恢复默认</Button>
            </div>
          </div>
        )}
      </div>
```
import 顶部补：`import { cn } from '@/lib/utils';`，lucide 补 `Square, ChevronDown`。

**Step 6**：`rtk bun run build` 通过、`rtk bun run lint` 0 error。开发态目视：方案下拉有内容、提示词可展开编辑保存、提炼时出现停止按钮且点击能停。

**Step 7**：commit `feat(memory): 会话摘要页加提示词编辑与停止按钮`

---

## Task 6：文档同步

**Files:**
- Modify: `.claude/rules/codebase-map.md`

**Step 1**：更新相关行：
- `digest.ts` IPC 列表加 `get+setDigestPrompt 提示词读写 / cancelDigest 取消`。
- `digest-prompt.ts` 描述加 `+ saveDigestPrompt 写入`。
- `app/settings/page.tsx` 描述加「会话摘要」顶级 Tab；`MemoryTab` 描述改为只含核心档案/主题记忆；`DigestsPanel` 描述加「提示词编辑 + 停止按钮 + 自取 workspace」。
- `agent-worker.ts` digest 链路注记加「query 接 AbortController 支持中断」。

**Step 2**：commit `docs(memory): 同步会话摘要 UX 完善`

---

## 验证矩阵

| 关注点 | 验证方式 |
|--------|----------|
| 方案下拉非空 | 运行时：设置→会话摘要，方案下拉列出所有 profile |
| 提示词可编辑保存 | 运行时：展开编辑→保存→重开仍在；恢复默认有效 |
| 会话摘要独立 Tab | 运行时：设置左侧出现「会话摘要」顶级 Tab，记忆 Tab 不再有该子标签 |
| 停止真中断 | 运行时：提炼中点停止→活动区 recent 出现「已取消」，且不再继续产卡 |
| 编译 / 检查 | `rtk bun run build` / `rtk bun run lint` |
| 单测未回归 | `rtk bun test electron/main/services/memory/digest-trigger.test.ts` |
