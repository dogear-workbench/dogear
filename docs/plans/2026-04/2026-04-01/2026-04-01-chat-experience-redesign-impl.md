# 会话体验重设计 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 重构 AgentChat 模块，实现 6 项核心改进：准确的消息识别、中途插入消息、用户控制滚动、渐隐预览折叠、统一渲染模型、简约系统消息。

**Architecture:** 引入统一的 `transformers.ts` 处理层，历史加载和实时流共用同一套数据构建逻辑。新增 `CollapsibleBlock` 通用渐隐预览组件，替代现有的卡片式折叠。后端 `getSdkSessionHistory` 传递 `userType` 字段支持准确的消息来源识别。

**Tech Stack:** React 19, Zustand 5, TypeScript, Tailwind CSS 4, shadcn/ui (Collapsible), @egoist/tipc

---

## Phase 1: 数据层 — 统一数据模型 + 消息识别（第 5 点 + 第 1 点）

### Task 1: 后端传递 userType 字段

**Files:**
- Modify: `electron/main/tipc/agent.ts:824-870` (getSdkSessionHistory JSONL 解析)

**Step 1: 修改 JSONL 解析，提取 userType 字段**

在 `getSdkSessionHistory` handler 中，解析 JSONL 时保留 `userType` 字段：

```typescript
// electron/main/tipc/agent.ts — getSdkSessionHistory handler 内部
// 在 rawMessages 类型定义中添加 userType 字段（约第 824-835 行）

const rawMessages: Array<{
  type: string;
  message?: any;
  timestamp?: string;
  uuid?: string;
  isMeta?: boolean;
  sourceToolUseID?: string;
  isCompactSummary?: boolean;
  isCompactBoundary?: boolean;
  compactMetadata?: { trigger?: string; preTokens?: number };
  toolUseResult?: any;
  userType?: string;  // ← 新增：来自 JSONL 的 userType 字段
}>() = [];

// 在 for 循环解析每行 JSONL 时（约第 854-871 行），提取 userType：
rawMessages.push({
  type: parsed.type,
  message: parsed.message,
  timestamp: parsed.timestamp,
  uuid: parsed.uuid,
  isMeta: parsed.isMeta || false,
  sourceToolUseID: parsed.sourceToolUseID,
  isCompactSummary: parsed.isCompactSummary || false,
  toolUseResult: parsed.toolUseResult,
  userType: parsed.userType,  // ← 新增
});
```

然后在 `historyMessages` 类型定义（约第 878-890 行）也添加 `userType`：

```typescript
const historyMessages: Array<{
  type: string;
  role?: string;
  content?: any;
  timestamp?: string;
  uuid?: string;
  isMeta?: boolean;
  sourceToolUseID?: string;
  isCompactSummary?: boolean;
  isCompactBoundary?: boolean;
  compactMetadata?: { trigger?: string; preTokens?: number };
  toolUseResult?: any;
  userType?: string;  // ← 新增
}> = [];
```

在合并循环中传递 `userType`（约第 914-929 行）：

```typescript
// user 消息分支
historyMessages.push({
  type: 'user',
  role: msg.message.role,
  content: msg.message.content,
  timestamp: msg.timestamp,
  uuid: msg.uuid,
  isMeta: msg.isMeta,
  sourceToolUseID: msg.sourceToolUseID,
  isCompactSummary: msg.isCompactSummary,
  toolUseResult: msg.toolUseResult,
  userType: msg.userType,  // ← 新增
});
```

**Step 2: 验证**

Run: `bun run build:electron`
Expected: 编译成功

**Step 3: Commit**

```bash
git add electron/main/tipc/agent.ts
git commit -m "feat: getSdkSessionHistory 传递 userType 字段"
```

---

### Task 2: Message 类型添加 isQueued 字段

**Files:**
- Modify: `components/agent-chat/types.ts`

**Step 1: 在 Message 接口添加 isQueued 字段**

```typescript
// components/agent-chat/types.ts — Message 接口
// 在 isMeta 字段后面添加：
export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
  isStreaming?: boolean;
  contentBlocks?: ContentBlock[];
  sdkUuid?: string;
  forkPointSdkUuid?: string;
  model?: string;
  images?: Array<{ preview: string }>;
  isMeta?: boolean;
  isQueued?: boolean;  // ← 新增：消息在排队等待 Agent 处理
  isCompactSummary?: boolean;
  isCompactBoundary?: boolean;
  compactMetadata?: { trigger?: string; preTokens?: number };
}
```

**Step 2: Commit**

```bash
git add components/agent-chat/types.ts
git commit -m "feat: Message 类型添加 isQueued 字段"
```

---

### Task 3: 新增 transformers.ts — 共享工具函数

**Files:**
- Create: `components/agent-chat/transformers.ts`

**Step 1: 创建 transformers.ts，包含共享工具函数**

