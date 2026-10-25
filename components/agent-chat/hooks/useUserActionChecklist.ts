import { useEffect, useState } from 'react';
import { useConversationId } from '../conversation-id-context';

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

export function useUserActionChecklist(toolUseId?: string) {
  const conversationId = useConversationId();
  const key = storageKey(conversationId, toolUseId);
  const [checked, setChecked] = useState<Set<number>>(() => new Set(readCheckedIndices(key)));

  useEffect(() => {
    setChecked(new Set(readCheckedIndices(key)));
  }, [key]);

  const toggle = (index: number) => {
    if (!key || checked.has(index)) return;
    setChecked((prev) => new Set(prev).add(index));
    const indices = readCheckedIndices(key);
    if (!indices.includes(index)) indices.push(index);
    localStorage.setItem(key, JSON.stringify(indices));
  };

  return { checked, toggle };
}
