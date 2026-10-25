import { toast } from 'sonner';
import { client } from '@/lib/client';
import { useConversationStore } from '@/stores/conversation-store';
import { useReferenceStore } from '@/stores/reference-store';
import { useSessionStore, DRAFT_VIEW_ID } from '@/stores/session-store';
import { useInputFocusStore } from '@/stores/input-focus-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { draftAnchorId } from '@/stores/draft-store';
import type { Conversation } from '@/types/electron-api';

async function resolveConversation(conversationId: string, workspaceId: string): Promise<Conversation | null> {
  for (const slice of Object.values(useConversationStore.getState().byWorkspace)) {
    const hit = slice?.conversations.find((c) => c.id === conversationId);
    if (hit) return hit;
  }
  const r = await client.getById({ conversationId, workspaceId });
  return r.conversation ?? null;
}

/** 运行/执行会话条目右键「引用到主会话」：挂到当前工作区草稿锚并切草稿视图（引用链与 SessionHistoryView 原实现一致） */
export async function referenceConversationToMain(conversationId: string, conversationWorkspaceId: string): Promise<void> {
  const workspace = useWorkspaceStore.getState().workspace;
  if (!workspace) {
    toast.warning('请先打开一个工作区，再引用会话');
    return;
  }
  const conv = await resolveConversation(conversationId, conversationWorkspaceId);
  if (!conv) {
    toast.error('会话不存在或已被删除');
    return;
  }
  const anchorId = draftAnchorId(workspace.id);
  useReferenceStore.getState().addReferencedConversation(
    {
      conversationId: conv.id,
      title: conv.title,
      sessionId: conv.sessionId,
      workspaceId: conv.workspaceId,
    },
    anchorId,
  );
  useSessionStore.getState().switchTab(DRAFT_VIEW_ID);
  useInputFocusStore.getState().requestFocus(anchorId);
}
