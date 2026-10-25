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
  panelActive?: boolean;
}

export function useAgentSession({
  conversationId,
  archived,
  setIsLoading,
  onLiveSnapshot,
  workspaceId,
  panelActive,
}: UseAgentSessionParams) {
  // 监听 sessionRestartTrigger，变化时重建会话
  const sessionRestartTrigger = useConversationStore((s) => s.sessionRestartTrigger);
  const activeTabId = useSessionStore((s) => s.activeTabId);
  const aliveConversationIds = useConversationStore((s) => s.aliveConversationIds);
  const pinnedAt = useConversationStore((s) => {
    if (!conversationId) return undefined;
    for (const slice of Object.values(s.byWorkspace)) {
      const conv = slice.conversations.find((c) => c.id === conversationId);
      if (conv) return conv.pinnedAt;
    }
    return undefined;
  });
  const [sessionId, setSessionId] = useState<string | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const attachmentIdRef = useRef<string | null>(null);
  const attachEpochRef = useRef(0);
  const attachInFlightRef = useRef(false);
  const lastLaunchKeyRef = useRef('');
  const prevTriggerRef = useRef(sessionRestartTrigger);
  const [isSessionReady, setIsSessionReady] = useState(false);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('default');
  const [pendingCount, setPendingCount] = useState(0);

  // 同步 sessionId 到 ref
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // retained 管「已有 attachment 是否保留」（激活/绿线亮/钉住切走不销毁），attachable 管「是否拉起」（钉住冷会话绿条仅标记，不拉起）
  const isActive = conversationId !== null && activeTabId === conversationId;
  const isAlive = conversationId !== null && aliveConversationIds.has(conversationId);
  const retained = isActive || isAlive || !!pinnedAt || panelActive === true;
  const attachable = isActive || isAlive || panelActive === true;

  // 启动会话：conversation.sessionId 已经决定了 resume 目标（新建/分叉/恢复都由后端统一解析），
  // 这里只需 attach，不需要预先判断 resume/fork 参数。
  useEffect(() => {
    const forcedRestart = prevTriggerRef.current !== sessionRestartTrigger;
    prevTriggerRef.current = sessionRestartTrigger;

    // in-flight 守卫：同对话的旁路重跑（alive 广播换 Set / 切 tab / 钉住变化）不双发 attach；
    // 拉起目标变化（切对话 / 跨工作区移入）与 forcedRestart 属正确性路径不受守卫限制，靠 epoch 让旧请求自弃
    const launchKey = `${conversationId ?? ''}|${workspaceId ?? ''}`;
    if (attachInFlightRef.current && !forcedRestart && lastLaunchKeyRef.current === launchKey) return;

    const startSession = async () => {
      if (archived || !conversationId || !attachable) return;

      // 强制重建（failover / 跨 profile 切模型重启）时先释放旧 attachment 再重 attach
      if (attachmentIdRef.current) {
        if (!forcedRestart) return;
        client.detachConversationRuntime({ attachmentId: attachmentIdRef.current });
        attachmentIdRef.current = null;
        setSessionId(null);
        setIsSessionReady(false);
      }

      const currentWorkspaceId = workspaceId ?? useWorkspaceStore.getState().workspace?.id;
      if (!currentWorkspaceId) return;

      // 每轮拉起（新 attach / pre-attach 复用）推进 epoch：上一轮在飞 attach 的结果过期自弃
      const myEpoch = ++attachEpochRef.current;
      lastLaunchKeyRef.current = launchKey;

      // 检查草稿落盘（draft-store.createAndSend）预 attach 的结果，直接复用（跳过重复 attach）
      const preAttached = useConversationStore.getState().preAttachedSession;
      if (preAttached && preAttached.conversationId === conversationId) {
        useConversationStore.getState().setPreAttachedSession(null);
        attachmentIdRef.current = preAttached.attachmentId;
        setSessionId(preAttached.sessionId);
        setPermissionMode(preAttached.permissionMode as PermissionMode);
        useConversationStore.getState().setRunningState(conversationId, preAttached.sessionState.running);
        useConversationStore.getState().setPendingActionState(conversationId, preAttached.sessionState.pendingAction);
        useConversationStore.getState().setPausedState(conversationId, preAttached.sessionState.paused);
        onLiveSnapshot?.(preAttached.snapshot, preAttached.pendingPermissionRequests, preAttached.turnEntryIds);
        setIsSessionReady(true);
        return;
      }

      attachInFlightRef.current = true;
      const settleInFlight = () => {
        if (attachEpochRef.current === myEpoch) attachInFlightRef.current = false;
      };

      try {
        const response = await client.attachConversationRuntime({
          conversationId,
          workspaceId: currentWorkspaceId,
        });

        settleInFlight();

        // epoch 过期：本轮拉起已被切对话 / forcedRestart / 卸载取代，成功结果立即 detach，错误静默
        if (attachEpochRef.current !== myEpoch) {
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

        // 跨 profile 切换模型重启后：消费待续发载荷，自动 send 用户原本要发的消息
        // （UI 上 useSendMessage 已经插过 user message + 状态块，这里只补发实际请求）
        const pendingSend = useConversationStore.getState().pendingSendAfterRestart;
        if (pendingSend && pendingSend.conversationId === conversationId && newSessionId) {
          useConversationStore.getState().setPendingSendAfterRestart(null);
          setTimeout(async () => {
            if (attachEpochRef.current !== myEpoch) return;
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
        settleInFlight();
        if (attachEpochRef.current === myEpoch) {
          console.error('❌ 启动会话异常:', error);
        }
      }
    };

    startSession();
    // 无 cleanup：旁路重跑不打断在飞 attach（cancelled 模型曾因此丢弃成功结果引发 attach-销毁振荡），
    // 过期结果由 epoch 自弃；释放走下方 retained effect 与卸载兜底
    // workspaceId 入依赖：会话跨工作区移入（移入工作区）后 JSONL 换目录，tab.workspaceId 变化驱动重 attach 到新路径
  }, [conversationId, archived, sessionRestartTrigger, onLiveSnapshot, workspaceId, activeTabId, aliveConversationIds, pinnedAt, panelActive]);

  // 保留判定失败（绿线灭 + 非激活）时释放：detach 后后端 refCount/orphan 接管销毁
  useEffect(() => {
    if (retained || !attachmentIdRef.current) return;
    client.detachConversationRuntime({ attachmentId: attachmentIdRef.current });
    attachmentIdRef.current = null;
    setSessionId(null);
    setIsSessionReady(false);
  }, [retained]);

  // 卸载兜底：保留判定只约束依赖重跑，组件卸载必须无条件释放（running 时由后端 orphan 保活接管）；
  // epoch 推进让在飞 attach 收尾时自知过期并 detach，不泄漏
  useEffect(() => {
    return () => {
      attachEpochRef.current++;
      if (attachmentIdRef.current) {
        client.detachConversationRuntime({ attachmentId: attachmentIdRef.current });
        attachmentIdRef.current = null;
      }
    };
  }, []);

  // 订阅 pendingCountChanged：跟踪本会话的待处理插话队列长度
  useEffect(() => {
    if (!sessionId) {
      setPendingCount(0);
      return;
    }
    const unsub = rendererEvents.pendingCountChanged.listen((data) => {
      if (data.sessionId !== sessionId) return;
      setPendingCount(data.count);
    });
    return () => { unsub(); };
  }, [sessionId]);

  return { sessionId, sessionIdRef, isSessionReady, permissionMode, setPermissionMode, pendingCount };
}
