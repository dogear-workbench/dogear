import { create } from 'zustand';
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';
import type { Book } from '@/types';

// 分析进度状态类型
interface AnalysisProgress {
  status: 'idle' | 'analyzing' | 'completed' | 'failed';
  taskId?: string;
  currentTool?: string;
  message?: string;
  chapterCount?: number;
  currentChapter?: string;
  error?: string;
}

interface AnalysisState {
  // --- 状态 ---
  analyzing: boolean;
  analysisProgress: AnalysisProgress;

  // --- Actions ---
  /** 启动 AI 分析 */
  analyzeBook: (bookId: string) => Promise<void>;
  /** 切换书籍时重置分析状态 */
  resetForBook: (book: Book | null) => void;
  /** 清理事件监听器 */
  cleanup: () => void;
  /** 重置所有状态到初始值 */
  reset: () => void;
}

// 模块级变量存储事件监听取消函数
let analysisUnsubscribe: (() => void) | null = null;

export const useAnalysisStore = create<AnalysisState>((set) => ({
  analyzing: false,
  analysisProgress: { status: 'idle' },

  analyzeBook: async (bookId) => {
    try {
      set({ analyzing: true, analysisProgress: { status: 'analyzing' } });

      const result = await client.analyzeBook({ bookId });

      if (result.error) {
        set({ analysisProgress: { status: 'failed', error: result.error }, analyzing: false });
        return;
      }

      if (result.taskId) {
        set((state) => ({
          analysisProgress: { ...state.analysisProgress, taskId: result.taskId },
        }));

        // 清理之前的监听器
        if (analysisUnsubscribe) {
          analysisUnsubscribe();
          analysisUnsubscribe = null;
        }

        // 注册分析进度监听
        analysisUnsubscribe = rendererEvents.analysisUpdate.listen((data) => {
          if (data.bookId === bookId) {
            set((state) => ({
              analysisProgress: {
                ...state.analysisProgress,
                currentTool: data.toolName,
                message: data.message || data.statusMessage,
                currentChapter: data.chapterTitle,
              },
            }));

            // 检查是否完成
            if (data.status === 'completed') {
              set({ analysisProgress: { status: 'completed' }, analyzing: false });
              // 刷新书籍信息
              client.getBookByFilePath({ filePathOrBookId: bookId }).then((updatedBook) => {
                import('./workspace-store').then(({ useWorkspaceStore }) => {
                  useWorkspaceStore.getState().setSelectedBook(updatedBook || null);
                });
              });
              if (analysisUnsubscribe) {
                analysisUnsubscribe();
                analysisUnsubscribe = null;
              }
            } else if (data.error) {
              set({ analysisProgress: { status: 'failed', error: data.error }, analyzing: false });
              if (analysisUnsubscribe) {
                analysisUnsubscribe();
                analysisUnsubscribe = null;
              }
            }
          }
        });
      }
    } catch (error) {
      console.error('启动分析失败:', error);
      set({
        analysisProgress: { status: 'failed', error: (error as Error).message },
        analyzing: false,
      });
    }
  },

  resetForBook: (book) => {
    if (book) {
      if (book.analysis_status === 'analyzed') {
        set({ analysisProgress: { status: 'completed' }, analyzing: false });
      } else if (book.analysis_status === 'analyzing') {
        set({ analysisProgress: { status: 'analyzing' }, analyzing: true });
      } else {
        set({ analysisProgress: { status: 'idle' }, analyzing: false });
      }
    } else {
      set({ analysisProgress: { status: 'idle' }, analyzing: false });
    }
  },

  cleanup: () => {
    if (analysisUnsubscribe) {
      analysisUnsubscribe();
      analysisUnsubscribe = null;
    }
  },

  reset: () => {
    // 清理事件监听器
    if (analysisUnsubscribe) {
      analysisUnsubscribe();
      analysisUnsubscribe = null;
    }
    set({
      analyzing: false,
      analysisProgress: { status: 'idle' },
    });
  },
}));
