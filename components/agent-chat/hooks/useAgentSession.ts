import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSessionStore } from '@/stores/session-store';
import { useConversationStore } from '@/stores/conversation-store';
import type { TranscriptEvent } from './useTranscriptState';
import type { PermissionMode } from '@/types/electron-api';

export interface LivePermissionRequest {
  requestId: string;
  toolName: string;
  toolInput: unknown;
}

interface UseAgentSessionParams {
  conversationId: string | null;
  archived: boolean;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
  onLiveSnapshot?: (snapshot: TranscriptEvent[], pendingPermissionRequests: LivePermissionRequest[], turnEntryIds?: string[]) => void;
  workspaceId?: string | null;
}

export function useAgentSession({
  conversationId,
  archived,
  setIsLoading,
  onLiveSnapshot,
  workspaceId,
}: UseAgentSessionParams) {
  // 监听 sessionRestartTrigger，变化时重建会话
  const sessionRestartTrigger = useConversationStore((s) => s.sessionRestartTrigger);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const attachmentIdRef = useRef<string | null>(null);
  const [isSessionReady, setIsSessionReady] = useState(false);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default');
  const [pendingCount, setPendingCount] = useState(0);

  // 同步 sessionId 到 ref
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // 启动会话：conversation.sessionId 已经决定了 resume 目标（新建/分叉/恢复都由后端统一解析），
  // 这里只需 attach，不需要预先判断 resume/fork 参数。
  useEffect(() => {
    // 竞态保护：快速切换对话时，取消过时的异步操作结果
    let cancelled = false;

    const startSession = async () => {
      if (archived || !conversationId) return;

      const currentWorkspaceId = workspaceId ?? useWorkspaceStore.getState().workspace?.id;
      if (!currentWorkspaceId) return;

      // 检查 newConversation 预 attach 的结果，直接复用（跳过重复 attach）
      const preAttached = useConversationStore.getState().preAttachedSession;
      if (preAttached && preAttached.conversationId === conversationId) {
        useConversationStore.getState().setPreAttachedSession(null);
        if (cancelled) {
          client.detachConversationRuntime({ attachmentId: preAttached.attachmentId });
          return;
        }
        attachmentIdRef.current = preAttached.attachmentId;
        setSessionId(preAttached.sessionId);
        setPermissionMode(preAttached.permissionMode as PermissionMode);
        useConversationStore.getState().setRunningState(conversationId, preAttached.sessionState.running);
        useConversationStore.getState().setPendingActionState(conversationId, preAttached.sessionState.pendingAction);
        useConversationStore.getState().setPausedState(conversationId, preAttached.sessionState.paused);
        onLiveSnapshot?.(preAttached.snapshot, preAttached.pendingPermissionRequests, preAttached.turnEntryIds);
        setIsSessionReady(true);
        useSessionStore.getState().updateSession(
          conversationId,
          preAttached.sessionId,
          preAttached.permissionMode,
          preAttached.attachmentId,
        );
        return;
      }

      try {
        const response = await client.attachConversationRuntime({
          conversationId,
          workspaceId: currentWorkspaceId,
        });

        // 关键：异步操作完成后检查是否已被取消（用户已切换到其他对话）
        if (cancelled) {
          // attachment 已建立但不再需要，立即 detach
          if (response.attachmentId) {
            client.detachConversationRuntime({ attachmentId: response.attachmentId });
          }
          return;
        }

        if (response.error) {
          console.error('❌ attach runtime 失败:', response.error);
          // 活跃会话数达到上限等错误展示给用户
          toast.error('无法打开会话', { description: response.error });
          // 启动失败：清除属于该对话的待续发载荷，避免下次进对话被错误消费
          const pending = useConversationStore.getState().pendingSendAfterRestart;
          if (pending && pending.conversationId === conversationId) {
            useConversationStore.getState().setPendingSendAfterRestart(null);
          }
          return;
        }

        const newSessionId = response.sessionId!;
        const newAttachmentId = response.attachmentId!;
        attachmentIdRef.current = newAttachmentId;
        setSessionId(newSessionId);

        if (response.permissionMode) {
          setPermissionMode(response.permissionMode as PermissionMode);
        }
        if (response.sessionState) {
          useConversationStore.getState().setRunningState(conversationId, response.sessionState.running);
          useConversationStore.getState().setPendingActionState(conversationId, response.sessionState.pendingAction);
          useConversationStore.getState().setPausedState(conversationId, response.sessionState.paused);
        }
        onLiveSnapshot?.(
          response.snapshot ?? [],
          response.pendingPermissionRequests ?? [],
          response.turnEntryIds,
        );
        setIsSessionReady(true);

        // 同步到 session-store（标签页状态）
        useSessionStore.getState().updateSession(
          conversationId,
          newSessionId,
          response.permissionMode || 'default',
          newAttachmentId,
        );

        // 跨 profile 切换模型重启后：消费待续发载荷，自动 send 用户原本要发的消息
        // （UI 上 useSendMessage 已经插过 user message + 状态块，这里只补发实际请求）
        const pendingSend = useConversationStore.getState().pendingSendAfterRestart;
        if (pendingSend && pendingSend.conversationId === conversationId && newSessionId) {
          useConversationStore.getState().setPendingSendAfterRestart(null);
          setTimeout(async () => {
            if (cancelled) return;
            setIsLoading(true);
            try {
              await client.sendQueryBasedSessionMessage({
                sessionId: newSessionId,
                content: pendingSend.content,
                ...(pendingSend.textBlocks && { textBlocks: pendingSend.textBlocks }),
                ...(pendingSend.images && { images: pendingSend.images }),
              });
            } catch (error) {
              console.error('切换模型后自动续发失败:', error);
              setIsLoading(false);
              toast.error('自动续发失败', { description: error instanceof Error ? error.message : String(error) });
            }
          }, 500);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('❌ 启动会话异常:', error);
        }
      }
    };

    startSession();

    // 组件卸载或会话状态变化时：标记取消 + detach 旧 attachment
    return () => {
      cancelled = true;
      if (attachmentIdRef.current) {
        client.detachConversationRuntime({ attachmentId: attachmentIdRef.current });
        attachmentIdRef.current = null;
      }
      setSessionId(null);
      setIsSessionReady(false);
    };
  }, [conversationId, archived, sessionRestartTrigger, onLiveSnapshot]);

  // 订阅 pendingCountChanged：跟踪本会话的待处理插话队列长度
  useEffect(() => {
    if (!sessionId) {
      setPendingCount(0);
      return;
    }
    const unsub = rendererEvents.pendingCountChanged.listen((data) => {
      if (data.sessionId === sessionId) setPendingCount(data.count);
    });
    return () => { unsub(); };
  }, [sessionId]);

  return { sessionId, sessionIdRef, isSessionReady, permissionMode, setPermissionMode, pendingCount };
}