```typescript
// components/agent-chat/transformers.ts
import type { Message, ContentBlock } from './types';

/**
 * 判断 JSONL 中的 user 消息是否为真实用户输入
 * userType === "external" 表示用户通过输入框发出的消息
 * 其他情况（SDK 注入的 skill 加载、command caveat、subagent 提示等）都不是
 */
export function isExternalUserMessage(rawMsg: { userType?: string; isMeta?: boolean }): boolean {
  return rawMsg.userType === 'external' && !rawMsg.isMeta;
}

/**
 * 判断消息文本是否为 SDK 注入的系统消息
 */
export function isSystemInjectedText(text: string): boolean {
  return text.includes('[Request interrupted by user]');
}

/**
 * 从 raw content 中提取纯文本
 */
export function extractTextContent(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block: any) => {
        if (typeof block === 'string') return block;
        if (block?.type === 'text') return block.text || '';
        return '';
      })
      .join('');
  }
  return '';
}

/**
 * 判断 content 是否只包含 tool_result（不应展示为用户消息）
 */
export function isOnlyToolResult(content: any): boolean {
  return Array.isArray(content) && content.length > 0 && content.every((b: any) => b?.type === 'tool_result');
}

/**
 * 创建标准的用户消息
 */
export function createUserMessage(opts: {
  content: string;
  timestamp: number;
  isMeta?: boolean;
  isCompactSummary?: boolean;
  isQueued?: boolean;
  images?: Array<{ preview: string }>;
}): Message {
  return {
    role: 'user',
    content: opts.content,
    timestamp: opts.timestamp,
    isMeta: opts.isMeta,
    isCompactSummary: opts.isCompactSummary,
    isQueued: opts.isQueued,
    images: opts.images,
  };
}

/**
 * 创建标准的 assistant 消息
 */
export function createAssistantMessage(opts: {
  content: string;
  timestamp: number;
  contentBlocks?: ContentBlock[];
  sdkUuid?: string;
  model?: string;
  isStreaming?: boolean;
  isCompactBoundary?: boolean;
  compactMetadata?: { trigger?: string; preTokens?: number };
}): Message {
  return {
    role: 'assistant',
    content: opts.content,
    timestamp: opts.timestamp,
    contentBlocks: opts.contentBlocks,
    sdkUuid: opts.sdkUuid,
    model: opts.model,
    isStreaming: opts.isStreaming,
    isCompactBoundary: opts.isCompactBoundary,
    compactMetadata: opts.compactMetadata,
  };
}

/**
 * 将 ExtendedSessionMessage 转换为 ContentBlock
 * 统一实时流和历史加载的 block 创建逻辑
 */
export function createContentBlock(extendedMsg: {
  type: string;
  content?: string;
  toolName?: string;
  toolInput?: any;
  toolOutput?: any;
  toolUseId?: string;
  status?: string;
  error?: string;
  isError?: boolean;
  timestamp?: number;
  citations?: any[];
  isReplay?: boolean;
  sessionStartSource?: string;
  sessionEndReason?: string;
  stopHookActive?: boolean;
  failedToolName?: string;
  failedToolError?: string;
  notificationTitle?: string;
  notificationMessage?: string;
  notificationType?: string;
  taskId?: string;
  taskStatus?: string;
  taskSummary?: string;
  compactTrigger?: string;
  compactPreTokens?: number;
  [key: string]: any;
}): ContentBlock {
  // 检测 Agent 工具调用
  const isAgentTool = extendedMsg.type === 'tool_use' && extendedMsg.toolName === 'Agent';

  return {
    type: extendedMsg.type as ContentBlock['type'],
    content: extendedMsg.content,
    toolName: extendedMsg.toolName,
    toolInput: extendedMsg.toolInput,
    toolOutput: extendedMsg.toolOutput,
    toolUseId: extendedMsg.toolUseId,
    status: extendedMsg.status,
    error: extendedMsg.error,
    isError: extendedMsg.isError,
    timestamp: extendedMsg.timestamp || Date.now(),
    citations: extendedMsg.citations,
    isReplay: extendedMsg.isReplay,
    // Hook 事件
    sessionStartSource: extendedMsg.sessionStartSource,
    sessionEndReason: extendedMsg.sessionEndReason,
    stopHookActive: extendedMsg.stopHookActive,
    failedToolName: extendedMsg.failedToolName,
    failedToolError: extendedMsg.failedToolError,
    notificationTitle: extendedMsg.notificationTitle,
    notificationMessage: extendedMsg.notificationMessage,
    notificationType: extendedMsg.notificationType,
    taskId: extendedMsg.taskId,
    taskStatus: extendedMsg.taskStatus,
    taskSummary: extendedMsg.taskSummary,
    // compact
    compactTrigger: extendedMsg.compactTrigger as 'manual' | 'auto' | undefined,
    compactPreTokens: extendedMsg.compactPreTokens,
    // 子代理
    ...(isAgentTool ? {
      isSubAgent: true,
      subAgentDescription: extendedMsg.toolInput?.description,
      subAgentType: extendedMsg.toolInput?.subagent_type,
    } : {}),
  };
}

// ==================== 历史消息转换 ====================

/**
 * 将主进程返回的 JSONL 解析结果转换为前端 Message[]
 * 替代 useMessageHistory 中 ~300 行的内联转换逻辑
 */
export function historyTransformer(rawMessages: any[]): Message[] {
  // 第一步：收集所有 tool_result，建立 tool_use_id -> result 的映射
  const toolResultMap = new Map<string, { content: any; isError: boolean }>();
  const subAgentResultMap = new Map<string, {
    agentId: string;
    status: string;
    durationMs?: number;
    totalTokens?: number;
    toolUseCount?: number;
    resultText?: string;
  }>();

  for (const msg of rawMessages) {
    if (msg.type === 'user' && Array.isArray(msg.content)) {
      // 子代理结果
      const tur = msg.toolUseResult;
      if (tur?.agentId) {
        for (const block of msg.content) {
          if (block?.type === 'tool_result' && block.tool_use_id) {
            let resultText = '';
            if (Array.isArray(tur.content)) {
              resultText = tur.content
                .filter((c: any) => c?.type === 'text')
                .map((c: any) => c.text)
                .join('\n');
            }
            subAgentResultMap.set(block.tool_use_id, {
              agentId: tur.agentId,
              status: tur.status || 'completed',
              durationMs: tur.totalDurationMs,
              totalTokens: tur.totalTokens,
              toolUseCount: tur.totalToolUseCount,
              resultText,
            });
          }
        }
      }
      // tool_result 收集
      for (const block of msg.content) {
        if (block?.type === 'tool_result') {
          let resultContent = block.content;
          if (Array.isArray(resultContent)) {
            resultContent = resultContent
              .map((item: any) => {
                if (typeof item === 'string') return item;
                if (item?.type === 'text') return item.text;
                return JSON.stringify(item);
              })
              .join('\n');
          }
          toolResultMap.set(block.tool_use_id, {
            content: resultContent,
            isError: block.is_error || false,
          });
        }
      }
    }
  }

  // 第二步：收集 skill 内容
  const skillContentMap = new Map<string, string>();
  for (const msg of rawMessages) {
    if (msg.isMeta && msg.sourceToolUseID && msg.type === 'user') {
      let skillContent = '';
      if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (block?.type === 'text') skillContent += block.text || '';
        }
      }
      if (skillContent) {
        skillContentMap.set(msg.sourceToolUseID, skillContent);
      }
    }
  }

  // 第三步：构建消息列表
  const historyMessages: Message[] = [];
  let currentAssistantMessage: Message | null = null;

  const flushAssistant = () => {
    if (currentAssistantMessage) {
      historyMessages.push(currentAssistantMessage);
      currentAssistantMessage = null;
    }
  };

  for (const msg of rawMessages) {
    const isUser = msg.type === 'user';
    const content = msg.content;

    // compact_boundary
    if (msg.type === 'compact_boundary' || msg.isCompactBoundary) {
      flushAssistant();
      historyMessages.push(createAssistantMessage({
        content: '',
        timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
        isCompactBoundary: true,
        compactMetadata: msg.compactMetadata,
        contentBlocks: [{
          type: 'compact_boundary',
          compactTrigger: msg.compactMetadata?.trigger as 'manual' | 'auto' | undefined,
          compactPreTokens: msg.compactMetadata?.preTokens,
          timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
        }],
      }));
      continue;
    }

    // isMeta 用户消息
    if (msg.isMeta && isUser) {
      flushAssistant();
      const textContent = extractTextContent(content);
      if (textContent.trim()) {
        historyMessages.push(createUserMessage({
          content: textContent,
          timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
          isMeta: true,
          isCompactSummary: msg.isCompactSummary || false,
        }));
      }
      continue;
    }

    // 空消息或只有 tool_result 的用户消息
    if (isUser) {
      if (!content || (Array.isArray(content) && content.length === 0)) continue;
      if (isOnlyToolResult(content)) continue;
    }

    if (isUser) {
      flushAssistant();
      const textContent = extractTextContent(content);
      if (!textContent.trim()) continue;

      // ★ 核心改动：使用 userType 判断是否为真实用户消息
      const isExternal = isExternalUserMessage(msg);
      const isInjected = isSystemInjectedText(textContent);

      historyMessages.push(createUserMessage({
        content: textContent,
        timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
        isCompactSummary: msg.isCompactSummary || false,
        // 不是 external 用户消息 → 标记为 isMeta（系统/agent 消息）
        isMeta: !isExternal || isInjected,
      }));
    } else {
      // assistant 消息
      const blocks: ContentBlock[] = [];
      let textContent = '';

      if (typeof content === 'string') {
        textContent = content;
        if (content) {
          blocks.push({ type: 'text', content, timestamp: Date.now() });
        }
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (typeof block === 'string') {
            textContent += block;
            blocks.push({ type: 'text', content: block, timestamp: Date.now() });
          } else if (block && typeof block === 'object') {
            if (block.type === 'text') {
              textContent += block.text || '';
              if (block.text) {
                blocks.push({ type: 'text', content: block.text, timestamp: Date.now() });
              }
            } else if (block.type === 'tool_use' || block.type === 'server_tool_use') {
              const toolResult = toolResultMap.get(block.id);
              let toolOutput = toolResult?.content;
              if (block.name === 'Skill' && skillContentMap.has(block.id)) {
                const sc = skillContentMap.get(block.id);
                toolOutput = toolOutput ? `${toolOutput}\n\n--- Skill 内容 ---\n${sc}` : sc;
              }
              const subAgentResult = subAgentResultMap.get(block.id);
              const isSubAgent = block.name === 'Agent';
              blocks.push({
                type: 'tool_use',
                id: block.id,
                toolName: block.name,
                toolInput: block.input,
                toolUseId: block.id,
                toolOutput,
                isError: toolResult?.isError || false,
                status: toolOutput !== undefined ? 'completed' : 'pending',
                timestamp: Date.now(),
                ...(isSubAgent ? {
                  isSubAgent: true,
                  subAgentDescription: block.input?.description,
                  subAgentType: block.input?.subagent_type,
                  subAgentId: subAgentResult?.agentId,
                  subAgentStatus: subAgentResult?.status,
                  subAgentDurationMs: subAgentResult?.durationMs,
                  subAgentTokens: subAgentResult?.totalTokens,
                  subAgentToolUseCount: subAgentResult?.toolUseCount,
                  subAgentResultText: subAgentResult?.resultText,
                } : {}),
              });
            } else if (block.type === 'thinking') {
              blocks.push({ type: 'thinking', content: block.thinking || '', timestamp: Date.now() });
            } else if (block.type === 'image' && block.source) {
              textContent += '[图片]';
              blocks.push({ type: 'text', content: '[图片]', timestamp: Date.now() });
            }
          }
        }
      }

      const assistantUuid = msg.uuid || undefined;

      if (currentAssistantMessage) {
        currentAssistantMessage.contentBlocks = [
          ...(currentAssistantMessage.contentBlocks || []),
          ...blocks,
        ];
        currentAssistantMessage.content += textContent;
        if (assistantUuid) currentAssistantMessage.sdkUuid = assistantUuid;
      } else {
        currentAssistantMessage = createAssistantMessage({
          content: textContent,
          timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
          contentBlocks: blocks.length > 0 ? blocks : undefined,
          sdkUuid: assistantUuid,
        });
      }
    }
  }

  flushAssistant();
  return historyMessages;
}

// ==================== 实时流消息更新 ====================

/**
 * 处理实时流 SDK 事件，更新消息列表
 * 替代 useSessionMessages 中 ~250 行的内联更新逻辑
 * 纯函数 reducer 模式：(prevMessages, event) → newMessages
 */
export function streamReducer(
  prev: Message[],
  extendedMsg: any,
  showReplayMessages: boolean,
): Message[] | null {
  // 重放消息过滤
  if (extendedMsg.isReplay && !showReplayMessages) return null;

  const updated = [...prev];
  const lastIdx = updated.length - 1;

  // assistant_uuid 处理
  if (extendedMsg.type === 'assistant_uuid') {
    if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
      updated[lastIdx] = {
        ...updated[lastIdx],
        sdkUuid: extendedMsg.uuid,
        ...(extendedMsg.model ? { model: extendedMsg.model } : {}),
      };
    }
    return updated;
  }

  // 用户消息（SDK 推送的 user 事件 → 一律 isMeta）
  if (extendedMsg.type === 'user') {
    const isInjected = isSystemInjectedText(extendedMsg.content || '');
    updated.push(createUserMessage({
      content: extendedMsg.content || '',
      timestamp: extendedMsg.timestamp || Date.now(),
      isMeta: true,  // SDK 推送的 user 消息一律视为系统消息
    }));
    return updated;
  }

  // 有正在流式输出的 assistant 消息
  if (lastIdx >= 0 && updated[lastIdx].role === 'assistant' && updated[lastIdx].isStreaming) {
    const lastMsg = updated[lastIdx];
    const blocks = lastMsg.contentBlocks || [];

    // tool_result → 更新对应 tool_use 块
    if (extendedMsg.type === 'tool_result' && extendedMsg.toolUseId) {
      const toolUseIdx = blocks.findIndex(b => b.toolUseId === extendedMsg.toolUseId);
      if (toolUseIdx >= 0) {
        const updatedBlocks = [...blocks];
        updatedBlocks[toolUseIdx] = {
          ...updatedBlocks[toolUseIdx],
          toolOutput: extendedMsg.toolOutput,
          isError: extendedMsg.isError,
          ...(extendedMsg.subAgentId ? {
            subAgentId: extendedMsg.subAgentId,
            subAgentStatus: extendedMsg.subAgentStatus,
            subAgentDurationMs: extendedMsg.subAgentDurationMs,
            subAgentTokens: extendedMsg.subAgentTokens,
            subAgentToolUseCount: extendedMsg.subAgentToolUseCount,
            subAgentResultText: extendedMsg.subAgentResultText,
          } : {}),
        };
        updated[lastIdx] = { ...lastMsg, contentBlocks: updatedBlocks };
        return updated;
      }
    }

    // task_notification → 更新 SubAgentBlock
    if (extendedMsg.type === 'task_notification' && extendedMsg.toolUseId) {
      const subIdx = blocks.findIndex(b => b.toolUseId === extendedMsg.toolUseId && b.isSubAgent);
      if (subIdx >= 0) {
        const updatedBlocks = [...blocks];
        updatedBlocks[subIdx] = {
          ...updatedBlocks[subIdx],
          taskId: extendedMsg.taskId,
          taskStatus: extendedMsg.taskStatus,
          subAgentStatus: extendedMsg.taskStatus === 'completed' ? 'completed'
            : extendedMsg.taskStatus === 'failed' ? 'failed'
            : extendedMsg.taskStatus === 'stopped' ? 'failed'
            : updatedBlocks[subIdx].subAgentStatus,
        };
        updated[lastIdx] = { ...lastMsg, contentBlocks: updatedBlocks };
        return updated;
      }
    }

    // thinking 合并
    if (extendedMsg.type === 'thinking' && blocks.length > 0 && blocks[blocks.length - 1].type === 'thinking') {
      const lastBlock = blocks[blocks.length - 1];
      updated[lastIdx] = {
        ...lastMsg,
        contentBlocks: [...blocks.slice(0, -1), {
          ...lastBlock,
          content: (lastBlock.content || '') + (extendedMsg.content || ''),
        }],
        isStreaming: true,
      };
      return updated;
    }

    // text 合并
    if (extendedMsg.type === 'text' && blocks.length > 0 && blocks[blocks.length - 1].type === 'text') {
      const lastBlock = blocks[blocks.length - 1];
      updated[lastIdx] = {
        ...lastMsg,
        contentBlocks: [...blocks.slice(0, -1), {
          ...lastBlock,
          content: (lastBlock.content || '') + (extendedMsg.content || ''),
        }],
        content: (lastMsg.content || '') + (extendedMsg.content || ''),
        isStreaming: true,
      };
      return updated;
    }

    // tool_result 未匹配 → 忽略
    if (extendedMsg.type === 'tool_result') return updated;

    // tool_use 更新已有块
    if (extendedMsg.type === 'tool_use' && extendedMsg.toolUseId) {
      const existingIdx = blocks.findIndex(b => b.toolUseId === extendedMsg.toolUseId);
      if (existingIdx >= 0) {
        const updatedBlocks = [...blocks];
        updatedBlocks[existingIdx] = {
          ...updatedBlocks[existingIdx],
          type: 'tool_use',
          toolName: extendedMsg.toolName || updatedBlocks[existingIdx].toolName,
          toolInput: extendedMsg.toolInput ?? updatedBlocks[existingIdx].toolInput,
          timestamp: extendedMsg.timestamp || Date.now(),
        };
        updated[lastIdx] = { ...lastMsg, contentBlocks: updatedBlocks, isStreaming: true };
        return updated;
      }
    }

    // 创建新块
    const newBlock = createContentBlock(extendedMsg);
    updated[lastIdx] = {
      ...lastMsg,
      contentBlocks: [...blocks, newBlock],
      content: extendedMsg.type === 'text'
        ? (lastMsg.content || '') + (extendedMsg.content || '')
        : lastMsg.content,
      isStreaming: extendedMsg.type !== 'result',
    };
    return updated;
  }

  // 无活跃 assistant 消息 → 创建新的
  if (extendedMsg.type === 'tool_result') return updated;

  const newBlock = createContentBlock(extendedMsg);
  updated.push(createAssistantMessage({
    content: extendedMsg.type === 'text' ? (extendedMsg.content || '') : '',
    timestamp: Date.now(),
    isStreaming: extendedMsg.type !== 'result',
    contentBlocks: [newBlock],
    model: extendedMsg.model,
  }));
  return updated;
}
```

