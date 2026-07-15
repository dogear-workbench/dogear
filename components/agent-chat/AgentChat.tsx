import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ChevronDown, GitBranch, PanelRightOpen, PanelRightClose } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { client } from '@/lib/client';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useUIStore } from '@/stores/ui-store';
import { useSettingsStore } from '@/stores/settings-store';
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
import { useChatScroll } from './hooks/useChatScroll';
import { StreamingIndicator } from './StreamingIndicator';
import { LineageBar } from './LineageBar';
import { derivePendingState } from './hooks/usePendingState';
import { SearchBar } from './SearchBar';
import { useMessageSearch } from './hooks/useMessageSearch';
import { MessageMinimap } from './MessageMinimap';
import { useToolRegistryStore } from '@/stores/tool-registry-store';
import { useCompactCollapseStore } from '@/stores/compact-collapse-store';
import { useTaskListAggregator } from './hooks/useTaskListAggregator';
import { CollapsedHistoryBanner } from './CollapsedHistoryBanner';
import { CollapseControlBar } from './CollapseControlBar';
import { buildTurns } from './turns';

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
  const settings = useSettingsStore((s) => s.settings);
  const setConvSelection = useConversationStore((s) => s.setConversationModelSelection);

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

  // compact_boundary 折叠状态（默认折叠，每个对话独立）
  const isHistoryCollapsed = useCompactCollapseStore((s) => s.isCollapsed(conversationId));
  const toggleCollapse = useCompactCollapseStore((s) => s.toggle);

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

  // 历史消息
  const { messages, setMessages, setHistoryLoaded } =
    useMessageHistory({ conversationId, useSdkResume, forkParams, workspacePath });

  useTaskListAggregator(messages, setMessages);

  // 会话生命周期
  const { sessionId, isSessionReady, permissionMode, setPermissionMode, pendingCount } =
    useAgentSession({ conversationId, forkParams, context, useSdkResume, setMessages, setIsLoading });

  // 外部启动的会话（agent 派子会话 / 微信 bot / fork 自动发送）本地 isLoading 不会点亮，
  // 用后端权威运行态兜底；本地 isLoading 保留用于点击发送的乐观预置和失败恢复
  const isRunningInStore = useConversationStore((s) =>
    conversationId ? s.runningConversationIds.has(conversationId) : false,
  );
  const pendingState = derivePendingState({ isRunning: isLoading || isRunningInStore, pendingCount });

  // 主会话派出的子会话快照（用于 StreamingIndicator 显示「等待 N 个交付」+ 中断按钮）
  const childrenForThis = useConversationStore(
    (s) => (conversationId ? s.childrenByParent[conversationId] : undefined) ?? null,
  );
  const { awaitCount, doneCount } = useMemo(() => {
    if (!childrenForThis) return { awaitCount: 0, doneCount: 0 };
    let awaiting = 0;
    let done = 0;
    for (const c of childrenForThis) {
      if (c.status === 'running') awaiting++;
      else if (c.status === 'done') done++;
    }
    return { awaitCount: awaiting, doneCount: done };
  }, [childrenForThis]);

  const handleAbortWait = useCallback(async () => {
    if (!conversationId) return;
    const result = await client.abortWaitForDeliveries({ parentConversationId: conversationId });
    // tipc 返回联合类型时 error 字段可能存在；尝试读出失败原因
    const err = (result as { error?: string }).error;
    if (err) {
      const { toast } = await import('sonner');
      toast.error('中断等待失败', { description: err });
      return;
    }
    if (result.abortedWaits > 0) {
      const { toast } = await import('sonner');
      toast.success(`已中断 ${result.abortedWaits} 个等待，取消 ${result.cancelledChildren} 个子会话`);
    }
  }, [conversationId]);

  // ─── 滚动控制（统一入口: useChatScroll）───
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const {
    showScrollBtn,
    scrollToBottom,
    scrollToMessage,
    scrollToElement,
    handleScroll,
    isFollowing,
  } = useChatScroll({ scrollAreaRef, isLoading });

  // 事件监听（完成、权限、AskUser、通知）
  useSessionEvents({
    sessionId,
    setMessages,
    setIsLoading,
    setPermissionMode,
    onScrollToAction: () => {
      requestAnimationFrame(() => {
        if (isFollowing()) scrollToBottom('smooth');
      });
    },
  });

  // 从 messages 的 ContentBlock 中提取子代理列表，按 conversationId 缓存到 ui-store
  // 仅注册列表数据，不主动打开右侧面板（用户手动切到子代理 Tab 时仍可看到）
  const sdkSessionId = useConversationStore((s) => s.selectedConversation?.sdk_session_id);
  useEffect(() => {
    if (!conversationId || !sdkSessionId) return;
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
          model: block.toolInput?.model,
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
    currentSelection: selectedConv?.modelSelection ?? null,
  });

  // 权限/AskUser 响应后恢复自动跟随
  const handlePermissionResolvedWithScroll = useCallback(
    async (...args: Parameters<typeof sendMessage.handlePermissionResolved>) => {
      await sendMessage.handlePermissionResolved(...args);
      requestAnimationFrame(() => scrollToBottom('smooth'));
    },
    [sendMessage.handlePermissionResolved, scrollToBottom]
  );

  const handleAskUserResolvedWithScroll = useCallback(
    async (...args: Parameters<typeof sendMessage.handleAskUserResolved>) => {
      await sendMessage.handleAskUserResolved(...args);
      requestAnimationFrame(() => scrollToBottom('smooth'));
    },
    [sendMessage.handleAskUserResolved, scrollToBottom]
  );

  // 消息流处理
  useSessionMessages({
    sessionId,
    showReplayMessages,
    setMessages,
    setIsLoading,
    setHistoryLoaded,
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

  // 搜索命中折叠段时自动展开 + 跳转
  useEffect(() => {
    if (!search.activeMatch || !conversationId) return;
    const lastBoundaryIdx = messages.reduce(
      (acc, m, i) => m.isCompactBoundary ? i : acc, -1
    );
    if (lastBoundaryIdx > 0 && search.activeMatch.messageIndex < lastBoundaryIdx && isHistoryCollapsed) {
      useCompactCollapseStore.getState().setCollapsed(conversationId, false);
      const targetIdx = search.activeMatch.messageIndex;
      requestAnimationFrame(() => {
        scrollToMessage(targetIdx, { align: 'top', flash: true });
      });
    }
  }, [search.activeMatch, conversationId, isHistoryCollapsed, messages, scrollToMessage]);

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
        {/* 会话溯源条（agent 派出会话，contractMetadata 存在时渲染） */}
        {selectedConv && (
          <LineageBar
            conversation={selectedConv}
            onOpenParent={(parentId) => {
              const parent = conversations.find((c) => c.id === parentId);
              if (parent) void selectConversation(parent);
            }}
          />
        )}
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
          const hasCompactHistory = lastCompactIdx > 0;
          const collapsed = isHistoryCollapsed && hasCompactHistory;

          // 渲染单条消息的辅助函数（messageIndex 始终为原始扁平下标）
          const renderMessage = (message: typeof messages[0], index: number) => (
            <MessageItem
              key={index}
              message={message}
              messageIndex={index}
              onFork={sendMessage.handleFork}
              sessionId={sessionId}
              onPermissionResolved={handlePermissionResolvedWithScroll}
              onAskUserResolved={handleAskUserResolvedWithScroll}
              searchQuery={search.query || undefined}
              activeMatchId={search.activeMatch?.id ?? null}
              isAgentConversation={selectedConv?.contractMetadata?.createdBy === 'agent'}
            />
          );

          const { turns } = buildTurns(messages, { collapsed });

          return (
            <>
              {/* 压缩历史 banner / 收起条：普通块，不吸顶，在所有 section 之前 */}
              {hasCompactHistory && (
                collapsed ? (
                  <CollapsedHistoryBanner
                    count={lastCompactIdx}
                    onExpand={() => conversationId && toggleCollapse(conversationId)}
                  />
                ) : (
                  <CollapseControlBar
                    count={lastCompactIdx}
                    onCollapse={() => conversationId && toggleCollapse(conversationId)}
                  />
                )
              )}

              {turns.map((turn) => (
                <section key={turn.turnId} className="agent-turn">
                  {turn.memberIdxs.map((i) => renderMessage(messages[i], i))}
                </section>
              ))}
            </>
          );
        })()}

        {/* 运行状态指示器 */}
        <StreamingIndicator
          pendingState={pendingState}
          pendingCount={pendingCount}
          lastBlockType={
            messages[messages.length - 1]?.contentBlocks?.slice(-1)[0]?.type
          }
          awaitCount={awaitCount}
          doneCount={doneCount}
          onAbortWait={handleAbortWait}
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

      {/* 输入区域 */}
      <ChatInputArea
        input={sendMessage.input}
        setInput={sendMessage.setInput}
        pendingState={pendingState}
        isSessionReady={isSessionReady}
        sessionId={sessionId}
        conversationId={conversationId}
        placeholder={placeholder}
        showStatusHint={showStatusHint}
        currentSelection={selectedConv?.modelSelection ?? null}
        onSelectionChange={(v) => { if (conversationId) setConvSelection(conversationId, v); }}
        cachePolicy={selectedConv?.cachePolicy}
        workspaceId={selectedConv?.workspace_id ?? null}
        settings={settings}
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
