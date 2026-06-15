import { create } from 'zustand';
import { client } from '@/lib/client';

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
  reportMarkdown: string | null;
  reportUpdatedAt: string | null;
  reviewActivity: ReviewActivity | null;
  notesContent: string;
  notesSaving: boolean;
  // 正在复盘的工作区 id（null 表示无）。组件按 wsId 派生自己的「复盘中」状态，
  // 避免全局布尔在多工作区间串台。
  reviewRunningWorkspaceId: string | null;
  // 当前仪表盘呈现的工作区，用于轮询结束后判断是否回填到正在看的工作区。
  currentWorkspaceId: string | null;

  setCurrentWorkspace: (workspaceId: string) => void;
  loadReport: (workspaceId: string) => Promise<void>;
  loadNotes: (workspaceId: string) => Promise<void>;
  flushNotes: (workspaceId: string, content: string) => Promise<void>;
  triggerReview: (workspaceId: string, workspacePath: string) => Promise<void>;
}

let pollIntervalId: ReturnType<typeof setInterval> | null = null;

function startReviewPoll(
  set: (partial: Partial<DashboardState>) => void,
  get: () => DashboardState,
): void {
  if (pollIntervalId !== null) return; // 单例轮询：多工作区共享一个定时器
  pollIntervalId = setInterval(async () => {
    try {
      const result = await client.getReviewActivity();
      if (!('activity' in result) || !result.activity) return;
      const activity = result.activity as ReviewActivity;
      set({ reviewActivity: activity });

      const busy = activity.current !== null || activity.queueDepth > 0;
      if (busy) return;

      clearInterval(pollIntervalId!);
      pollIntervalId = null;
      const finishedWs = get().reviewRunningWorkspaceId;
      set({ reviewRunningWorkspaceId: null });
      // 仅当生成完成的工作区仍是当前呈现的工作区时，才回填报告，
      // 否则会把别的工作区的报告刷到正在看的仪表盘上。
      if (finishedWs && finishedWs === get().currentWorkspaceId) {
        get().loadReport(finishedWs);
      }
    } catch (error) {
      console.error('[dashboard] 轮询 getReviewActivity 失败:', error);
    }
  }, 2000);
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  reportMarkdown: null,
  reportUpdatedAt: null,
  reviewActivity: null,
  notesContent: '',
  notesSaving: false,
  reviewRunningWorkspaceId: null,
  currentWorkspaceId: null,

  setCurrentWorkspace: (workspaceId) => {
    set({ currentWorkspaceId: workspaceId });
  },

  loadReport: async (workspaceId) => {
    try {
      const result = await client.getReport({ workspaceId });
      if ('report' in result) {
        const report = result.report as { markdown: string; updatedAt: string } | null;
        set({
          reportMarkdown: report?.markdown ?? null,
          reportUpdatedAt: report?.updatedAt ?? null,
        });
      }
    } catch (error) {
      console.error('[dashboard] loadReport 失败:', error);
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

  flushNotes: async (workspaceId, content) => {
    set({ notesSaving: true });
    try {
      await client.saveNotes({ workspaceId, content });
    } catch (error) {
      console.error('[dashboard] flushNotes 失败:', error);
    } finally {
      set({ notesSaving: false });
    }
  },

  triggerReview: async (workspaceId, workspacePath) => {
    try {
      await client.triggerReview({ workspaceId, workspacePath });
    } catch (error) {
      console.error('[dashboard] triggerReview 失败:', error);
      return;
    }
    set({ reviewRunningWorkspaceId: workspaceId });
    startReviewPoll(set, get);
  },
}));

// 监听主进程广播：dashboard.md 文件变更（不论谁写）→ 当前工作区匹配则 reload
if (typeof window !== 'undefined') {
  import('@/lib/events').then(({ rendererEvents }) => {
    rendererEvents.reportUpdated.listen((data) => {
      const state = useDashboardStore.getState();
      if (data.workspaceId === state.currentWorkspaceId) {
        void state.loadReport(data.workspaceId);
      }
    });
  });
}
