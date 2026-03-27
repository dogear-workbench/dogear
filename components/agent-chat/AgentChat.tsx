import { useState, useEffect, useRef, useMemo } from 'react';
import { ChevronRight, Archive } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { client } from '@/lib/client';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useSessionStore } from '@/stores/session-store';
import { useUIStore } from '@/stores/ui-store';
import type { AgentChatProps } from './types';
import { MessageItem } from './MessageItem';
import { ChatInputArea } from './ChatInputArea';
import { useMessageHistory } from './hooks/useMessageHistory';
import { useAgentSession } from './hooks/useAgentSession';
import { useSessionMessages } from './hooks/useSessionMessages';
import { useSessionEvents } from './hooks/useSessionEvents';
import { useImageAttachment } from './hooks/useImageAttachment';
import { useSendMessage } from './hooks/useSendMessage';
import { useSlashCommands } from './hooks/useSlashCommands';
import { StreamingIndicator } from './StreamingIndicator';

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
  conversationIdOverride,
}: AgentChatProps) {
  // UI 状态
  const togglePromptSidebar = useUIStore((s) => s.togglePromptSidebar);

  // 从 store 获取状态
  const bookId = useWorkspaceStore((s) => s.selectedBook?.id);
  const workspaceId = useWorkspaceStore((s) => s.workspace?.id);
  const storeConversationId = useConversationStore((s) => s.selectedConversation?.id) || null;
  // 多标签页模式下使用 override，否则使用 store 中的选中对话
  const conversationId = conversationIdOverride || storeConversationId;
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

  // 同步 isLoading 到 session-store（标签页运行状态）
  useEffect(() => {
    if (conversationId) {
      useSessionStore.getState().updateStreaming(conversationId, isLoading);
    }
  }, [isLoading, conversationId]);

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

  // 斜杠命令
  const slashCommands = useSlashCommands({
    sessionId,
    input: sendMessage.input,
  });

  // 选择命令时更新 input
  const handleSlashCommandSelect = (cmd: import('@/stores/slash-command-store').SlashCommandInfo) => {
    const newInput = slashCommands.handleSlashCommandSelect(cmd);
    sendMessage.setInput(newInput);
  };

  // 自动滚动到底部
  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  return (
    <div className="flex flex-col h-full bg-white rounded-lg border">
      {/* 消息区域：overflow-hidden 确保 flex-1 高度被约束，ScrollArea 内部产生滚动 */}
      <ScrollArea className="flex-1 overflow-hidden">
        <div className="px-4">
        {messages.length === 0 && (
          <div className="text-center text-gray-500 mt-20">
            <p>开始与 Agent 对话...</p>
          </div>
        )}

        {(() => {
          // 找到最后一个 compact_boundary 的位置
          const lastCompactIdx = messages.reduce(
            (acc, m, i) => m.isCompactBoundary ? i : acc, -1
          );
          // 仅最后一条用户消息可编辑重发，历史消息只读
          const lastUserIdx = messages.reduce((acc, m, i) => m.role === 'user' ? i : acc, -1);

          // 渲染单条消息的辅助函数
          const renderMessage = (message: typeof messages[0], index: number) => (
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
          );

          if (lastCompactIdx > 0) {
            // 有压缩历史：压缩边界之前的消息折叠
            const beforeCompact = messages.slice(0, lastCompactIdx);
            const compactBoundary = messages[lastCompactIdx];
            const afterCompact = messages.slice(lastCompactIdx + 1);
            return (
              <>
                {/* 折叠的历史消息 */}
                <Collapsible>
                  <CollapsibleTrigger className="flex items-center gap-2 w-full px-3 py-2 my-2 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors cursor-pointer">
                    <Archive size={14} />
                    <span>查看 {beforeCompact.length} 条历史消息</span>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="opacity-70">
                      {beforeCompact.map((msg, i) => renderMessage(msg, i))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                {/* 压缩分隔线（compactBoundary 的 contentBlocks 中已有 compact_boundary 块） */}
                {renderMessage(compactBoundary, lastCompactIdx)}

                {/* 压缩后的消息正常渲染 */}
                {afterCompact.map((msg, i) => renderMessage(msg, lastCompactIdx + 1 + i))}
              </>
            );
          }

          // 无压缩历史：正常渲染所有消息
          return messages.map((message, index) => renderMessage(message, index));
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

        {/* 运行状态指示器 */}
        <StreamingIndicator
          isLoading={isLoading}
          lastBlockType={
            messages[messages.length - 1]?.contentBlocks?.slice(-1)[0]?.type
          }
        />

        <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

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
        isSlashMenuOpen={slashCommands.isSlashMenuOpen}
        filteredCommands={slashCommands.filteredCommands}
        filterQuery={slashCommands.filterQuery}
        onSlashCommandSelect={handleSlashCommandSelect}
        onSlashMenuClose={slashCommands.closeSlashMenu}
        onTogglePromptSidebar={togglePromptSidebar}
      />
    </div>
  );
}
