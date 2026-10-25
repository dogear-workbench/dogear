import { create } from 'zustand';
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';
import type { HumanInterventionRequest } from '../electron/main/services/browser/human-intervention';

interface BrowserState {
  humanInterventions: HumanInterventionRequest[];
}

export const useBrowserStore = create<BrowserState>(() => ({
  humanInterventions: [],
}));

if (typeof window !== 'undefined' && window.ipcRenderer) {
  rendererEvents.humanInterventionChanged.listen(({ pending }) => {
    useBrowserStore.setState({ humanInterventions: pending });
  });
  client
    .listHumanInterventions()
    .then((pending) => useBrowserStore.setState({ humanInterventions: pending }))
    .catch(() => {});
}
