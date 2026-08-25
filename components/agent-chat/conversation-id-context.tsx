import { createContext, useContext, type ReactNode } from 'react';

const ConversationIdContext = createContext<string | null>(null);

export function ConversationIdProvider({ conversationId, children }: {
  conversationId: string | null;
  children: ReactNode;
}) {
  return (
    <ConversationIdContext.Provider value={conversationId}>
      {children}
    </ConversationIdContext.Provider>
  );
}

export function useConversationId() {
  return useContext(ConversationIdContext);
}
