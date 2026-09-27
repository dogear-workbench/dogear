/**
 * 系统托盘：关闭主窗口时最小化到托盘，双托盘图标恢复窗口
 */
import electron, { type BrowserWindow as BrowserWindowType, type Tray as TrayType } from 'electron';
const { app, Menu, Tray, nativeImage } = electron;
import * as path from 'path';
import { getSessionNotificationService } from './services/session-notification-service.js';

let tray: TrayType | null = null;

export function createTray(options: {
  isDev: boolean;
  getMainWindow: () => BrowserWindowType | null;
  setQuitting: (v: boolean) => void;
}): TrayType | null {
  const isMac = process.platform === 'darwin';
  const iconPath = isMac
    ? path.join(options.isDev ? process.cwd() : process.resourcesPath, 'icon-tray.png')
    : options.isDev
      ? path.join(process.cwd(), 'build/icon.ico')
      : path.join(process.resourcesPath, 'icon.ico');

  try {
    if (isMac) {
      const image = nativeImage.createFromPath(iconPath);
      if (image.isEmpty()) {
        throw new Error(`托盘图标缺失或为空: ${iconPath}`);
      }
      image.setTemplateImage(true);
      tray = new Tray(image);
    } else {
      tray = new Tray(iconPath);
    }
  } catch (err) {
    console.error('创建托盘失败，图标路径:', iconPath, err);
    // 托盘创建失败时，关闭窗口应直接退出而非隐藏；
    // mac 上 png 未随包是资源问题而非用户预期，不能误开「关窗即退出」
    if (!isMac) {
      options.setQuitting(true);
    }
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
