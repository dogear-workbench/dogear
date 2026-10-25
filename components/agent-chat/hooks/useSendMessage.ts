import { useState, useCallback, useMemo, useEffect, type Dispatch, type SetStateAction } from 'react';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import { useConversationStore } from '@/stores/conversation-store';
import { useReferenceStore } from '@/stores/reference-store';
import { useHandoffDraftStore } from '@/stores/handoff-draft-store';
import { useSlashCommandStore } from '@/stores/slash-command-store';
import { useCompactCollapseStore } from '@/stores/compact-collapse-store';
import { useSessionStore, DRAFT_VIEW_ID } from '@/stores/session-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useDraftStore } from '@/stores/draft-store';
import { sameSelection } from '@/lib/model-selection';
import type { PermissionMode } from '@/types/electron-api';
import type { ModelSelection } from '@/types/settings';
import type { Message, ContentBlock } from '../types';
import { generateLocalMessageId } from '../transformers';
import type { UseTranscriptStateResult } from './useTranscriptState';
import type { PendingImage } from './useImageAttachment';

/** 自动发送载荷：草稿首条消息消费时绕过 input state 直接指定文本与图片 */
export interface ManualSendPayload {
  text: string;
  images: PendingImage[];
}

interface UseSendMessageParams {
  sessionId: string | null;
  isSessionReady: boolean;
  isLoading: boolean;
  getMessages: () => Message[];
  transcript: UseTranscriptStateResult;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  permissionMode: PermissionMode;
  setPermissionMode: Dispatch<SetStateAction<PermissionMode>>;
  conversationId: string | null;
  pendingImages: PendingImage[];
  setPendingImages: Dispatch<SetStateAction<PendingImage[]>>;
  currentSelection: ModelSelection | null;
  readOnly: boolean;
}

/**
 * 消息发送相关逻辑 Hook
 * 包含：分叉、消息发送、权限/AskUser 响应回调、模式切换通知
 * 消息写入全部走 transcript 写入口，本 hook 不再直接持有 setMessages
 */
