import { useState, useEffect } from 'react';
import { client } from '@/lib/client';
import { useWorkspaceStore } from '@/stores/workspace-store';
import type { ForkParams } from '@/stores/conversation-store';
import type { Message } from '../types';
import { historyTransformer } from '../transformers';

interface UseMessageHistoryParams {
  conversationId: string | null;
  useSdkResume: boolean;
  forkParams: ForkParams | null;
  workspacePath: string;
}

/**
 * 历史消息加载 Hook
 * 当 conversationId 变化时，从 SDK 会话文件加载历史消息
 */
export function useMessageHistory({ conversationId, useSdkResume, forkParams, workspacePath }: UseMessageHistoryParams) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [isResumeMode, setIsResumeMode] = useState(false);

  // 加载历史消息（当 conversationId 变化时）
  useEffect(() => {
    const loadHistory = async () => {
      if (!conversationId) {
        setMessages([]);
        setHistoryLoaded(false);
        setIsResumeMode(false);
        return;
      }

      // fork 模式下跳过历史加载：
      // 新对话的 sdk_session_id 尚未写入数据库，此时读取必然失败。
      // fork 会话启动后，SDK 会通过 replay 消息流自动推送截断历史。
      if (forkParams) {
        console.log('🔀 Fork 模式，跳过 loadHistory，保留当前消息等待 SDK replay');
        // 不清空消息，保留当前显示的历史，SDK replay 到来后自然追加
        setHistoryLoaded(true);
        setIsResumeMode(true);
        return;
      }

      // fork_pending 模式：加载父对话截断历史（只读展示）
      if (!forkParams && conversationId) {
        try {
          const pendingCheckResult = await client.getById({ conversationId, workspaceId: useWorkspaceStore.getState().workspace?.id || '' });
          const pendingConv = pendingCheckResult.conversation;

          if (pendingConv?.fork_pending && pendingConv.parent_conversation_id) {
            console.log('⏳ fork_pending 模式，加载父对话截断历史');
            const parentResult = await client.getById({
              conversationId: pendingConv.parent_conversation_id,
              workspaceId: useWorkspaceStore.getState().workspace?.id || '',
            });
            const parentSdkSessionId = parentResult.conversation?.sdk_session_id;

            if (parentSdkSessionId) {
              const historyResult = await client.getSdkSessionHistory({
                sdkSessionId: parentSdkSessionId,
                projectPath: workspacePath || undefined,
              });

              if (!historyResult.error && historyResult.messages) {
                const forkUuid = pendingConv.fork_message_sdk_uuid;
                let truncatedMsgs = historyResult.messages;
                if (forkUuid) {
                  const forkIdx = truncatedMsgs.findIndex((m: any) => m.uuid === forkUuid);
                  if (forkIdx >= 0) {
                    truncatedMsgs = truncatedMsgs.slice(0, forkIdx + 1);
                  }
                }

                // 简单转换：提取用户和 assistant 消息文本
                const previewMessages: Message[] = [];
                for (const msg of truncatedMsgs) {
                  if (msg.type === 'compact_boundary' || msg.isCompactBoundary) continue;
                  if (msg.isMeta) continue;

                  const isUserMsg = msg.type === 'user';
                  const content = msg.content;
                  let textContent = '';
                  if (typeof content === 'string') {
                    textContent = content;
                  } else if (Array.isArray(content)) {
                    for (const block of content) {
                      if (typeof block === 'string') textContent += block;
                      else if (block?.type === 'text') textContent += block.text || '';
                    }
                  }
                  if (!textContent.trim()) continue;
                  if (isUserMsg && Array.isArray(content) && content.every((b: any) => b?.type === 'tool_result')) continue;

                  previewMessages.push({
                    role: isUserMsg ? 'user' : 'assistant',
                    content: textContent,
                    timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
                    ...((!isUserMsg && msg.uuid) ? { sdkUuid: msg.uuid } : {}),
                  });
                }

                setMessages(previewMessages);
                console.log(`⏳ fork_pending: 加载了 ${previewMessages.length} 条父对话历史`);
              }
            }
            setHistoryLoaded(true);
            setIsResumeMode(false);
            return;
          }
        } catch (error) {
          console.error('检查 fork_pending 状态失败:', error);
        }
      }

      // 使用 SDK resume 模式时，从 SDK 的会话文件中读取历史消息
      if (useSdkResume) {
        console.log('使用 SDK resume 模式，从 SDK 会话文件加载历史...');

        try {
          // 获取对话信息，拿到 sdk_session_id
          const convResult = await client.getById({ conversationId, workspaceId: useWorkspaceStore.getState().workspace?.id || '' });
          const sdkSessionId = convResult.conversation?.sdk_session_id;

          if (sdkSessionId) {
            console.log('✅ 找到 sdk_session_id:', sdkSessionId);

            // 从 SDK 的会话文件中读取历史消息
            const historyResult = await client.getSdkSessionHistory({ sdkSessionId, projectPath: workspacePath || undefined });

            if (historyResult.error) {
              console.error('读取 SDK 会话历史失败:', historyResult.error);
              return;
            }

            // 转换 SDK 历史消息格式到组件消息格式（使用统一 transformer）
            const historyMessages = historyTransformer(historyResult.messages);

            setMessages(historyMessages);
            setTimeout(() => {
              setHistoryLoaded(true);
            }, 100);

            console.log(`✅ 已从 SDK 会话文件加载历史消息: ${historyMessages.length} 条`);
          } else {
            console.log('⚠️ 该对话没有 sdk_session_id，无法加载 SDK 历史消息');
            setMessages([]);
            setHistoryLoaded(true);
          }
        } catch (error) {
          console.error('加载 SDK 会话历史失败:', error);
          setMessages([]);
          setHistoryLoaded(true);
        }

        setIsResumeMode(true);
        return;
      }

      // 无 SDK resume 模式：新对话，空消息列表
      setIsResumeMode(false);
      setMessages([]);
      setHistoryLoaded(true);
    };

    loadHistory();
  }, [conversationId, useSdkResume, forkParams]);

  return { messages, setMessages, historyLoaded, setHistoryLoaded, isResumeMode };
}
