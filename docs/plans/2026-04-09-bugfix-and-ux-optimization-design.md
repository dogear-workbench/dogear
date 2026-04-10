# Bug 修复与体验优化设计文档

> 2026-04-09 | 涉及 #6 工作区消失、#8 分叉卡死、#1 滚动条、#2 Plan 按钮、#3 输入框按钮、#4 排队消息

---

## 一、严重 Bug 修复

### Bug #8: 对话分叉永远卡死

#### 根因

在引入微信 Bot 时，对话会话管理从 `agent.ts` 的 `createQueryBasedSession`（内联处理 fork 清理）迁移到了新的 `conversation-runtime-service.ts` + `conversation-runtime.ts` 架构。

**旧架构**（`agent.ts` 行 501-502）：
```typescript
// session_init 事件中，直接用 input.forkSession 判断
if (input.forkSession && input.workspaceId) {
  await conversationService.clearForkFields(input.workspaceId, input.conversationId);
}
```

**新架构**（`conversation-runtime-service.ts` 行 142-144）：
```typescript
// 改为显式参数，需要前端传入 clearForkFields=true
if (options.clearForkFields) {
  await conversationService.clearForkFields(options.workspaceId, options.conversationId);
}
```

但前端 `useAgentSession.ts` 虽然声明了 `clearForkFields` 变量，**在 fork 分支中从未赋值**（始终为 `undefined`）。

**故障链**：
1. 用户点击分叉 → `createFork()` 创建对话，`forkPending=true`
2. 用户发送消息 → `useSendMessage` 设置 `forkParams`，前端清除 `fork_pending`
3. `useAgentSession` 重新运行，进入 fork 分支，`clearForkFields` 仍为 `undefined`
4. `attachConversationRuntime(clearForkFields=undefined)` → 后端条件判断失败
5. `conversations.json` 中 `forkPending/parentConversationId/forkMessageSdkUuid` **永不清除**
6. 重新打开该对话 → 后端返回 `fork_pending=true` → 覆盖前端状态
7. 每次发消息重复步骤 2-6，永远循环

#### 修复（双保险）

**方案 1 — 后端修复**（主要）：`conversation-runtime-service.ts`

恢复旧架构的判断逻辑，用 `forkSession` 代替 `clearForkFields` 作为触发条件：

```typescript
// wireConversationSession 中
// 分叉会话初始化时，自动清除分叉字段（与旧 agent.ts 逻辑一致）
if (options.clearForkFields || options.forkSession) {
  await conversationService.clearForkFields(options.workspaceId, options.conversationId);
}
```

同时 `WireOptions` 类型增加 `forkSession` 字段，在 `attachConversation` 中传入：
```typescript
wireConversationSession(session, {
  conversationId,
  workspaceId,
  clearForkFields: options?.clearForkFields,
  forkSession: options?.forkSession,  // ✅ 新增
});
```

**方案 2 — 前端修复**（双保险）：`useAgentSession.ts`

```typescript
if (forkParams) {
  sdkSessionId = forkParams.sdkSessionIdToResume;
  forkSessionFlag = forkParams.forkSession;
  resumeSessionAtFlag = forkParams.resumeSessionAt;
  clearForkFields = true;  // ✅ 补上遗漏的赋值
}
```

**把握度**: 99%。根因 100% 确认（git history 证实），双保险修复。

---

### Bug #6: 工作区路径偶发消失

#### 根因

所有 JSON 服务（21 处写入）均存在以下缺陷：
1. `fs.writeFile()` 直接覆盖，非原子操作 → 应用崩溃时文件被截断/清空
2. 无并发写入锁 → 多个 IPC 同时执行时互相覆盖
3. 文件损坏时 `catch` 分支返回空结构，静默丢失数据

#### 修复方案：统一安全 JSON 写入工具

**新增文件**: `electron/main/services/safe-json.ts`

提供 `safeJsonWrite` 和 `safeJsonRead` 两个核心函数，所有 JSON 服务统一使用。

##### safeJsonWrite — 原子写入 + 自动备份

```typescript
/**
 * 安全写入 JSON 文件
 * 1. 写入 .tmp 临时文件
 * 2. 成功后将原文件 rename 为 .bak（备份）
 * 3. 将 .tmp rename 为目标文件（原子操作）
 */
export async function safeJsonWrite(filePath: string, data: unknown): Promise<void> {
  const tmpPath = filePath + '.tmp';
  const bakPath = filePath + '.bak';
  const content = JSON.stringify(data, null, 2);

  // 先确保目录存在
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  // Step 1: 写入临时文件
  await fs.writeFile(tmpPath, content, 'utf-8');

  // Step 2: 验证临时文件可读且有效
  const verify = await fs.readFile(tmpPath, 'utf-8');
  JSON.parse(verify); // 如果解析失败会抛异常

  // Step 3: 备份原文件（如果存在）
  try {
    await fs.access(filePath);
    await fs.rename(filePath, bakPath);
  } catch {
    // 原文件不存在，跳过备份
  }

  // Step 4: 原子替换
  await fs.rename(tmpPath, filePath);
}
```

