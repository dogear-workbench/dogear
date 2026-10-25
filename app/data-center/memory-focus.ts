import { create } from 'zustand';
import type { MemoryScope } from './memory-types';

export interface MemoryTopicFocusReq {
  scope: MemoryScope;
  workspaceId: string;
  slug: string;
  at: number;
}

interface DataCenterFocusState {
  memoryTopicReq: MemoryTopicFocusReq | null;
  requestMemoryTopic: (req: Omit<MemoryTopicFocusReq, 'at'>) => void;
  consumeMemoryTopic: () => void;
}

export const useDataCenterFocusStore = create<DataCenterFocusState>((set) => ({
  memoryTopicReq: null,
  requestMemoryTopic: (req) => set({ memoryTopicReq: { ...req, at: Date.now() } }),
  consumeMemoryTopic: () => set({ memoryTopicReq: null }),
}));