**Step 2: Commit**

```bash
git add components/agent-chat/transformers.ts
git commit -m "feat: 新增 transformers.ts 统一历史/实时消息转换"
```

---

### Task 4: 简化 useMessageHistory.ts — 调用 historyTransformer

**Files:**
- Modify: `components/agent-chat/hooks/useMessageHistory.ts:116-476`

**Step 1: 替换 SDK resume 模式的内联转换逻辑为 historyTransformer 调用**

在文件顶部添加 import：
```typescript
import { historyTransformer } from '../transformers';
```

替换第 136-456 行（"转换 SDK 历史消息格式"注释开始，到 `flushAssistant()` 结束）为：

```typescript
// 转换 SDK 历史消息格式到组件消息格式（使用统一 transformer）
const historyMessages = historyTransformer(historyResult.messages);

setMessages(historyMessages);
setTimeout(() => {
  setHistoryLoaded(true);
}, 100);

console.log(`✅ 已从 SDK 会话文件加载历史消息: ${historyMessages.length} 条`);
```

**Step 2: 验证**

Run: `bun run dev:renderer`
Expected: 编译成功，无 TypeScript 错误

**Step 3: Commit**

```bash
git add components/agent-chat/hooks/useMessageHistory.ts
git commit -m "refactor: useMessageHistory 使用 historyTransformer 替代内联逻辑"
```