##### safeJsonRead — 损坏自动恢复

```typescript
/**
 * 安全读取 JSON 文件
 * 1. 尝试读取并解析主文件
 * 2. 失败时尝试读取 .bak 备份
 * 3. 备份也失败时返回 defaultValue
 * 4. 从备份恢复时自动修复主文件
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
    console.warn(`[safeJsonRead] 从备份恢复: ${bakPath}`);
    // 修复主文件
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    return data;
  } catch {
    console.warn(`[safeJsonRead] 备份也无法读取: ${bakPath}`);
  }

  return defaultValue;
}
```

##### fileLock — 简单写入锁

```typescript
const locks = new Map<string, Promise<void>>();

/**
 * 按文件路径加锁，确保同一文件不会被并发写入
 */
export async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(filePath) ?? Promise.resolve();
  let resolve: () => void;
  const next = new Promise<void>((r) => { resolve = r; });
  locks.set(filePath, next);

  await prev;
  try {
    return await fn();
  } finally {
    resolve!();
    if (locks.get(filePath) === next) {
      locks.delete(filePath);
    }
  }
}
```

##### 改造范围

需要改造的文件和函数：

| 文件 | 写入函数 | 文件路径 |
|------|--------|---------|
| `workspace-json-service.ts` | `saveWorkspacesFile()` | `.dogear/workspaces/workspaces.json` |
| `conversation-service.ts` | `saveWorkspaceConversations()` | `.dogear/workspaces/{id}/conversations.json` |
| `settings-service.ts` | `saveSettings()` | `.dogear/settings.json` |
| `stock-watchlist-service.ts` | `save()` | `.dogear/stocks/watchlist.json` |
| `stock-data-service.ts` | `writeKLine()` / `appendDailySnapshot()` | `.dogear/stocks/kline/*.jsonl` / `daily/*.jsonl` |
| `workspace-service.ts` | 多处 writeFile | 书籍元数据/分析结果 |
| `claude-config-service.ts` | 多处 writeFile | Claude 配置 |
| `article-service.ts` | 多处 writeFile | 文章内容 |

**注意**: JSONL 文件（stock-data-service 的 kline/daily）使用 `appendFile` 追加模式的，风险较低，但完整覆写时仍需原子操作。

##### 启动健康检查

在应用启动时（`electron/main/index.ts`）添加：

```typescript
async function startupHealthCheck() {
  // 1. 检查 workspaces.json 是否可读
  const workspaces = await workspaceJsonService.getAll();

  // 2. 验证每个工作区路径是否存在
  for (const ws of workspaces) {
    try {
      await fs.access(ws.path);
    } catch {
      console.warn(`[健康检查] 工作区路径不存在: ${ws.path} (${ws.name})`);
      // 标记为需要用户重新选择，而非删除
    }
  }
}
```

**把握度**: 95%。原子写入 + 备份恢复是业界标准方案，能覆盖绝大多数文件损坏场景。并发锁进一步防止竞态。

---

## 二、体验优化

### #1: 会话滚动条优化

#### 现状问题

1. 自动滚动仅监听 `messages` 数组变化，流式输出更新内容块时不触发（messages 引用没变）
2. 权限请求/AskUser 是修改现有 assistant 消息的 contentBlocks，不触发滚动
3. 用户手动上滚后，即使 Agent 在底部生成了权限请求，用户也看不到

#### 设计

引入三态滚动模型：

```
┌─────────────┐     用户上滚      ┌──────────────┐
│  auto（跟随）│ ──────────────→  │ user（用户控制）│
│  自动滚到底部 │  ←──────────────  │  保持用户位置   │
└─────────────┘   用户滚到底部     └──────────────┘
       ↑                                  │
       │         权限/AskUser 事件         │
       │         ┌──────────────┐         │
       └─────────│ force（强制） │←────────┘
                 │ 滚到指定元素   │
                 └──────────────┘
                       │
                    完成滚动
                       │
                       ↓
                  恢复 auto 模式
```

**实现要点**：

1. **流式输出跟随**：不再依赖 `messages` 数组变化。使用 `ResizeObserver` 监听消息容器高度变化，`auto` 模式下每帧 `scrollTo(bottom)`
2. **用户上滚检测**：`handleScroll` 中判断距底部 > 50px → 切换 `user` 模式
3. **回到底部恢复**：距底部 < 50px → 切换 `auto` 模式
4. **权限/AskUser 强制滚动**：`useSessionEvents` 中发出事件 → 给权限请求元素添加 `data-scroll-target` 属性 → `scrollIntoView({ behavior: 'smooth', block: 'center' })`

