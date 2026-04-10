# Bug 修复与体验优化 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修复 2 个严重 Bug（分叉卡死、工作区消失）+ 4 个体验优化（滚动条、Plan 按钮、输入框按钮、排队消息）

**Architecture:** 分 6 个独立 Task。Task 1 修复分叉（前后端双保险）；Task 2 新建 safe-json 工具并改造所有 JSON 服务；Task 3 删除 Plan 执行按钮；Task 4 优化输入框按钮状态；Task 5 重写滚动逻辑；Task 6 实现排队消息延迟插入。

**Tech Stack:** React 19, Zustand, Electron IPC (tipc), Node.js fs.promises, ResizeObserver

---

### Task 1: 修复分叉卡死 Bug (#8)

**Files:**
- Modify: `electron/main/services/conversation-runtime-service.ts:41-44,134-148,270-281`
- Modify: `components/agent-chat/hooks/useAgentSession.ts:41-59`

**Step 1: 后端修复 — conversation-runtime-service.ts**

`WireOptions` 类型增加 `forkSession` 字段，`wireConversationSession` 的 `session_init` handler 中用 `forkSession || clearForkFields` 判断：

```typescript
// conversation-runtime-service.ts 行 41-45
// 修改 WireOptions 类型
type WireOptions = {
  conversationId: string;
  workspaceId: string;
  clearForkFields?: boolean;
  forkSession?: boolean;  // ← 新增
};
```

```typescript
// conversation-runtime-service.ts 行 134-148
// wireConversationSession 中修改判断条件
function wireConversationSession(session: QueryBasedSession, options: WireOptions): void {
  session.on('session_init', async (data: { session_id: string }) => {
    try {
      await conversationService.updateSdkSessionId(
        options.workspaceId,
        options.conversationId,
        data.session_id,
      );
      // 修改：forkSession 也触发清除（与旧 agent.ts 逻辑一致）
      if (options.clearForkFields || options.forkSession) {
        await conversationService.clearForkFields(options.workspaceId, options.conversationId);
      }
    } catch (error) {
      console.warn('Failed to persist sdk_session_id for runtime session:', error);
    }
  });
  // ... 后续代码不变
```

```typescript
// conversation-runtime-service.ts 行 270-281
// attachConversation 中传入 forkSession
      wireConversationSession(session, {
        conversationId,
        workspaceId,
        clearForkFields: options?.clearForkFields,
        forkSession: options?.forkSession,  // ← 新增
      });
```

**Step 2: 前端修复（双保险） — useAgentSession.ts**

在 fork 分支中补上 `clearForkFields = true`：

```typescript
// useAgentSession.ts 行 54-59
        if (forkParams) {
          // Fork 模式：使用父对话的 sdk_session_id + fork 参数
          sdkSessionId = forkParams.sdkSessionIdToResume;
          forkSessionFlag = forkParams.forkSession;
          resumeSessionAtFlag = forkParams.resumeSessionAt;
          clearForkFields = true;  // ← 新增：分叉完成后清除后端分叉字段
          console.log('🔀 Fork 模式启动:', { sdkSessionId, forkSession: forkSessionFlag, resumeSessionAt: resumeSessionAtFlag });
        }
```

**Step 3: 编译验证**

Run: `cd c:/dogear && bun run build:electron`
Expected: 编译成功，无类型错误

**Step 4: Commit**

```bash
git add electron/main/services/conversation-runtime-service.ts components/agent-chat/hooks/useAgentSession.ts
git commit -m "fix: 修复分叉对话卡死 — clearForkFields 在新架构中未正确触发"
```

---

### Task 2: 安全 JSON 写入工具 + 全量改造 (#6)

**Files:**
- Create: `electron/main/services/safe-json.ts`
- Modify: `electron/main/services/workspace-json-service.ts:106-123`
- Modify: `electron/main/services/conversation-service.ts:116-136`
- Modify: `electron/main/services/settings-service.ts:170-195`
- Modify: `electron/main/services/stock/stock-watchlist-service.ts:92-107`
- Modify: `electron/main/services/stock/stock-data-service.ts:229-243`
- Modify: `electron/main/services/workspace-service.ts:132-141,170-186,219-238,268-291`
- Modify: `electron/main/services/article-service.ts:64-70,354-386`
- Modify: `electron/main/services/book-service.ts:27-32`
- Modify: `electron/main/services/conversation-tree-service.ts:64-69`
- Modify: `electron/main/services/wechat/wechat-auth-service.ts:108-111`
- Modify: `electron/main/services/wechat/wechat-message-store.ts:87-90`

