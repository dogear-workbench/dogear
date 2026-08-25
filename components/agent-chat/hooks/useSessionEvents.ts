import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { toast } from 'sonner';
import { rendererEvents } from '@/lib/events';
import type { PermissionMode } from '@/types/electron-api';
import type { UseTranscriptStateResult } from './useTranscriptState';

interface UseSessionEventsParams {
  sessionId: string | null;
  transcript: UseTranscriptStateResult;
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
  transcript,
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

    // 1. 监听会话完成事件：关闭尾部流式并触发提升检查（settled 且无 pending → promote）
    const unsubComplete = rendererEvents.queryBasedSessionComplete.listen((data) => {
      if (data.sessionId !== sessionId) return;

      console.log('收到会话完成事件:', data);

      setIsLoading(false);
      transcript.onSessionComplete();
    });

    // 2. 监听权限请求：写 pendingActions + live tail 挂占位 block
    const unsubPermReq = rendererEvents.permissionRequest.listen((data) => {
      if (data.sessionId !== sessionId) return;

      console.log('📋 收到权限确认请求:', data);

      transcript.registerPermission({
        requestId: data.requestId,
        toolName: data.toolName,
        toolInput: data.toolInput,
        decisionReason: data.decisionReason,
      });

      onScrollToActionRef.current?.();
    });

    // 3. 监听后端权限模式变更（双向同步）
    const unsubPermMode = rendererEvents.permissionModeChanged.listen((data) => {
      if (data.sessionId !== sessionId) return;
      console.log('🔄 权限模式已由后端变更:', data.mode);
      setPermissionMode(data.mode as PermissionMode);
    });

    // 4. 监听 AskUser 问题：写 pendingActions + live tail 挂占位 block
    const unsubAskUser = rendererEvents.askUserQuestion.listen((data) => {
      if (data.sessionId !== sessionId) return;

      console.log('❓ 收到 AskUserQuestion 请求:', data);

      transcript.registerAskUser({
        requestId: data.requestId,
        questions: data.questions,
      });

      onScrollToActionRef.current?.();
    });

    // 5. 监听 Agent 通知事件（Notification hook 触发的系统级通知）
    const unsubNotify = rendererEvents.agentNotification.listen((data) => {
      if (data.sessionId !== sessionId) return;
      console.log('🔔 收到 Agent 通知:', data);
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