---

### Task 5: 简化 useSessionMessages.ts — 调用 streamReducer

**Files:**
- Modify: `components/agent-chat/hooks/useSessionMessages.ts`

**Step 1: 替换 setMessages 回调中的内联更新逻辑为 streamReducer**

在文件顶部添加 import：
```typescript
import { streamReducer } from '../transformers';
```

替换 `setMessages(prev => { ... })` 回调体（第 55-318 行）为：

```typescript
setMessages(prev => {
  const result = streamReducer(prev, extendedMsg, showReplayMessages);
  if (result === null) return prev;  // 被过滤的消息不更新
  return result;
});
```

保留末尾的 result 类型处理（第 320-324 行）不变：
```typescript
// 收到结果消息时结束加载状态
if (extendedMsg.type === 'result') {
  setIsLoading(false);
  setHistoryLoaded(true);
}
```

同时保留 `setHistoryLoaded(true)` 的逻辑——在 streamReducer 返回非 null 时调用。可以在 `user` 类型事件后调用：

```typescript
setMessages(prev => {
  const result = streamReducer(prev, extendedMsg, showReplayMessages);
  if (result === null) return prev;
  return result;
});

// 收到用户消息或结果时更新状态
if (extendedMsg.type === 'user') {
  setHistoryLoaded(true);
}
if (extendedMsg.type === 'result') {
  setIsLoading(false);
  setHistoryLoaded(true);
}
```

