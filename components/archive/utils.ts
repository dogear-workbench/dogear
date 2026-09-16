import type { ConversationTreeNode } from '@/lib/conversation-sort';

export function countTreeConversations(nodes: ConversationTreeNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countTreeConversations(node.children), 0);
}

/** 主会话行徽标数：挂在其下的子会话递归总数 */
export function countDescendants(node: ConversationTreeNode): number {
  return node.children.reduce((total, child) => total + 1 + countDescendants(child), 0);
}
