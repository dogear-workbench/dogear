import { useState, useEffect, useRef, useMemo } from 'react';
import { ChevronDown, Archive, GitBranch, Send, PanelRightOpen, PanelRightClose } from 'lucide-react';
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
import { useChatScroll } from './hooks/useChatScroll';
import { StreamingIndicator } from './StreamingIndicator';
import { SearchBar } from './SearchBar';
import { useMessageSearch } from './hooks/useMessageSearch';
import { MessageMinimap } from './MessageMinimap';
import { useToolRegistryStore } from '@/stores/tool-registry-store';

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
  rightPanelToggle,
}: AgentChatProps) {
  // UI 状态
  const togglePromptSidebar = useUIStore((s) => s.togglePromptSidebar);

  // 从 store 获取状态
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
  const context = { workspaceId, selectedText: undefined };

  // 预加载工具分类映射（供 ToolBlock/ToolGroupBlock 使用中文大类标签）
  useEffect(() => {
    useToolRegistryStore.getState().ensureLoaded();
  }, []);

  // 获取默认工作区路径
  const [workspacePath, setWorkspacePath] = useState('');
  useEffect(() => {
    client.getDefault().then((ws) => {
      if (ws?.path) setWorkspacePath(ws.path);
    });
  }, []);

  // 加载状态
  const [isLoading, setIsLoading] = useState(false);

  // SDK 0.2.119+：下一步建议气泡（临时 UI 状态，不跨会话持久化）
  const [promptSuggestion, setPromptSuggestion] = useState<string | null>(null);

  // 切换会话/对话时清空建议气泡
  useEffect(() => {
    setPromptSuggestion(null);
  }, [conversationId]);

  // Agent 开始新一轮（isLoading 转 true）时清空旧建议
  useEffect(() => {
    if (isLoading) setPromptSuggestion(null);
  }, [isLoading]);

  // 同步 isLoading 到 session-store（标签页运行状态）
  useEffect(() => {
    if (conversationId) {
      useSessionStore.getState().updateStreaming(conversationId, isLoading);
    }
  }, [isLoading, conversationId]);

  // 历史消息
  const { messages, setMessages, setHistoryLoaded } =
    useMessageHistory({ conversationId, useSdkResume, forkParams, workspacePath });

  // 会话生命周期
  const { sessionId, isSessionReady, permissionMode, setPermissionMode } =
    useAgentSession({ conversationId, forkParams, context, useSdkResume, setMessages, setIsLoading });

  // 排队消息缓冲区：由 AgentChat 声明，同时传给 useSendMessage（写入）和 useSessionMessages（消费）
  // 必须在两个 hook 之前声明（React Hooks 顺序规则）
  const queuedMessagesRef = useRef<QueuedMessageEntry[]>([]);

  // ─── 滚动控制（统一入口: useChatScroll）───
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const {
    showScrollBtn,
    scrollToBottom,
    scrollToMessage,
    scrollToElement,
    handleScroll,
  } = useChatScroll({ scrollAreaRef, isLoading });

  // 事件监听（完成、权限、AskUser、通知）
  useSessionEvents({
    sessionId,
    conversationId,
    setMessages,
    setIsLoading,
    setPermissionMode,
    onScrollToAction: () => {
      // 权限请求/AskUser 到达时，延迟等 DOM 更新完成后滚到底部
      requestAnimationFrame(() => scrollToBottom('smooth'));
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
        if (!block.isSubAgent && block.toolName !== 'Agent' && block.toolName !== 'Task') continue;
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
    onPromptSuggestion: (suggestion) => setPromptSuggestion(suggestion),
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

  // 消息搜索（传入 messages 以实时计算匹配）
  const search = useMessageSearch(messages);
  // 解构出稳定引用，避免 useEffect deps 依赖整个 search 对象
  const openSearch = search.open;

  // Ctrl+F 唤起搜索浮条
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        openSearch();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [openSearch]);

  // 搜索激活项切换时: 滚动到上 1/3 位置
  useEffect(() => {
    if (!search.activeMatch) return;
    const el = document.querySelector(`[data-match-id="${search.activeMatch.id}"]`) as HTMLElement | null;
    if (el) scrollToElement(el, { align: 'top-third' });
  }, [search.activeMatch?.id, scrollToElement]);

  return (
    <div className="relative flex flex-col h-full bg-white rounded-lg border">
      {/* SearchBar 挂在最外层 relative 容器，避免被内部 overflow-hidden 裁剪 */}
      <SearchBar
        isOpen={search.isOpen}
        query={search.query}
        setQuery={search.setQuery}
        totalMatches={search.matches.length}
        activeIndex={search.activeIndex}
        onPrev={search.prev}
        onNext={search.next}
        onClose={search.close}
      />
      {/* 消息区域：overflow-hidden 确保 flex-1 高度被约束，ScrollArea 内部产生滚动 */}
      <div className="relative flex-1 overflow-hidden">
      <ScrollArea
        ref={scrollAreaRef}
        className="h-full pr-12"
        onScrollCapture={handleScroll}
      >
        <div className="px-6">
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
              messageIndex={index}
              onFork={sendMessage.handleFork}
              sessionId={sessionId}
              onPermissionResolved={sendMessage.handlePermissionResolved}
              onAskUserResolved={sendMessage.handleAskUserResolved}
              searchQuery={search.query || undefined}
              activeMatchId={search.activeMatch?.id ?? null}
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

        {/* SDK 0.2.119+：下一步建议气泡（点击追加到输入框，临时状态） */}
        {promptSuggestion && !isLoading && (
          <div className="flex items-start gap-2 mt-2 mb-4">
            <button
              onClick={() => {
                const current = sendMessage.input;
                const sep = current && !current.endsWith(' ') && !current.endsWith('\n') ? ' ' : '';
                sendMessage.setInput(current + sep + promptSuggestion);
                setPromptSuggestion(null);
              }}
              className="group inline-flex items-start gap-2 max-w-[90%] px-3 py-2 rounded-2xl rounded-tl-sm bg-muted/60 hover:bg-muted text-left text-sm text-foreground/80 hover:text-foreground border border-border/40 transition-colors cursor-pointer"
              title="点击填入输入框"
            >
              <span className="text-xs mt-0.5 text-muted-foreground group-hover:text-foreground/70">💡</span>
              <span className="flex-1 leading-relaxed">{promptSuggestion}</span>
            </button>
          </div>
        )}

        </div>
      </ScrollArea>

      {/* 右侧工具轨道：w-12 透明浮层，顶部+底部两组按钮 */}
      <div className="absolute top-0 right-0 bottom-0 w-12 flex flex-col pointer-events-none z-10">
        {/* 顶部按钮组：右栏折叠 + Minimap */}
        <div className="flex flex-col gap-1 p-1 pointer-events-auto">
          {rightPanelToggle && (
            <button
              onClick={rightPanelToggle.onToggle}
              className="w-8 h-8 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title={rightPanelToggle.open ? '折叠预览面板' : '展开预览面板'}
            >
              {rightPanelToggle.open
                ? <PanelRightClose size={14} />
                : <PanelRightOpen size={14} />
              }
            </button>
          )}
          <MessageMinimap
            messages={messages}
            hidden={search.isOpen}
            scrollAreaRef={scrollAreaRef}
            onJumpToMessage={(idx) => scrollToMessage(idx, { align: 'top', flash: true })}
          />
        </div>

        {/* 底部按钮组：回到底部 */}
        <div className="mt-auto flex flex-col gap-1 p-1 pointer-events-auto">
          {showScrollBtn && (
            <button
              onClick={() => scrollToBottom()}
              className="w-8 h-8 flex items-center justify-center rounded-md bg-foreground/10 hover:bg-foreground/20 backdrop-blur-sm text-foreground/60 transition-colors shadow-sm"
              title="回到底部"
            >
              <ChevronDown size={14} />
            </button>
          )}
        </div>
      </div>
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
        currentTier={sendMessage.currentTier}
        setCurrentTier={sendMessage.setCurrentTier}
        permissionMode={permissionMode}
        setPermissionMode={setPermissionMode}
        hasPendingUserAction={sendMessage.hasPendingUserAction}
        pendingImages={imageAttachment.pendingImages}
        imageInputRef={imageAttachment.imageInputRef}
        handleSend={() => { scrollToBottom('instant'); sendMessage.handleSend(); }}
        handleKeyPress={(e: React.KeyboardEvent) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) scrollToBottom('instant');
          sendMessage.handleKeyPress(e);
        }}
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
