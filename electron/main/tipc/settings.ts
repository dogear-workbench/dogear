// electron/main/tipc/settings.ts
import { tipc } from '@egoist/tipc/main';
import { loadSettings, saveSettings } from '../services/settings-service.js';
import type { AppSettings } from '../services/settings-service.js';
import { getPiSessionManager } from '../agents/pi-session/pi-session-manager.js';

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
   * 更新应用设置（落盘后广播 settingsChanged 给主窗口；restartSessions=true 时主窗口同时重启活跃会话）
   */
  updateSettings: t.procedure
    .input<{ settings: AppSettings; restartSessions?: boolean }>()
    .action(async ({ input }) => {
      try {
        await saveSettings(input.settings);
        const { broadcastSettingsChanged } = await import('../index.js');
        broadcastSettingsChanged(input.restartSessions ?? false);
        return { success: true };
      } catch (error) {
        console.error('更新设置失败:', error);
        return { error: String(error) };
      }
    }),

  /**
   * 重启所有活跃会话
   * 关闭 PiSessionManager 上所有活跃会话，前端会自动用新 settings 重建
   */
  restartActiveSessions: t.procedure
    .action(async () => {
      try {
        const piSessionManager = getPiSessionManager();
        const activeCount = piSessionManager.getActiveCount();
        piSessionManager.closeAll();
        console.log(`已关闭 ${activeCount} 个活跃会话，前端将自动重建`);
        return { success: true, closedCount: activeCount };
      } catch (error) {
        console.error('重启活跃会话失败:', error);
        return { error: String(error) };
      }
    }),
};
