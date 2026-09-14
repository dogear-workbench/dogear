import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Archive, AlertCircle, ChevronDown, ArrowLeftRight, X } from 'lucide-react';
import { toast } from 'sonner';
import { useConversationStore, type FailoverNotice } from '@/stores/conversation-store';
import { useReferenceStore } from '@/stores/reference-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useNotesStore } from '@/stores/notes-store';
import { useSessionStore, NOTES_TAB_ID } from '@/stores/session-store';
import { requireReferenceAnchorId } from '@/lib/reference-guard';
import { SelectionActionTooltip, useMessageSelection } from './SelectionActionTooltip';
import type { AgentChatProps, Message } from './types';
import { LiveTail } from './LiveTail';
import { StableHistory } from './StableHistory';
import { ChatInputArea } from './ChatInputArea';
import { useMessageHistory } from './hooks/useMessageHistory';
import { useAgentSession } from './hooks/useAgentSession';
import { useTopicArchiveState } from './hooks/useTopicArchiveState';
import { useSessionMessages } from './hooks/useSessionMessages';
import { useSessionEvents } from './hooks/useSessionEvents';
import { useImageAttachment } from './hooks/useImageAttachment';
import { useSendMessage } from './hooks/useSendMessage';
import { useTranscriptState } from './hooks/useTranscriptState';
import { useSlashCommands } from './hooks/useSlashCommands';
import { useChatScroll } from './hooks/useChatScroll';
import { derivePendingState } from './hooks/usePendingState';
import { SearchBar } from './SearchBar';
import { useMessageSearch } from './hooks/useMessageSearch';
import { MessageMinimap } from './MessageMinimap';
import { AwaitingDeliveryIndicator } from './AwaitingDeliveryIndicator';
import { useToolRegistryStore } from '@/stores/tool-registry-store';
import { useCompactCollapseStore } from '@/stores/compact-collapse-store';
import { ConversationIdProvider } from './conversation-id-context';
import { WorkspaceIdProvider } from './workspace-id-context';
import { buildTurns } from './turns';
import type { TranscriptEvent } from './hooks/useTranscriptState';
import type { ChildStatus } from '@/types/delegation';
import type { LivePermissionRequest } from './hooks/useAgentSession';

const childStatusLabels: Record<ChildStatus, string> = {
  running: '子会话运行中',
  stopped: '子会话已停止',
};

const childStatusStyles: Record<ChildStatus, string> = {
  running: 'bg-orange-50 border-orange-200 text-orange-800 dark:bg-orange-950/40 dark:border-orange-800/60 dark:text-orange-300',
  stopped: 'bg-muted border-border text-muted-foreground',
};

