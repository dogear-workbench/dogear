import electron from 'electron';
import path from 'path';
import { tipc, getRendererHandlers } from '@egoist/tipc/main';
import { loadSettings, saveSettings } from '../services/settings-service.js';
import {
  checkForUpdates,
  downloadHotfix,
  applyHotfix,
  downloadFullUpdate,
  runInstaller,
} from '../services/update-service.js';
import type { RendererHandlers } from './renderer-handlers.js';

const { app } = electron;
const t = tipc.create();

export const updaterRouter = {
  getAppVersion: t.procedure.action(async () => {
    return { version: app.getVersion() };
  }),

  checkForUpdates: t.procedure.action(async () => {
    try {
      const settings = await loadSettings();
      const serverUrl = settings.update?.serverUrl || 'http://localhost:9527';
      const result = await checkForUpdates(serverUrl);
      return result;
    } catch (error) {
      console.error('[updater] 检查更新失败:', error);
      return { hasUpdate: false, error: String(error) };
    }
  }),

  downloadAndApplyHotfix: t.procedure
    .input<{ url: string; sha256: string }>()
    .action(async ({ input, context }) => {
      try {
        const sender = context.sender;
        const handlers = getRendererHandlers<RendererHandlers>(sender);

        const sendProgress = (percent: number, transferred: number, total: number) => {
          if (!sender.isDestroyed()) {
            handlers.updateProgress.send({ percent, transferred, total });
          }
        };

        const zipPath = await downloadHotfix(input.url, input.sha256, sendProgress);

        const targetDir = path.join(process.resourcesPath, 'out');
        await applyHotfix(zipPath, targetDir);

        return { success: true };
      } catch (error) {
        console.error('[updater] 下载并应用热更新失败:', error);
        return { success: false, error: String(error) };
      }
    }),

  downloadAndRunFullUpdate: t.procedure
    .input<{ url: string }>()
    .action(async ({ input, context }) => {
      try {
        const sender = context.sender;
        const handlers = getRendererHandlers<RendererHandlers>(sender);

        const sendProgress = (percent: number, transferred: number, total: number) => {
          if (!sender.isDestroyed()) {
            handlers.updateProgress.send({ percent, transferred, total });
          }
        };

        const installerPath = await downloadFullUpdate(input.url, sendProgress);
        runInstaller(installerPath);
        return { success: true };
      } catch (error) {
        console.error('[updater] 下载完整更新失败:', error);
        return { success: false, error: String(error) };
      }
    }),

  getUpdateConfig: t.procedure.action(async () => {
    try {
      const settings = await loadSettings();
      return { serverUrl: settings.update?.serverUrl || 'http://localhost:9527' };
    } catch (error) {
      return { error: String(error) };
    }
  }),

  setUpdateConfig: t.procedure
    .input<{ serverUrl: string }>()
    .action(async ({ input }) => {
      try {
        const settings = await loadSettings();
        settings.update = { serverUrl: input.serverUrl };
        await saveSettings(settings);
        return { success: true };
      } catch (error) {
        return { error: String(error) };
      }
    }),
};