**Step 1: 创建 safe-json.ts**

```typescript
// electron/main/services/safe-json.ts
import fs from 'node:fs/promises';
import path from 'node:path';

// ─── 文件级互斥锁 ───

const locks = new Map<string, Promise<void>>();

/**
 * 按文件路径加锁，确保同一文件不会被并发写入。
 * 等待前一个同路径操作完成后再执行 fn。
 */
export async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const normalizedPath = path.resolve(filePath);
  const prev = locks.get(normalizedPath) ?? Promise.resolve();
  let resolve!: () => void;
  const next = new Promise<void>((r) => { resolve = r; });
  locks.set(normalizedPath, next);

  await prev;
  try {
    return await fn();
  } finally {
    resolve();
    if (locks.get(normalizedPath) === next) {
      locks.delete(normalizedPath);
    }
  }
}

// ─── 原子写入 ───

/**
 * 安全写入 JSON 文件。
 * 1. 写入 .tmp 临时文件
 * 2. 验证临时文件内容可解析
 * 3. 备份原文件为 .bak
 * 4. 原子 rename .tmp → 目标文件
 *
 * 自带文件锁，同路径不会并发写入。
 */
export async function safeJsonWrite(filePath: string, data: unknown): Promise<void> {
  await withFileLock(filePath, async () => {
    const tmpPath = filePath + '.tmp';
    const bakPath = filePath + '.bak';
    const content = JSON.stringify(data, null, 2);

    // 确保目录存在
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    // Step 1: 写入临时文件
    await fs.writeFile(tmpPath, content, 'utf-8');

    // Step 2: 验证临时文件内容
    const verify = await fs.readFile(tmpPath, 'utf-8');
    JSON.parse(verify); // 如果解析失败会抛异常，不会覆盖原文件

    // Step 3: 备份原文件（如果存在）
    try {
      await fs.access(filePath);
      // Windows 上 rename 不能覆盖已存在的文件，先删再 rename
      try { await fs.unlink(bakPath); } catch { /* .bak 不存在，忽略 */ }
      await fs.rename(filePath, bakPath);
    } catch {
      // 原文件不存在，跳过备份
    }

    // Step 4: 原子替换
    await fs.rename(tmpPath, filePath);
  });
}

/**
 * 安全写入纯文本/Markdown/HTML 文件（非 JSON，不做 parse 验证）。
 * 原子写入 + 备份，但不验证 JSON 格式。
 */
export async function safeFileWrite(filePath: string, content: string): Promise<void> {
  await withFileLock(filePath, async () => {
    const tmpPath = filePath + '.tmp';
    const bakPath = filePath + '.bak';

    await fs.mkdir(path.dirname(filePath), { recursive: true });

    // 写入临时文件
    await fs.writeFile(tmpPath, content, 'utf-8');

    // 备份原文件（如果存在）
    try {
      await fs.access(filePath);
      try { await fs.unlink(bakPath); } catch { /* 忽略 */ }
      await fs.rename(filePath, bakPath);
    } catch {
      // 原文件不存在
    }

    // 原子替换
    await fs.rename(tmpPath, filePath);
  });
}

// ─── 安全读取 ───

/**
 * 安全读取 JSON 文件。
 * 1. 尝试读取并解析主文件
 * 2. 失败时尝试从 .bak 备份恢复
 * 3. 都失败则返回 defaultValue
 */
export async function safeJsonRead<T>(filePath: string, defaultValue: T): Promise<T> {
  // 尝试主文件
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch (mainError) {
    console.warn(`[safeJsonRead] 主文件读取失败: ${filePath}`, mainError);
  }

  // 尝试备份
  const bakPath = filePath + '.bak';
  try {
    const raw = await fs.readFile(bakPath, 'utf-8');
    const data = JSON.parse(raw) as T;
    console.warn(`[safeJsonRead] 从备份恢复成功: ${bakPath}`);
    // 修复主文件
    try {
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // 修复失败也没关系，至少数据读到了
    }
    return data;
  } catch {
    console.warn(`[safeJsonRead] 备份也无法读取: ${bakPath}`);
  }

  return defaultValue;
}
```