export function useSendMessage(params: UseSendMessageParams) {
  const {
    sessionId,
    isSessionReady,
    isLoading,
    getMessages,
    transcript,
    setIsLoading,
    setPermissionMode,
    conversationId,
    pendingImages: pendingImagesProp,
    setPendingImages,
    currentSelection,
    readOnly,
  } = params;

  const {
    loadHistory,
    pushLocalUser,
    pushLiveAssistant,
    replaceLastLiveAssistant,
    insertLocalBlock,
    resolvePermission,
    resolveAskUser,
    markAllPendingCancelled,
    pendingActions,
  } = transcript;

  const [inputState, setInput] = useState('');
  const [lastAppliedSelection, setLastAppliedSelection] = useState<ModelSelection | null>(null);

  // 从 conversation-store 获取 actions
  const forkConversation = useConversationStore((s) => s.forkConversation);
  const updateConversationTitle = useConversationStore((s) => s.updateConversationTitle);
  const triggerSessionRestart = useConversationStore((s) => s.triggerSessionRestart);

  // 从 reference-store 获取引用数据和清理方法，只取/只清锚定本会话的项
  const allQuotedSnippets = useReferenceStore((s) => s.quotedSnippets);
  const clearQuotedSnippetsFor = useReferenceStore((s) => s.clearQuotedSnippetsFor);
  const allMessageSnippets = useReferenceStore((s) => s.messageSnippets);
  const clearMessageSnippetsFor = useReferenceStore((s) => s.clearMessageSnippetsFor);
  const allFileSnippets = useReferenceStore((s) => s.fileSnippets);
  const clearFileSnippetsFor = useReferenceStore((s) => s.clearFileSnippetsFor);
  const allReferencedFiles = useReferenceStore((s) => s.referencedFiles);
  const clearReferencedFilesFor = useReferenceStore((s) => s.clearReferencedFilesFor);
  const allReferencedConversations = useReferenceStore((s) => s.referencedConversations);
  const clearReferencedConversationsFor = useReferenceStore((s) => s.clearReferencedConversationsFor);
  const allReferencedSharedFiles = useReferenceStore((s) => s.referencedSharedFiles);
  const clearReferencedSharedFilesFor = useReferenceStore((s) => s.clearReferencedSharedFilesFor);
  const allReferencedNotes = useReferenceStore((s) => s.referencedNotes);
  const clearReferencedNotesFor = useReferenceStore((s) => s.clearReferencedNotesFor);
  const allHandoffDrafts = useHandoffDraftStore((s) => s.draftsByConversation);
  const clearHandoffDraftsFor = useHandoffDraftStore((s) => s.clearFor);
  const handoffDrafts = useMemo(
    () => (conversationId ? allHandoffDrafts[conversationId] ?? [] : []),
    [allHandoffDrafts, conversationId]
  );
  const quotedSnippets = useMemo(
    () => allQuotedSnippets.filter((s) => s.anchorConversationId === conversationId),
    [allQuotedSnippets, conversationId]
  );
  const messageSnippets = useMemo(
    () => allMessageSnippets.filter((s) => s.anchorConversationId === conversationId),
    [allMessageSnippets, conversationId]
  );
  const fileSnippets = useMemo(
    () => allFileSnippets.filter((s) => s.anchorConversationId === conversationId),
    [allFileSnippets, conversationId]
  );
  const referencedFiles = useMemo(
    () => allReferencedFiles.filter((f) => f.anchorConversationId === conversationId),
    [allReferencedFiles, conversationId]
  );
  const referencedConversations = useMemo(
    () => allReferencedConversations.filter((c) => c.anchorConversationId === conversationId),
    [allReferencedConversations, conversationId]
  );
  const referencedSharedFiles = useMemo(
    () => allReferencedSharedFiles.filter((f) => f.anchorConversationId === conversationId),
    [allReferencedSharedFiles, conversationId]
  );
  const referencedNotes = useMemo(
    () => allReferencedNotes.filter((n) => n.anchorConversationId === conversationId),
    [allReferencedNotes, conversationId]
  );

  // 权限模式名称映射
  const modeLabels: Record<string, string> = {
    'autoExecute': '自动执行',
    'default': '默认',
  };

  // 检查是否有未处理的权限请求或 AskUser 问题，有则隐藏普通输入框
  const hasPendingUserAction = pendingActions.length > 0;

  // 在对话中插入模式切换通知
  const insertModeChangeNotice = useCallback((newMode: string) => {
    insertLocalBlock({
      type: 'status',
      status: `权限模式已切换为「${modeLabels[newMode] || newMode}」`,
      timestamp: Date.now(),
    });
  }, [insertLocalBlock]);

  // 权限确认响应回调：更新消息中对应权限请求块的状态
  const handlePermissionResolved = useCallback(async (requestId: string, behavior: 'allow' | 'deny' | 'allow_session') => {
    if (readOnly) return;
    resolvePermission(requestId, behavior);
  }, [readOnly, resolvePermission]);

  // AskUserQuestion 响应回调：更新消息中对应问答块的状态
  const handleAskUserResolved = useCallback((requestId: string, answers: Record<string, string>) => {
    if (readOnly) return;
    resolveAskUser(requestId, answers);
  }, [readOnly, resolveAskUser]);

  // 中断当前执行：发 IPC + 本地把所有未 resolved 的 pending block 标为已取消，
  // 让 hasPendingUserAction 立刻变假、输入框立刻回来（否则依赖后端事件闭环时序，UI 卡在"等确认"）
  const handleInterrupt = useCallback(async () => {
    if (readOnly || !sessionId) return;
    console.log('[interrupt-trace] handleInterrupt 触发', { sessionId: sessionId.substring(0, 8) });
    try {
      await client.interruptQueryBasedSession({ sessionId });
      console.log('[interrupt-trace] interruptQueryBasedSession IPC 已 resolve');
    } catch (e) {
      console.warn('[interrupt-trace] 中断会话失败:', e);
    }
    markAllPendingCancelled();
    setIsLoading(false);
  }, [readOnly, sessionId, markAllPendingCancelled, setIsLoading]);

  /**
   * 从某条 assistant 消息处分叉新对话
   */
  const handleFork = useCallback((assistantSdkUuid: string) => {
    if (readOnly || !conversationId) return;
    forkConversation({
      parentConversationId: conversationId,
      forkMessageSdkUuid: assistantSdkUuid,
    });
  }, [conversationId, forkConversation, readOnly]);

  // 斜杠命令拦截处理，返回 true 表示已处理（不走正常发送流程）
  const handleSlashCommand = useCallback(async (text: string): Promise<boolean> => {
    const trimmed = text.trim();
    if (!trimmed.startsWith('/') || !sessionId) return false;

    const parts = trimmed.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    switch (cmd) {
      case '/clear': {
        // 前端清空消息 + 强制终止旧会话（跑步机模式下 release 不会打断执行中的任务，
        // 但 /clear 语义是"立即重置"，必须忽略引用计数强杀，避免旧任务在后台继续跑）
        loadHistory([]);
        setIsLoading(false);
        try {
          await client.forceCloseQueryBasedSession({ sessionId });
        } catch (e) {
          console.warn('关闭旧会话失败:', e);
        }
        // 清空后落草稿：语境沿用当前 tab 所属工作区（含 personal）
        const wsId = (conversationId
          ? useSessionStore.getState().getTab(conversationId)?.workspaceId
          : undefined) ?? useWorkspaceStore.getState().workspace?.id;
        if (wsId) {
          useDraftStore.getState().enterDraft(wsId);
          useSessionStore.getState().switchTab(DRAFT_VIEW_ID);
        }
        return true;
      }

      case '/compact': {
        // 直接发送给 SDK 处理（SDK 内置命令）
        setInput('');
        insertLocalBlock({
          type: 'compacting',
          timestamp: Date.now(),
        });
        try {
          await client.sendQueryBasedSessionMessage({ sessionId, content: '/compact' });
        } catch (e) {
          console.error('/compact 发送失败:', e);
        }
        return true;
      }

      case '/search': {
        if (!args) return false; // 没有关键词则不拦截
        const searchPrompt = `请搜索与「${args}」相关的内容，查找相关段落并总结结果。`;
        setInput('');
        pushLocalUser({ role: 'user', content: `/search ${args}`, timestamp: Date.now(), id: generateLocalMessageId() });
        pushLiveAssistant({ role: 'assistant', content: '', timestamp: Date.now(), id: generateLocalMessageId(), isStreaming: true, contentBlocks: [] });
        setIsLoading(true);
        try {
          await client.sendQueryBasedSessionMessage({ sessionId, content: searchPrompt });
        } catch (e) {
          console.error('/search 发送失败:', e);
          setIsLoading(false);
        }
        return true;
      }

      default: {
        // 检查是否为 SDK 已注册的命令
        const cmdName = cmd.slice(1); // 去掉 /
        const { allCommands } = useSlashCommandStore.getState();
        const sdkCmd = allCommands.find(c => c.name === cmdName && c.source === 'sdk');

        if (sdkCmd) {
          // SDK 命令：直接透传给 SDK，以系统消息样式展示
          setInput('');
          pushLocalUser({ role: 'user', content: trimmed, timestamp: Date.now(), id: generateLocalMessageId(), isMeta: true });
          setIsLoading(true);
          try {
            await client.sendQueryBasedSessionMessage({ sessionId, content: trimmed });
          } catch (e) {
            console.error(`SDK 命令 ${cmd} 发送失败:`, e);
            setIsLoading(false);
          }
          return true;
        }

        return false;
      }
    }
  }, [sessionId, conversationId, setInput, loadHistory, insertLocalBlock, pushLocalUser, pushLiveAssistant, setIsLoading]);

  // 发送消息；override 供草稿首条消息自动发送（绕过 input state 与斜杠拦截，失败回填见 catch）
  const handleSend = useCallback(async (override?: ManualSendPayload) => {
    if (readOnly) return;
    const input = override ? override.text : inputState;
    const pendingImages = override ? override.images : pendingImagesProp;
    const hasText = !!input.trim();
    const hasImages = pendingImages.length > 0;
    if (!hasText && !hasImages && handoffDrafts.length === 0) return;

    if (!sessionId || !isSessionReady) return;

    // 斜杠命令拦截（override 已在草稿侧做过命令防护）
    if (hasText && !hasImages && !override && await handleSlashCommand(input)) {
      return;
    }

    const userMessage = input;
    const imagesToSend = [...pendingImages];
    if (!override) setInput('');
    setPendingImages([]);

    // 发送新消息时强制折叠 compact 历史段，让旧 DOM 立即卸载
    if (conversationId) {
      useCompactCollapseStore.getState().setCollapsed(conversationId, true);
    }

    // 构建多 content block 发送结构：每种引用独立为一个 text block，使用 XML 标签包裹
    const textBlocks: Array<{ text: string }> = [];

    // 清理文本中的换行符
    const sanitize = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

    // 文章引用不再单列：树右键/阅读面板入口直接进 referencedFiles 池，随 <referenced_files> block 携带路径发送

    // 文字片段引用：独立 block，直接内联内容
    if (quotedSnippets.length > 0) {
      for (const s of quotedSnippets) {
        textBlocks.push({
          text: `<quoted_snippet source="${sanitize(s.articleTitle)}">\n${sanitize(s.text)}\n</quoted_snippet>`
        });
      }
      clearQuotedSnippetsFor(conversationId!);
    }

    // 会话消息片段：发送标签沿用 quoted_snippet（source=会话消息），MessageItem 解析零改动
    if (messageSnippets.length > 0) {
      for (const s of messageSnippets) {
        textBlocks.push({
          text: `<quoted_snippet source="会话消息">\n${sanitize(s.text)}\n</quoted_snippet>`
        });
      }
      clearMessageSnippetsFor(conversationId!);
    }

    // 文件内容片段（阅读面板选字）：沿用 quoted_snippet（source=文件: 名），渲染端零改动
    if (fileSnippets.length > 0) {
      for (const s of fileSnippets) {
        textBlocks.push({
          text: `<quoted_snippet source="文件: ${sanitize(s.fileName)}">\n${sanitize(s.text)}\n</quoted_snippet>`
        });
      }
      clearFileSnippetsFor(conversationId!);
    }

    // 文件/文件夹引用：独立 block，agent 通过 Read 工具读取内容
    if (referencedFiles.length > 0) {
      const refLines = referencedFiles.map(f =>
        `  <file name="${sanitize(f.name)}" path="${sanitize(f.path)}"${f.type === 'folder' ? ' type="folder"' : ''} />`
      ).join('\n');
      textBlocks.push({
        text: `<referenced_files>\n${refLines}\n</referenced_files>`
      });
      clearReferencedFilesFor(conversationId!);
    }

    // 会话引用：独立 block，agent 可通过 sessionId 读取历史会话上下文
    if (referencedConversations.length > 0) {
      const focusWorkspaceId = conversationId
        ? useSessionStore.getState().getTab(conversationId)?.workspaceId
          ?? useWorkspaceStore.getState().workspace?.id
        : useWorkspaceStore.getState().workspace?.id;
      const convLines = referencedConversations.map(c =>
        `  <conversation title="${sanitize(c.title)}" conversationId="${c.conversationId}" sessionId="${c.sessionId || ''}" workspaceId="${c.workspaceId}" />`
      ).join('\n');
      const hasCrossWorkspaceRef = !!focusWorkspaceId
        && referencedConversations.some(c => c.workspaceId !== focusWorkspaceId);
      const crossWsNote = hasCrossWorkspaceRef
        ? '\n（注：引用的会话可能属于其他工作区，读取其原文时请把 workspaceId 参数一并传给 ReadReferenceSession）'
        : '';
      textBlocks.push({
        text: `<referenced_conversations>\n${convLines}\n</referenced_conversations>${crossWsNote}`
      });
      clearReferencedConversationsFor(conversationId!);
    }

    // 共享文件引用：独立 block，agent 通过 Read 工具读取绝对路径
    if (referencedSharedFiles.length > 0) {
      const refLines = referencedSharedFiles.map(f =>
        `  <shared_file group_id="${sanitize(f.groupId)}" rel_path="${sanitize(f.relPath)}" abs_path="${sanitize(f.absPath)}" />`
      ).join('\n');
      textBlocks.push({
        text: `<referenced_shared_files>\n${refLines}\n</referenced_shared_files>`
      });
      clearReferencedSharedFilesFor(conversationId!);
    }

    // 笔记引用：独立 block，agent 通过 dogear__GetNote(noteId) 读全文（守卫已保证同工作区）
    if (referencedNotes.length > 0) {
      const refLines = referencedNotes.map(n =>
        `  <note noteId="${sanitize(n.noteId)}" title="${sanitize(n.title)}" workspaceId="${sanitize(n.workspaceId)}" />`
      ).join('\n');
      textBlocks.push({
        text: `<referenced_notes>\n${refLines}\n</referenced_notes>`
      });
      clearReferencedNotesFor(conversationId!);
    }

    // 指针类引用提示：四类任一存在时追加一句引导先读再答；quoted_snippet 内容已内联，不在其列
    const pointerRefCount = referencedFiles.length
      + referencedConversations.length + referencedSharedFiles.length + referencedNotes.length;
    if (pointerRefCount > 0) {
      textBlocks.push({
        text: '（引用提示：以上引用由用户主动选定作为本轮上下文，标签仅含元数据、内容不可见；除非与问题明确无关，回答前应先读取相关引用，勿仅凭标题判断跳过）'
      });
    }

    // 浏览器移交草稿：每条独立 block，固定拼在用户文本之前；移交即转移操作焦点，固定提示告知 agent 直接操作页面
    for (const d of handoffDrafts) {
      const lines = [
        '来自浏览器一键移交：',
        `标题：${d.title || '(无标题)'}`,
        `URL：${d.url}`,
      ];
      if (d.selectionText) lines.push(`选中内容：\n${d.selectionText}`);
      if (d.instruction) lines.push(d.instruction);
      lines.push('该页面已设为 agent 操作焦点，发送后可直接 observe_page 读取与操作。');
      textBlocks.push({ text: lines.join('\n') });
    }
    if (handoffDrafts.length > 0) clearHandoffDraftsFor(conversationId!);

    // 用户消息作为最后一个 block
    if (userMessage) {
      textBlocks.push({ text: userMessage });
    }

    // 兼容：拼合完整消息用于前端存储和显示
    const messageToSend = textBlocks.map(b => b.text).join('\n\n');

    // ==================== 前端发送消息日志 ====================
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║                    [前端] 发送用户消息                          ║');
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('  Session ID:', sessionId?.substring(0, 8));
    console.log('  消息长度:', messageToSend.length, '字符');
    console.log('  引用条目数:', referencedFiles.length);
    console.log('  用户消息:', userMessage);
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('');

    // 创建用户消息对象（存储完整内容含引用前缀，由 parseUserMessageReferences 解析渲染）
    const newUserMessage: Message = {
      role: 'user',
      content: messageToSend,
      timestamp: Date.now(),
      id: generateLocalMessageId(),
      ...(imagesToSend.length > 0 && { images: imagesToSend.map(img => ({ preview: img.preview })) }),
    };

    if (isLoading) {
      // Agent 运行中 → 立即在 UI 显示用户消息；后端 pendingMessages 队列会在下一轮窗口消费
      pushLocalUser(newUserMessage);

      client.sendQueryBasedSessionMessage({
        sessionId: sessionId!,
        content: messageToSend,
        ...(textBlocks.length > 1 && { textBlocks }),
        ...(imagesToSend.length > 0 && {
          images: imagesToSend.map(img => ({
            media_type: img.mediaType,
            data: img.base64,
          })),
        }),
      }).catch(err => {
        console.error('插话消息发送失败:', err);
        toast.error('插话发送失败，请重试');
      });
      return;
    }

    // 发送前模型校验 + reconcile（仅空闲路径执行；插话沿用会话当前模型）
    if (!currentSelection) {
      toast.error('请先选择模型');
      return;
    }
    if (sessionId && !sameSelection(lastAppliedSelection, currentSelection)) {
      const result = await client.setSessionModel({ sessionId, selection: currentSelection });
      if (!result.ok) {
        toast.error(result.error || '模型切换失败');
        return;
      }
      if (result.needsRestart) {
        // 跨 profile 切换：把消息插入 UI（用户能看到自己写的内容已"在路上"）+
        // 把待发载荷塞进 store，让 useAgentSession 在新 session ready 后自动续发
        pushLocalUser(newUserMessage);
        pushLiveAssistant({
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          id: generateLocalMessageId(),
          contentBlocks: [{
            type: 'status',
            status: '正在切换模型方案，稍候自动发送…',
            timestamp: Date.now(),
          } as ContentBlock],
        });
        if (conversationId) {
          useConversationStore.getState().setPendingSendAfterRestart({
            conversationId,
            content: messageToSend,
            ...(textBlocks.length > 1 && { textBlocks }),
            ...(imagesToSend.length > 0 && {
              images: imagesToSend.map(img => ({
                media_type: img.mediaType,
                data: img.base64,
              })),
            }),
          });
        }
        triggerSessionRestart();
        setLastAppliedSelection(null);
        return;
      }
      setLastAppliedSelection(currentSelection);
    }

    // Agent 空闲 → 正常流程：插入用户消息 + assistant 占位
    pushLocalUser(newUserMessage);
    pushLiveAssistant({
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
      id: generateLocalMessageId(),
      isStreaming: true,
      contentBlocks: [] as ContentBlock[],
    });

    const conversationTitle = conversationId
      ? useConversationStore.getState().conversations.find((conversation) => conversation.id === conversationId)?.title
      : undefined;
    if (conversationTitle === '新对话' && getMessages().length === 0 && conversationId) {
      const titleText = userMessage.replace(/<[^>]+>/g, '').trim();
      const autoTitle = titleText.length > 30
        ? titleText.slice(0, 30) + '...'
        : titleText;
      if (autoTitle) {
        updateConversationTitle(conversationId, autoTitle);
      }
    }

    setIsLoading(true);

    try {
      // 发送消息到会话（多 content block + 图片附件）
      // sessionId 在此处一定不为 null（handleSend 顶部已提前 return）
      await client.sendQueryBasedSessionMessage({
        sessionId: sessionId!,
        content: messageToSend,
        // 有多个 textBlocks 时使用结构化发送
        ...(textBlocks.length > 1 && { textBlocks }),
        ...(imagesToSend.length > 0 && {
          images: imagesToSend.map(img => ({
            media_type: img.mediaType,
            data: img.base64,
          })),
        }),
      });
    } catch (error) {
      console.error('发送消息失败:', error);
      replaceLastLiveAssistant({
        role: 'assistant',
        content: `错误: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now(),
        id: generateLocalMessageId(),
        contentBlocks: [{
          type: 'error',
          error: error instanceof Error ? error.message : String(error),
          timestamp: Date.now()
        }]
      });
      if (override) {
        // 草稿首条消息发送失败：文本与图片回填该会话输入框，用户手动重发
        toast.error('首条消息发送失败，已回填输入框');
        setInput(userMessage);
        setPendingImages(imagesToSend);
      }
      setIsLoading(false);
    }
  }, [
    readOnly, inputState, pendingImagesProp, sessionId, isSessionReady, handleSlashCommand,
    setInput, setPendingImages, conversationId, currentSelection, isLoading,
    lastAppliedSelection, pushLocalUser, pushLiveAssistant, replaceLastLiveAssistant,
    setIsLoading, updateConversationTitle, getMessages,
    triggerSessionRestart, quotedSnippets, clearQuotedSnippetsFor, messageSnippets, clearMessageSnippetsFor,
    fileSnippets, clearFileSnippetsFor,
    referencedFiles, clearReferencedFilesFor,
    referencedConversations, clearReferencedConversationsFor, referencedSharedFiles,
    clearReferencedSharedFilesFor, referencedNotes, clearReferencedNotesFor, forkConversation,
    handoffDrafts, clearHandoffDraftsFor,
  ]);

  // 键盘事件处理：Ctrl+Enter 发送，Enter 换行
  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  // 草稿首条消息消费：新会话就绪（session ready + 模型明确）后自动发送；
  // consume 原子取出保证只发一次，模型未就绪时等 conversation 加载/用户选择后再触发。
  // 草稿选过权限模式时先应用到新会话（IPC + 本地 state）再发送，失败仅 toast 不阻断发送
  useEffect(() => {
    if (!isSessionReady || !conversationId || !currentSelection || !sessionId) return;
    const draft = useDraftStore.getState();
    const pending = draft.pendingFirstMessage;
    if (!pending || pending.conversationId !== conversationId) return;
    const consumed = draft.consumePendingFirstMessage();
    if (!consumed) return;
    void (async () => {
      if (consumed.permissionMode) {
        try {
          const result = await client.setPermissionMode({ sessionId, mode: consumed.permissionMode });
          if ('error' in result) {
            toast.error('权限模式应用失败', { description: result.error });
          } else {
            setPermissionMode(consumed.permissionMode);
          }
        } catch {
          toast.error('权限模式应用失败', { description: '会话将以全局默认权限模式运行' });
        }
      }
      await handleSend({
        text: consumed.text,
        images: consumed.images.map((img) => {
          const bytes = Uint8Array.from(atob(img.data), (c) => c.charCodeAt(0));
          return {
            file: new File([bytes], 'image', { type: img.media_type }),
            preview: `data:${img.media_type};base64,${img.data}`,
            base64: img.data,
            mediaType: img.media_type,
          };
        }),
      });
    })();
  }, [isSessionReady, conversationId, currentSelection, handleSend, sessionId, setPermissionMode]);

  return {
    input: inputState,
    setInput,
    handleSend,
    handleKeyPress,
    handleFork,
    handlePermissionResolved,
    handleAskUserResolved,
    handleInterrupt,
    insertModeChangeNotice,
    modeLabels,
    hasPendingUserAction,
  };
}
