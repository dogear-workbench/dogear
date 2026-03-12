import { create } from 'zustand';
import { client } from '@/lib/client';
import type { AppSettings, ThinkingConfig, ModelProfile } from '@/types/settings';
import { DEFAULT_SETTINGS } from '@/types/settings';

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;

  loadSettings: () => Promise<void>;
  saveSettings: (settings: AppSettings) => Promise<void>;

  setThinking: (thinking: ThinkingConfig) => Promise<void>;
  setEffort: (effort: AppSettings['ai']['effort']) => Promise<void>;
  setMaxTurns: (maxTurns?: number) => Promise<void>;
  setPermissionRules: (rules: { allow?: string[]; deny?: string[] }) => Promise<void>;

  setActiveProfile: (profileId: string) => Promise<void>;
  addProfile: () => Promise<string>;
  updateProfile: (profileId: string, updates: Partial<ModelProfile>) => Promise<void>;
  deleteProfile: (profileId: string) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
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
    set({ settings });
    await client.updateSettings({ settings });
  },

  setThinking: async (thinking) => {
    const { settings, saveSettings } = get();
    await saveSettings({ ...settings, ai: { ...settings.ai, thinking } });
  },

  setEffort: async (effort) => {
    const { settings, saveSettings } = get();
    await saveSettings({ ...settings, ai: { ...settings.ai, effort } });
  },

  setMaxTurns: async (maxTurns) => {
    const { settings, saveSettings } = get();
    await saveSettings({ ...settings, ai: { ...settings.ai, maxTurns } });
  },

  setPermissionRules: async (rules) => {
    const { settings, saveSettings } = get();
    await saveSettings({ ...settings, permissionRules: rules });
  },

  setActiveProfile: async (profileId) => {
    const { settings, saveSettings } = get();
    if (!settings.profiles[profileId]) return;
    await saveSettings({ ...settings, ai: { ...settings.ai, activeProfileId: profileId } });
  },

  addProfile: async () => {
    const { settings, saveSettings } = get();
    const id = crypto.randomUUID();
    const newProfile: ModelProfile = {
      id,
      name: '新方案',
      apiKey: '',
      baseUrl: '',
      haikuModel: '',
      sonnetModel: '',
      opusModel: '',
      apiTimeoutMs: 3000000,
      disableNonessentialTraffic: true,
    };
    const newProfiles = { ...settings.profiles, [id]: newProfile };
    await saveSettings({ ...settings, profiles: newProfiles, ai: { ...settings.ai, activeProfileId: id } });
    return id;
  },

  updateProfile: async (profileId, updates) => {
    const { settings, saveSettings } = get();
    const existing = settings.profiles[profileId];
    if (!existing) return;
    const newProfiles = { ...settings.profiles, [profileId]: { ...existing, ...updates } };
    await saveSettings({ ...settings, profiles: newProfiles });
  },

  deleteProfile: async (profileId) => {
    if (profileId === 'default') return;
    const { settings, saveSettings } = get();
    const { [profileId]: _, ...rest } = settings.profiles;
    const activeId = settings.ai.activeProfileId === profileId ? 'default' : settings.ai.activeProfileId;
    await saveSettings({ ...settings, profiles: rest, ai: { ...settings.ai, activeProfileId: activeId } });
  },
}));
