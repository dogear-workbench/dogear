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
}

/**
 * 内容块类型
 * 按照实际接收顺序存储和渲染
 */
interface ContentBlock {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'status' | 'error' | 'result';
  id?: string;
  content?: string;
  toolName?: string;
  toolInput?: any;
  toolOutput?: any;
  status?: string;
  error?: string;
  timestamp: number;
  citations?: Citation[];
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
  showStatusHint = true
}: AgentChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  // 会话 ID
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isSessionReady, setIsSessionReady] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // 启动会话
  useEffect(() => {
    const startSession = async () => {
      try {
        console.log('启动基于 Query 的 Agent 会话...');

        // 自动确定项目根目录
        let projectRoot = '';
        if (typeof window !== 'undefined' && (window as any).process?.cwd) {
          projectRoot = (window as any).process.cwd();
        }

        const response = await window.electronAPI.queryBasedSession.createSession({
          model: 'claude-sonnet-4-5-20250929',
          allowedTools: ['Read', 'Glob', 'Grep'],
          context,
          enableSkills: true,  // 启用 Skills
          projectRoot  // 留空让 SDK 自动查找
        });

        if (response.error) {
          console.error('启动会话失败:', response.error);
          return;
        }

        const newSessionId = response.sessionId!;
        setSessionId(newSessionId);
        console.log('会话已启动:', newSessionId);
        setIsSessionReady(true);
      } catch (error) {
        console.error('启动会话失败:', error);
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
  }, []); // 只在组件挂载时执行一次

  // 监听会话消息
  useEffect(() => {
    if (!sessionId) return;

    const unsubscribe = window.electronAPI.queryBasedSession.onMessage((data) => {
      if (data.sessionId !== sessionId) return;

      const extendedMsg = data.message;
      console.log('收到会话消息:', extendedMsg);

      setMessages(prev => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;

        if (lastIdx >= 0 && updated[lastIdx].role === 'assistant' && updated[lastIdx].isStreaming) {
          // 更新最后一条流式消息
          const lastMsg = updated[lastIdx];
          const blocks = lastMsg.contentBlocks || [];

          // 将收到的消息转换为内容块并追加
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
        } else {
          // 创建新的助手消息
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
          };

          const newMessage: Message = {
            role: 'assistant',
            content: extendedMsg.type === 'text' ? (extendedMsg.content || '') : '',
            timestamp: Date.now(),
            isStreaming: extendedMsg.type !== 'result',
            contentBlocks: [newBlock]
          };
          updated.push(newMessage);
        }

        return updated;
      });

      // 收到结果消息时结束加载状态
      if (extendedMsg.type === 'result') {
        setIsLoading(false);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [sessionId]);

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

  const handleSend = async () => {
    if (!input.trim() || isLoading || !sessionId || !isSessionReady) return;

    const userMessage = input;
    setInput('');

    // 添加用户消息
    setMessages(prev => [
      ...prev,
      { role: 'user', content: userMessage, timestamp: Date.now() }
    ]);

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