**Step 2: 删除不再需要的日志代码**

移除第 33-47 行的大段 console.log 调试输出（`══════...` 分隔线），保持简洁。

**Step 3: 验证**

Run: `bun run dev:renderer`
Expected: 编译成功

**Step 4: Commit**

```bash
git add components/agent-chat/hooks/useSessionMessages.ts
git commit -m "refactor: useSessionMessages 使用 streamReducer 替代内联逻辑"
```

---

## Phase 2: 渲染层 — 渐隐预览组件 + 系统消息简约化（第 4 点 + 第 6 点）

### Task 6: 新增 CollapsibleBlock 通用渐隐预览组件

**Files:**
- Create: `components/agent-chat/CollapsibleBlock.tsx`

**Step 1: 创建 CollapsibleBlock 组件**

```typescript
// components/agent-chat/CollapsibleBlock.tsx
import { useState, useRef, useEffect, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CollapsibleBlockProps {
  /** 标题行左侧图标 */
  icon?: ReactNode;
  /** 标题文本 */
  title: string;
  /** 标题右侧的状态指示 */
  statusIcon?: ReactNode;
  /** 默认预览行数（超出部分渐隐） */
  previewLines?: number;
  /** 子内容 */
  children: ReactNode;
  /** 额外的 className */
  className?: string;
  /** 标题文字颜色 */
  titleClassName?: string;
  /** 是否默认展开 */
  defaultOpen?: boolean;
}

/**
 * 通用渐隐预览组件
 * - 无边框、无背景色，和周围文本融为一体
 * - 默认显示 N 行预览，超出部分 gradient mask 渐隐
 * - 展开按钮在左上角（ChevronRight 旋转动画）
 * - 展开后显示完整内容，max-height + 内部滚动
 */
export function CollapsibleBlock({
  icon,
  title,
  statusIcon,
  previewLines = 3,
  children,
  className,
  titleClassName,
  defaultOpen = false,
}: CollapsibleBlockProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const contentRef = useRef<HTMLDivElement>(null);
  const [needsCollapse, setNeedsCollapse] = useState(false);

  // 检测内容是否超出预览行数
  useEffect(() => {
    if (contentRef.current) {
      const lineHeight = parseFloat(getComputedStyle(contentRef.current).lineHeight) || 20;
      const maxHeight = lineHeight * previewLines;
      setNeedsCollapse(contentRef.current.scrollHeight > maxHeight + 4);
    }
  }, [children, previewLines]);

  // 预览区域的最大高度（行数 × 行高）
  const previewMaxHeight = `${previewLines * 1.4}em`;

  return (
    <div className={cn('group/collapsible', className)}>
      {/* 标题行：展开图标 + icon + title + status */}
      <button
        onClick={() => setNeedsCollapse && setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 text-left w-full hover:opacity-80 transition-opacity cursor-pointer"
      >
        <ChevronRight
          className={cn(
            'w-3.5 h-3.5 text-muted-foreground/60 transition-transform duration-200 flex-shrink-0',
            isOpen && 'rotate-90',
            !needsCollapse && 'opacity-0'
          )}
        />
        {icon && <span className="flex-shrink-0">{icon}</span>}
        <span className={cn('text-sm text-muted-foreground truncate', titleClassName)}>
          {title}
        </span>
        {statusIcon && <span className="ml-auto flex-shrink-0">{statusIcon}</span>}
      </button>

      {/* 内容区域 */}
      <div className="pl-5 mt-0.5">
        {isOpen ? (
          /* 展开：完整内容，限制最大高度 + 内部滚动 */
          <div className="max-h-[500px] overflow-y-auto">
            {children}
          </div>
        ) : (
          /* 收起：预览 N 行 + 渐隐 */
          <div className="relative">
            <div
              ref={contentRef}
              className="overflow-hidden"
              style={{ maxHeight: previewMaxHeight }}
            >
              {children}
            </div>
            {/* 渐隐遮罩 */}
            {needsCollapse && (
              <div
                className="absolute bottom-0 left-0 right-0 h-8 pointer-events-none"
                style={{
                  background: 'linear-gradient(to bottom, transparent, var(--background, white))',
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add components/agent-chat/CollapsibleBlock.tsx
git commit -m "feat: 新增 CollapsibleBlock 通用渐隐预览组件"
```