**Step 2: 改造 workspace-json-service.ts**

```typescript
// workspace-json-service.ts
// 顶部添加导入
import { safeJsonWrite, safeJsonRead } from './safe-json.js';

// 替换 loadWorkspacesFile（约行 106-117）
async function loadWorkspacesFile(): Promise<WorkspacesFile> {
  return safeJsonRead<WorkspacesFile>(getWorkspacesPath(), emptyFile());
}

// 替换 saveWorkspacesFile（约行 119-123）
async function saveWorkspacesFile(data: WorkspacesFile): Promise<void> {
  await safeJsonWrite(getWorkspacesPath(), data);
}
```

**Step 3: 改造 conversation-service.ts**

```typescript
// conversation-service.ts
// 顶部添加导入
import { safeJsonWrite, safeJsonRead } from './safe-json.js';

// 替换 loadWorkspaceConversations（约行 116-126）
async function loadWorkspaceConversations(workspaceId: string): Promise<WorkspaceConversationsFile> {
  const dir = getWorkspaceDataDir(workspaceId);
  await fs.mkdir(dir, { recursive: true });
  return safeJsonRead<WorkspaceConversationsFile>(
    getWorkspaceConversationsPath(workspaceId),
    { version: 1, conversations: {} },
  );
}

// 替换 saveWorkspaceConversations（约行 128-136）
async function saveWorkspaceConversations(workspaceId: string, data: WorkspaceConversationsFile): Promise<void> {
  await safeJsonWrite(getWorkspaceConversationsPath(workspaceId), data);
}
```

**Step 4: 改造 settings-service.ts**

```typescript
// settings-service.ts
// 顶部添加导入
import { safeJsonWrite, safeJsonRead } from './safe-json.js';

// 替换 loadSettings 中的读取逻辑（约行 170-188）
export async function loadSettings(): Promise<AppSettings> {
  const settingsPath = getSettingsPath();
  const raw = await safeJsonRead<AppSettings | null>(settingsPath, null);
  if (raw) return raw;
  // 首次启动，写入默认设置
  const defaults = getDefaultSettings();
  await safeJsonWrite(settingsPath, defaults);
  return defaults;
}

// 替换 saveSettings（约行 190-195）
export async function saveSettings(settings: AppSettings): Promise<void> {
  await safeJsonWrite(getSettingsPath(), settings);
}
```

**Step 5: 改造 stock-watchlist-service.ts**

```typescript
// stock-watchlist-service.ts
// 顶部添加导入
import { safeJsonWrite, safeJsonRead } from '../safe-json.js';

// 替换 load 方法中的读取
async load(): Promise<Watchlist> {
  return safeJsonRead<Watchlist>(getWatchlistPath(), { items: [] });
}

// 替换 save 方法
async save(watchlist: Watchlist): Promise<void> {
  await safeJsonWrite(getWatchlistPath(), watchlist);
}
```

**Step 6: 改造 stock-data-service.ts**

```typescript
// stock-data-service.ts
// 顶部添加导入
import { safeFileWrite } from '../safe-json.js';

// 替换 writeKLine 中的 fs.writeFile（约行 229-243）
async writeKLine(market: number, code: string, points: KLineDataPoint[]): Promise<void> {
  const filePath = getKLinePath(market, code);
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  if (points.length === 0) {
    await safeFileWrite(filePath, '');
    return;
  }

  const jsonlContent = toJsonl(points as unknown as Record<string, unknown>[]);
  await safeFileWrite(filePath, jsonlContent);
}
```

**Step 7: 改造 workspace-service.ts**

将 4 个 `fs.writeFile` 替换为 `safeJsonWrite`：

```typescript
// workspace-service.ts 顶部添加导入
import { safeJsonWrite } from './safe-json.js';

// saveBookMeta（行 140）
await safeJsonWrite(metaPath, metadata);

// saveAnalysisStatus（行 185）
await safeJsonWrite(statusPath, status);

// saveAnalysisResult（行 237）
await safeJsonWrite(analysisPath, data);

// saveChapterAnalysis（行 290）
await safeJsonWrite(chapterPath, data);
```

