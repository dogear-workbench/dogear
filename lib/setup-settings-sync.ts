const FONT_SIZE_SCALE: Record<'small' | 'medium' | 'large', string> = {
  small: '100%',
  medium: '120%',
  large: '135%',
};

function applyFontSize(fontSize: string | undefined) {
  const scale = FONT_SIZE_SCALE[(fontSize ?? 'medium') as keyof typeof FONT_SIZE_SCALE] ?? FONT_SIZE_SCALE.medium;
  document.documentElement.style.fontSize = scale;
}

export function setupSettingsSync() {
  import('@/lib/events').then(({ rendererEvents }) => {
    rendererEvents.settingsChanged.listen((p) => {
      void (async () => {
        const { useSettingsStore } = await import('@/stores/settings-store');
        const { useConversationStore } = await import('@/stores/conversation-store');
        await useSettingsStore.getState().loadSettings();
        if (p.restartSessions) {
          await useSettingsStore.getState().restartActiveSessions();
          useConversationStore.getState().triggerSessionRestart();
        }
      })();
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
    })();
  });
}
