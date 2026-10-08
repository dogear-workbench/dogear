import { useConversationStore } from '@/stores/conversation-store';

/**
 * 子会话「已交付且已停跑」判定。三个条件缺一不可：
 * bridge 内存快照存在（从未被派遣/进程重启后丢失的历史子会话不判定为已交付）+
 * delivered 单调事实（dogear__SendMessage delivery:true 落上）+
 * 状态机与本地运行态都非 running（交付发生在工具调用中途，status 仍 running 时不提示）。
 */
export function useSubSessionDelivered(conversationId: string | null | undefined): boolean {
  const snapshot = useConversationStore((s) =>
    conversationId ? s.childSnapshotsById[conversationId] : undefined,
  );
  const running = useConversationStore((s) =>
    conversationId ? s.runningConversationIds.has(conversationId) : false,
  );
  return !!snapshot && snapshot.delivered && snapshot.status !== 'running' && !running;
}