// Zustand selectors must return a cached reference when no notices exist.
// Allocating `[]` inside the selector makes React treat every store snapshot as changed.
const EMPTY_FAILOVER_NOTICES: FailoverNotice[] = [];

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
  showReplayMessages = true,
  conversationIdOverride,
  workspaceId,
  visible = true,
}: AgentChatProps) {
  const conversationId = conversationIdOverride ?? null;
  const setConvSelection = useConversationStore((s) => s.setConversationModelSelection);

  const { conversation: currentConversation, topicState } = useTopicArchiveState(conversationId, workspaceId);
  const childSnapshot = useConversationStore((s) => conversationId ? s.childSnapshotsById[conversationId] : undefined);

  // compact_boundary 折叠状态（默认折叠，每个对话独立）
  const isHistoryCollapsed = useCompactCollapseStore((s) => s.isCollapsed(conversationId));
  const toggleCollapse = useCompactCollapseStore((s) => s.toggle);

  // 预加载工具分类映射（供 ToolBlock/ToolGroupBlock 使用中文大类标签）
  useEffect(() => {
    useToolRegistryStore.getState().ensureLoaded();
  }, []);

  // 加载状态
  const [isLoading, setIsLoading] = useState(false);

  // transcript 状态：消息写入口全部收敛到该 hook，结构快照与 live tail 分别订阅
  const transcript = useTranscriptState(showReplayMessages, visible, conversationId);
  const { stableHistory, structuredLiveTail, transcriptStore, getMessages, applySnapshot, initReady } = transcript;

  const { setHistoryLoaded, historyStatus, historyError, retryHistory } = useMessageHistory({ conversationId, workspaceId, loadHistory: transcript.loadHistory });
  const isTopicStatePending = !!conversationId && topicState === 'loading';
  const topicArchived = topicState === 'archived';
  const isTopicReadOnly = topicArchived || topicState === 'missing';
  const isReadOnly = isTopicReadOnly;

  const applyLiveSnapshot = useCallback((snapshot: TranscriptEvent[], pendingPermissionRequests: LivePermissionRequest[], turnEntryIds?: string[]) => {
    applySnapshot(snapshot, pendingPermissionRequests, turnEntryIds);
  }, [applySnapshot]);

  // 会话生命周期
  const { sessionId, isSessionReady, permissionMode, setPermissionMode, pendingCount } =
    useAgentSession({
      conversationId,
      archived: isReadOnly,
      setIsLoading,
      onLiveSnapshot: applyLiveSnapshot,
      workspaceId,
    });

  // 外部启动的会话（agent 派子会话 / 微信 bot / fork 自动发送）本地 isLoading 不会点亮，
  // 用后端权威运行态兜底；本地 isLoading 保留用于点击发送的乐观预置和失败恢复
  const isRunningInStore = useConversationStore((s) =>
    conversationId ? s.runningConversationIds.has(conversationId) : false,
  );
  const isPausedInStore = useConversationStore((s) =>
    conversationId ? s.pausedConversationIds.has(conversationId) : false,
  );
  const pendingState = derivePendingState({ isRunning: isLoading || isRunningInStore, pendingCount });

  // 主会话派出的子会话快照（驱动侧边轨道等待交付动效 + 输入区状态行）
  const childrenForThis = useConversationStore(
    (s) => (conversationId ? s.childrenByParent[conversationId] : undefined) ?? null,
  );
  const failoverNotices = useConversationStore(
    (s) => (conversationId ? s.failoverNoticesByConversation[conversationId] : undefined) ?? EMPTY_FAILOVER_NOTICES,
  );
  const dismissFailoverNotice = useConversationStore((s) => s.dismissFailoverNotice);
  const { awaitCount, doneCount, issueCount } = useMemo(() => {
    if (!childrenForThis) return { awaitCount: 0, doneCount: 0, issueCount: 0 };
    let awaiting = 0;
    let done = 0;
    let issues = 0;
    for (const c of childrenForThis) {
      if (c.status === 'running') awaiting++;
      else if (c.delivered) done++;
      else issues++;
    }
    return { awaitCount: awaiting, doneCount: done, issueCount: issues };
  }, [childrenForThis]);

  // 事件驱动等待的派生展示态：run settled（非 running/paused）∧ 有 running 直属子会话，
  // 驱动输入区状态行；侧边轨道动效不区分 settled 与否，直接用 awaitCount
  const isWaitingForChildren = !isLoading && !isRunningInStore && !isPausedInStore && awaitCount > 0;

  const scrollAreaRef = useRef<HTMLDivElement>(null);

  // 会话流内选中文字 → 浮动引用/存笔记按钮（挂消息流内容层）
  const messageFlowRef = useRef<HTMLDivElement>(null);
  const selectionActions = useMessageSelection(messageFlowRef);
  const addMessageSnippet = useReferenceStore((s) => s.addMessageSnippet);

  const handleQuoteSelection = useCallback(() => {
    if (!selectionActions.selectedText) return;
    const anchorId = requireReferenceAnchorId();
    if (!anchorId) return;
    addMessageSnippet({ text: selectionActions.selectedText, timestamp: Date.now() }, anchorId);
    selectionActions.clear();
  }, [selectionActions, addMessageSnippet]);

  const handleSaveSelectionAsNote = useCallback(async () => {
    if (!selectionActions.selectedText) return;
    const workspace = useWorkspaceStore.getState().workspace;
    if (!workspace) {
      toast.error('存笔记失败', { description: '未打开工作区' });
      return;
    }
    const conversationTitle = currentConversation?.title?.trim() || '未命名会话';
    const time = new Date().toLocaleString('zh-CN', { hour12: false });
    const note = await useNotesStore.getState().createNote(workspace.path, {
      content: `${selectionActions.selectedText}\n\n> 来自会话消息 · ${conversationTitle} · ${time}`,
    });
    selectionActions.clear();
    if (!note) {
      toast.error('存笔记失败');
      return;
    }
    // 独立窗口无笔记面板，「查看」仅在主窗口提供
    const inSessionWindow = window.location.hash.startsWith('#/session-window/');
    toast.success('已存为笔记', {
      description: `来自「${conversationTitle}」`,
      ...(inSessionWindow ? {} : {
        action: {
          label: '查看',
          onClick: () => {
            useNotesStore.getState().setActiveNoteId(note.id);
            useSessionStore.getState().switchTab(NOTES_TAB_ID);
          },
        },
      }),
    });
  }, [selectionActions, currentConversation]);

  // ─── 虚拟滚动 ───
  // 计算 compact_boundary 折叠状态（提前到组件主体，供 buildTurns 和虚拟滚动共用）
  const lastCompactBoundaryIdx = useMemo(
    () => stableHistory.reduce((acc, m, i) => (m.isCompactBoundary ? i : acc), -1),
    [stableHistory],
  );
  const hasCompactHistory = lastCompactBoundaryIdx > 0;
  const collapsed = isHistoryCollapsed && hasCompactHistory;
  const { turns: chatTurns } = useMemo(
    () => buildTurns(stableHistory, { collapsed }),
    [stableHistory, collapsed],
  );

  const messagesById = useMemo(() => {
    const map = new Map<string, Message>();
    for (const message of stableHistory) {
      if (message.id) map.set(message.id, message);
    }
    return map;
  }, [stableHistory]);
  // ─── 滚动控制（统一入口: useChatScroll）───
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
    transcript,
    setIsLoading,
    setPermissionMode,
    onScrollToAction: () => {
      requestAnimationFrame(() => {
        if (isFollowing()) scrollToBottom('smooth');
      });
    },
  });

  // 图片附件
  const imageAttachment = useImageAttachment();

  // 消息发送 + 分叉 + 权限响应
  const sendMessage = useSendMessage({
    sessionId,
    isSessionReady,
    isLoading,
    getMessages,
    transcript,
    setIsLoading,
    permissionMode,
    setPermissionMode,
    conversationId,
    pendingImages: imageAttachment.pendingImages,
    setPendingImages: imageAttachment.setPendingImages,
    currentSelection: currentConversation?.modelSelection ?? null,
    readOnly: isReadOnly,
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
    enqueueStreamEvent: transcript.enqueueStreamEvent,
    setIsLoading,
    setHistoryLoaded,
  });

  // 斜杠命令
  const slashCommands = useSlashCommands({
    sessionId,
    input: sendMessage.input,
  });

  // 稳定化传给 ChatInputArea 的回调，避免每次渲染产生新引用导致 memo 失效
  const handleSend = useCallback(() => {
    scrollToBottom('instant');
    sendMessage.handleSend();
  }, [scrollToBottom, sendMessage.handleSend]);

  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) scrollToBottom('instant');
    sendMessage.handleKeyPress(e);
  }, [scrollToBottom, sendMessage.handleKeyPress]);

  const handleSelectionChange = useCallback((value: import('@/types/settings').ModelSelection | null) => {
    if (conversationId) void setConvSelection(conversationId, value);
  }, [conversationId, setConvSelection]);

  // 选择命令时更新 input
  const handleSlashCommandSelect = useCallback((cmd: import('@/stores/slash-command-store').SlashCommandInfo) => {
    const newInput = slashCommands.handleSlashCommandSelect(cmd);
    sendMessage.setInput(newInput);
  }, [slashCommands.handleSlashCommandSelect, sendMessage.setInput]);

  // 搜索 query 变化时读取 stable history 与 live tail 快照
  const search = useMessageSearch(stableHistory, transcriptStore.getLiveSnapshot);
  // 解构出稳定引用，避免 useEffect deps 依赖整个 search 对象
  const openSearch = search.open;

  // 历史加载完成后触底；followMode=auto 让虚拟占位测量回流时由 ResizeObserver 续滚校正
  useEffect(() => {
    if (historyStatus === 'loading' || !conversationId) return;
    scrollToBottom('instant');
  }, [conversationId, historyStatus, scrollToBottom]);

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
    const matchId = search.activeMatch.id;
    const el = document.querySelector(`[data-match-id="${matchId}"]`) as HTMLElement | null;
    if (el) scrollToElement(el, { align: 'top-third' });
  }, [search.activeMatch?.id, scrollToElement]);

  // 搜索命中折叠段时自动展开 + 跳转
  const scrollToMessageRef = useRef(scrollToMessage);
  scrollToMessageRef.current = scrollToMessage;
  useEffect(() => {
    if (!search.activeMatch || !conversationId) return;
    const lastBoundaryIdx = stableHistory.reduce(
      (acc, m, i) => m.isCompactBoundary ? i : acc, -1
    );
    const matchIdx = stableHistory.findIndex((m) => m.id === search.activeMatch!.messageId);
    if (lastBoundaryIdx > 0 && matchIdx >= 0 && matchIdx < lastBoundaryIdx && isHistoryCollapsed) {
      useCompactCollapseStore.getState().setCollapsed(conversationId, false);
      requestAnimationFrame(() => {
        scrollToMessageRef.current(search.activeMatch!.messageId, { align: 'top', flash: true });
      });
    }
  }, [search.activeMatch, conversationId, isHistoryCollapsed, stableHistory]);

  const isAgentConversation = currentConversation?.contractMetadata?.createdBy === 'agent';
  const hasMessages = stableHistory.length > 0 || structuredLiveTail.length > 0;
  const fallbackLastBlockType = stableHistory[stableHistory.length - 1]?.contentBlocks?.slice(-1)[0]?.type;
  const handleExpandHistory = useCallback(() => {
    if (conversationId) toggleCollapse(conversationId);
  }, [conversationId, toggleCollapse]);
  const handleCollapseHistory = useCallback(() => {
    if (conversationId) toggleCollapse(conversationId);
  }, [conversationId, toggleCollapse]);

  return (
    <WorkspaceIdProvider workspaceId={workspaceId ?? null}>
    <div className="relative flex flex-col h-full bg-card rounded-lg border shadow-sm">
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
      <div
        ref={scrollAreaRef}
        data-chat-scroll-viewport=""
        className="h-full pr-12 overflow-y-auto"
        onScrollCapture={handleScroll}
      >
        <div ref={messageFlowRef} className="relative px-6" onMouseUp={selectionActions.handleMouseUp}>
        {childSnapshot && (
          <div className={`px-3 py-2 my-2 rounded-lg border text-xs ${childSnapshot.delivered ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-800/60 dark:text-emerald-300' : childStatusStyles[childSnapshot.status]}`} title={childSnapshot.lastError || undefined}>
            <p className="font-medium">{childSnapshot.delivered ? '子会话已交付' : childStatusLabels[childSnapshot.status]}</p>
            {childSnapshot.lastError && <p className="mt-0.5">{childSnapshot.lastError}</p>}
          </div>
        )}
        {/* 旧 SDK 主会话迁移冻结提示：只读展示，不回放 JSONL、不允许发送/编辑重发/分叉 */}
        {topicArchived && (
          <div className="flex items-start gap-2 px-3 py-3 my-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 dark:bg-amber-950/40 dark:border-amber-800/60 dark:text-amber-300">
            <Archive size={14} className="flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">此话题已归档</p>
              <p className="mt-0.5 text-amber-700 dark:text-amber-300/80">历史记录仅供查看；恢复话题后才能发送消息、编辑重发、分叉或调整模型与权限。</p>
            </div>
          </div>
        )}
        {topicState === 'missing' && (
          <div className="flex items-start gap-2 px-3 py-3 my-2 rounded-lg bg-destructive/10 border border-destructive/30 text-xs text-destructive">
            <Archive size={14} className="flex-shrink-0 mt-0.5" />
            <p>此话题已删除，无法继续操作。</p>
          </div>
        )}

        {!hasMessages && historyStatus !== 'error' && (historyStatus === 'loading' || (!initReady && conversationId !== null)) && (
          <div className="my-8 space-y-4" aria-hidden="true">
            <div className="h-9 w-1/2 ml-auto rounded-lg bg-muted animate-pulse" />
            <div className="h-16 w-3/4 rounded-lg bg-muted animate-pulse" />
            <div className="h-9 w-2/5 ml-auto rounded-lg bg-muted animate-pulse" />
            <div className="h-12 w-2/3 rounded-lg bg-muted animate-pulse" />
          </div>
        )}

        {historyStatus === 'error' && (
          <div className="flex items-start gap-2 px-3 py-3 my-2 rounded-lg bg-destructive/10 border border-destructive/30 text-xs text-destructive">
            <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">读取对话历史失败</p>
              {historyError && <p className="mt-0.5 opacity-80 break-all">{historyError}</p>}
              {conversationId && (
                <button
                  onClick={retryHistory}
                  className="mt-2 px-3 py-1.5 text-xs bg-destructive text-white rounded-md hover:opacity-90 transition-opacity"
                >
                  重试
                </button>
              )}
            </div>
          </div>
        )}

        {historyStatus === 'empty' && hasMessages === false && !isReadOnly && !isTopicStatePending && (
          <div className="text-center text-gray-500 dark:text-gray-400 mt-20">
            <p>开始与 Agent 对话...</p>
          </div>
        )}

        <ConversationIdProvider conversationId={conversationId}>
        <StableHistory
          turns={chatTurns}
          messagesById={messagesById}
          hasCompactHistory={hasCompactHistory}
          collapsed={collapsed}
          compactBoundaryCount={lastCompactBoundaryIdx}
          onExpandHistory={handleExpandHistory}
          onCollapseHistory={handleCollapseHistory}
          onFork={sendMessage.handleFork}
          onPermissionResolved={handlePermissionResolvedWithScroll}
          onAskUserResolved={handleAskUserResolvedWithScroll}
          onInterrupt={sendMessage.handleInterrupt}
          searchQuery={search.query || undefined}
          activeMatchId={search.activeMatch?.id ?? null}
          readOnly={isReadOnly}
          sessionId={sessionId}
          isAgentConversation={isAgentConversation}
        />
        <LiveTail
          transcriptStore={transcriptStore}
          pendingState={pendingState}
          pendingCount={pendingCount}
          fallbackLastBlockType={fallbackLastBlockType}
          onFork={sendMessage.handleFork}
          onPermissionResolved={handlePermissionResolvedWithScroll}
          onAskUserResolved={handleAskUserResolvedWithScroll}
          onInterrupt={sendMessage.handleInterrupt}
          searchQuery={search.query || undefined}
          activeMatchId={search.activeMatch?.id ?? null}
          readOnly={isReadOnly}
          sessionId={sessionId}
          isAgentConversation={isAgentConversation}
        />
        </ConversationIdProvider>

        {selectionActions.position && (
          <SelectionActionTooltip
            position={selectionActions.position}
            onQuote={handleQuoteSelection}
            onSaveNote={() => { void handleSaveSelectionAsNote(); }}
          />
        )}
        </div>
      </div>

      {/* 右侧工具轨道：w-12 透明浮层，顶部+底部两组按钮 */}
      <div className="absolute top-0 right-0 bottom-0 w-12 flex flex-col pointer-events-none z-10">
        {/* 顶部按钮组：Minimap */}
        <div className="flex flex-col gap-1 p-1 pointer-events-auto">
          <MessageMinimap
            turns={chatTurns}
            messagesById={messagesById}
            conversationId={conversationId}
            hidden={search.isOpen}
            scrollAreaRef={scrollAreaRef}
            onJumpToMessage={(id) => scrollToMessage(id, { align: 'top', flash: true })}
          />
          {!search.isOpen && (
            <AwaitingDeliveryIndicator
              awaitCount={awaitCount}
              doneCount={doneCount}
              issueCount={issueCount}
            />
          )}
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

      {/* 模型故障转移提示条（内存级，不进消息流也不落盘；单条可关闭，60s 自动过期） */}
      {failoverNotices.length > 0 && (
        <div className="px-4 py-2 border-t bg-amber-50/70 dark:bg-amber-950/30 flex flex-col gap-1">
          {failoverNotices.map((notice) => (
            <div key={notice.at} className="flex items-center gap-1.5 text-xs text-amber-800 dark:text-amber-300">
              <ArrowLeftRight size={12} className="flex-shrink-0" />
              <span>{notice.fromLabel} 费率受限，已自动切换 {notice.toLabel} 继续运行</span>
              <span className="text-amber-500">{new Date(notice.at).toLocaleTimeString()}</span>
              <button
                onClick={() => conversationId && dismissFailoverNotice(conversationId, notice.at)}
                className="ml-auto p-0.5 rounded hover:bg-amber-100 text-amber-600 dark:hover:bg-amber-900/50 dark:text-amber-400 transition-colors"
                title="关闭"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 输入区域 */}
      {isTopicStatePending ? (
        <div className="flex items-center gap-2 px-4 py-3 border-t text-xs text-muted-foreground bg-muted/30">
          <span>正在检查话题状态…</span>
        </div>
      ) : isReadOnly ? (
        <div className="flex items-center gap-2 px-4 py-3 border-t text-xs text-muted-foreground bg-muted/30">
          <Archive size={14} className="flex-shrink-0" />
          <span>{topicArchived ? '此话题已归档，恢复后才能发送新消息' : '此话题已删除，无法发送新消息'}</span>
        </div>
      ) : (
      <ChatInputArea
        input={sendMessage.input}
        setInput={sendMessage.setInput}
        pendingState={pendingState}
        isPaused={isPausedInStore}
        isSessionReady={isSessionReady}
        sessionId={sessionId}
        conversationId={conversationId}
        placeholder={placeholder}
        showStatusHint={showStatusHint}
        currentSelection={currentConversation?.modelSelection ?? null}
        onSelectionChange={handleSelectionChange}
        permissionMode={permissionMode}
        setPermissionMode={setPermissionMode}
        hasPendingUserAction={sendMessage.hasPendingUserAction}
        isSubSession={currentConversation?.role === 'sub'}
        awaitingDelivery={isWaitingForChildren}
        pendingImages={imageAttachment.pendingImages}
        imageInputRef={imageAttachment.imageInputRef}
        handleSend={handleSend}
        handleKeyPress={handleKeyPress}
        handleImageFiles={imageAttachment.handleImageFiles}
        removePendingImage={imageAttachment.removePendingImage}
        insertModeChangeNotice={sendMessage.insertModeChangeNotice}
        onInterrupt={sendMessage.handleInterrupt}
        isSlashMenuOpen={slashCommands.isSlashMenuOpen}
        filteredCommands={slashCommands.filteredCommands}
        filterQuery={slashCommands.filterQuery}
        onSlashCommandSelect={handleSlashCommandSelect}
        onSlashMenuClose={slashCommands.closeSlashMenu}
      />
      )}
    </div>
    </WorkspaceIdProvider>
  );
}
