import { useEffect, useState } from 'react';
import { client } from '@/lib/client';
import { useConversationStore } from '@/stores/conversation-store';
import { useGroupStore } from '@/stores/group-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import type { Conversation } from '@/components/ConversationList';

type TopicState = 'loading' | 'active' | 'archived' | 'missing';

export function useTopicArchiveState(conversationId: string | null, workspaceId?: string | null) {
  const knownConversation = useConversationStore((state) => (
    conversationId
      ? state.conversations.find((conversation) => conversation.id === conversationId) ?? null
      : null
  ));
  const globalWsId = useWorkspaceStore((state) => state.workspace?.id ?? null);
  const effectiveWsId = workspaceId ?? globalWsId;
  const [resolvedConversation, setResolvedConversation] = useState<Conversation | null>(null);
  const [topicState, setTopicState] = useState<TopicState>(conversationId ? 'loading' : 'active');

  const conversation = knownConversation ?? resolvedConversation;
  const groupId = conversation?.groupId ?? null;
  const group = useGroupStore((state) => (
    groupId ? state.groups.find((candidate) => candidate.id === groupId) : undefined
  ));
  const currentGroup = group;

  useEffect(() => {
    let cancelled = false;

    if (!conversationId) {
      setResolvedConversation(null);
      setTopicState('active');
      return;
    }

    if (!effectiveWsId) {
      setTopicState('loading');
      return;
    }

    setTopicState('loading');
    const resolve = async () => {
      try {
        let currentConversation = conversation;
        if (!currentConversation) {
          const response = await client.getById({ conversationId, workspaceId: effectiveWsId });
          if (cancelled) return;
          currentConversation = response.conversation ?? null;
          setResolvedConversation(currentConversation);
        }

        if (!currentConversation?.groupId) {
          if (!cancelled) setTopicState('missing');
          return;
        }

        let resolvedGroup = currentGroup;
        if (!resolvedGroup) {
          const response = await client.getGroup({ workspaceId: effectiveWsId, groupId: currentConversation.groupId });
          if (cancelled) return;
          resolvedGroup = response.group ?? undefined;
        }
        if (cancelled) return;
        if (!resolvedGroup) {
          setTopicState('missing');
          return;
        }
        setTopicState(resolvedGroup.archivedAt === undefined ? 'active' : 'archived');
      } catch {
        if (!cancelled) setTopicState('missing');
      }
    };

    void resolve();
    return () => {
      cancelled = true;
    };
  }, [conversationId, conversation, currentGroup, effectiveWsId]);

  return { conversation, topicState };
}