每处替换模式相同：`await fs.writeFile(xxxPath, JSON.stringify(xxx, null, 2), 'utf-8')` → `await safeJsonWrite(xxxPath, xxx)`。注意 `safeJsonWrite` 内部已经做了 `JSON.stringify` 和 `mkdir`。

**Step 8: 改造 article-service.ts**

```typescript
// article-service.ts 顶部添加导入
import { safeJsonWrite, safeJsonRead, safeFileWrite } from './safe-json.js';

// saveArticleOrder（行 69）
await safeJsonWrite(orderPath, data);

// loadArticleOrder — 如果有类似读取，也改为 safeJsonRead

// saveArticle 中的 3 处 writeFile（行 364-378）
await safeJsonWrite(path.join(articleDir, 'meta.json'), articleData.meta);
await safeFileWrite(path.join(articleDir, 'content.md'), articleData.content);
await safeFileWrite(path.join(articleDir, 'raw.html'), articleData.rawHtml);
```

**Step 9: 改造 book-service.ts**

```typescript
// book-service.ts 顶部添加导入
import { safeJsonWrite } from './safe-json.js';

// saveChapters（行 31）
// 原来: await fs.promises.writeFile(chaptersPath, JSON.stringify({ bookId, chapters }, null, 2), 'utf-8');
await safeJsonWrite(chaptersPath, { bookId, chapters });
```

注意 book-service.ts 使用 `fs.promises` 而非 `fs`（是 `import fs from 'node:fs'`），确认导入方式兼容。

**Step 10: 改造 conversation-tree-service.ts**

```typescript
// conversation-tree-service.ts 顶部添加导入
import { safeJsonWrite, safeJsonRead } from './safe-json.js';

// 行 68
await safeJsonWrite(getTreePath(workspaceId), data);

// 对应的读取函数也改为 safeJsonRead
```

**Step 11: 改造 wechat 相关服务（wechat-auth-service.ts, wechat-message-store.ts）**

```typescript
// wechat-auth-service.ts
import { safeJsonWrite, safeJsonRead } from '../safe-json.js';
// 行 110
await safeJsonWrite(getAuthPath(), token);

// wechat-message-store.ts
import { safeJsonWrite, safeJsonRead } from '../safe-json.js';
// 行 89
await safeJsonWrite(getContactsPath(), contacts);
```

**Step 12: 编译验证**

Run: `cd c:/dogear && bun run build:electron`
Expected: 编译成功，无类型错误

**Step 13: Commit**

```bash
git add electron/main/services/safe-json.ts electron/main/services/
git commit -m "fix: 统一安全 JSON 写入（原子写入+备份+恢复+互斥锁）防止数据丢失"
```

---

### Task 3: 删除 Plan 模式执行按钮 (#2)

**Files:**
- Modify: `components/agent-chat/AgentChat.tsx:302-339`

**Step 1: 删除执行按钮代码**

删除 `AgentChat.tsx` 行 302-339 的完整 JSX 块：

```typescript
// 删除整个块：
        {/* Plan 模式下，assistant 完成输出后显示"执行计划"按钮 */}
        {permissionMode === 'plan' && !isLoading && messages.length > 0 && messages[messages.length - 1]?.role === 'assistant' && !messages[messages.length - 1]?.isStreaming && (
          <div className="flex justify-center py-3">
            <Button
              // ... 整个按钮代码
            </Button>
          </div>
        )}
```

同时检查是否有相关的 import（`ChevronRight`）仅用于此处，若是则一并删除。

**Step 2: 检查 ChevronRight import 是否仍需要**

搜索 `AgentChat.tsx` 中 `ChevronRight` 的其他使用。如果只有此处使用，从 lucide-react import 中移除。

**Step 3: 编译验证**

Run: `cd c:/dogear && bun run build:electron`
Expected: 编译成功

**Step 4: Commit**

```bash
git add components/agent-chat/AgentChat.tsx
git commit -m "feat: 删除 Plan 模式下的'执行计划'按钮（Agent 自行理解 plan 模式）"
```

