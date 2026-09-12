import { create } from 'zustand';
import { client } from '@/lib/client';
import type { AppSettings } from '@/types/settings';
import { DEFAULT_SETTINGS } from '@/types/settings';

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;

  loadSettings: () => Promise<void>;
  saveSettings: (settings: AppSettings) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

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
}));
