'use client';

import { useState, useEffect } from 'react';
import { TaskType } from '@/types/agents';

/**
 * Agent 聊天组件
 * 可复用的聊天界面组件
 *
 * 使用场景:
 * - 在主窗口的任何页面中使用
 * - 在调试窗口中使用
 * - 作为其他组件的子组件
 */

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
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

  // 调试:检查 API 是否可用
  useEffect(() => {
    console.log('window.electronAPI:', window.electronAPI);
    console.log('window.electronAPI.agent:', window.electronAPI?.agent);
  }, []);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input;
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage, timestamp: Date.now() }]);
    setIsLoading(true);

    try {
      // 通过 Agent 系统发送消息
      const response = await window.electronAPI.agent.submitTask({
        id: '', // id 会在 Agent Manager 中生成
        type: TaskType.CHAT,
        payload: {
          messages: [
            {
              role: 'user',
              content: userMessage
            }
          ],
          context // 传递上下文信息
        },
        status: 'pending' as any,
        createdAt: Date.now()
      });

      const taskId = response.taskId;

      // 监听任务更新
      const unsubscribe = window.electronAPI.agent.onTaskUpdate((update) => {
        if (update.taskId === taskId) {
          if (update.status === 'completed' && update.result) {
            // 任务完成,添加助手消息
            setMessages(prev => [
              ...prev,
              {
                role: 'assistant',
                content: update.result.response || update.result.message || '',
                timestamp: Date.now()
              }
            ]);
            setIsLoading(false);
            unsubscribe();
          } else if (update.status === 'failed') {
            // 任务失败
            setMessages(prev => [
              ...prev,
              {
                role: 'system',
                content: `错误: ${update.error || '未知错误'}`,
                timestamp: Date.now()
              }
            ]);
            setIsLoading(false);
            unsubscribe();
          } else if (update.status === 'in_progress') {
            // 任务进行中
            console.log('任务进行中...');
          }
        }
      });
    } catch (error) {
      console.error('发送消息失败:', error);
      setMessages(prev => [
        ...prev,
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
              <div className="text-xs font-medium mb-1 opacity-70 capitalize">
                {message.role === 'user' ? '你' : message.role === 'system' ? '系统' : 'AI 助手'}
              </div>
              <div className="whitespace-pre-wrap break-words">{message.content}</div>
              {message.timestamp && (
                <div className="text-xs mt-2 opacity-50">
                  {new Date(message.timestamp).toLocaleTimeString()}
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
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
            disabled={isLoading}
          />
          <button
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors self-end"
          >
            发送
          </button>
        </div>
        {showStatusHint && (
          <div className="mt-2 text-xs text-gray-500">
            通过 Agent 系统: 主窗口 → IPC → Agent Manager → Agent Worker → Chat Skill → SDK query → Claude
          </div>
        )}
      </div>
    </div>
  );
}