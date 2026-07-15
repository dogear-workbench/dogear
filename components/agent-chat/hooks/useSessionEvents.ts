import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { toast } from 'sonner';
import { rendererEvents } from '@/lib/events';
import type { PermissionMode } from '@/types/electron-api';
import type { Message, ContentBlock } from '../types';

interface UseSessionEventsParams {
  sessionId: string | null;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  setPermissionMode: Dispatch<SetStateAction<PermissionMode>>;
  /** 权限请求/AskUser 到达时通知调用方触发滚动 */
  onScrollToAction?: () => void;
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
  onScrollToAction,
}: UseSessionEventsParams): void {
  // 用 ref 存储回调，避免 effect 依赖数组包含回调导致频繁重订阅（过期闭包问题）
  const onScrollToActionRef = useRef(onScrollToAction);
  useEffect(() => {
    onScrollToActionRef.current = onScrollToAction;
  });

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
        const newBlock: ContentBlock = {
          type: 'permission_request',
          timestamp: Date.now(),
          permissionRequestId: data.requestId,
          permissionToolName: data.toolName,
          permissionInput: data.toolInput,
          permissionDecisionReason: data.decisionReason,
        };

        if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
          const lastMsg = updated[lastIdx];
          updated[lastIdx] = {
            ...lastMsg,
            contentBlocks: [...(lastMsg.contentBlocks || []), newBlock],
          };
        } else {
          // 外部启动的会话（agent 派子会话等）没有本地插入的 assistant 占位，
          // 直接 push 一个新 assistant 消息挂块，避免权限请求被丢弃导致会话卡死
          updated.push({
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
            isStreaming: true,
            contentBlocks: [newBlock],
          });
        }

        return updated;
      });

      // 通知滚动到权限请求位置
      onScrollToActionRef.current?.();
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
        const newBlock: ContentBlock = {
          type: 'ask_user_question',
          timestamp: Date.now(),
          askUserRequestId: data.requestId,
          askUserQuestions: data.questions,
        };

        if (lastIdx >= 0 && updated[lastIdx].role === 'assistant') {
          const lastMsg = updated[lastIdx];
          updated[lastIdx] = {
            ...lastMsg,
            contentBlocks: [...(lastMsg.contentBlocks || []), newBlock],
          };
        } else {
          // 同权限请求：外部启动的会话没 assistant 占位，push 新消息挂块避免丢失
          updated.push({
            role: 'assistant',
            content: '',
            timestamp: Date.now(),
            isStreaming: true,
            contentBlocks: [newBlock],
          });
        }

        return updated;
      });

      // 通知滚动到 AskUser 请求位置
      onScrollToActionRef.current?.();
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
