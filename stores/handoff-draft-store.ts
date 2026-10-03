import { create } from 'zustand';
import { rendererEvents } from '@/lib/events';

/** 浏览器一键移交草稿（等待用户编辑后随消息发出） */
export interface HandoffDraft {
  id: string;
  title: string;
  url: string;
  selectionText?: string;
  textExcerpt?: string;
  createdAt: number;
}

type HandoffDraftInput = Pick<HandoffDraft, 'title' | 'url'> & Partial<Pick<HandoffDraft, 'selectionText' | 'textExcerpt'>>;

interface HandoffDraftState {
  draftsByConversation: Record<string, HandoffDraft[]>;
  addDraft: (conversationId: string, draft: HandoffDraftInput) => void;
  removeDraft: (conversationId: string, draftId: string) => void;
  clearFor: (conversationId: string) => void;
}

let draftSeq = 0;

export const useHandoffDraftStore = create<HandoffDraftState>((set) => ({
  draftsByConversation: {},

  addDraft: (conversationId, draft) => {
    set((state) => {
      draftSeq += 1;
      const entry: HandoffDraft = { ...draft, id: `handoff-${Date.now()}-${draftSeq}`, createdAt: Date.now() };
      return {
        draftsByConversation: {
          ...state.draftsByConversation,
          [conversationId]: [...(state.draftsByConversation[conversationId] ?? []), entry],
        },
      };
    });
  },

  removeDraft: (conversationId, draftId) => {
    set((state) => {
      const list = state.draftsByConversation[conversationId];
      if (!list) return state;
      return {
        draftsByConversation: {
          ...state.draftsByConversation,
          [conversationId]: list.filter((d) => d.id !== draftId),
        },
      };
    });
  },

  clearFor: (conversationId) => {
    set((state) => {
      if (!state.draftsByConversation[conversationId]) return state;
      const next = { ...state.draftsByConversation };
      delete next[conversationId];
      return { draftsByConversation: next };
    });
  },
}));

if (typeof window !== 'undefined' && window.ipcRenderer) {
  rendererEvents.browserHandoffReceived.listen(({ conversationId, title, url, selectionText, textExcerpt }) => {
    useHandoffDraftStore
      .getState()
      .addDraft(conversationId, {
        title,
        url,
        ...(selectionText ? { selectionText } : {}),
        ...(textExcerpt ? { textExcerpt } : {}),
      });
  });
}
