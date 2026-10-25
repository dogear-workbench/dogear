import type { Conversation } from '@/components/ConversationList';

export interface ConversationTreeNode {
  conv: Conversation;
  children: ConversationTreeNode[];
}

/** 组内排序冻结区大小：前 K 位不因提顶重排（「正在看的列表别动」），位次 ≥ K 的会话有动静才 bump */
export const SORT_FREEZE_K = 5;

export function conversationSortKey(conv: Conversation, lastBumpById?: Record<string, number>): number {
  const bump = lastBumpById?.[conv.id];
  return (bump ? new Date(bump) : new Date(conv.updatedAt)).getTime();
}

export function conversationRankInGroup(
  conversations: Conversation[],
  conversationId: string,
  lastBumpById?: Record<string, number>,
): number {
  const target = conversations.find((c) => c.id === conversationId);
  if (!target) return -1;
  const key = conversationSortKey(target, lastBumpById);
  return conversations.filter(
    (c) => c.groupId === target.groupId && c.id !== conversationId && conversationSortKey(c, lastBumpById) > key,
  ).length;
}

/**
 * 组内会话树：根排序先按挂起态（pinned 前置，组内 pinnedAt 倒序），其余按活跃键（bump 时间优先，退回 updatedAt）倒序；
 * agent 派出会话挂在派出者下（createdAt 升序）。
 * 派出者不在当前列表（已删除/不在同组）时，该 agent 会话回落到自然时间序位置作为根。
 * 输入不可变，返回新结构。
 */
export function buildConversationTree(conversations: Conversation[], lastBumpById?: Record<string, number>): ConversationTreeNode[] {
  const base = [...conversations].sort((a, b) => {
    const pa = a.pinnedAt ?? 0;
    const pb = b.pinnedAt ?? 0;
    if ((pa !== 0) !== (pb !== 0)) return pa !== 0 ? -1 : 1;
    if (pa !== 0 && pb !== 0 && pa !== pb) return pb - pa;
    return conversationSortKey(b, lastBumpById) - conversationSortKey(a, lastBumpById);
  });

  const bySessionId = new Map<string, Conversation>();
  for (const c of base) {
    if (c.sessionId) bySessionId.set(c.sessionId, c);
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
    list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  const nodeByConvId = new Map<string, ConversationTreeNode>();
  const build = (c: Conversation): ConversationTreeNode => {
    const memo = nodeByConvId.get(c.id);
    if (memo) return memo;
    const node: ConversationTreeNode = { conv: c, children: [] };
    nodeByConvId.set(c.id, node);
    node.children = ((c.sessionId ? childrenBySessionId.get(c.sessionId) : undefined) ?? []).map(build);
    return node;
  };

  const roots = base.filter((c) => !isChild(c)).map(build);
  for (const c of base) {
    if (!nodeByConvId.has(c.id)) roots.push(build(c));
  }
  return roots;
}
