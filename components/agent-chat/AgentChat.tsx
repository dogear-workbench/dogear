import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ChevronDown, Archive, GitBranch, Send } from 'lucide-react';
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
import { useSendMessage, type QueuedMessageEntry } from './hooks/useSendMessage';
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
  const globalForkParams = useConversationStore((s) => s.forkParams);
  // 仅处理属于当前对话的 forkParams，防止其他对话的 fork 触发本对话重建
  const forkParams = (globalForkParams?.targetConversationId && globalForkParams.targetConversationId !== conversationId)
    ? null
    : globalForkParams;
  const conversations = useConversationStore((s) => s.conversations);
  const selectedConv = useConversationStore((s) => s.selectedConversation);
  const selectConversation = useConversationStore((s) => s.selectConversation);

  // 分叉来源父对话标题
  const parentTitle = useMemo(() => {
    if (!selectedConv?.parent_conversation_id) return '';
    const parent = conversations.find(c => c.id === selectedConv.parent_conversation_id);
    return parent?.title || '未知对话';
  }, [selectedConv?.parent_conversation_id, conversations]);

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

  // 排队消息缓冲区：由 AgentChat 声明，同时传给 useSendMessage（写入）和 useSessionMessages（消费）
  // 必须在两个 hook 之前声明（React Hooks 顺序规则）
  const queuedMessagesRef = useRef<QueuedMessageEntry[]>([]);

  // ─── 滚动控制（需在 useSessionEvents 之前声明，供其闭包引用）───
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const isAtBottomRef = useRef(true);
  const [newMsgCount, setNewMsgCount] = useState(0);
  const prevMessageCount = useRef(0);
  // 滚动模式：auto=跟随底部, user=用户控制
  const scrollModeRef = useRef<'auto' | 'user'>('auto');
  // 程序化滚动标志：scrollTo 调用期间为 true，防止 handleScroll 误判为用户滚动
  const programmaticScrollRef = useRef(false);

  // 获取滚动视口元素
  const getViewportEl = useCallback(() => {
    return scrollAreaRef.current?.querySelector('[data-radix-scroll-area-viewport]') as HTMLElement | null;
  }, []);

  // 滚到底部
  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const el = getViewportEl();
    if (el) {
      programmaticScrollRef.current = true;
      el.scrollTo({ top: el.scrollHeight, behavior });
      setNewMsgCount(0);
      scrollModeRef.current = 'auto';
      isAtBottomRef.current = true;
      setIsAtBottom(true);
      // instant 没有动画，立即清除标志；smooth 需等动画结束后 handleScroll 检测到 atBottom 再清除
      if (behavior === 'instant') {
        programmaticScrollRef.current = false;
      }
    }
  }, [getViewportEl]);

  // 用户滚动检测
  const handleScroll = useCallback(() => {
    const el = getViewportEl();
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    isAtBottomRef.current = atBottom;
    setIsAtBottom(atBottom);

    if (programmaticScrollRef.current) {
      // 程序化滚动中：到达底部时清除标志，不切换模式
      if (atBottom) {
        programmaticScrollRef.current = false;
        setNewMsgCount(0);
        // scrollModeRef 已在 scrollToBottom/ResizeObserver 中设为 auto，无需重复
      }
      // 未到底部时忽略（动画过渡帧），不切 user
      return;
    }

    // 用户手动滚动
    if (atBottom) {
      setNewMsgCount(0);
      scrollModeRef.current = 'auto';
    } else {
      scrollModeRef.current = 'user';
    }
  }, [getViewportEl]);

  // 使用 ResizeObserver 监听消息容器高度变化，驱动自动滚动
  // 涵盖流式输出（contentBlocks 更新）和新消息追加两种场景
  useEffect(() => {
    const el = getViewportEl();
    if (!el) return;

    const contentEl = el.firstElementChild as HTMLElement | null;
    if (!contentEl) return;

    const observer = new ResizeObserver(() => {
      if (scrollModeRef.current === 'auto') {
        programmaticScrollRef.current = true;
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
        // smooth 动画结束后 handleScroll 检测到 atBottom 会清除 programmaticScrollRef
      } else if (messages.length > 0) {
        setNewMsgCount(prev => prev + 1);
      }
    });

    observer.observe(contentEl);
    return () => observer.disconnect();
  }, [getViewportEl, sessionId]);

  // 历史加载完成后（从无消息到有消息）自动滚到底部（无动画）
  useEffect(() => {
    if (prevMessageCount.current === 0 && messages.length > 0) {
      requestAnimationFrame(() => {
        scrollToBottom('instant');
      });
    }
    prevMessageCount.current = messages.length;
  }, [messages.length, scrollToBottom]);

  // 事件监听（完成、权限、AskUser、通知）
  useSessionEvents({
    sessionId,
    conversationId,
    setMessages,
    setIsLoading,
    setPermissionMode,
    onScrollToAction: () => {
      // 权限请求/AskUser 到达时，延迟 100ms 等 DOM 更新完成后滚到底部
      setTimeout(() => scrollToBottom('smooth'), 100);
    },
  });

  // 从 messages 的 ContentBlock 中提取子代理列表，按 conversationId 缓存到 ui-store
  const sdkSessionId = useConversationStore((s) => s.selectedConversation?.sdk_session_id);
  useEffect(() => {
    if (!conversationId || !sdkSessionId) return;
    // 遍历所有消息的 contentBlocks，提取 isSubAgent 的 block
    const agents: import('@/stores/ui-store').SubAgentInfo[] = [];
    for (const msg of messages) {
      if (!msg.contentBlocks) continue;
      for (const block of msg.contentBlocks) {
        if (!block.isSubAgent && block.toolName !== 'Agent') continue;
        if (!block.subAgentId) continue;
        if (agents.some(a => a.agentId === block.subAgentId)) continue;
        const hasOutput = block.toolOutput !== undefined || !!block.subAgentResultText;
        const isCompleted = block.subAgentStatus === 'completed' || hasOutput;
        const isFailed = block.subAgentStatus === 'failed' || block.isError;
        agents.push({
          agentId: block.subAgentId,
          sdkSessionId,
          description: block.subAgentDescription || block.toolInput?.description || '子代理任务',
          subagentType: block.subAgentType || block.toolInput?.subagent_type,
          status: isFailed ? 'failed' : isCompleted ? 'completed' : 'running',
          durationMs: block.subAgentDurationMs,
          tokens: block.subAgentTokens,
          toolUseCount: block.subAgentToolUseCount,
          resultText: block.subAgentResultText,
        });
      }
    }
    useUIStore.getState().setSubAgents(conversationId, agents);
  }, [messages, sdkSessionId, conversationId]);

  // 图片附件
  const imageAttachment = useImageAttachment();

  // 消息发送 + 分叉 + 权限响应
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
    queuedMessagesRef,
  });

  // 消息流处理（在 useSendMessage 之后调用，共享 queuedMessagesRef）
  useSessionMessages({
    sessionId,
    showReplayMessages,
    setMessages,
    setIsLoading,
    setHistoryLoaded,
    queuedMessagesRef,
    // 缓冲区消费后同步 React state（更新悬浮预览区）
    onQueueChanged: () => {
      sendMessage.setQueuedMessages([...queuedMessagesRef.current]);
    },
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

  return (
    <div className="flex flex-col h-full bg-white rounded-lg border">
      {/* 消息区域：overflow-hidden 确保 flex-1 高度被约束，ScrollArea 内部产生滚动 */}
      <div className="relative flex-1 overflow-hidden">
      <ScrollArea
        ref={scrollAreaRef}
        className="h-full"
        onScrollCapture={handleScroll}
      >
        <div className="px-4">
        {/* 分叉来源 Banner */}
        {selectedConv?.fork_pending && selectedConv?.parent_conversation_id && (
          <div className="flex items-center gap-2 px-3 py-2 my-2 rounded-lg bg-purple-50 border border-purple-200 text-xs text-purple-700">
            <GitBranch size={14} className="flex-shrink-0" />
            <span>分叉自: </span>
            <button
              onClick={async () => {
                const parentId = selectedConv.parent_conversation_id!;
                const parentConv = conversations.find(c => c.id === parentId);
                if (parentConv) {
                  await selectConversation(parentConv);
                }
              }}
              className="font-medium text-purple-800 hover:underline cursor-pointer"
            >
              {parentTitle}
            </button>
          </div>
        )}

        {messages.length === 0 && !selectedConv?.fork_pending && (
          <div className="text-center text-gray-500 mt-20">
            <p>开始与 Agent 对话...</p>
          </div>
        )}

        {(() => {
          // 找到最后一个 compact_boundary 的位置
          const lastCompactIdx = messages.reduce(
            (acc, m, i) => m.isCompactBoundary ? i : acc, -1
          );

          // 渲染单条消息的辅助函数
          const renderMessage = (message: typeof messages[0], index: number) => (
            <MessageItem
              key={index}
              message={message}
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

        {/* 运行状态指示器 */}
        <StreamingIndicator
          isLoading={isLoading}
          lastBlockType={
            messages[messages.length - 1]?.contentBlocks?.slice(-1)[0]?.type
          }
        />

        </div>
      </ScrollArea>

      {/* 跳到最新按钮 */}
      {!isAtBottom && (
        <button
          onClick={() => scrollToBottom()}
          className="absolute bottom-20 right-4 z-10 w-8 h-8 rounded-full bg-foreground/10 hover:bg-foreground/20 backdrop-blur-sm flex items-center justify-center transition-all shadow-sm"
        >
          <ChevronDown size={16} className="text-foreground/60" />
          {newMsgCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] flex items-center justify-center">
              {newMsgCount > 9 ? '9+' : newMsgCount}
            </span>
          )}
        </button>
      )}
      </div>

      {/* 排队消息悬浮预览区（消息已发后端排队，此处只读展示） */}
      {sendMessage.queuedMessages.length > 0 && (
        <div className="border-t bg-muted/20 px-4 py-2 space-y-1">
          <div className="text-xs text-muted-foreground mb-1">
            {sendMessage.queuedMessages.length} 条消息排队中
          </div>
          {sendMessage.queuedMessages.map((entry, index) => (
            <div
              key={index}
              className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-background border text-sm"
            >
              <Send size={12} className="flex-shrink-0 text-muted-foreground" />
              <span className="flex-1 truncate text-muted-foreground">
                {entry.displayMessage.content.length > 60
                  ? entry.displayMessage.content.slice(0, 60) + '...'
                  : entry.displayMessage.content}
              </span>
            </div>
          ))}
        </div>
      )}

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
