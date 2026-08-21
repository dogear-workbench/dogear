import { useEffect, useMemo, useState } from 'react';
import { client } from '@/lib/client';
import { useConversationStore } from '@/stores/conversation-store';
import { useGroupStore } from '@/stores/group-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import type { Conversation } from '@/components/ConversationList';

type TopicState = 'loading' | 'active' | 'archived' | 'missing';

export function useTopicArchiveState(conversationId: string | null, workspaceId?: string | null) {
  const selectedConversation = useConversationStore((state) => state.selectedConversation);
  const conversations = useConversationStore((state) => state.conversations);
  const globalWsId = useWorkspaceStore((state) => state.workspace?.id ?? null);
  const effectiveWsId = workspaceId ?? globalWsId;
  const groups = useGroupStore((state) => state.groups);
  const [resolvedConversation, setResolvedConversation] = useState<Conversation | null>(null);
  const [topicState, setTopicState] = useState<TopicState>(conversationId ? 'loading' : 'active');

  const knownConversation = useMemo(() => {
    if (!conversationId) return null;
    if (selectedConversation?.id === conversationId) return selectedConversation;
    return conversations.find((conversation) => conversation.id === conversationId) ?? null;
  }, [conversationId, conversations, selectedConversation]);

  const conversation = knownConversation ?? resolvedConversation;

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
        let currentConversation = knownConversation;
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

        const response = await client.getGroup({ workspaceId: effectiveWsId, groupId: currentConversation.groupId });
        if (cancelled) return;
        if (!response.group) {
          setTopicState('missing');
          return;
        }
        setTopicState(response.group.archivedAt === undefined ? 'active' : 'archived');
      } catch {
        if (!cancelled) setTopicState('missing');
      }
    };

    void resolve();
    return () => {
      cancelled = true;
    };
  }, [conversationId, groups, knownConversation, effectiveWsId]);

  return { conversation, topicState };
}
