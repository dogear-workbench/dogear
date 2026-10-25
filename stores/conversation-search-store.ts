import { create } from 'zustand';

interface ConversationSearchHandlers {
  setQuery: (q: string) => void;
  next: () => void;
  prev: () => void;
  close: () => void;
}

interface ConversationSearchState {
  query: string;
  unitCount: number;
  unitIndex: number;
}

export const useConversationSearchStore = create<ConversationSearchState>(() => ({
  query: '',
  unitCount: 0,
  unitIndex: 0,
}));

let handlers: ConversationSearchHandlers | null = null;

export function connectConversationSearch(next: ConversationSearchHandlers): void {
  handlers = next;
}

export function disconnectConversationSearch(): void {
  handlers = null;
  useConversationSearchStore.setState({ query: '', unitCount: 0, unitIndex: 0 });
}

export function reportConversationSearch(state: ConversationSearchState): void {
  const cur = useConversationSearchStore.getState();
  if (cur.query === state.query && cur.unitCount === state.unitCount && cur.unitIndex === state.unitIndex) return;
  useConversationSearchStore.setState(state);
}

export const conversationSearchActions = {
  setQuery: (q: string) => handlers?.setQuery(q),
  next: () => handlers?.next(),
  prev: () => handlers?.prev(),
  close: () => handlers?.close(),
};
