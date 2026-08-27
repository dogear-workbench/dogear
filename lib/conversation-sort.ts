import type { Conversation } from '@/components/ConversationList';

export interface ConversationTreeNode {
  conv: Conversation;
  children: ConversationTreeNode[];
}

/**
 * 组内会话树：手动会话按 updated_at 倒序作为根；agent 派出会话挂在派出者下（created_at 升序）。
 * 派出者不在当前列表（已删除/不在同组）时，该 agent 会话回落到自然时间序位置作为根。
 * 输入不可变，返回新结构。
 */
export function buildConversationTree(conversations: Conversation[]): ConversationTreeNode[] {
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

  const nodeByConvId = new Map<string, ConversationTreeNode>();
  const build = (c: Conversation): ConversationTreeNode => {
    const memo = nodeByConvId.get(c.id);
    if (memo) return memo;
    const node: ConversationTreeNode = { conv: c, children: [] };
    nodeByConvId.set(c.id, node);
    node.children = ((c.session_id ? childrenBySessionId.get(c.session_id) : undefined) ?? []).map(build);
    return node;
  };

  const roots = base.filter((c) => !isChild(c)).map(build);
  for (const c of base) {
    if (!nodeByConvId.has(c.id)) roots.push(build(c));
  }
  return roots;
}
