// electron/main/tipc/settings.ts
import { tipc } from '@egoist/tipc/main';
import { loadSettings, saveSettings } from '../services/settings-service.js';
import type { AppSettings } from '../services/settings-service.js';

const t = tipc.create();

export const settingsRouter = {
  /**
   * 获取应用设置
   */
  getSettings: t.procedure
    .action(async () => {
      try {
        const settings = await loadSettings();
        return { settings };
      } catch (error) {
        console.error('获取设置失败:', error);
        return { error: String(error) };
      }
    }),

  /**
   * 更新应用设置
   */
  updateSettings: t.procedure
    .input<{ settings: AppSettings }>()
    .action(async ({ input }) => {
      try {
        await saveSettings(input.settings);
        return { success: true };
      } catch (error) {
        console.error('更新设置失败:', error);
        return { error: String(error) };
      }
    }),
};
