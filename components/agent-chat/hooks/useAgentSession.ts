import { useState, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSessionStore } from '@/stores/session-store';
import { useConversationStore } from '@/stores/conversation-store';
import type { PermissionMode } from '@/types/electron-api';
import type { ForkParams } from '@/stores/conversation-store';
import type { Message } from '../types';

interface UseAgentSessionParams {
  conversationId: string | null;
  forkParams: ForkParams | null;
  context: { workspaceId?: string; selectedText?: string };
  useSdkResume: boolean;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  setIsLoading: Dispatch<SetStateAction<boolean>>;
}

export function useAgentSession({
  conversationId,
  forkParams,
  setMessages,
  setIsLoading,
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

  // 启动会话
  useEffect(() => {
    // 竞态保护：快速切换对话时，取消过时的异步操作结果
    let cancelled = false;

    const startSession = async () => {
      try {
        console.log('[interrupt-trace] useAgentSession effect 触发 startSession', {
          conversationId,
          forkParams: !!forkParams,
          sessionRestartTrigger,
        });
        console.log('=== attach conversation runtime ===');
        console.log('conversationId:', conversationId);

        // v4: 判断是否为 fork 模式
        let sdkSessionId: string | undefined;
        let forkSessionFlag: boolean | undefined;
        let resumeSessionAtFlag: string | undefined;
        let clearForkFields: boolean | undefined;

        if (forkParams) {
          // Fork 模式：使用父对话的 sdk_session_id + fork 参数
          sdkSessionId = forkParams.sdkSessionIdToResume;
          forkSessionFlag = forkParams.forkSession;
          resumeSessionAtFlag = forkParams.resumeSessionAt;
          clearForkFields = true;  // 分叉完成后清除后端分叉字段
          console.log('🔀 Fork 模式启动:', { sdkSessionId, forkSession: forkSessionFlag, resumeSessionAt: resumeSessionAtFlag });
        } else if (conversationId) {
          // 正常 resume 模式
          try {
            const convResult = await client.getById({ conversationId, workspaceId: useWorkspaceStore.getState().workspace?.id || '' });
            if (cancelled) return;

            // fork_pending 对话：不启动 SDK 会话，等用户发送第一条消息
            if (convResult.conversation?.fork_pending) {
              console.log('⏳ fork_pending 对话，等待用户输入后再启动 SDK fork 会话');
              setIsSessionReady(true);  // 允许用户发送消息（发送时触发实际 fork）
              return;
            }

            console.log('getById 结果:', convResult);
            if (convResult.conversation?.sdk_session_id) {
              sdkSessionId = convResult.conversation.sdk_session_id;
              console.log('✅ 找到 sdk_session_id，将 resume 会话:', sdkSessionId);
            } else {
              console.log('⚠️ 该对话没有 sdk_session_id，将创建新会话');
            }
          } catch (error) {
            console.error('❌ 获取对话信息失败:', error);
          }
        }

        if (cancelled) return;

        const currentWorkspaceId = useWorkspaceStore.getState().workspace?.id;
        if (!currentWorkspaceId || !conversationId) return;

        const response = await client.attachConversationRuntime({
          conversationId,
          workspaceId: currentWorkspaceId,
          resume: sdkSessionId,
          forkSession: forkSessionFlag,
          resumeSessionAt: resumeSessionAtFlag,
          clearForkFields,
        });

        // 关键：异步操作完成后检查是否已被取消（用户已切换到其他对话）
        if (cancelled) {
          // attachment 已建立但不再需要，立即 detach
          if (response.attachmentId) {
            console.log('attachment 已建立但被取消（用户快速切换），detach:', response.attachmentId);
            client.detachConversationRuntime({ attachmentId: response.attachmentId });
          }
          return;
        }

        console.log('attachConversationRuntime 响应:', response);

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
        console.log('✅ runtime attached:', {
          sessionId: newSessionId,
          attachmentId: newAttachmentId,
          created: response.created,
        });
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

        // fork 模式：如果有 editedMessage，会话 ready 后自动发送（fork_pending 首次发送场景）
        // 纯分叉新对话（forkSession=true 但无 editedMessage）不自动发送，只加载历史等待用户输入
        if (forkParams?.editedMessage && newSessionId) {
          console.log('🔀 Fork 自动发送消息:', forkParams.editedMessage);
          setTimeout(async () => {
            if (cancelled) return;
            try {
              setMessages(prev => [
                ...prev,
                {
                  role: 'user',
                  content: forkParams.editedMessage!,
                  timestamp: Date.now(),
                  forkPointSdkUuid: forkParams.resumeSessionAt,
                },
                {
                  role: 'assistant',
                  content: '',
                  timestamp: Date.now(),
                  isStreaming: true,
                  contentBlocks: [],
                }
              ]);
              setIsLoading(true);
              await client.sendQueryBasedSessionMessage({
                sessionId: newSessionId,
                content: forkParams.editedMessage!
              });
            } catch (error) {
              console.error('Fork 自动发送失败:', error);
            }
          }, 500);
        } else if (forkParams?.forkSession) {
          console.log('🔀 纯分叉模式: 等待历史加载完成，用户自行输入新消息');
        }
      } catch (error) {
        if (!cancelled) {
          console.error('❌ 启动会话异常:', error);
        }
      }
    };

    startSession();

    // 组件卸载或 conversationId/forkParams 变化时：标记取消 + detach 旧 attachment
    return () => {
      cancelled = true;
      console.log('[interrupt-trace] useAgentSession cleanup（可能是依赖变化触发 detach → release）', {
        conversationId,
        hadAttachment: !!attachmentIdRef.current,
        sessionRestartTrigger,
      });
      if (attachmentIdRef.current) {
        console.log('detach attachment:', attachmentIdRef.current);
        client.detachConversationRuntime({ attachmentId: attachmentIdRef.current });
        attachmentIdRef.current = null;
      }
      setSessionId(null);
      setIsSessionReady(false);
    };
  }, [conversationId, forkParams, sessionRestartTrigger]); // 当 conversationId、forkParams 或 sessionRestartTrigger 变化时重启会话

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
