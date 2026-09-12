// electron/main/tipc/settings.ts
import { tipc } from '@egoist/tipc/main';
import { loadSettings, saveSettings } from '../services/settings-service.js';
import type { AppSettings } from '../services/settings-service.js';
import { diffSettings, hasSnapshotChange } from '../services/settings-diff.js';
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
   * 更新应用设置：落盘后 diff 新旧设置分层生效——
   * 纯 UI/按次读取域仅广播 settingsChanged（渲染层刷 store 热更）；
   * agent 启动快照域由 PiSessionManager 对受影响会话标脏（permissionMode 热更），
   * 各会话在下轮 sendMessage 前自行重建，不再无差别杀会话
   */
  updateSettings: t.procedure
    .input<{ settings: AppSettings }>()
    .action(async ({ input }) => {
      try {
        const prev = await loadSettings();
        await saveSettings(input.settings);
        const diff = diffSettings(prev, input.settings);
        if (hasSnapshotChange(diff)) {
          getPiSessionManager().applySettingsSnapshotDiff(diff, input.settings);
        }
        const { broadcastSettingsChanged } = await import('../main-app.js');
        broadcastSettingsChanged();
        return { success: true };
      } catch (error) {
        console.error('更新设置失败:', error);
        return { error: String(error) };
      }
    }),
};
