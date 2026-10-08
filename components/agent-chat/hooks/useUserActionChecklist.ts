import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import { useConversationId } from '../conversation-id-context';
import { useWorkspaceId } from '../workspace-id-context';
import { useConversationStore } from '@/stores/conversation-store';

function storageKey(conversationId: string | null, toolUseId?: string): string | null {
  if (!conversationId || !toolUseId) return null;
  return `user-action:${conversationId}:${toolUseId}`;
}

function readCheckedIndices(key: string | null): number[] {
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0))].sort((a, b) => a - b);
  } catch {
    return [];
  }
}

export function useUserActionChecklist(actions: string[], toolUseId?: string) {
  const conversationId = useConversationId();
  const workspaceId = useWorkspaceId();
  const groupId = useConversationStore((s) =>
    conversationId ? s.conversations.find((c) => c.id === conversationId)?.groupId : undefined,
  );
  const key = storageKey(conversationId, toolUseId);
  const [checked, setChecked] = useState<Set<number>>(() => new Set(readCheckedIndices(key)));
  const [busyIndex, setBusyIndex] = useState<number | null>(null);

  useEffect(() => {
    setChecked(new Set(readCheckedIndices(key)));
  }, [key]);

  const toggle = async (index: number, text: string) => {
    if (busyIndex !== null || checked.has(index)) return;
    if (!key || !workspaceId || !groupId) {
      toast.warning('会话不属于话题组，无法记录到状态卡');
      return;
    }
    setBusyIndex(index);
    setChecked((prev) => new Set(prev).add(index));
    try {
      const r = await client.appendStateUserEntry({ workspaceId, groupId, category: 'completed', text });
      if (r.error) {
        toast.error('记入状态卡失败', { description: r.error });
        setChecked((prev) => {
          const rollback = new Set(prev);
          rollback.delete(index);
          return rollback;
        });
        return;
      }
      const indices = readCheckedIndices(key);
      if (!indices.includes(index)) indices.push(index);
      localStorage.setItem(key, JSON.stringify(indices));
    } catch (e) {
      toast.error('记入状态卡失败', { description: e instanceof Error ? e.message : String(e) });
      setChecked((prev) => {
        const rollback = new Set(prev);
        rollback.delete(index);
        return rollback;
      });
    } finally {
      setBusyIndex(null);
    }
  };

  return { checked, busyIndex, toggle };
}
