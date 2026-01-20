'use client';

import { useState, useEffect, useRef } from 'react';
import { TaskType } from '@/types/agents';

/**
 * Agent 聊天组件
 * 使用持续会话模式，保持对话连贯性
 *
 * 核心特性：
 * - 组件挂载时启动会话
 * - 通过 sendSessionMessage 发送消息到同一个会话
 * - 组件卸载时关闭会话
 */

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
  isStreaming?: boolean;  // 是否正在流式输出中
}

interface AgentChatProps {
  /**
   * 初始消息列表(可选)
   */
  initialMessages?: Message[];
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

export function AgentChat({
  initialMessages = [],
  context,
  placeholder = '输入消息...',
  showStatusHint = true
}: AgentChatProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
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
        console.log('启动 Agent 会话...');

        // 提交启动会话任务
        const response = await window.electronAPI.agent.submitTask({
          id: '',
          type: TaskType.CHAT_SESSION,
          payload: {
            action: 'start',
            context
          },
          status: 'pending' as any,
          createdAt: Date.now()
        });

        const newSessionId = response.taskId;
        setSessionId(newSessionId);
        console.log('会话已启动:', newSessionId);

        // 监听会话消息
        const unsubscribeSessionMessage = window.electronAPI.agent.onSessionMessage((data) => {
          if (data.sessionId === newSessionId) {
            console.log('收到会话消息:', data.message);

            // 更新最后一条助手消息
            setMessages(prev => {
              const updated = [...prev];
              const lastIdx = updated.length - 1;

              // 如果最后一条是助手消息且正在流式输出，追加内容
              if (lastIdx >= 0 && updated[lastIdx].role === 'assistant' && updated[lastIdx].isStreaming) {
                updated[lastIdx] = {
                  ...updated[lastIdx],
                  content: data.message,
                  isStreaming: false // 收到完整消息，结束流式状态
                };
              } else {
                // 添加新的助手消息
                updated.push({
                  role: 'assistant',
                  content: data.message,
                  timestamp: Date.now(),
                  isStreaming: false
                });
              }

              return updated;
            });

            setIsLoading(false);
          }
        });

        // 监听会话启动确认
        const unsubscribeTaskUpdate = window.electronAPI.agent.onTaskUpdate((update) => {
          if (update.taskId === newSessionId && update.status === 'completed') {
            console.log('会话准备就绪');
            setIsSessionReady(true);
          }
        });

        // 保存取消订阅函数
        return () => {
          unsubscribeSessionMessage();
          unsubscribeTaskUpdate();
        };
      } catch (error) {
        console.error('启动会话失败:', error);
      }
    };

    const cleanupPromise = startSession();

    // 组件卸载时关闭会话
    return () => {
      cleanupPromise.then(cleanup => {
        if (cleanup && sessionId) {
          console.log('关闭会话:', sessionId);
          window.electronAPI.agent.closeSession(sessionId);
        }
      });
    };
  }, []); // 只在组件挂载时执行一次

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
        isStreaming: true
      }
    ]);

    setIsLoading(true);

    try {
      // 发送消息到会话
      await window.electronAPI.agent.sendSessionMessage(sessionId, {
        role: 'user',
        content: userMessage
      });
    } catch (error) {
      console.error('发送消息失败:', error);
      setMessages(prev => [
        ...prev.slice(0, -1), // 移除占位消息
        {
          role: 'system',
          content: `错误: ${error instanceof Error ? error.message : String(error)}`,
          timestamp: Date.now()
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
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-20">
            <p>开始与 Agent 对话...</p>
          </div>
        )}

        {messages.map((message, index) => (
          <div
            key={index}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg p-3 ${
                message.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : message.role === 'system'
                  ? 'bg-yellow-100 text-yellow-900 border border-yellow-300'
                  : 'bg-gray-100 text-gray-900 border border-gray-200'
              }`}
            >
              <div className="text-xs font-medium mb-1 opacity-70 capitalize flex items-center gap-2">
                <span>{message.role === 'user' ? '你' : message.role === 'system' ? '系统' : 'AI 助手'}</span>
                {message.isStreaming && (
                  <span className="flex items-center">
                    <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                    <span className="text-xs opacity-70">思考中...</span>
                  </span>
                )}
              </div>
              <div className="whitespace-pre-wrap break-words">
                {message.content || (message.isStreaming && '...')}
              </div>
              {message.timestamp && (
                <div className="text-xs mt-2 opacity-50">
                  {new Date(message.timestamp).toLocaleTimeString()}
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && messages.length > 0 && messages[messages.length - 1].role !== 'assistant' && (
          <div className="flex justify-start">
            <div className="bg-gray-100 border border-gray-200 rounded-lg p-3">
              <div className="flex space-x-2">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
              </div>
            </div>
          </div>
        )}
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