---

### Task 7: 重写 ThinkingBlock — 使用渐隐预览

**Files:**
- Modify: `components/agent-chat/ThinkingBlock.tsx` (完全重写)

**Step 1: 重写 ThinkingBlock**

```typescript
// components/agent-chat/ThinkingBlock.tsx
import { Brain } from 'lucide-react';
import { CollapsibleBlock } from './CollapsibleBlock';
import type { ContentBlock } from './types';

/**
 * 思考块组件
 * 默认 3 行预览 + 渐隐，无边框无背景
 */
export function ThinkingBlock({ block }: { block: ContentBlock }) {
  const hasContent = !!block.content;

  return (
    <CollapsibleBlock
      icon={
        hasContent
          ? <Brain size={14} className="text-muted-foreground/60" />
          : <div className="w-2 h-2 bg-muted-foreground rounded-full animate-pulse" />
      }
      title={hasContent ? '思考' : '思考中...'}
      previewLines={3}
    >
      {hasContent && (
        <div className="text-xs text-muted-foreground/80 whitespace-pre-wrap break-words leading-relaxed">
          {block.content}
        </div>
      )}
    </CollapsibleBlock>
  );
}
```

**Step 2: Commit**

```bash
git add components/agent-chat/ThinkingBlock.tsx
git commit -m "refactor: ThinkingBlock 使用 CollapsibleBlock 渐隐预览"
```

---

### Task 8: 重写 ToolBlock — 渐隐预览 + 无卡片

**Files:**
- Modify: `components/ToolBlock.tsx` (完全重写)

**Step 1: 重写 ToolBlock**

保留 `getToolIcon`、`formatToolName`、`getToolSummary`、`formatToolOutput`、`StatusIcon` 等工具函数不变（第 34-199 行），只重写 ToolBlock 组件本身（第 205-363 行）和 ToolResultBlock（第 370-440 行可以删除，不再需要）：

```typescript
// 替换 ToolBlock 组件（第 205 行开始）
import { CollapsibleBlock } from './agent-chat/CollapsibleBlock';

export function ToolBlock({
  toolName,
  toolInput,
  toolOutput,
  toolUseId,
  status = "success",
  isError = false,
  citations,
  className,
}: ToolBlockProps) {
  const actualStatus: ToolStatus = isError ? "error" : status;
  const summary = getToolSummary(toolName, toolInput, toolOutput);
  const formattedOutput = formatToolOutput(toolName, toolOutput);
  const icon = getToolIcon(toolName);

  // 标题：工具图标 + 名称 + 摘要
  const titleText = summary
    ? `${formatToolName(toolName)} ${summary}`
    : formatToolName(toolName);

  return (
    <CollapsibleBlock
      icon={<span className="text-sm">{icon}</span>}
      title={titleText}
      titleClassName={cn(
        actualStatus === 'error' && 'text-red-600',
        actualStatus === 'running' && 'text-sky-600',
      )}
      statusIcon={<StatusIcon status={actualStatus} />}
      previewLines={2}
      className={className}
    >
      <div className="space-y-2 text-xs">
        {/* 输入参数 */}
        {toolInput && Object.keys(toolInput).length > 0 && (
          <div>
            <div className="text-muted-foreground/60 mb-0.5">输入参数</div>
            <pre className="text-muted-foreground whitespace-pre-wrap break-all">
              {JSON.stringify(toolInput, null, 2)}
            </pre>
          </div>
        )}
        {/* 执行结果 */}
        {toolOutput && (
          <div>
            <div className="text-muted-foreground/60 mb-0.5">
              执行结果{isError && <span className="text-red-500 ml-1">(错误)</span>}
            </div>
            <pre className={cn(
              "whitespace-pre-wrap break-all",
              isError ? "text-red-600" : "text-muted-foreground"
            )}>
              {formattedOutput}
            </pre>
          </div>
        )}
        {/* 引用 */}
        {citations && citations.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {citations.map((c, i) => (
              <span key={i} className="px-1.5 py-0.5 bg-muted rounded text-muted-foreground text-xs">
                {c.chapterTitle || `引用 ${i + 1}`}
              </span>
            ))}
          </div>
        )}
      </div>
    </CollapsibleBlock>
  );
}

// 删除 ToolResultBlock（不再需要，tool_result 已合并到 tool_use 块中）
export default ToolBlock;
```

