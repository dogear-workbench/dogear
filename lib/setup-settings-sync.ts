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
  });
}
