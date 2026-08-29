import { create } from 'zustand';

/**
 * 任务深链请求：通知点击等场景请求任务视图选中指定任务。
 * seq 递增保证同一任务重复通知也能再次触发；消费方（NotesPanel 切视图、
 * TaskPanel 选中）各自响应同一请求，无需显式清除。
 */
interface TaskFocusRequest {
  taskId: string;
  seq: number;
}

interface TaskFocusState {
  focusReq: TaskFocusRequest | null;
  requestTaskFocus: (taskId: string) => void;
}

export const useTaskFocusStore = create<TaskFocusState>((set) => ({
  focusReq: null,
  requestTaskFocus: (taskId) =>
    set((state) => ({ focusReq: { taskId, seq: (state.focusReq?.seq ?? 0) + 1 } })),
}));
