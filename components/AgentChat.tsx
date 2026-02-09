'use client';

import { useState, useEffect, useRef } from 'react';
import { Citation } from '@/types/electron-api';

/**
 * Agent 聊天组件 v2
 * 使用主进程会话模式，会话生命周期与程序相同
 *
 * 核心特性：
 * - 使用 SDK 的 v2 API 在主进程中创建会话
 * - 显示完整的 AI 操作（工具调用、思考过程等）
 * - 内容占满整行，无气泡样式
 */

/**
 * 扩展的消息类型
 */
interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp?: number;
  isStreaming?: boolean;  // 是否正在流式输出中
  // 统一的内容块数组，按接收顺序存储所有内容
  // 可以是文本块、工具调用、思考等
  contentBlocks?: ContentBlock[];
  // 内部标记：是否需要保存到数据库
  needsSave?: boolean;
}

/**
 * 内容块类型
 * 按照实际接收顺序存储和渲染
 */
interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'status' | 'error' | 'result' | 'user';
  id?: string;
  content?: string;
  toolName?: string;
  toolInput?: any;
  toolOutput?: any;
  status?: string;
  error?: string;
  timestamp: number;
  citations?: Citation[];
  // 是否为重放的历史消息（SDK resume 时使用）
  isReplay?: boolean;
}

interface AgentChatProps {
  /**
   * 上下文信息(可选)
   */
  context?: {
    bookId?: string;
    chapterId?: string;
    selectedText?: string;
  };
  /**
   * 占位符文本
   */
  placeholder?: string;
  /**
   * 是否显示状态提示
   */
  showStatusHint?: boolean;
  /**
   * 对话ID（用于恢复之前的对话）
   */
  conversationId?: string | null;
  /**
   * 消息更新回调（用于保存消息到数据库）
   */
  onMessagesUpdate?: (messages: Message[]) => void;
  /**
   * 是否使用 SDK 的 resume 功能（默认 true）
   * - true: 使用 SDK resume，SDK 会自动重放历史消息
   * - false: 从数据库加载历史消息，不使用 resume
   */
  useSdkResume?: boolean;
  /**
   * 是否显示重放的历史消息（仅当 useSdkResume=true 时有效）
   */
  showReplayMessages?: boolean;
}

/**
 * 消息渲染组件
 * 显示用户消息或 AI 消息（包含工具调用等）
 */
