import { useState, useCallback, type Dispatch, type SetStateAction } from 'react';
import { client } from '@/lib/client';
import { useConversationStore } from '@/stores/conversation-store';
import { useReferenceStore } from '@/stores/reference-store';
import { useSlashCommandStore } from '@/stores/slash-command-store';
import type { PermissionMode } from '@/types/electron-api';
import type { Message, ContentBlock } from '../types';
import type { PendingImage } from './useImageAttachment';

interface UseSendMessageParams {
  sessionId: string | null;
  isSessionReady: boolean;
  isLoading: boolean;
  messages: Message[];
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  permissionMode: PermissionMode;
  setPermissionMode: Dispatch<SetStateAction<PermissionMode>>;
  conversationId: string | null;
  pendingImages: PendingImage[];
  setPendingImages: Dispatch<SetStateAction<PendingImage[]>>;
}

/**
 * 消息发送相关逻辑 Hook
 * 包含：分叉、消息发送、权限/AskUser 响应回调、模式切换通知
 */
export function useSendMessage(params: UseSendMessageParams) {
  const {
    sessionId,
    isSessionReady,
    isLoading,
    messages,
    setMessages,
    setIsLoading,
    setPermissionMode,
    conversationId,
    pendingImages,
    setPendingImages,
  } = params;

  const [input, setInput] = useState('');
  const [thinkingLevel, setThinkingLevel] = useState<number>(10000);

  // 从 conversation-store 获取 actions
  const forkConversation = useConversationStore((s) => s.forkConversation);
  const updateConversationTitle = useConversationStore((s) => s.updateConversationTitle);
  const conversationTitle = useConversationStore((s) => s.selectedConversation?.title);

  // 从 reference-store 获取引用数据和清理方法
  const referencedArticles = useReferenceStore((s) => s.referencedArticles);
  const quotedSnippets = useReferenceStore((s) => s.quotedSnippets);
  const clearReferencedArticles = useReferenceStore((s) => s.clearReferencedArticles);
  const clearQuotedSnippets = useReferenceStore((s) => s.clearQuotedSnippets);
  const referencedFiles = useReferenceStore((s) => s.referencedFiles);
  const clearReferencedFiles = useReferenceStore((s) => s.clearReferencedFiles);

  // 权限模式名称映射
  const modeLabels: Record<string, string> = {
    'bypassPermissions': '自动执行',
    'acceptEdits': '允许编辑',
    'default': '需确认',
    'plan': '仅规划',
  };

  // 检查是否有未处理的权限请求或 AskUser 问题，有则隐藏普通输入框
  const hasPendingUserAction = messages.some(msg =>
    msg.contentBlocks?.some(b =>
      (b.type === 'permission_request' && !b.permissionResolved) ||
      (b.type === 'ask_user_question' && !b.askUserResolved)
    )
  );

  // 在对话中插入模式切换通知
  const insertModeChangeNotice = useCallback((newMode: string) => {
    setMessages(prev => {
      const updated = [...prev];
      const lastIdx = updated.length - 1;
      const statusText = newMode === 'plan'
        ? `权限模式已切换为「${modeLabels[newMode] || newMode}」— AI 将先描述计划而不执行操作。确认后可切换到「允许编辑」模式来执行。`
        : `权限模式已切换为「${modeLabels[newMode] || newMode}」`;
      const noticeBlock: ContentBlock = {
        type: 'status',
        status: statusText,
        timestamp: Date.now(),
      };
      // 插入到当前 assistant 消息中，或创建新 assistant 消息
      if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
        const lastMsg = updated[lastIdx];
        updated[lastIdx] = {
          ...lastMsg,
          contentBlocks: [...(lastMsg.contentBlocks || []), noticeBlock],
        };
      } else {
        updated.push({
          role: 'assistant',
          content: '',
          timestamp: Date.now(),
          contentBlocks: [noticeBlock],
        });
      }
      return updated;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 权限确认响应回调：更新消息中对应权限请求块的状态
  const handlePermissionResolved = useCallback(async (requestId: string, behavior: 'allow' | 'deny' | 'always_allow', denyMessage?: string) => {
    setMessages(prev => prev.map(msg => {
      if (!msg.contentBlocks) return msg;
      const hasTarget = msg.contentBlocks.some(b => b.permissionRequestId === requestId);
      if (!hasTarget) return msg;
      return {
        ...msg,
        contentBlocks: msg.contentBlocks.map(b =>
          b.permissionRequestId === requestId
            ? { ...b, permissionResolved: behavior, ...(denyMessage ? { permissionDenyMessage: denyMessage } : {}) }
            : b
        ),
      };
    }));

    // "总是允许"：切换到自动执行模式并插入通知
    if (behavior === 'always_allow' && sessionId) {
      setPermissionMode('bypassPermissions');
      await client.setPermissionMode({ sessionId, mode: 'bypassPermissions' });
      // 插入模式切换通知
      insertModeChangeNotice('bypassPermissions');
    }
  }, [sessionId, setMessages, setPermissionMode, insertModeChangeNotice]);

  // AskUserQuestion 响应回调：更新消息中对应问答块的状态
  const handleAskUserResolved = useCallback((requestId: string, answers: Record<string, string>) => {
    setMessages(prev => prev.map(msg => {
      if (!msg.contentBlocks) return msg;
      const hasTarget = msg.contentBlocks.some(b => b.askUserRequestId === requestId);
      if (!hasTarget) return msg;
      return {
        ...msg,
        contentBlocks: msg.contentBlocks.map(b =>
          b.askUserRequestId === requestId
            ? { ...b, askUserResolved: true, askUserAnswers: answers }
            : b
        ),
      };
    }));
  }, [setMessages]);

  /**
   * 从某条 assistant 消息处分叉新对话
   */
  const handleFork = useCallback((assistantSdkUuid: string) => {
    if (!conversationId) return;
    forkConversation({
      parentConversationId: conversationId,
      forkMessageSdkUuid: assistantSdkUuid,
    });
  }, [conversationId, forkConversation]);

  // 斜杠命令拦截处理，返回 true 表示已处理（不走正常发送流程）
  const handleSlashCommand = useCallback(async (text: string): Promise<boolean> => {
    const trimmed = text.trim();
    if (!trimmed.startsWith('/') || !sessionId) return false;

    const parts = trimmed.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    switch (cmd) {
      case '/clear': {
        // 前端清空消息 + 关闭当前会话
        setMessages([]);
        setIsLoading(false);
        try {
          await client.closeQueryBasedSession({ sessionId });
        } catch (e) {
          console.warn('关闭旧会话失败:', e);
        }
        // 通过 store 触发新对话创建
        useConversationStore.getState().newConversation();
        return true;
      }

      case '/compact': {
        // 直接发送给 SDK 处理（SDK 内置命令）
        setInput('');
        // 插入状态提示
        setMessages(prev => {
          const compactingBlock: ContentBlock = {
            type: 'compacting',
            timestamp: Date.now(),
          };
          const lastIdx = prev.length - 1;
          if (lastIdx >= 0 && prev[lastIdx].role === 'assistant') {
            const updated = [...prev];
            updated[lastIdx] = {
              ...prev[lastIdx],
              contentBlocks: [...(prev[lastIdx].contentBlocks || []), compactingBlock],
            };
            return updated;
          }
          return [...prev, {
            role: 'assistant' as const,
            content: '',
            timestamp: Date.now(),
            contentBlocks: [compactingBlock],
          }];
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
        // 转换为自然语言搜索提示，让 Agent 使用 SearchBookContent 工具
        const searchPrompt = `请在当前书籍中搜索与「${args}」相关的内容，使用 SearchBookContent 工具查找相关段落并总结结果。`;
        // 替换 input 为搜索提示，走正常发送流程
        setInput('');
        // 直接发送构造的 prompt
        setMessages(prev => [
          ...prev,
          { role: 'user' as const, content: `/search ${args}`, timestamp: Date.now() },
          { role: 'assistant' as const, content: '', timestamp: Date.now(), isStreaming: true, contentBlocks: [] },
        ]);
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
          setMessages(prev => [
            ...prev,
            { role: 'user' as const, content: trimmed, timestamp: Date.now(), isMeta: true },
          ]);
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
  }, [sessionId, setInput, setMessages, setIsLoading]);

  // 发送消息
  const handleSend = async () => {
    const hasText = !!input.trim();
    const hasImages = pendingImages.length > 0;
    if (!hasText && !hasImages) return;

    // fork_pending 对话没有 sessionId，但允许发送（会触发 SDK fork 创建）
    const isForkPending = useConversationStore.getState().selectedConversation?.fork_pending;
    if (!isForkPending && (!sessionId || !isSessionReady)) return;

    // 斜杠命令拦截
    if (hasText && !hasImages && await handleSlashCommand(input)) {
      return;
    }

    // fork_pending 模式：首次发送消息时启动 SDK fork 会话
    const selectedConv = useConversationStore.getState().selectedConversation;
    if (selectedConv?.fork_pending && selectedConv.parent_conversation_id) {
      const userMessage = input;
      setInput('');

      // 获取父对话 sdk_session_id
      const { useWorkspaceStore } = await import('@/stores/workspace-store');
      const parentResult = await client.getById({
        conversationId: selectedConv.parent_conversation_id,
        workspaceId: useWorkspaceStore.getState().workspace?.id || '',
      });
      const parentSdkSessionId = parentResult.conversation?.sdk_session_id;

      if (!parentSdkSessionId) {
        console.warn('无法启动分叉会话: 父对话缺少 SDK session');
        return;
      }

      // 通过 forkParams 触发 SDK fork 会话创建，useAgentSession 会自动发送 editedMessage
      useConversationStore.getState().setForkParams({
        sdkSessionIdToResume: parentSdkSessionId,
        forkSession: true,
        resumeSessionAt: selectedConv.fork_message_sdk_uuid || '',
        editedMessage: userMessage,
        targetConversationId: selectedConv.id,
      });

      // 清除 fork_pending 状态：后端 + 前端同步
      // 后端 clearForkFields 在 agent.ts session_init 中执行，这里只需前端同步
      const clearFields = { fork_pending: false, parent_conversation_id: undefined, fork_message_sdk_uuid: undefined };
      useConversationStore.setState((state) => ({
        selectedConversation: state.selectedConversation?.id === selectedConv.id
          ? { ...state.selectedConversation, ...clearFields }
          : state.selectedConversation,
        conversations: state.conversations.map((c) =>
          c.id === selectedConv.id ? { ...c, ...clearFields } : c
        ),
      }));
      return;
    }

    const userMessage = input;
    const imagesToSend = [...pendingImages];
    setInput('');
    setPendingImages([]);

    // 构建多 content block 发送结构：每种引用独立为一个 text block，使用 XML 标签包裹
    const textBlocks: Array<{ text: string }> = [];

    // 清理文本中的换行符
    const sanitize = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

    // 整篇文章引用：独立 block，agent 通过 ReadArticle tool 读取
    if (referencedArticles.length > 0) {
      const refLines = referencedArticles.map(a =>
        `  <article title="${sanitize(a.title)}" articleId="${a.id}"${a.siteName ? ` site="${sanitize(a.siteName)}"` : ''} />`
      ).join('\n');
      textBlocks.push({
        text: `<referenced_articles>\n${refLines}\n</referenced_articles>`
      });
      clearReferencedArticles();
    }

    // 文字片段引用：独立 block，直接内联内容
    if (quotedSnippets.length > 0) {
      for (const s of quotedSnippets) {
        textBlocks.push({
          text: `<quoted_snippet source="${sanitize(s.articleTitle)}">\n${sanitize(s.text)}\n</quoted_snippet>`
        });
      }
      clearQuotedSnippets();
    }

    // 文件引用：独立 block，agent 通过 Read 工具读取文件内容
    if (referencedFiles.length > 0) {
      const refLines = referencedFiles.map(f =>
        `  <file name="${sanitize(f.name)}" path="${sanitize(f.path)}" />`
      ).join('\n');
      textBlocks.push({
        text: `<referenced_files>\n${refLines}\n</referenced_files>`
      });
      clearReferencedFiles();
    }

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
    console.log('  引用文章数:', referencedArticles.length);
    console.log('  用户消息:', userMessage);
    console.log('╚════════════════════════════════════════════════════════════════╝');
    console.log('');

    // 创建用户消息对象（存储完整内容含引用前缀，由 parseUserMessageReferences 解析渲染）
    const newUserMessage: Message = {
      role: 'user',
      content: messageToSend,
      timestamp: Date.now(),
      ...(imagesToSend.length > 0 && { images: imagesToSend.map(img => ({ preview: img.preview })) }),
    };

    // 添加用户消息，Agent 运行中时标记为排队
    setMessages(prev => [...prev, {
      ...newUserMessage,
      isQueued: isLoading,  // Agent 运行中时标记为排队
    }, ...(isLoading ? [] : [{
      role: 'assistant' as const,
      content: '' as string,
      timestamp: Date.now(),
      isStreaming: true,
      contentBlocks: [] as ContentBlock[],
    }])]);

    // 新对话自动标题：首条消息截取前 30 字
    if (conversationTitle === '新对话' && messages.length === 0 && conversationId) {
      const titleText = userMessage.replace(/<[^>]+>/g, '').trim();
      const autoTitle = titleText.length > 30
        ? titleText.slice(0, 30) + '...'
        : titleText;
      if (autoTitle) {
        updateConversationTitle(conversationId, autoTitle);
      }
    }

    // 仅在非排队时才设置 loading
    if (!isLoading) {
      setIsLoading(true);
    }

    try {
      // 发送消息到会话（多 content block + 图片附件）
      // sessionId 在此处一定不为 null（fork_pending 分支已提前 return）
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

  // 键盘事件处理：Ctrl+Enter 发送，Enter 换行
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSend();
    }
  };

  return {
    input,
    setInput,
    thinkingLevel,
    setThinkingLevel,
    handleSend,
    handleKeyPress,
    handleFork,
    handlePermissionResolved,
    handleAskUserResolved,
    insertModeChangeNotice,
    modeLabels,
    hasPendingUserAction,
  };
}