---

### Task 4: 输入框按钮状态优化 (#3)

**Files:**
- Modify: `components/agent-chat/ChatInputArea.tsx:392-419`

**Step 1: 修改按钮渲染逻辑**

将 `ChatInputArea.tsx` 行 392-419 的发送/停止按钮替换为三态逻辑：

```tsx
              {/* 发送/停止按钮（右侧） */}
              <div className="ml-auto">
                {(input.trim() || pendingImages.length > 0) ? (
                  // 有输入内容 → 始终显示发送按钮（运行中时排队发送）
                  <InputGroupButton
                    variant="default"
                    size="icon-xs"
                    onClick={handleSend}
                    disabled={!isSessionReady}
                    title={isLoading ? "排队发送 (Ctrl+Enter)" : "发送 (Ctrl+Enter)"}
                  >
                    <Send size={14} />
                  </InputGroupButton>
                ) : isLoading ? (
                  // 无内容 + 运行中 → 停止按钮
                  <InputGroupButton
                    variant="destructive"
                    size="icon-xs"
                    onClick={async () => {
                      if (sessionId) {
                        await client.interruptQueryBasedSession({ sessionId });
                        setIsLoading(false);
                      }
                    }}
                    title="停止"
                  >
                    <Square size={14} />
                  </InputGroupButton>
                ) : (
                  // 无内容 + 空闲 → 禁用发送按钮
                  <InputGroupButton
                    variant="default"
                    size="icon-xs"
                    onClick={handleSend}
                    disabled
                    title="发送 (Ctrl+Enter)"
                  >
                    <Send size={14} />
                  </InputGroupButton>
                )}
              </div>
```

**Step 2: 编译验证**

Run: `cd c:/dogear && bun run build:electron`
Expected: 编译成功

**Step 3: Commit**

```bash
git add components/agent-chat/ChatInputArea.tsx
git commit -m "feat: 输入框按钮三态优化 — 有内容时始终显示发送按钮"
```

---

### Task 5: 会话滚动条优化 (#1)

**Files:**
- Modify: `components/agent-chat/AgentChat.tsx:160-215,340-360`
- Modify: `components/agent-chat/hooks/useSessionEvents.ts:50-81,90-118`

**Step 1: 重写 AgentChat.tsx 滚动逻辑**

替换 `AgentChat.tsx` 行 160-215 的滚动控制代码：

```typescript
  // ─── 滚动控制 ───
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);
  const [newMsgCount, setNewMsgCount] = useState(0);
  const prevMessageCount = useRef(0);
  // 三态滚动：auto=跟随底部, user=用户控制, force=强制滚到指定元素
  const scrollModeRef = useRef<'auto' | 'user'>('auto');

  // 获取滚动视口元素
  const getViewportEl = useCallback(() => {
    return scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;
  }, []);

  // 滚到底部
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = getViewportEl();
    if (el) {
      el.scrollTo({ top: el.scrollHeight, behavior });
      setNewMsgCount(0);
      scrollModeRef.current = 'auto';
      isAtBottomRef.current = true;
      setIsAtBottom(true);
    }
  }, [getViewportEl]);

  // 强制滚到指定元素（权限/AskUser 请求时使用）
  const scrollToElement = useCallback((element: HTMLElement) => {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // 滚到指定位置后恢复 auto 模式（下次内容增长继续跟随）
    setTimeout(() => {
      scrollModeRef.current = 'auto';
    }, 500);
  }, []);

  // 用户滚动检测
  const handleScroll = useCallback(() => {
    const el = getViewportEl();
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    isAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);

    if (atBottom) {
      setNewMsgCount(0);
      scrollModeRef.current = 'auto';
    } else {
      // 用户主动上滚 → 切换到 user 模式
      scrollModeRef.current = 'user';
    }
  }, [getViewportEl]);

  // 使用 ResizeObserver 监听消息容器高度变化，驱动自动滚动
  useEffect(() => {
    const el = getViewportEl();
    if (!el) return;

    // 监听内容区域（而非视口本身）的大小变化
    const contentEl = el.firstElementChild as HTMLElement | null;
    if (!contentEl) return;

    const observer = new ResizeObserver(() => {
      if (scrollModeRef.current === 'auto') {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      } else if (messages.length > 0) {
        setNewMsgCount(prev => prev + 1);
      }
    });

    observer.observe(contentEl);
    return () => observer.disconnect();
  }, [getViewportEl, sessionId]); // sessionId 变化时重新绑定

  // 历史加载完成后（从无消息到有消息）自动滚到底部（无动画）
  useEffect(() => {
    if (prevMessageCount.current === 0 && messages.length > 0) {
      requestAnimationFrame(() => {
        scrollToBottom('instant');
      });
    }
    prevMessageCount.current = messages.length;
  }, [messages.length, scrollToBottom]);
```

