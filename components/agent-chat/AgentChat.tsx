import { useState, useEffect, useRef } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { client } from '@/lib/client';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useConversationStore } from '@/stores/conversation-store';
import type { AgentChatProps } from './types';
import { MessageItem } from './MessageItem';
import { ChatInputArea } from './ChatInputArea';
import { useMessageHistory } from './hooks/useMessageHistory';
import { useAgentSession } from './hooks/useAgentSession';
import { useSessionMessages } from './hooks/useSessionMessages';
import { useSessionEvents } from './hooks/useSessionEvents';
import { useImageAttachment } from './hooks/useImageAttachment';
import { useSendMessage } from './hooks/useSendMessage';

/**
 * Agent 聊天组件
 * 使用主进程会话模式，会话生命周期与程序相同
 *
 * 核心特性：
 * - 使用 SDK 的 v2 API 在主进程中创建会话
 * - 显示完整的 AI 操作（工具调用、思考过程等）
 * - 内容占满整行，无气泡样式
 */
export function AgentChat({
  placeholder = '输入消息...',
  showStatusHint = true,
  useSdkResume = true,
  showReplayMessages = true,
}: AgentChatProps) {
  // 从 store 获取状态
  const bookId = useWorkspaceStore((s) => s.selectedBook?.id);
  const workspaceId = useWorkspaceStore((s) => s.workspace?.id);
  const conversationId = useConversationStore((s) => s.selectedConversation?.id) || null;
  const forkParams = useConversationStore((s) => s.forkParams);

  // 构建 context 对象
  const context = { bookId, workspaceId, chapterId: undefined, selectedText: undefined };

  // 获取默认工作区路径
  const [workspacePath, setWorkspacePath] = useState('');
  useEffect(() => {
    client.getDefault().then((ws) => {
      if (ws?.path) setWorkspacePath(ws.path);
    });
  }, []);

  // 加载状态
  const [isLoading, setIsLoading] = useState(false);

  // 历史消息
  const { messages, setMessages, historyLoaded, setHistoryLoaded, isResumeMode } =
    useMessageHistory({ conversationId, useSdkResume, forkParams, workspacePath });

  // 会话生命周期
  const { sessionId, sessionIdRef, isSessionReady, permissionMode, setPermissionMode } =
    useAgentSession({ conversationId, forkParams, context, useSdkResume, setMessages, setIsLoading });

  // 消息流处理
  useSessionMessages({ sessionId, showReplayMessages, setMessages, setIsLoading, setHistoryLoaded });

  // 事件监听（完成、权限、AskUser、通知）
  useSessionEvents({ sessionId, setMessages, setIsLoading, setPermissionMode });

  // 图片附件
  const imageAttachment = useImageAttachment();

  // 消息发送 + 编辑重发 + 分叉 + 权限响应
  const sendMessage = useSendMessage({
    sessionId,
    isSessionReady,
    isLoading,
    messages,
    setMessages,
    setIsLoading,
    permissionMode,
    setPermissionMode,
    conversationId,
    pendingImages: imageAttachment.pendingImages,
    setPendingImages: imageAttachment.setPendingImages,
  });

  // 自动滚动到底部
  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex flex-col h-full bg-white rounded-lg border">
      {/* 消息区域 */}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-20">
            <p>开始与 Agent 对话...</p>
          </div>
        )}

        {(() => {
          // 仅最后一条用户消息可编辑重发，历史消息只读
          const lastUserIdx = messages.reduce((acc, m, i) => m.role === 'user' ? i : acc, -1);
          return messages.map((message, index) => (
            <MessageItem
              key={index}
              message={message}
              messageIndex={index}
              onEditResend={index === lastUserIdx ? sendMessage.handleEditResend : undefined}
              onFork={sendMessage.handleFork}
              sessionId={sessionId}
              onPermissionResolved={sendMessage.handlePermissionResolved}
              onAskUserResolved={sendMessage.handleAskUserResolved}
            />
          ));
        })()}

        {/* Plan 模式下，assistant 完成输出后显示"执行计划"按钮 */}
        {permissionMode === 'plan' && !isLoading && messages.length > 0 && messages[messages.length - 1]?.role === 'assistant' && !messages[messages.length - 1]?.isStreaming && (
          <div className="flex justify-center py-3">
            <Button
              onClick={async () => {
                // 切换到"允许编辑"模式
                setPermissionMode('acceptEdits');
                if (sessionId) {
                  await client.setPermissionMode({ sessionId, mode: 'acceptEdits' });
                  sendMessage.insertModeChangeNotice('acceptEdits');
                  // 发送执行指令
                  setMessages(prev => [...prev, {
                    role: 'user' as const,
                    content: '请执行上面的计划',
                    timestamp: Date.now(),
                  }, {
                    role: 'assistant' as const,
                    content: '',
                    timestamp: Date.now(),
                    isStreaming: true,
                    contentBlocks: [],
                  }]);
                  setIsLoading(true);
                  try {
                    await client.sendQueryBasedSessionMessage({ sessionId, content: '请执行上面的计划' });
                  } catch (error) {
                    console.error('执行计划失败:', error);
                    setIsLoading(false);
                  }
                }
              }}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              <ChevronRight size={16} />
              执行计划
            </Button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 输入区域 */}
      <ChatInputArea
        input={sendMessage.input}
        setInput={sendMessage.setInput}
        isLoading={isLoading}
        isSessionReady={isSessionReady}
        sessionId={sessionId}
        placeholder={placeholder}
        showStatusHint={showStatusHint}
        thinkingLevel={sendMessage.thinkingLevel}
        setThinkingLevel={sendMessage.setThinkingLevel}
        permissionMode={permissionMode}
        setPermissionMode={setPermissionMode}
        hasPendingUserAction={sendMessage.hasPendingUserAction}
        pendingImages={imageAttachment.pendingImages}
        imageInputRef={imageAttachment.imageInputRef}
        handleSend={sendMessage.handleSend}
        handleKeyPress={sendMessage.handleKeyPress}
        handleImageFiles={imageAttachment.handleImageFiles}
        removePendingImage={imageAttachment.removePendingImage}
        insertModeChangeNotice={sendMessage.insertModeChangeNotice}
        setIsLoading={setIsLoading}
      />
    </div>
  );
}
