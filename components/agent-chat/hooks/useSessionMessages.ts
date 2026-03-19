import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { rendererEvents } from '@/lib/events';
import type { Message, ContentBlock } from '../types';

interface UseSessionMessagesParams {
  sessionId: string | null;
  showReplayMessages: boolean;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setHistoryLoaded: Dispatch<SetStateAction<boolean>>;
}

/**
 * 监听会话消息流，处理各种消息类型并更新消息状态
 * 从 AgentChat.tsx 提取的核心消息监听逻辑
 */
export function useSessionMessages({
  sessionId,
  showReplayMessages,
  setMessages,
  setIsLoading,
  setHistoryLoaded,
}: UseSessionMessagesParams): void {
  // 监听会话消息
  useEffect(() => {
    if (!sessionId) return;

    const unsubscribe = rendererEvents.queryBasedSessionMessage.listen((data) => {
      if (data.sessionId !== sessionId) return;

      const extendedMsg = data.message;

      // ==================== 前端消息接收日志 ====================
      console.log('');
      console.log('══════════════════════════════════════════════════════════════════');
      console.log('📨 [前端] 收到会话消息');
      console.log('══════════════════════════════════════════════════════════════════');
      console.log('  Session ID:', data.sessionId?.substring(0, 8));
      console.log('  消息类型:', extendedMsg.type);
      console.log('  时间戳:', new Date(extendedMsg.timestamp || Date.now()).toISOString());
      console.log('  内容:', extendedMsg.content ? extendedMsg.content.substring(0, 100) + (extendedMsg.content.length > 100 ? '...' : '') : '(无)');
      if (extendedMsg.toolName) console.log('  工具名称:', extendedMsg.toolName);
      if (extendedMsg.status) console.log('  状态:', extendedMsg.status);
      if (extendedMsg.error) console.log('  错误:', extendedMsg.error);
      if (extendedMsg.isReplay) console.log('  重放消息: 是');
      console.log('══════════════════════════════════════════════════════════════════');
      console.log('');

      // 如果是重放消息且不显示重放消息，跳过
      if (extendedMsg.isReplay && !showReplayMessages) {
        console.log('⚠️  跳过重放消息（showReplayMessages=false）');
        return;
      }

      setMessages(prev => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;

        console.log('🔄 [前端] 更新消息状态:');
        console.log('  当前消息数:', updated.length);
        console.log('  最后一条索引:', lastIdx);
        console.log('  最后一条角色:', lastIdx >= 0 ? updated[lastIdx].role : 'N/A');
        console.log('  最后一条流式状态:', lastIdx >= 0 ? updated[lastIdx].isStreaming : 'N/A');

        // v4: 处理 assistant_uuid 消息（将 uuid 和 model 关联到当前 assistant 消息）
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

        // 处理用户消息
        if (extendedMsg.type === 'user') {
          // SDK 注入的系统消息（如中断提示）标记为 isMeta
          const isSystemInjected = (extendedMsg.content || '').includes('[Request interrupted by user]');

          const newUserMessage: Message = {
            role: 'user',
            content: extendedMsg.content || '',
            timestamp: extendedMsg.timestamp || Date.now(),
            ...(isSystemInjected ? { isMeta: true } : {}),
          };
          updated.push(newUserMessage);
          setHistoryLoaded(true);  // 收到消息后标记历史已加载
          return updated;
        }

        if (lastIdx >= 0 && updated[lastIdx].role === 'assistant' && updated[lastIdx].isStreaming) {
          // 更新最后一条流式消息
          console.log('  → 更新流式消息，追加内容块');
          const lastMsg = updated[lastIdx];
          const blocks = lastMsg.contentBlocks || [];

          // 问题1修复：tool_result 应该更新之前的 tool_use 块，而不是创建新块
          if (extendedMsg.type === 'tool_result' && extendedMsg.toolUseId) {
            // 查找对应的 tool_use 块
            const toolUseIdx = blocks.findIndex(b => b.toolUseId === extendedMsg.toolUseId);
            if (toolUseIdx >= 0) {
              // 更新找到的 tool_use 块，同时合并子代理元数据（如有）
              const updatedBlocks = [...blocks];
              updatedBlocks[toolUseIdx] = {
                ...updatedBlocks[toolUseIdx],
                toolOutput: extendedMsg.toolOutput,
                isError: extendedMsg.isError,
                // 子代理元数据（Agent 工具的 tool_result 携带）
                ...(extendedMsg.subAgentId ? {
                  subAgentId: extendedMsg.subAgentId,
                  subAgentStatus: extendedMsg.subAgentStatus,
                  subAgentDurationMs: extendedMsg.subAgentDurationMs,
                  subAgentTokens: extendedMsg.subAgentTokens,
                  subAgentToolUseCount: extendedMsg.subAgentToolUseCount,
                  subAgentResultText: extendedMsg.subAgentResultText,
                } : {}),
              };
              updated[lastIdx] = {
                ...lastMsg,
                contentBlocks: updatedBlocks,
              };
              return updated;
            }
          }

          // task_notification：如果携带 toolUseId，更新对应的 SubAgentBlock 状态
          if (extendedMsg.type === 'task_notification' && extendedMsg.toolUseId) {
            const subAgentIdx = blocks.findIndex(b => b.toolUseId === extendedMsg.toolUseId && b.isSubAgent);
            if (subAgentIdx >= 0) {
              const updatedBlocks = [...blocks];
              updatedBlocks[subAgentIdx] = {
                ...updatedBlocks[subAgentIdx],
                taskId: extendedMsg.taskId,
                taskStatus: extendedMsg.taskStatus,
                subAgentStatus: extendedMsg.taskStatus === 'completed' ? 'completed'
                  : extendedMsg.taskStatus === 'failed' ? 'failed'
                  : extendedMsg.taskStatus === 'stopped' ? 'failed'
                  : updatedBlocks[subAgentIdx].subAgentStatus,
              };
              updated[lastIdx] = {
                ...lastMsg,
                contentBlocks: updatedBlocks,
              };
              return updated;
            }
            // 没找到对应的 SubAgentBlock，作为独立块添加（fallthrough）
          }

          // 对于 thinking 类型，合并到最后一个 thinking 块
          if (extendedMsg.type === 'thinking' && blocks.length > 0 && blocks[blocks.length - 1].type === 'thinking') {
            const lastBlock = blocks[blocks.length - 1];
            const mergedBlock: ContentBlock = {
              ...lastBlock,
              content: (lastBlock.content || '') + (extendedMsg.content || ''),
            };
            updated[lastIdx] = {
              ...lastMsg,
              contentBlocks: [...blocks.slice(0, -1), mergedBlock],
              isStreaming: true,
            };
            return updated;
          }

          // 对于文本类型，如果最后一个块也是 text，合并它们而不是创建新块
          if (extendedMsg.type === 'text' && blocks.length > 0 && blocks[blocks.length - 1].type === 'text') {
            // 合并到最后一个文本块
            const lastBlock = blocks[blocks.length - 1];
            const mergedBlock: ContentBlock = {
              ...lastBlock,
              content: (lastBlock.content || '') + (extendedMsg.content || ''),
            };
            updated[lastIdx] = {
              ...lastMsg,
              contentBlocks: [...blocks.slice(0, -1), mergedBlock],
              content: (lastMsg.content || '') + (extendedMsg.content || ''),
              isStreaming: true, // 文本类型继续保持流式状态
            };
          } else {
            // tool_result 不作为独立块添加，结果已通过上面的逻辑整合到 tool_use 块中
            if (extendedMsg.type === 'tool_result') {
              console.log('⚠️ tool_result 未找到对应 tool_use，忽略:', extendedMsg.toolUseId);
              return updated;
            }

            // tool_use 类型：查找同 toolUseId 的已有块并更新（统一逻辑，和历史加载一致）
            if (extendedMsg.type === 'tool_use' && extendedMsg.toolUseId) {
              const existingIdx = blocks.findIndex(
                b => b.toolUseId === extendedMsg.toolUseId
              );
              if (existingIdx >= 0) {
                // 更新已有块：只在有新 input 时覆盖（避免 progress 事件的 null 覆盖已有 input）
                const existingBlock = blocks[existingIdx];
                const updatedBlocks = [...blocks];
                updatedBlocks[existingIdx] = {
                  ...existingBlock,
                  type: 'tool_use',
                  toolName: extendedMsg.toolName || existingBlock.toolName,
                  toolInput: extendedMsg.toolInput ?? existingBlock.toolInput,
                  timestamp: extendedMsg.timestamp || Date.now(),
                };
                updated[lastIdx] = {
                  ...lastMsg,
                  contentBlocks: updatedBlocks,
                  isStreaming: true,
                };
                return updated;
              }
            }

            // 检测 Agent 工具调用
            const isAgentTool = extendedMsg.type === 'tool_use' && extendedMsg.toolName === 'Agent';

            // 创建新块
            const newBlock: ContentBlock = {
              type: extendedMsg.type,
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
              // Hook 事件相关字段
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
              // compact_boundary 相关字段
              compactTrigger: extendedMsg.compactTrigger,
              compactPreTokens: extendedMsg.compactPreTokens,
              // 子代理标记（Agent tool_use）
              ...(isAgentTool ? {
                isSubAgent: true,
                subAgentDescription: extendedMsg.toolInput?.description,
                subAgentType: extendedMsg.toolInput?.subagent_type,
              } : {}),
            };

            updated[lastIdx] = {
              ...lastMsg,
              contentBlocks: [...blocks, newBlock],
              // 对于文本类型，同时更新 content 字段以保持兼容
              content: extendedMsg.type === 'text'
                ? (lastMsg.content || '') + (extendedMsg.content || '')
                : lastMsg.content,
              isStreaming: extendedMsg.type !== 'result'  // 收到结果时结束流式状态
            };
          }
        } else {
          // tool_result 不应创建新的助手消息
          if (extendedMsg.type === 'tool_result') {
            return updated;
          }

          // 检测 Agent 工具调用
          const isAgentTool = extendedMsg.type === 'tool_use' && extendedMsg.toolName === 'Agent';

          // 创建新的助手消息
          console.log('  → 创建新的助手消息');
          const newBlock: ContentBlock = {
            type: extendedMsg.type,
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
            // Hook 事件相关字段
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
            // 子代理标记（Agent tool_use）
            ...(isAgentTool ? {
              isSubAgent: true,
              subAgentDescription: extendedMsg.toolInput?.description,
              subAgentType: extendedMsg.toolInput?.subagent_type,
            } : {}),
          };

          const newMessage: Message = {
            role: 'assistant',
            content: extendedMsg.type === 'text' ? (extendedMsg.content || '') : '',
            timestamp: Date.now(),
            isStreaming: extendedMsg.type !== 'result',
            contentBlocks: [newBlock],
            model: extendedMsg.model,
          };
          updated.push(newMessage);
        }

        return updated;
      });

      // 收到结果消息时结束加载状态
      if (extendedMsg.type === 'result') {
        setIsLoading(false);
        setHistoryLoaded(true);  // 确保历史加载标记已设置
      }
    });

    return () => {
      unsubscribe();
    };
  }, [sessionId, showReplayMessages]);
}