**Step 2: 给权限/AskUser 添加 scrollToElement 回调**

修改 `useSessionEvents.ts`，新增 `onScrollToAction` 回调参数：

```typescript
// useSessionEvents.ts — 修改接口
interface UseSessionEventsParams {
  sessionId: string | null;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setPermissionMode: Dispatch<SetStateAction<PermissionMode>>;
  onScrollToAction?: () => void;  // ← 新增：权限/AskUser 到达时通知滚动
}
```

在权限请求和 AskUser 事件 handler 末尾调用：

```typescript
    // 2. 监听权限请求
    const unsubPermReq = rendererEvents.permissionRequest.listen((data) => {
      if (data.sessionId !== sessionId) return;
      // ... 现有 setMessages 逻辑不变 ...

      // 通知滚动到最新的操作请求
      onScrollToAction?.();
    });

    // 4. 监听 AskUser 问题
    const unsubAskUser = rendererEvents.askUserQuestion.listen((data) => {
      if (data.sessionId !== sessionId) return;
      // ... 现有 setMessages 逻辑不变 ...

      // 通知滚动到最新的操作请求
      onScrollToAction?.();
    });
```

**Step 3: AgentChat.tsx 连接回调**

在 `AgentChat.tsx` 中传入 `onScrollToAction` 到 `useSessionEvents`：

```typescript
  useSessionEvents({
    sessionId,
    setMessages,
    setIsLoading,
    setPermissionMode,
    onScrollToAction: () => {
      // 权限/AskUser 到达时，强制滚到底部（它们附加在最后一条消息上）
      setTimeout(() => scrollToBottom('smooth'), 100);
    },
  });
```

**Step 4: 编译验证**

Run: `cd c:/dogear && bun run build:electron`
Expected: 编译成功

**Step 5: Commit**

```bash
git add components/agent-chat/AgentChat.tsx components/agent-chat/hooks/useSessionEvents.ts
git commit -m "feat: 会话滚动条优化 — ResizeObserver 驱动 + 权限请求自动滚动"
```

---

### Task 6: 排队消息延迟插入 (#4)

**Files:**
- Modify: `components/agent-chat/hooks/useSendMessage.ts:394-420`
- Modify: `components/agent-chat/hooks/useSessionMessages.ts:47-51`
- Modify: `components/agent-chat/ChatInputArea.tsx`

**Step 1: useSendMessage.ts — 引入消息缓冲区**

在 `useSendMessage` hook 中添加缓冲区 ref，修改排队消息的处理方式：

```typescript
// useSendMessage.ts 顶部（hook 函数体内）添加：
  const queuedMessagesRef = useRef<Array<{
    content: string;
    textBlocks?: Array<{ text: string }>;
    images?: Array<{ base64: string; mediaType: string }>;
    displayMessage: Message;
  }>>([]);
```

修改行 394-420，排队时不插入 messages，存入缓冲区：

```typescript
    // 添加用户消息
    if (isLoading) {
      // Agent 运行中 → 消息存入缓冲区，不插入 messages 列表
      queuedMessagesRef.current.push({
        content: messageToSend,
        ...(textBlocks.length > 1 && { textBlocks }),
        ...(imagesToSend.length > 0 && {
          images: imagesToSend.map(img => ({ base64: img.base64, mediaType: img.mediaType })),
        }),
        displayMessage: newUserMessage,
      });
    } else {
      // Agent 空闲 → 正常插入消息列表
      setMessages(prev => [...prev, newUserMessage, {
        role: 'assistant' as const,
        content: '' as string,
        timestamp: Date.now(),
        isStreaming: true,
        contentBlocks: [] as ContentBlock[],
      }]);
      setIsLoading(true);
    }
```

