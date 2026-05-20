import { create } from 'zustand';

interface MarkdownPreviewState {
  isOpen: boolean;
  workspaceId: string | null;
  filePath: string | null;
  fileName: string | null;
  /** inline 模式：直接渲染传入内容，不读盘（用于 Write 工具预览） */
  inlineContent: string | null;
  open: (workspaceId: string, filePath: string, fileName: string) => void;
  openInline: (fileName: string, content: string) => void;
  close: () => void;
}

export const useMarkdownPreviewStore = create<MarkdownPreviewState>((set) => ({
  isOpen: false,
  workspaceId: null,
  filePath: null,
  fileName: null,
  inlineContent: null,
  open: (workspaceId, filePath, fileName) => set({
    isOpen: true,
    workspaceId,
    filePath,
    fileName,
    inlineContent: null,
  }),
  openInline: (fileName, content) => set({
    isOpen: true,
    workspaceId: null,
    filePath: null,
    fileName,
    inlineContent: content,
  }),
  close: () => set({
    isOpen: false,
    workspaceId: null,
    filePath: null,
    fileName: null,
    inlineContent: null,
  }),
}));