**修改文件**：
- `AgentChat.tsx` — 替换滚动逻辑
- `useSessionEvents.ts` — 权限/AskUser 事件增加滚动回调
- `ContentBlockItem.tsx` — 权限/AskUser 块添加 ref/data 属性

**把握度**: 95%。ResizeObserver 是可靠的 API，三态模型覆盖了所有场景。

---

### #2: 删除 Plan 模式执行按钮

#### 设计

直接删除 `AgentChat.tsx` 中以下代码块（约 30 行）：

```typescript
{/* Plan 模式执行按钮 */}
{permissionMode === 'plan' && !isLoading && messages.length > 0 && ...}
```

包括：
- 按钮渲染 JSX
- `insertModeChangeNotice` 中 plan → acceptEdits 的切换逻辑（如果只用于此按钮）
- 相关的权限模式切换调用

**注意**：保留 Plan 权限模式本身（下拉菜单中仍可选），只删除自动弹出的"执行计划"按钮。

**把握度**: 99%。纯删除操作，无副作用。

---

### #3: 输入框按钮状态优化

#### 现状

```
isLoading=true  → 停止按钮（无论是否有输入内容）
isLoading=false → 发送按钮
```

#### 新逻辑

```
有输入内容 → 发送按钮（isLoading 时点击为排队发送）
无输入内容 + isLoading  → 停止按钮
无输入内容 + !isLoading → 发送按钮（disabled）
```

**修改文件**: `ChatInputArea.tsx`

```typescript
const hasInput = input.trim() || pendingImages.length > 0;

{hasInput ? (
  // 有内容 → 始终显示发送按钮
  <SendButton onClick={handleSend} disabled={!isSessionReady} />
) : isLoading ? (
  // 无内容 + 运行中 → 停止按钮
  <StopButton onClick={handleStop} />
) : (
  // 无内容 + 空闲 → 禁用发送按钮
  <SendButton disabled />
)}
```

**把握度**: 98%。逻辑清晰，改动小。

---

### #4: 排队消息延迟插入

#### 现状

排队消息（`isQueued: true`）立即插入 `messages` 数组，但 Agent 还在处理上一轮，导致：
- 用户消息出现在 assistant 输出中间
- 视觉上顺序混乱

#### 设计

**方案**：引入消息缓冲区

```typescript
// useSendMessage 中
const queuedMessagesRef = useRef<Message[]>([]);

// 发送排队消息时，不插入 messages，存入缓冲区
if (isLoading) {
  queuedMessagesRef.current.push(newUserMessage);
  return;
}

// useSessionMessages 中，收到 result 事件（Agent 完成）时：
if (extendedMsg.type === 'result') {
  setIsLoading(false);
  
  // 刷新缓冲区中的排队消息
  const queued = queuedMessagesRef.current;
  if (queued.length > 0) {
    queuedMessagesRef.current = [];
    // 将第一条排队消息正式发送
    const firstQueued = queued[0];
    setMessages(prev => [...prev, firstQueued, {
      role: 'assistant', content: '', isStreaming: true, contentBlocks: []
    }]);
    setIsLoading(true);
    client.sendQueryBasedSessionMessage({ sessionId, content: firstQueued.content });
    // 剩余消息保持排队
    queuedMessagesRef.current = queued.slice(1);
  }
}
```

**注意**：需要在 `ChatInputArea` 中显示排队数量提示，让用户知道消息已排队。

**修改文件**：
- `useSendMessage.ts` — 缓冲区逻辑
- `useSessionMessages.ts` — result 事件时刷新缓冲区
- `ChatInputArea.tsx` — 显示排队状态提示

**把握度**: 95%。需要注意缓冲区在会话切换/关闭时的清理。

---

## 三、实施优先级

| 阶段 | 任务 | 影响 | 复杂度 |
|------|------|------|--------|
| **P0** | Bug #8 分叉修复 | 一行代码 | 极低 |
| **P0** | Bug #6 safeJsonWrite 工具 | 新文件 | 中 |
| **P0** | Bug #6 改造所有 JSON 服务 | 替换 21 处写入 | 中 |
| **P1** | #2 删除 Plan 执行按钮 | 删除 ~30 行 | 极低 |
| **P1** | #3 输入框按钮状态 | 改一个组件 | 低 |
| **P1** | #1 滚动条优化 | 核心交互改造 | 中高 |
| **P1** | #4 排队消息延迟插入 | 跨 hook 改动 | 中 |

---

## 四、不在本次范围

- **#5 独立会话窗口** — 需要新窗口、新路由、组件复用改造，单独规划
- **#7 对话修复功能** — 依赖 #6 的防御改造基础，后续补充 conversation-tree 双向绑定