function MessageItem({ message }: { message: Message }) {
  const isUser = message.role === 'user';

  return (
    <div className="w-full py-3 border-b border-gray-100 last:border-0">
      {isUser ? (
        // 用户消息
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
            <span className="text-white text-sm font-medium">你</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-gray-900 whitespace-pre-wrap break-words">
              {message.content}
            </div>
            {message.timestamp && (
              <div className="text-xs text-gray-400 mt-1">
                {new Date(message.timestamp).toLocaleTimeString()}
              </div>
            )}
          </div>
        </div>
      ) : (
        // AI 助手消息
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-emerald-600 flex items-center justify-center">
            <span className="text-white text-sm font-medium">AI</span>
          </div>
          <div className="flex-1 min-w-0">
            {/* 按照接收顺序渲染所有内容块 */}
            {message.contentBlocks && message.contentBlocks.length > 0 ? (
              <div className="space-y-2">
                {message.contentBlocks.map((block, idx) => (
                  <ContentBlockItem key={idx} block={block} />
                ))}
              </div>
            ) : message.content ? (
              // 兼容旧格式：直接显示文本内容
              <div className="text-sm text-gray-800 whitespace-pre-wrap break-words">
                {message.content}
              </div>
            ) : null}

            {/* 流式输出状态 */}
            {message.isStreaming && (!message.contentBlocks || message.contentBlocks.length === 0) && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <div className="flex space-x-1">
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></div>
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                  <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                </div>
                <span>思考中...</span>
              </div>
            )}

            {message.timestamp && (
              <div className="text-xs text-gray-400 mt-1">
                {new Date(message.timestamp).toLocaleTimeString()}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 内容块组件
 * 按照接收顺序渲染文本、工具调用、思考等内容
 */
function ContentBlockItem({ block }: { block: ContentBlock }) {
  switch (block.type) {
    case 'tool_use':
      return (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-800 mb-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            调用工具: {block.toolName}
          </div>
          {block.toolInput && (
            <pre className="text-xs bg-amber-100 rounded p-2 overflow-x-auto">
              {JSON.stringify(block.toolInput, null, 2)}
            </pre>
          )}
          {/* 显示工具调用中的引用信息 */}
          {block.citations && block.citations.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {block.citations.map((citation, idx) => (
                <CitationBadge key={idx} citation={citation} />
              ))}
            </div>
          )}
        </div>
      );

    case 'tool_result':
      return (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-green-800 mb-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            工具执行完成
          </div>
          {block.toolOutput && typeof block.toolOutput === 'string' && (
            <pre className="text-xs bg-green-100 rounded p-2 overflow-x-auto max-h-40 overflow-y-auto">
              {block.toolOutput}
            </pre>
          )}
        </div>
      );

    case 'status':
      return (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-2">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
            {block.status}
          </div>
        </div>
      );

    case 'thinking':
      return (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-purple-800 mb-2">
            <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse"></div>
            思考过程
          </div>
          {block.content && (
            <div className="text-xs text-purple-700 whitespace-pre-wrap bg-purple-100 rounded p-2">
              {block.content}
            </div>
          )}
        </div>
      );

    case 'error':
      return (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-red-800">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            错误: {block.error}
          </div>
        </div>
      );

    case 'result':
      // result 类型不显示任何内容，只是标志消息结束
      return null;

    case 'user':
      // 用户消息（来自 SDK 重放）
      return (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
          <div className="flex items-center gap-2 text-sm font-medium text-blue-800 mb-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            {block.isReplay && <span className="text-xs text-blue-500">(历史)</span>}
            用户消息
          </div>
          {block.content && (
            <div className="text-sm text-blue-700 whitespace-pre-wrap">
              {block.content}
            </div>
          )}
        </div>
      );

    case 'text':
    default:
      return block.content ? (
        <div className="text-sm text-gray-800 whitespace-pre-wrap">
          {block.content}
        </div>
      ) : null;
  }
}

/**
 * 引用徽章组件
 * 显示引用来源，支持点击跳转到原文位置
 */
function CitationBadge({ citation }: { citation: Citation }) {
  const handleClick = async () => {
    try {
      await window.electronAPI.book.jumpToPosition(
        citation.chapterId,
        citation.position
      );
    } catch (error) {
      console.error('跳转失败:', error);
    }  
  };

  return (
    <button
      onClick={handleClick}
      className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 hover:bg-blue-100
                 rounded text-xs text-blue-700 cursor-pointer transition-colors border border-blue-200"
      title={`点击跳转到: ${citation.chapterTitle}`}
    >
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
      </svg>
      <span className="font-medium">{citation.chapterTitle}</span>
      {citation.position && (
        <span className="text-gray-400">: {citation.position.start}-{citation.position.end}</span>
      )}
    </button>
  );
}

export function AgentChat({
  context,
  placeholder = '输入消息...',
  showStatusHint = true,
  conversationId,
  onMessagesUpdate,
  useSdkResume = true,
  showReplayMessages = true
}: AgentChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  // 会话 ID
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isSessionReady, setIsSessionReady] = useState(false);
  // 历史消息加载状态
  const [historyLoaded, setHistoryLoaded] = useState(false);
  // SDK resume 状态
  const [isResumeMode, setIsResumeMode] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // 加载历史消息（当 conversationId 变化时）
  useEffect(() => {
    const loadHistory = async () => {
      if (!conversationId) {
        setMessages([]);
        setHistoryLoaded(false);
        setIsResumeMode(false);
        return;
      }

      // 使用 SDK resume 模式时，从 SDK 的会话文件中读取历史消息
      if (useSdkResume) {
        console.log('使用 SDK resume 模式，从 SDK 会话文件加载历史...');

        try {
          // 获取对话信息，拿到 sdk_session_id
          const convResult = await window.electronAPI.conversations.getById(conversationId);
          const sdkSessionId = convResult.conversation?.sdk_session_id;

          if (sdkSessionId) {
            console.log('✅ 找到 sdk_session_id:', sdkSessionId);

            // 从 SDK 的会话文件中读取历史消息
            const historyResult = await window.electronAPI.queryBasedSession.getSdkSessionHistory(sdkSessionId);

            if (historyResult.error) {
              console.error('读取 SDK 会话历史失败:', historyResult.error);
              return;
            }

            // 转换 SDK 历史消息格式到组件消息格式
            const historyMessages: Message[] = historyResult.messages.map((msg) => {
              const message: Message = {
                role: msg.type === 'user' ? 'user' : 'assistant',
                // content 可能是字符串或数组
                content: '',
                timestamp: msg.timestamp ? new Date(msg.timestamp).getTime() : Date.now(),
                needsSave: false,  // 标记为不需要保存（从 SDK 加载的）
              };

              // 处理 content 数组或字符串
              if (typeof msg.content === 'string') {
                message.content = msg.content;
              } else if (Array.isArray(msg.content)) {
                // 将 SDK 的 content 数组转换为 contentBlocks
                const blocks: ContentBlock[] = [];
                let textContent = '';

                for (const block of msg.content) {
                  if (typeof block === 'string') {
                    // 纯字符串块
                    textContent += block;
                    blocks.push({
                      type: 'text',
                      content: block,
                      timestamp: Date.now()
                    });
                  } else if (block && typeof block === 'object') {
                    if (block.type === 'text') {
                      // 文本块
                      textContent += block.text || '';
                      blocks.push({
                        type: 'text',
                        content: block.text || '',
                        timestamp: Date.now()
                      });
                    } else if (block.type === 'tool_use' || block.type === 'server_tool_use') {
                      // 工具调用块
                      blocks.push({
                        type: 'tool_use',
                        id: block.id,
                        toolName: block.name,
                        toolInput: block.input,
                        timestamp: Date.now()
                      });
                    } else if (block.type === 'image' && block.source) {
                      // 图片块（对于用户消息）
                      textContent += '[图片]';
                      blocks.push({
                        type: 'text',
                        content: '[图片]',
                        timestamp: Date.now()
                      });
                    }
                  }
                }

                message.content = textContent;
                message.contentBlocks = blocks.length > 0 ? blocks : undefined;
              }

              return message;
            });

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

      // 传统模式：从数据库加载历史消息
      setIsResumeMode(false);

      try {
        // 先设置 historyLoaded 为 false，防止在加载期间保存消息
        setHistoryLoaded(false);

        const result = await window.electronAPI.conversations.getMessages(conversationId);
        if (result.error) {
          console.error('加载历史消息失败:', result.error);
          return;
        }

        // 转换数据库消息格式到组件消息格式
        const historyMessages: Message[] = result.messages.map((msg) => {
          const message: Message = {
            role: msg.role as 'user' | 'assistant',
            content: msg.content,
            timestamp: msg.timestamp,
            needsSave: false,  // 标记为不需要保存（从数据库加载的）
          };

          // 解析 content_blocks
          if (msg.content_blocks) {
            try {
              const blocks = JSON.parse(msg.content_blocks) as ContentBlock[];
              message.contentBlocks = blocks;
            } catch {
              // 解析失败，忽略 content_blocks
            }
          }

          return message;
        });

        setMessages(historyMessages);

        // 延迟设置 historyLoaded，确保消息状态已更新
        // 这样可以防止在加载过程中触发保存逻辑
        setTimeout(() => {
          setHistoryLoaded(true);
        }, 100);

        console.log('已从数据库加载历史消息:', historyMessages.length, '条');
      } catch (error) {
        console.error('加载历史消息失败:', error);
      }
    };

    loadHistory();
  }, [conversationId, useSdkResume]);

  // 启动会话
  useEffect(() => {
    const startSession = async () => {
      try {
        console.log('=== 启动基于 Query 的 Agent 会话 ===');
        console.log('conversationId:', conversationId);
        console.log('useSdkResume:', useSdkResume);

        // 自动确定项目根目录
        let projectRoot = '';
        if (typeof window !== 'undefined' && (window as any).process?.cwd) {
          projectRoot = (window as any).process.cwd();
        }

        // 如果有 conversationId，尝试获取 sdk_session_id 用于 resume
        let sdkSessionId: string | undefined;
        if (conversationId) {
          try {
            const convResult = await window.electronAPI.conversations.getById(conversationId);
            console.log('getById 结果:', convResult);
            if (convResult.conversation?.sdk_session_id) {
              sdkSessionId = convResult.conversation.sdk_session_id;
              console.log('✅ 找到 sdk_session_id，将 resume 会话:', sdkSessionId);
            } else {
              console.log('⚠️ 该对话没有 sdk_session_id，将创建新会话');
            }
          } catch (error) {
            console.error('❌ 获取 sdk_session_id 失败:', error);
          }
        }

        const response = await window.electronAPI.queryBasedSession.createSession({
          model: 'claude-sonnet-4-5-20250929',
          allowedTools: ['Read', 'Glob', 'Grep'],
          context,
          enableSkills: true,  // 启用 Skills
          projectRoot,  // 留空让 SDK 自动查找
          conversationId: conversationId || undefined,  // 传递 conversationId 用于保存 sdk_session_id
          resume: sdkSessionId  // 使用 resume 恢复会话
        });

        console.log('createSession 响应:', response);

        if (response.error) {
          console.error('❌ 启动会话失败:', response.error);
          return;
        }

        const newSessionId = response.sessionId!;
        setSessionId(newSessionId);
        console.log('✅ 会话已启动:', {
          sessionId: newSessionId,
          mode: sdkSessionId ? '(resume)' : '(new)',
          sdkMode: useSdkResume ? 'SDK模式' : '数据库模式'
        });
        setIsSessionReady(true);
      } catch (error) {
        console.error('❌ 启动会话异常:', error);
      }
    };

    startSession();

    // 组件卸载时关闭会话
    return () => {
      if (sessionId) {
        console.log('关闭会话:', sessionId);
        window.electronAPI.queryBasedSession.closeSession(sessionId);
      }
    };
  }, [conversationId]); // 当 conversationId 变化时重启会话

  // 监听会话消息
  useEffect(() => {
    if (!sessionId) return;

    const unsubscribe = window.electronAPI.queryBasedSession.onMessage((data) => {
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

        // 处理用户消息
        if (extendedMsg.type === 'user') {
          const newUserMessage: Message = {
            role: 'user',
            content: extendedMsg.content || '',
            timestamp: extendedMsg.timestamp || Date.now(),
            needsSave: !extendedMsg.isReplay,  // 重放消息不需要保存到数据库
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
              isStreaming: extendedMsg.type !== 'result',
            };
          } else {
            // 创建新块
            const newBlock: ContentBlock = {
              type: extendedMsg.type,
              content: extendedMsg.content,
              toolName: extendedMsg.toolName,
              toolInput: extendedMsg.toolInput,
              toolOutput: extendedMsg.toolOutput,
              status: extendedMsg.status,
              error: extendedMsg.error,
              timestamp: extendedMsg.timestamp || Date.now(),
              citations: extendedMsg.citations,
              isReplay: extendedMsg.isReplay,
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
          // 创建新的助手消息
          console.log('  → 创建新的助手消息');
          const newBlock: ContentBlock = {
            type: extendedMsg.type,
            content: extendedMsg.content,
            toolName: extendedMsg.toolName,
            toolInput: extendedMsg.toolInput,
            toolOutput: extendedMsg.toolOutput,
            status: extendedMsg.status,
            error: extendedMsg.error,
            timestamp: extendedMsg.timestamp || Date.now(),
            citations: extendedMsg.citations,
            isReplay: extendedMsg.isReplay,
          };

          const newMessage: Message = {
            role: 'assistant',
            content: extendedMsg.type === 'text' ? (extendedMsg.content || '') : '',
            timestamp: Date.now(),
            isStreaming: extendedMsg.type !== 'result',
            contentBlocks: [newBlock],
            needsSave: !extendedMsg.isReplay,  // 重放消息不需要保存
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

  // 监听会话完成事件
  useEffect(() => {
    if (!sessionId) return;

    const unsubscribe = window.electronAPI.queryBasedSession.onComplete((data) => {
      if (data.sessionId !== sessionId) return;

      console.log('收到会话完成事件:', data);

      // 结束加载状态
      setIsLoading(false);

      // 更新最后一条消息的流式状态
      setMessages(prev => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
          updated[lastIdx] = {
            ...updated[lastIdx],
            isStreaming: false
          };
        }
        return updated;
      });
    });

    return () => {
      unsubscribe();
    };
  }, [sessionId]);

  // 监听消息变化，保存完整的助手消息到数据库
  useEffect(() => {
    if (!conversationId || messages.length === 0) return;

    const lastMessage = messages[messages.length - 1];

    // 只保存非流式状态的消息（已完成），且是从数据库加载之后产生的消息
    // 通过检查是否在加载历史消息完成之后产生的
    if (lastMessage.role === 'assistant' && !lastMessage.isStreaming && historyLoaded) {
      // 只保存有 needsSave 标志的消息（新消息）
      // 从数据库加载的消息没有 needsSave 标志，不会被保存
      if ('needsSave' in lastMessage && !lastMessage.needsSave) {
        // 从数据库加载的消息，不需要保存
        return;
      }

      // 保存助手消息到数据库
      const saveMessage = async () => {
        try {
          await window.electronAPI.conversations.addMessage({
            conversation_id: conversationId,
            role: 'assistant',
            content: lastMessage.content,
            content_blocks: lastMessage.contentBlocks
              ? JSON.stringify(lastMessage.contentBlocks)
              : undefined,
            timestamp: lastMessage.timestamp || Date.now()
          });

          // 通知父组件消息已更新
          if (onMessagesUpdate) {
            onMessagesUpdate(messages);
          }
        } catch (error) {
          console.error('保存助手消息失败:', error);
        }
      };

      // 使用防抖，避免频繁保存
      const timeoutId = setTimeout(saveMessage, 500);
      return () => clearTimeout(timeoutId);
    }
  }, [messages, conversationId, onMessagesUpdate, historyLoaded]);

  const handleSend = async () => {
    if (!input.trim() || isLoading || !sessionId || !isSessionReady) return;

    const userMessage = input;
    setInput('');

    // ==================== 前端发送消息日志 ====================
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║                    [前端] 发送用户消息                          ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('  Session ID:', sessionId?.substring(0, 8));
    console.log('  消息长度:', userMessage.length, '字符');
    console.log('  消息内容:', userMessage);
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('');

    // 创建用户消息对象
    const newUserMessage: Message = {
      role: 'user',
      content: userMessage,
      timestamp: Date.now()
    };

    // 添加用户消息
    setMessages(prev => [...prev, newUserMessage]);

    // 添加一个空的助手消息占位，准备接收流式响应
    setMessages(prev => [
      ...prev,
      {
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
        contentBlocks: []
      }
    ]);

    // 如果有 conversationId，保存用户消息到数据库
    if (conversationId) {
      try {
        await window.electronAPI.conversations.addMessage({
          conversation_id: conversationId,
          role: 'user',
          content: userMessage,
          timestamp: Date.now()
        });
      } catch (error) {
        console.error('保存用户消息失败:', error);
      }
    }

    setIsLoading(true);

    try {
      // 发送消息到会话
      await window.electronAPI.queryBasedSession.sendMessage(sessionId, userMessage);
    } catch (error) {
      console.error('发送消息失败:', error);
      setMessages(prev => [
        ...prev.slice(0, -1), // 移除占位消息
        {
          role: 'assistant',
          content: `错误: ${error instanceof Error ? error.message : String(error)}`,
          timestamp: Date.now(),
          contentBlocks: [{
            type: 'error',
            error: error instanceof Error ? error.message : String(error),
            timestamp: Date.now()
          }]
        }
      ]);
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-lg border">
      {/* 消息区域 */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-20">
            <p>开始与 Agent 对话...</p>
          </div>
        )}

        {messages.map((message, index) => (
          <MessageItem key={index} message={message} />
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* 输入区域 */}
      <div className="border-t p-4 bg-gray-50">
        <div className="flex space-x-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder={placeholder}
            className="flex-1 border border-gray-300 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            rows={2}
            disabled={isLoading || !isSessionReady}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim() || !isSessionReady}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors self-end"
          >
            发送
          </button>
        </div>
        {showStatusHint && (
          <div className="mt-2 text-xs text-gray-500 flex items-center gap-2">
            <span>会话模式: {sessionId ? `已连接 (${sessionId.substring(0, 8)}...)` : '连接中...'}</span>
            {isSessionReady && <span className="text-green-600">● 就绪</span>}
          </div>
        )}
      </div>
    </div>
  );
}