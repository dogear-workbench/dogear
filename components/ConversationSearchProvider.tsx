import { useEffect } from 'react';
import { isSentinelTabId, useSessionStore, DRAFT_VIEW_ID } from '@/stores/session-store';
import { registerProvider, unregisterProvider, type SearchProvider } from '@/stores/search-store';

function createConversationSearchProvider(): SearchProvider {
  return {
    id: 'conversation-content',
    placeholder: '搜索当前会话',
    mode: 'conversation',
    isActive: () => {
      const s = useSessionStore.getState();
      return (
        s.activeTabId !== DRAFT_VIEW_ID
        && !isSentinelTabId(s.activeTabId)
        && !s.sessionWindowIds.has(s.activeTabId)
      );
    },
    search: () => [],
  };
}

export function ConversationSearchProvider() {
  useEffect(() => {
    const provider = createConversationSearchProvider();
    registerProvider(provider);
    return () => unregisterProvider(provider.id);
  }, []);
  return null;
}
