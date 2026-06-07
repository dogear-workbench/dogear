import { create } from 'zustand';
import { client } from '@/lib/client';

export interface ReviewRef {
  sessionId: string;
  uuid: string;
}

export interface ReviewItem {
  kind: string;
  text: string;
  refs: ReviewRef[];
}

export interface ReviewCard {
  reviewedAt: string;
  coveredCount: number;
  items: ReviewItem[];
}

export interface ReviewRecentEntry {
  workspaceId: string;
  finishedAt: number;
  outcome: 'saved' | 'no-card' | 'error';
  tier?: string;
  profileName?: string;
  error?: string;
  durationMs: number;
}

export interface ReviewActivity {
  current: { workspaceId: string; startedAt: number; taskId: string } | null;
  queueDepth: number;
  recent: ReviewRecentEntry[];
  lastScan: { at: number; dirtyCount: number } | null;
}

interface DashboardState {
  reviewCard: ReviewCard | null;
  reviewActivity: ReviewActivity | null;
  notesContent: string;
  notesSaving: boolean;
  reviewRunning: boolean;

  loadReview: (workspaceId: string) => Promise<void>;
  loadNotes: (workspaceId: string) => Promise<void>;
  setNotesLocal: (content: string) => void;
  flushNotes: (workspaceId: string) => Promise<void>;
  triggerReview: (workspaceId: string, workspacePath: string) => Promise<void>;
}

let pollIntervalId: ReturnType<typeof setInterval> | null = null;

export const useDashboardStore = create<DashboardState>((set, get) => ({
  reviewCard: null,
  reviewActivity: null,
  notesContent: '',
  notesSaving: false,
  reviewRunning: false,

  loadReview: async (workspaceId) => {
    try {
      const result = await client.getReviewCard({ workspaceId });
      if ('card' in result) {
        set({ reviewCard: (result.card as ReviewCard) ?? null });
      }
    } catch (error) {
      console.error('[dashboard] loadReview 失败:', error);
    }
  },

  loadNotes: async (workspaceId) => {
    try {
      const result = await client.getNotes({ workspaceId });
      if ('content' in result) {
        set({ notesContent: result.content ?? '' });
      }
    } catch (error) {
      console.error('[dashboard] loadNotes 失败:', error);
    }
  },

  setNotesLocal: (content) => {
    set({ notesContent: content });
  },

  flushNotes: async (workspaceId) => {
    const { notesContent } = get();
    set({ notesSaving: true });
    try {
      await client.saveNotes({ workspaceId, content: notesContent });
    } catch (error) {
      console.error('[dashboard] flushNotes 失败:', error);
    } finally {
      set({ notesSaving: false });
    }
  },

  triggerReview: async (workspaceId, workspacePath) => {
    if (pollIntervalId !== null) return;

    try {
      await client.triggerReview({ workspaceId, workspacePath });
    } catch (error) {
      console.error('[dashboard] triggerReview 失败:', error);
      return;
    }

    set({ reviewRunning: true });

    const stopPoll = (wsId: string) => {
      if (pollIntervalId !== null) {
        clearInterval(pollIntervalId);
        pollIntervalId = null;
      }
      set({ reviewRunning: false });
      get().loadReview(wsId);
    };

    pollIntervalId = setInterval(async () => {
      try {
        const result = await client.getReviewActivity();
        if (!('activity' in result) || !result.activity) return;
        const activity = result.activity as ReviewActivity;
        set({ reviewActivity: activity });

        const stillRunning =
          (activity.current?.workspaceId === workspaceId) ||
          (activity.queueDepth > 0 && activity.recent.length === 0);

        if (!stillRunning) {
          stopPoll(workspaceId);
        }
      } catch (error) {
        console.error('[dashboard] 轮询 getReviewActivity 失败:', error);
      }
    }, 2000);
  },
}));
