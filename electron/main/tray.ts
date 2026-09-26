/**
 * 系统托盘：关闭主窗口时最小化到托盘，双托盘图标恢复窗口
 */
import electron, { type BrowserWindow as BrowserWindowType, type Tray as TrayType } from 'electron';
const { app, Menu, Tray } = electron;
import * as path from 'path';
import { getSessionNotificationService } from './services/session-notification-service.js';

let tray: TrayType | null = null;

export function createTray(options: {
  isDev: boolean;
  getMainWindow: () => BrowserWindowType | null;
  setQuitting: (v: boolean) => void;
}): TrayType | null {
  // 开发环境用 build/icon.ico，生产环境 electron-builder extraResources 会复制到 resourcesPath
  const iconPath = options.isDev
    ? path.join(process.cwd(), 'build/icon.ico')
    : path.join(process.resourcesPath, 'icon.ico');

  try {
    tray = new Tray(iconPath);
  } catch (err) {
    console.error('创建托盘失败，图标路径:', iconPath, err);
    // 托盘创建失败时，关闭窗口应直接退出而非隐藏
    options.setQuitting(true);
    return null;
  }
  const showMainWindow = () => {
    const win = options.getMainWindow();
    win?.show();
    win?.focus();
  };
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: showMainWindow,
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        options.setQuitting(true);
        app.quit();
      },
    },
  ]);
  tray.setToolTip('Dogear');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', showMainWindow);

  getSessionNotificationService().registerTray(tray, iconPath);
  return tray;
}

export function getTray(): TrayType | null {
  return tray && !tray.isDestroyed() ? tray : null;
}

export function destroyTray() {
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
  }
  tray = null;
}