注意：因为 `CollapsibleBlock` 在 `components/agent-chat/` 中，而 `ToolBlock` 在 `components/` 中，import 路径需要调整为 `'./agent-chat/CollapsibleBlock'` 或把 CollapsibleBlock 移到 `components/ui/` 中。

**推荐方案**：将 CollapsibleBlock 放在 `components/agent-chat/` 中，ToolBlock 从相对路径导入：

```typescript
import { CollapsibleBlock } from './agent-chat/CollapsibleBlock';
```

**Step 2: Commit**

```bash
git add components/ToolBlock.tsx
git commit -m "refactor: ToolBlock 使用 CollapsibleBlock 渐隐预览，移除卡片样式"
```

---

### Task 9: 系统消息简约化 — 修改 MessageItem.tsx

**Files:**
- Modify: `components/agent-chat/MessageItem.tsx:56-198`

**Step 1: 替换 isMeta 系统消息的渲染**

将第 58-198 行的用户消息渲染部分中 isMeta 相关的代码替换。当前 isMeta 消息使用完整的头像 + 灰色背景卡片，改为淡色行内提示：

在 `isUser` 分支的最前面（第 58 行 `{isUser ? (` 后），添加 isMeta 提前返回：

```typescript
{isUser ? (
  // 系统消息：淡色行内单行提示
  message.isMeta ? (
    <div className="flex items-center gap-1.5 py-1 px-1">
      <div className="w-1 h-1 rounded-full bg-muted-foreground/30 flex-shrink-0" />
      <span className="text-xs text-muted-foreground/50 truncate">
        {message.content.length > 80 ? message.content.substring(0, 80) + '...' : message.content}
      </span>
    </div>
  ) : (
    // 普通用户消息（保持原有逻辑）
    <div className="flex items-start gap-3">
      ...原有代码...
    </div>
  )
```

具体来说，将第 60-198 行中的整个 `<div className="flex items-start gap-3">` 块用条件渲染包裹。

**Step 2: 同时处理 isQueued 排队消息标记**

在用户消息（非 isMeta）的时间戳旁边添加排队标签：

```typescript
{message.timestamp && (
  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
    <span>{new Date(message.timestamp).toLocaleTimeString()}</span>
    {message.isQueued && (
      <span className="text-muted-foreground/50 text-[10px]">排队中</span>
    )}
  </div>
)}
```

**Step 3: Commit**

```bash
git add components/agent-chat/MessageItem.tsx
git commit -m "feat: 系统消息简约化 + 排队消息标记"
```

---

## Phase 3: 交互层 — 滚动控制 + 中途插入消息（第 3 点 + 第 2 点）

### Task 10: 滚动行为 — 移除自动滚动 + 添加跳到最新按钮

**Files:**
- Modify: `components/agent-chat/AgentChat.tsx:132-136` (删除自动滚动)
- Modify: `components/agent-chat/AgentChat.tsx:138-273` (添加浮动按钮)

**Step 1: 删除自动滚动的 useEffect**

删除第 132-136 行：
```typescript
// 删除这段
const messagesEndRef = useRef<HTMLDivElement>(null);
useEffect(() => {
  messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
}, [messages]);
```

以及第 271 行的 `<div ref={messagesEndRef} />`。

**Step 2: 添加滚动状态检测 + 浮动按钮**

在 AgentChat 组件中添加：

```typescript
// 滚动控制
const scrollAreaRef = useRef<HTMLDivElement>(null);
const [isAtBottom, setIsAtBottom] = useState(true);
const [newMsgCount, setNewMsgCount] = useState(0);

// 监听滚动位置
const handleScroll = useCallback(() => {
  const el = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]');
  if (!el) return;
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
  setIsAtBottom(atBottom);
  if (atBottom) setNewMsgCount(0);
}, []);

// 消息变化时，如果不在底部则累加计数
useEffect(() => {
  if (!isAtBottom && messages.length > 0) {
    setNewMsgCount(prev => prev + 1);
  }
}, [messages.length]);

const scrollToBottom = useCallback(() => {
  const el = scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]');
  if (el) {
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setNewMsgCount(0);
  }
}, []);
```

在 `<ScrollArea>` 上添加 ref 和 onScroll：

```tsx
<ScrollArea
  ref={scrollAreaRef}
  className="flex-1 overflow-hidden"
  onScrollCapture={handleScroll}
>
```

在 `</ScrollArea>` 前面添加浮动按钮：

```tsx
{/* 跳到最新按钮 */}
{!isAtBottom && (
  <button
    onClick={scrollToBottom}
    className="absolute bottom-20 right-4 z-10 w-8 h-8 rounded-full bg-foreground/10 hover:bg-foreground/20 backdrop-blur-sm flex items-center justify-center transition-all shadow-sm"
  >
    <ChevronDown size={16} className="text-foreground/60" />
    {newMsgCount > 0 && (
      <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center">
        {newMsgCount > 9 ? '9+' : newMsgCount}
      </span>
    )}
  </button>
)}
```

