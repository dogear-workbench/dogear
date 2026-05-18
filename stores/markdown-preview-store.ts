import { create } from 'zustand';

interface MarkdownPreviewState {
  isOpen: boolean;
  workspaceId: string | null;
  filePath: string | null;
  fileName: string | null;
  open: (workspaceId: string, filePath: string, fileName: string) => void;
  close: () => void;
}

export const useMarkdownPreviewStore = create<MarkdownPreviewState>((set) => ({
  isOpen: false,
  workspaceId: null,
  filePath: null,
  fileName: null,
  open: (workspaceId, filePath, fileName) => set({ isOpen: true, workspaceId, filePath, fileName }),
  close: () => set({ isOpen: false, workspaceId: null, filePath: null, fileName: null }),
}));
