import type { ThemePreference } from '@/types/settings';

const FONT_SIZE_SCALE: Record<'small' | 'medium' | 'large', string> = {
  small: '100%',
  medium: '120%',
  large: '135%',
};

function applyFontSize(fontSize: string | undefined) {
  const scale = FONT_SIZE_SCALE[(fontSize ?? 'medium') as keyof typeof FONT_SIZE_SCALE] ?? FONT_SIZE_SCALE.medium;
  document.documentElement.style.fontSize = scale;
}

function applyTheme(theme: ThemePreference | undefined, systemDark: boolean) {
  const dark = theme === 'dark' || (theme !== 'light' && systemDark);
  document.documentElement.classList.toggle('dark', dark);
}

export function setupSettingsSync() {
  import('@/lib/events').then(({ rendererEvents }) => {
    rendererEvents.settingsChanged.listen(() => {
      void import('@/stores/settings-store').then(({ useSettingsStore }) => {
        void useSettingsStore.getState().loadSettings();
      });
    });
  });

  void (async () => {
    const { useSettingsStore } = await import('@/stores/settings-store');
    const { getState } = useSettingsStore;
    if (!getState().loaded) {
      await getState().loadSettings();
    }
    applyFontSize(getState().settings.ui?.fontSize);
    useSettingsStore.subscribe((state, prev) => {
      if (state.settings.ui?.fontSize !== prev.settings.ui?.fontSize) {
        applyFontSize(state.settings.ui?.fontSize);
      }
    });

    const themeQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const applyCurrentTheme = () => applyTheme(getState().settings.appearance?.theme, themeQuery.matches);
    applyCurrentTheme();
    useSettingsStore.subscribe((state, prev) => {
      if (state.settings.appearance?.theme !== prev.settings.appearance?.theme) {
        applyCurrentTheme();
      }
    });
    themeQuery.addEventListener('change', applyCurrentTheme);
  })();
}
