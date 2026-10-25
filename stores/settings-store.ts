import { create } from 'zustand';
import { client } from '@/lib/client';
import type { AppSettings } from '@/types/settings';
import { DEFAULT_SETTINGS } from '@/types/settings';

export interface SubTabFocusReq {
  tabId: string;
  at: number;
}

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;
  subTabFocusReq: SubTabFocusReq | null;

  loadSettings: () => Promise<void>;
  saveSettings: (settings: AppSettings) => Promise<void>;
  requestSubTabFocus: (tabId: string) => void;
  consumeSubTabFocus: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  subTabFocusReq: null,

  loadSettings: async () => {
    const result = await client.getSettings();
    if (result.settings) {
      set({ settings: result.settings, loaded: true });
    } else {
      set({ settings: DEFAULT_SETTINGS, loaded: true });
    }
  },

  saveSettings: async (settings: AppSettings) => {
    const result = await client.updateSettings({ settings });
    if (result && 'error' in result && result.error) {
      throw new Error(String(result.error));
    }
    set({ settings });
  },

  requestSubTabFocus: (tabId) => set({ subTabFocusReq: { tabId, at: Date.now() } }),

  consumeSubTabFocus: () => set({ subTabFocusReq: null }),
}));
