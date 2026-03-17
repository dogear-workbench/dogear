import { useState, useEffect } from 'react';
import { client } from '@/lib/client';
import { useWorkspaceStore } from '@/stores/workspace-store';
import type { ForkParams } from '@/stores/conversation-store';
import type { Message, ContentBlock } from '../types';

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
        console.log('🔀 Fork 模式，跳过 loadHistory，等待 SDK replay 消息流');
        setMessages([]);
        setHistoryLoaded(true);
        setIsResumeMode(true);
        return;
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

            // 转换 SDK 历史消息格式到组件消息格式
            // 第一步：收集所有 tool_result，建立 tool_use_id -> result 的映射
            const toolResultMap = new Map<string, { content: any; isError: boolean }>();
            for (const msg of historyResult.messages) {
              if (msg.type === 'user' && Array.isArray(msg.content)) {
                for (const block of msg.content) {
                  if (block && typeof block === 'object' && block.type === 'tool_result') {
                    const toolUseId = block.tool_use_id;
                    // 处理 content，可能是字符串或数组
                    let resultContent = block.content;
                    if (Array.isArray(resultContent)) {
                      // 如果是数组，提取文本内容
                      resultContent = resultContent
                        .map((item: any) => {
                          if (typeof item === 'string') return item;
                          if (item?.type === 'text') return item.text;
                          return JSON.stringify(item);
                        })
                        .join('\n');
                    }
                    toolResultMap.set(toolUseId, {
                      content: resultContent,
                      isError: block.is_error || false
                    });
                  }
                }
              }
            }
            console.log('工具结果映射:', toolResultMap.size, '个');

            // 第二步：收集 isMeta 消息（skill 内容），建立 sourceToolUseID -> content 的映射
            const skillContentMap = new Map<string, string>();
            for (const msg of historyResult.messages) {
              if (msg.isMeta && msg.sourceToolUseID && msg.type === 'user') {
                // 提取 skill 内容
                let skillContent = '';
                if (Array.isArray(msg.content)) {
                  for (const block of msg.content) {
                    if (block?.type === 'text') {
                      skillContent += block.text || '';
                    }
                  }
                }
                if (skillContent) {
                  skillContentMap.set(msg.sourceToolUseID, skillContent);
                }
              }
            }
            console.log('Skill 内容映射:', skillContentMap.size, '个');

            // 第三步：合并连续的 assistant 消息，处理特殊消息类型
            const historyMessages: Message[] = [];
            let currentAssistantMessage: Message | null = null;

            // 辅助：保存当前累积的 assistant 消息
            const flushAssistant = () => {
              if (currentAssistantMessage) {
                historyMessages.push(currentAssistantMessage);
                currentAssistantMessage = null;
              }
            };

            for (const msg of historyResult.messages) {
              const isUser = msg.type === 'user';
              const content = msg.content;

              // compact_boundary：插入压缩分隔标记
              if (msg.type === 'compact_boundary' || msg.isCompactBoundary) {
                flushAssistant();
                historyMessages.push({
                  role: 'assistant',
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
                });
                continue;
              }

              // isMeta 且有 sourceToolUseID 的消息：已在 skillContentMap 中收集，
              // 同时也作为 isMeta 消息渲染（区别于普通用户消息）
              if (msg.isMeta && isUser) {
                flushAssistant();
                // 提取文本内容
                let textContent = '';
                if (typeof content === 'string') {
                  textContent = content;
                } else if (Array.isArray(content)) {
                  for (const block of content) {
                    if (typeof block === 'string') textContent += block;
                    else if (block?.type === 'text') textContent += block.text || '';
                  }
                }
                // 跳过空的 isMeta 消息
                if (textContent.trim()) {
                  historyMessages.push({
                    role: 'user',
                    content: textContent,
                    timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
                    isMeta: true,
                    isCompactSummary: msg.isCompactSummary || false,
                  });
                }
                continue;
              }

              // 检查是否为空消息或只包含 tool_result 的用户消息
              let isEmpty = false;
              let onlyToolResult = false;
              if (isUser) {
                if (!content || (Array.isArray(content) && content.length === 0)) {
                  isEmpty = true;
                } else if (Array.isArray(content)) {
                  onlyToolResult = content.every((b: any) => b?.type === 'tool_result');
                }
              }

              // 跳过空的用户消息和只包含 tool_result 的用户消息
              if (isUser && (isEmpty || onlyToolResult)) {
                continue;
              }

              if (isUser) {
                // 用户消息：先保存之前的 assistant 消息
                flushAssistant();

                // 创建用户消息
                let textContent = '';
                if (typeof content === 'string') {
                  textContent = content;
                } else if (Array.isArray(content)) {
                  for (const block of content) {
                    if (typeof block === 'string') {
                      textContent += block;
                    } else if (block?.type === 'text') {
                      textContent += block.text || '';
                    }
                  }
                }

                // 跳过空文本的用户消息
                if (!textContent.trim()) {
                  continue;
                }

                // SDK 注入的系统消息（如中断提示）标记为 isMeta
                const isSystemInjected = textContent.includes('[Request interrupted by user]');

                historyMessages.push({
                  role: 'user',
                  content: textContent,
                  timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
                  isCompactSummary: msg.isCompactSummary || false,
                  ...(isSystemInjected ? { isMeta: true } : {}),
                });
              } else {
                // assistant 消息：合并到当前的 assistant 消息中
                const blocks: ContentBlock[] = [];
                let textContent = '';

                if (typeof content === 'string') {
                  textContent = content;
                  if (content) {
                    blocks.push({
                      type: 'text',
                      content,
                      timestamp: Date.now()
                    });
                  }
                } else if (Array.isArray(content)) {
                  for (const block of content) {
                    if (typeof block === 'string') {
                      textContent += block;
                      blocks.push({
                        type: 'text',
                        content: block,
                        timestamp: Date.now()
                      });
                    } else if (block && typeof block === 'object') {
                      if (block.type === 'text') {
                        textContent += block.text || '';
                        if (block.text) {
                          blocks.push({
                            type: 'text',
                            content: block.text || '',
                            timestamp: Date.now()
                          });
                        }
                      } else if (block.type === 'tool_use' || block.type === 'server_tool_use') {
                        // 工具调用块 - 查找关联的结果
                        const toolResult = toolResultMap.get(block.id);

                        // 对于 Skill 工具，还要查找关联的 skill 内容
                        let toolOutput = toolResult?.content;
                        if (block.name === 'Skill' && skillContentMap.has(block.id)) {
                          // 将 skill 内容作为工具输出的一部分
                          const skillContent = skillContentMap.get(block.id);
                          toolOutput = toolOutput
                            ? `${toolOutput}\n\n--- Skill 内容 ---\n${skillContent}`
                            : skillContent;
                        }

                        blocks.push({
                          type: 'tool_use',
                          id: block.id,
                          toolName: block.name,
                          toolInput: block.input,
                          toolUseId: block.id,
                          // 关联工具执行结果
                          toolOutput: toolOutput,
                          isError: toolResult?.isError || false,
                          // 历史加载的工具块，有 output 说明已完成
                          status: toolOutput !== undefined ? 'completed' : 'pending',
                          timestamp: Date.now()
                        });
                      } else if (block.type === 'thinking') {
                        // 思考块 - 历史加载时也渲染
                        blocks.push({
                          type: 'thinking',
                          content: block.thinking || '',
                          timestamp: Date.now()
                        });
                      } else if (block.type === 'image' && block.source) {
                        textContent += '[图片]';
                        blocks.push({
                          type: 'text',
                          content: '[图片]',
                          timestamp: Date.now()
                        });
                      }
                    }
                  }
                }

                // v4: 提取 assistant 消息的 UUID
                const assistantUuid = msg.uuid || undefined;

                // 合并到当前的 assistant 消息，或创建新的
                if (currentAssistantMessage) {
                  // 合并内容块
                  currentAssistantMessage.contentBlocks = [
                    ...(currentAssistantMessage.contentBlocks || []),
                    ...blocks
                  ];
                  currentAssistantMessage.content += textContent;
                  // 更新 uuid（使用最后一个 assistant 消息的 uuid）
                  if (assistantUuid) {
                    currentAssistantMessage.sdkUuid = assistantUuid;
                  }
                } else {
                  // 创建新的 assistant 消息
                  currentAssistantMessage = {
                    role: 'assistant',
                    content: textContent,
                    timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
                    contentBlocks: blocks.length > 0 ? blocks : undefined,
                    sdkUuid: assistantUuid,
                  };
                }
              }
            }

            // 保存最后一个 assistant 消息
            flushAssistant();

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