注意：需要在消息区域的容器上添加 `relative` 类名以支持 absolute 定位。

**Step 3: 需要额外导入**

在 AgentChat.tsx 顶部的 lucide-react import 中添加 `ChevronDown`：

```typescript
import { ChevronRight, Archive, GitBranch, ChevronDown } from 'lucide-react';
```

添加 `useCallback`：
```typescript
import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
```

**Step 4: Commit**

```bash
git add components/agent-chat/AgentChat.tsx
git commit -m "feat: 移除自动滚动，添加跳到最新浮动按钮"
```

---

### Task 11: Agent 运行时允许输入消息

**Files:**
- Modify: `components/agent-chat/ChatInputArea.tsx:290,314,437`
- Modify: `components/agent-chat/hooks/useSendMessage.ts:307`

**Step 1: ChatInputArea — 移除 isLoading 禁用**

1. 第 290 行：`disabled={isLoading || !isSessionReady}` → `disabled={!isSessionReady}`
2. 第 314 行：同上
3. 第 437 行：发送按钮的 disabled 条件不变（已经没有 isLoading 限制）

**Step 2: useSendMessage — 移除 isLoading 限制，改为排队**

第 307 行：
```typescript
// 原来：
if ((!hasText && !hasImages) || isLoading) return;

// 改为：
if (!hasText && !hasImages) return;
```

在发送消息的乐观更新中（`setMessages` 调用处），当 `isLoading` 为 true 时标记 `isQueued`：

在 `handleSend` 函数中，正常发送消息部分（非 resendDraft、非 forkPending 分支），找到添加用户消息到 messages 的地方，添加 isQueued 标记：

```typescript
// 乐观更新消息列表（现有逻辑中 setMessages 添加用户消息的地方）
setMessages(prev => [...prev, {
  role: 'user' as const,
  content: userMessage,
  timestamp: Date.now(),
  images: imagePreview,
  isQueued: isLoading,  // ← 新增：Agent 运行中时标记为排队
}, ...(isLoading ? [] : [{
  role: 'assistant' as const,
  content: '',
  timestamp: Date.now(),
  isStreaming: true,
  contentBlocks: [],
}])]);

// 仅在非排队时才设置 loading
if (!isLoading) {
  setIsLoading(true);
}
```

**Step 3: 排队消息被消费后自动清除标记**

在 `useSessionMessages` 中（或 streamReducer 中），当收到新的 user 类型消息时，清除前面排队消息的 `isQueued` 标记。这在 `streamReducer` 的 user 分支中自然处理——因为 SDK 消费了排队消息后会发回 user 事件，此时前端可以遍历并清除 isQueued。

简单方案：在 `streamReducer` 的 user 分支中，在 push 新消息前，清除所有 isQueued：

```typescript
if (extendedMsg.type === 'user') {
  // 清除排队标记
  for (let i = 0; i < updated.length; i++) {
    if (updated[i].isQueued) {
      updated[i] = { ...updated[i], isQueued: false };
    }
  }
  // ... 其余逻辑
}
```

**Step 4: Commit**

```bash
git add components/agent-chat/ChatInputArea.tsx components/agent-chat/hooks/useSendMessage.ts
git commit -m "feat: Agent 运行时允许输入消息（排队模式）"
```

---

### Task 12: 最终验证与清理

**Files:**
- 全部修改过的文件

**Step 1: TypeScript 编译检查**

Run: `bun run build:electron && bun run build`
Expected: 无编译错误

**Step 2: Lint 检查**

Run: `bun run lint`
Expected: 无错误（warnings 可接受）

**Step 3: 手动功能测试清单**

- [ ] 启动开发模式 `bun run dev`
- [ ] 发送消息，观察实时流渲染正常
- [ ] 切换对话，历史消息加载正常
- [ ] 工具调用显示为渐隐预览（无卡片背景）
- [ ] 思考块显示 3 行预览 + 渐隐
- [ ] 系统消息（isMeta）显示为淡色单行
- [ ] Agent 运行时输入框可用，消息显示"排队中"
- [ ] 滚动到顶部后，新消息不自动滚回底部
- [ ] 右下角出现"跳到最新"按钮
- [ ] 分叉对话正常
- [ ] 编辑重发正常
- [ ] 权限请求/AskUser 卡片正常
- [ ] /compact 压缩后历史折叠正常

**Step 4: Final Commit**

```bash
git add -A
git commit -m "chore: 会话体验重设计完成 — 清理与最终调整"
```

---

## 影响范围汇总

| 文件 | 改动类型 | 涉及的点 |
|------|---------|---------|
| `electron/main/tipc/agent.ts` | 修改 | 第 1 点 |
| `components/agent-chat/types.ts` | 修改 | 第 2, 5 点 |
| `components/agent-chat/transformers.ts` | **新增** | 第 1, 5 点 |
| `components/agent-chat/CollapsibleBlock.tsx` | **新增** | 第 4 点 |
| `components/agent-chat/hooks/useMessageHistory.ts` | 简化 | 第 1, 5 点 |
| `components/agent-chat/hooks/useSessionMessages.ts` | 简化 | 第 1, 5 点 |
| `components/agent-chat/hooks/useSendMessage.ts` | 修改 | 第 2 点 |
| `components/agent-chat/AgentChat.tsx` | 修改 | 第 3 点 |
| `components/agent-chat/MessageItem.tsx` | 修改 | 第 2, 6 点 |
| `components/agent-chat/ThinkingBlock.tsx` | 重写 | 第 4 点 |
| `components/ToolBlock.tsx` | 重写 | 第 4 点 |
| `components/agent-chat/ChatInputArea.tsx` | 修改 | 第 2 点 |
