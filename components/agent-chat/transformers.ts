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
 * 替代 useMessageHistory 中内联的转换逻辑
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

    // isMeta 用户消息（skill 文档、SDK 注入内容等）→ 不渲染，直接跳过
    if (msg.isMeta && isUser) {
      continue;
    }

    // 空消息或只有 tool_result 的用户消息
    if (isUser) {
      if (!content || (Array.isArray(content) && content.length === 0)) continue;
      if (isOnlyToolResult(content)) continue;
    }

    if (isUser) {
      // 非真实用户输入（非 external）或 SDK 注入文本 → 跳过
      if (!isExternalUserMessage(msg)) continue;
      const textContent = extractTextContent(content);
      if (!textContent.trim()) continue;
      if (isSystemInjectedText(textContent)) continue;

      flushAssistant();
      historyMessages.push(createUserMessage({
        content: textContent,
        timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
        isCompactSummary: msg.isCompactSummary || false,
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
