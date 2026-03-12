import { useState, useCallback, type Dispatch, type SetStateAction } from 'react';
import { client } from '@/lib/client';
import { useConversationStore } from '@/stores/conversation-store';
import { useReferenceStore } from '@/stores/reference-store';
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
 * 包含：编辑重发、分叉、消息发送、权限/AskUser 响应回调、模式切换通知
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
  const editResendAction = useConversationStore((s) => s.editResend);
  const forkConversation = useConversationStore((s) => s.forkConversation);

  // 从 reference-store 获取引用数据和清理方法
  const referencedArticles = useReferenceStore((s) => s.referencedArticles);
  const quotedSnippets = useReferenceStore((s) => s.quotedSnippets);
  const clearReferencedArticles = useReferenceStore((s) => s.clearReferencedArticles);
  const clearQuotedSnippets = useReferenceStore((s) => s.clearQuotedSnippets);

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
   * 编辑重发处理
   * 截断消息到编辑点的 assistant 消息，然后在当前对话内重新发送
   */
  const handleEditResend = useCallback((messageIndex: number, newContent: string) => {
    if (!conversationId) return;

    // 找到该用户消息前面最近的 assistant 消息的 sdkUuid 作为截断点
    let targetAssistantUuid: string | undefined;
    let targetAssistantIdx = -1;
    for (let i = messageIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant' && messages[i].sdkUuid) {
        targetAssistantUuid = messages[i].sdkUuid;
        targetAssistantIdx = i;
        break;
      }
    }

    if (!targetAssistantUuid || targetAssistantIdx < 0) {
      console.warn('编辑的是第一条消息，无法使用 resumeSessionAt，暂不支持');
      return;
    }

    // 截断消息：保留到 forkPoint assistant（含）
    const truncatedMessages = messages.slice(0, targetAssistantIdx + 1);
    setMessages(truncatedMessages);

    // 通过 store action 处理（设置 forkParams + 创建分支记录）
    editResendAction({
      forkPointSdkUuid: targetAssistantUuid,
      editedMessage: newContent,
    });
  }, [conversationId, messages, setMessages, editResendAction]);

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

  // 发送消息
  const handleSend = async () => {
    const hasText = !!input.trim();
    const hasImages = pendingImages.length > 0;
    if ((!hasText && !hasImages) || isLoading || !sessionId || !isSessionReady) return;

    const userMessage = input;
    const imagesToSend = [...pendingImages];
    setInput('');
    setPendingImages([]);

    // 构建实际发送的内容：如果有引用文章或片段，在消息前追加引用提示
    let messageToSend = userMessage;
    const prefixParts: string[] = [];

    // 清理文本中的换行符，确保引用格式每条引用都在单行内，方便后续解析
    const sanitize = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

    // 整篇文章引用：只传 ID，agent 通过 ReadArticle tool 读取
    if (referencedArticles.length > 0) {
      const refLines = referencedArticles.map(a =>
        `- 《${sanitize(a.title)}》(articleId: ${a.id})${a.siteName ? ` - ${sanitize(a.siteName)}` : ''}`
      ).join('\n');
      prefixParts.push(`[引用文章] 以下文章已引用，可使用 ReadArticle 工具读取完整内容：\n${refLines}`);
      clearReferencedArticles();
    }

    // 文字片段引用：直接内联内容，不需要 agent 调 tool
    if (quotedSnippets.length > 0) {
      const snippetLines = quotedSnippets.map(s =>
        `来自《${sanitize(s.articleTitle)}》:\n> ${sanitize(s.text)}`
      ).join('\n\n');
      prefixParts.push(`[引用片段]\n${snippetLines}`);
      clearQuotedSnippets();
    }

    if (prefixParts.length > 0) {
      messageToSend = `${prefixParts.join('\n\n')}\n\n${userMessage}`;
    }

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

    // 添加用户消息
    setMessages(prev => [...prev, newUserMessage]);

    // 添加一个空的助手消息占位，准备接收流式响应
    setMessages(prev => [
      ...prev,
      {
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        isStreaming: true,
        contentBlocks: []
      }
    ]);

    setIsLoading(true);

    try {
      // 发送消息到会话（包含引用提示 + 图片附件）
      await client.sendQueryBasedSessionMessage({
        sessionId,
        content: messageToSend,
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

  // 键盘事件处理：Enter 发送，Shift+Enter 换行
  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
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
    handleEditResend,
    handleFork,
    handlePermissionResolved,
    handleAskUserResolved,
    insertModeChangeNotice,
    modeLabels,
    hasPendingUserAction,
  };
}
