import type { Conversation } from '@/components/ConversationList';

/**
 * 组内会话排序：手动会话按时间倒序；agent 会话按 DFS 紧跟派出者。
 * 派出者不在当前列表（已删除/不在同组）时，该 agent 会话回落到自然时间序位置。
 * 输入不可变，返回新数组。
 */
export function sortConversationsWithDFS(conversations: Conversation[]): Conversation[] {
  const base = [...conversations].sort((a, b) => b.updated_at - a.updated_at);

  const bySessionId = new Map<string, Conversation>();
  for (const c of base) {
    if (c.session_id) bySessionId.set(c.session_id, c);
  }

  const parentSessionIdOf = (c: Conversation): string | undefined => {
    const meta = c.contractMetadata;
    return meta?.createdBy === 'agent' ? meta.parentSessionId : undefined;
  };

  const isChild = (c: Conversation): boolean => {
    const parentSessionId = parentSessionIdOf(c);
    return !!parentSessionId && bySessionId.has(parentSessionId);
  };

  const childrenBySessionId = new Map<string, Conversation[]>();
  for (const c of base) {
    if (!isChild(c)) continue;
    const parentSessionId = parentSessionIdOf(c)!;
    const list = childrenBySessionId.get(parentSessionId) ?? [];
    list.push(c);
    childrenBySessionId.set(parentSessionId, list);
  }
  for (const list of childrenBySessionId.values()) {
    list.sort((a, b) => a.created_at - b.created_at);
  }

  const roots = base.filter((c) => !isChild(c));

  const result: Conversation[] = [];
  const visited = new Set<string>();
  const visit = (c: Conversation): void => {
    if (visited.has(c.id)) return;
    visited.add(c.id);
    result.push(c);
    const children = c.session_id ? childrenBySessionId.get(c.session_id) : undefined;
    if (children) {
      for (const child of children) visit(child);
    }
  };
  for (const root of roots) visit(root);

  return result;
}
