export interface SettingsSearchEntry {
  label: string;
  description?: string;
  keywords?: string[];
}

export interface SettingsSearchTarget extends SettingsSearchEntry {
  tabId: string;
  tabLabel: string;
}
