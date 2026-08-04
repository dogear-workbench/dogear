// components/agent-chat/transformers.ts
import type { Message, ContentBlock } from './types';

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
  // 检测子代理工具调用（SDK 过渡期 'Agent' / 'Task' 都可能出现）
  const isAgentTool = extendedMsg.type === 'tool_use' && (extendedMsg.toolName === 'Agent' || extendedMsg.toolName === 'Task');

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

// ==================== 实时流消息更新 ====================

/**
 * 处理实时流 SDK 事件，更新消息列表
 * 替代 useSessionMessages 中内联的更新逻辑
 * 纯函数 reducer 模式：(prevMessages, event, showReplayMessages) → newMessages | null
 * 返回 null 表示该事件被过滤，不更新状态
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

  // 运行时 compact_boundary：插入独立的分隔消息（带 isCompactBoundary 标记）
  if (extendedMsg.type === 'compact_boundary') {
    // 关闭可能正在流式输出的 assistant 消息
    if (lastIdx >= 0 && updated[lastIdx].role === 'assistant' && updated[lastIdx].isStreaming) {
      updated[lastIdx] = { ...updated[lastIdx], isStreaming: false };
    }
    const ts = extendedMsg.timestamp || Date.now();
    updated.push(createAssistantMessage({
      content: '',
      timestamp: ts,
      isCompactBoundary: true,
      compactMetadata: {
        trigger: extendedMsg.compactTrigger,
        preTokens: extendedMsg.compactPreTokens,
      },
      contentBlocks: [{
        type: 'compact_boundary',
        compactTrigger: extendedMsg.compactTrigger,
        compactPreTokens: extendedMsg.compactPreTokens,
        timestamp: ts,
      }],
    }));
    return updated;
  }

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

  // 用户消息（SDK 推送的 user 事件）
  if (extendedMsg.type === 'user') {
    // SDK 回送 user 事件说明排队消息已被消费，清除排队标记
    for (let i = 0; i < updated.length; i++) {
      if (updated[i].isQueued) {
        updated[i] = { ...updated[i], isQueued: false };
      }
    }
    // bot 来源的 user 消息需要渲染（desktop 端自己发的已在 useSendMessage 中直接添加）
    if ((extendedMsg as any).source === 'wechat-bot') {
      // content 可能是 string 或 Array<{ type: 'text', text: string }>
      let textContent = '';
      if (typeof extendedMsg.content === 'string') {
        textContent = extendedMsg.content;
      } else if (Array.isArray(extendedMsg.content)) {
        textContent = extendedMsg.content
          .filter((b: any) => b?.type === 'text')
          .map((b: any) => b.text)
          .join('\n');
      }
      if (textContent) {
        updated.push({
          role: 'user',
          content: textContent,
          timestamp: Date.now(),
          contentBlocks: [],
          source: (extendedMsg as any).source,
        });
      }
      return updated;
    }
    // SDK 注入的 user 事件（isMeta / skill 文档等）不渲染
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