修改发送逻辑：只有非排队时才调用 `client.sendQueryBasedSessionMessage`：

```typescript
    // 排队消息不立即发送
    if (isLoading) {
      // 已存入缓冲区，等待上一轮完成后自动发送
      return;
    }

    try {
      await client.sendQueryBasedSessionMessage({
        sessionId: sessionId!,
        content: messageToSend,
        ...(textBlocks.length > 1 && { textBlocks }),
        ...(imagesToSend.length > 0 && {
          images: imagesToSend.map(img => ({ base64: img.base64, mediaType: img.mediaType })),
        }),
      });
    } catch (error) {
      // ... 错误处理不变
    }
```

导出 `queuedMessagesRef` 供 `useSessionMessages` 使用（通过返回值）：

```typescript
  return {
    // ... 现有返回值
    queuedMessagesRef,
    queuedCount: queuedMessagesRef.current.length,  // 暴露排队数量
  };
```

**Step 2: useSessionMessages.ts — result 事件时刷新缓冲区**

修改接口，接收 `queuedMessagesRef`：

```typescript
interface UseSessionMessagesParams {
  sessionId: string | null;
  showReplayMessages: boolean;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setHistoryLoaded: Dispatch<SetStateAction<boolean>>;
  queuedMessagesRef: React.MutableRefObject<Array<{
    content: string;
    textBlocks?: Array<{ text: string }>;
    images?: Array<{ base64: string; mediaType: string }>;
    displayMessage: Message;
  }>>;
}
```

在 `type === 'result'` 分支中刷新缓冲区：

```typescript
      // 收到结果消息时结束加载状态
      if (extendedMsg.type === 'result') {
        // 检查是否有排队消息需要发送
        const queued = queuedMessagesRef.current;
        if (queued.length > 0) {
          const next = queued.shift()!;
          // 插入排队消息 + 新的 assistant 占位
          setMessages(prev => [...prev, next.displayMessage, {
            role: 'assistant' as const,
            content: '' as string,
            timestamp: Date.now(),
            isStreaming: true,
            contentBlocks: [],
          }]);
          // 发送到后端
          import('@/lib/client').then(({ client }) => {
            client.sendQueryBasedSessionMessage({
              sessionId: data.sessionId,
              content: next.content,
              ...(next.textBlocks && { textBlocks: next.textBlocks }),
              ...(next.images && { images: next.images }),
            }).catch(err => {
              console.error('发送排队消息失败:', err);
              setIsLoading(false);
            });
          });
          // 不设置 setIsLoading(false)，因为新消息立即开始处理
        } else {
          setIsLoading(false);
        }
        setHistoryLoaded(true);
      }
```

**Step 3: ChatInputArea.tsx — 显示排队数量提示**

在发送按钮区域，当有排队消息时显示计数：

```tsx
// ChatInputArea.tsx props 中添加
  queuedCount?: number;

// 在发送按钮旁边添加排队提示
{queuedCount && queuedCount > 0 && (
  <span className="text-xs text-muted-foreground mr-1">
    {queuedCount} 条排队
  </span>
)}
```

**Step 4: AgentChat.tsx — 连接 queuedMessagesRef**

在 `AgentChat.tsx` 中将 `useSendMessage` 的 `queuedMessagesRef` 传给 `useSessionMessages`：

```typescript
  const sendMessage = useSendMessage({ /* ... */ });

  useSessionMessages({
    sessionId,
    showReplayMessages,
    setMessages,
    setIsLoading,
    setHistoryLoaded,
    queuedMessagesRef: sendMessage.queuedMessagesRef,
  });
```

**Step 5: 编译验证**

Run: `cd c:/dogear && bun run build:electron`
Expected: 编译成功

**Step 6: Commit**

```bash
git add components/agent-chat/hooks/useSendMessage.ts components/agent-chat/hooks/useSessionMessages.ts components/agent-chat/ChatInputArea.tsx components/agent-chat/AgentChat.tsx
git commit -m "feat: 排队消息延迟插入 — 缓冲区机制保证消息顺序"
```
