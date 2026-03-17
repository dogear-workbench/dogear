import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { toast } from 'sonner';
import { rendererEvents } from '@/lib/events';
import type { PermissionMode } from '@/types/electron-api';
import type { Message, ContentBlock } from '../types';

interface UseSessionEventsParams {
  sessionId: string | null;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setPermissionMode: Dispatch<SetStateAction<PermissionMode>>;
}

/**
 * 会话事件监听 Hook
 * 监听完成事件、权限请求、权限模式变更、AskUser 问题、Agent 通知等事件
 */
export function useSessionEvents({
  sessionId,
  setMessages,
  setIsLoading,
  setPermissionMode,
}: UseSessionEventsParams): void {
  useEffect(() => {
    if (!sessionId) return;

    // 1. 监听会话完成事件
    const unsubComplete = rendererEvents.queryBasedSessionComplete.listen((data) => {
      if (data.sessionId !== sessionId) return;

      console.log('收到会话完成事件:', data);

      // 结束加载状态
      setIsLoading(false);

      // 更新最后一条消息的流式状态
      setMessages(prev => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;
        if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
          updated[lastIdx] = {
            ...updated[lastIdx],
            isStreaming: false
          };
        }
        return updated;
      });
    });

    // 2. 监听权限请求
    const unsubPermReq = rendererEvents.permissionRequest.listen((data) => {
      if (data.sessionId !== sessionId) return;

      console.log('📋 收到权限确认请求:', data);

      // 将权限请求作为内容块插入到当前 assistant 消息中
      setMessages(prev => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;

        // 找到当前 assistant 消息，插入权限请求块
        if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
          const lastMsg = updated[lastIdx];
          const blocks = lastMsg.contentBlocks || [];
          const newBlock: ContentBlock = {
            type: 'permission_request',
            timestamp: Date.now(),
            permissionRequestId: data.requestId,
            permissionToolName: data.toolName,
            permissionInput: data.toolInput,
            permissionDecisionReason: data.decisionReason,
          };
          updated[lastIdx] = {
            ...lastMsg,
            contentBlocks: [...blocks, newBlock],
          };
        }

        return updated;
      });
    });

    // 3. 监听后端权限模式变更（双向同步）
    const unsubPermMode = rendererEvents.permissionModeChanged.listen((data) => {
      if (data.sessionId !== sessionId) return;
      console.log('🔄 权限模式已由后端变更:', data.mode);
      setPermissionMode(data.mode as PermissionMode);
    });

    // 4. 监听 AskUser 问题
    const unsubAskUser = rendererEvents.askUserQuestion.listen((data) => {
      if (data.sessionId !== sessionId) return;

      console.log('❓ 收到 AskUserQuestion 请求:', data);

      // 将问答请求作为内容块插入到当前 assistant 消息中
      setMessages(prev => {
        const updated = [...prev];
        const lastIdx = updated.length - 1;

        if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
          const lastMsg = updated[lastIdx];
          const blocks = lastMsg.contentBlocks || [];
          const newBlock: ContentBlock = {
            type: 'ask_user_question',
            timestamp: Date.now(),
            askUserRequestId: data.requestId,
            askUserQuestions: data.questions,
          };
          updated[lastIdx] = {
            ...lastMsg,
            contentBlocks: [...blocks, newBlock],
          };
        }

        return updated;
      });
    });

    // 5. 监听 Agent 通知事件（Notification hook 触发的系统级通知）
    const unsubNotify = rendererEvents.agentNotification.listen((data) => {
      if (data.sessionId !== sessionId) return;
      console.log('🔔 收到 Agent 通知:', data);
      // 通过 Sonner toast 展示 Agent 通知
      toast.info(data.title || 'Agent 通知', {
        description: data.message,
      });
    });

    return () => {
      unsubComplete();
      unsubPermReq();
      unsubPermMode();
      unsubAskUser();
      unsubNotify();
    };
  }, [sessionId]);
}
