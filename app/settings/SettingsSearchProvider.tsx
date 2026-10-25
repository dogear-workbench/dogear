import { useEffect } from 'react';
import { Settings } from 'lucide-react';
import { useSessionStore, SETTINGS_TAB_ID } from '@/stores/session-store';
import { useSettingsStore } from '@/stores/settings-store';
import { registerProvider, unregisterProvider, type SearchProvider } from '@/stores/search-store';
import type { SettingsSearchTarget } from './search-index';
import { BEHAVIOR_SEARCH_ENTRIES } from './BehaviorTab';
import { BROWSER_SEARCH_ENTRIES } from './BrowserTab';
import { ABILITY_SEARCH_ENTRIES } from './AbilityTab';
import { SCENE_SEARCH_ENTRIES } from './scene/SceneTab';
import { PROFILES_SEARCH_ENTRIES } from './ProfilesTab';
import { WORKSPACE_MANAGEMENT_SEARCH_ENTRIES } from './WorkspaceManagementTab';
import { SUB_AGENT_SEARCH_ENTRIES } from './SubAgentTab';
import { SHORTCUTS_SEARCH_ENTRIES } from './ShortcutsTab';
import { ABOUT_SEARCH_ENTRIES } from './AboutTab';

const SETTINGS_SEARCH_TARGETS: SettingsSearchTarget[] = [
  ...BEHAVIOR_SEARCH_ENTRIES.map((e) => ({ ...e, tabId: 'behavior', tabLabel: '基础' })),
  ...BROWSER_SEARCH_ENTRIES.map((e) => ({ ...e, tabId: 'browser', tabLabel: '浏览器' })),
  ...ABILITY_SEARCH_ENTRIES.map((e) => ({ ...e, tabId: 'abilities', tabLabel: '能力' })),
  ...SCENE_SEARCH_ENTRIES.map((e) => ({ ...e, tabId: 'scene', tabLabel: '场景' })),
  ...PROFILES_SEARCH_ENTRIES.map((e) => ({ ...e, tabId: 'profiles', tabLabel: '模型方案' })),
  ...WORKSPACE_MANAGEMENT_SEARCH_ENTRIES.map((e) => ({ ...e, tabId: 'workspace-management', tabLabel: '工作区管理' })),
  ...SUB_AGENT_SEARCH_ENTRIES.map((e) => ({ ...e, tabId: 'sub-agent', tabLabel: '子会话派遣' })),
  ...SHORTCUTS_SEARCH_ENTRIES.map((e) => ({ ...e, tabId: 'shortcuts', tabLabel: '快捷键' })),
  ...ABOUT_SEARCH_ENTRIES.map((e) => ({ ...e, tabId: 'about', tabLabel: '关于' })),
];

function createSettingsSearchProvider(): SearchProvider {
  return {
    id: 'settings',
    placeholder: '搜索设置',
    isActive: () => useSessionStore.getState().activeTabId === SETTINGS_TAB_ID,
    search: (query) => {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      return SETTINGS_SEARCH_TARGETS
        .filter((t) =>
          t.label.toLowerCase().includes(q)
          || t.description?.toLowerCase().includes(q)
          || t.keywords?.some((k) => k.toLowerCase().includes(q)))
        .slice(0, 8)
        .map((t) => ({
          id: `settings:${t.tabId}:${t.label}`,
          title: t.label,
          subtitle: t.tabLabel,
          icon: Settings,
          onSelect: () => {
            useSettingsStore.getState().requestSubTabFocus(t.tabId);
            useSessionStore.getState().switchTab(SETTINGS_TAB_ID);
          },
        }));
    },
  };
}

export function SettingsSearchProvider() {
  useEffect(() => {
    const provider = createSettingsSearchProvider();
    registerProvider(provider);
    return () => unregisterProvider(provider.id);
  }, []);
  return null;
}
