import { BrowserWindow, nativeImage, Notification, Tray } from 'electron';
import { getRendererHandlers } from '@egoist/tipc/main';
import { mainLogger } from '../agents/logger.js';
import type { RendererHandlers } from '../tipc/renderer-handlers.js';

export type SessionNotificationKind = 'complete' | 'permission';

export type SoundCueKind = 'complete' | 'permission' | 'error';

export interface SessionNotificationInput {
  kind: SessionNotificationKind;
  notificationId: string;
  conversationId: string;
  workspaceId: string;
  title: string;
  toolName?: string;
  body?: string;
  // 任务通知携带 taskId：点击深链任务视图，跳过独立会话窗口分支
  taskId?: string;
}

type LocateCallback = (conversationId: string, workspaceId: string, taskId?: string) => void;

const DEDUP_MAX = 500;

const FLASH_INTERVAL = 500;

class SessionNotificationService {
  private mainWindow: BrowserWindow | null = null;
  private sessionWindows = new Map<string, BrowserWindow>();
  private locateCallback: LocateCallback | null = null;
  private recentIds = new Set<string>();
  private recentQueue: string[] = [];
  private tray: Tray | null = null;
  private trayNormalIcon: string | Electron.NativeImage | null = null;
  private trayFlashTimer: NodeJS.Timeout | null = null;
  private trayFlashOn = false;

  registerMainWindow(win: BrowserWindow): void {
    this.mainWindow = win;
    win.on('focus', () => this.stopFlash());
    win.on('closed', () => {
      if (this.mainWindow === win) {
        this.stopFlash();
        this.mainWindow = null;
      }
    });
  }

  registerTray(t: Tray, normalIcon: string | Electron.NativeImage): void {
    this.tray = t;
    this.trayNormalIcon = normalIcon;
    t.on('mouse-down', () => this.stopFlash());
  }

  registerSessionWindow(conversationId: string, win: BrowserWindow): void {
    this.sessionWindows.set(conversationId, win);
    win.on('focus', () => this.stopFlash());
    win.on('closed', () => {
      const registered = this.sessionWindows.get(conversationId);
      if (registered === win) {
        this.sessionWindows.delete(conversationId);
      }
    });
  }

  setLocateCallback(cb: LocateCallback): void {
    this.locateCallback = cb;
  }

  isForeground(): boolean {
    const all = this.collectLiveWindows();
    return all.some((w) => w.isVisible() && !w.isMinimized() && w.isFocused());
  }

  notify(input: SessionNotificationInput): void {
    if (!this.shouldNotify(input.notificationId)) {
      return;
    }
    if (this.isForeground()) {
      return;
    }

    if (!Notification.isSupported()) {
      mainLogger.warn('[session-notification] 当前系统不支持原生通知，跳过');
      return;
    }

    const body = this.buildBody(input);

    let notification: Notification;
    try {
      notification = new Notification({
        title: input.title,
        body,
        silent: false,
      });
    } catch (err) {
      mainLogger.error('[session-notification] 创建 Notification 失败:', err);
      return;
    }

    notification.on('click', () => {
      this.handleClick(input);
    });

    try {
      notification.show();
    } catch (err) {
      mainLogger.error('[session-notification] 显示通知失败:', err);
      return;
    }

    this.flashIfVisible();
  }

  /** 提示音指令：主进程提示决策收敛后的唯一发声入口，只发主窗口 */
  playCue(kind: SoundCueKind): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    try {
      getRendererHandlers<RendererHandlers>(this.mainWindow.webContents).soundCue.send({
        kind,
        appFocused: this.isForeground(),
      });
    } catch {
      // 窗口已销毁，忽略
    }
  }

  dispose(): void {
    this.stopFlash();
    this.tray = null;
    this.trayNormalIcon = null;
    this.mainWindow = null;
    this.sessionWindows.clear();
    this.locateCallback = null;
    this.recentIds.clear();
    this.recentQueue.length = 0;
  }

  private shouldNotify(notificationId: string): boolean {
    if (this.recentIds.has(notificationId)) {
      return false;
    }
    this.recentIds.add(notificationId);
    this.recentQueue.push(notificationId);
    if (this.recentQueue.length > DEDUP_MAX) {
      const oldest = this.recentQueue.shift()!;
      this.recentIds.delete(oldest);
    }
    return true;
  }

  private collectLiveWindows(): BrowserWindow[] {
    const wins: BrowserWindow[] = [];
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      wins.push(this.mainWindow);
    }
    for (const [, w] of this.sessionWindows) {
      if (!w.isDestroyed()) wins.push(w);
    }
    return wins;
  }

  private buildBody(input: SessionNotificationInput): string {
    if (input.kind === 'permission' && input.toolName) {
      return `等待授权: ${input.toolName}`;
    }
    return input.body ?? '会话已结束';
  }

  private flashIfVisible(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.isVisible()) {
      try {
        this.mainWindow.flashFrame(true);
      } catch {
        // flashFrame 失败不影响通知
      }
    }
    this.startTrayFlash();
  }

  private stopFlash(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      try {
        this.mainWindow.flashFrame(false);
      } catch {
        // 忽略
      }
    }
    this.stopTrayFlash();
  }

  private startTrayFlash(): void {
    if (!this.tray || this.tray.isDestroyed() || !this.trayNormalIcon) return;
    if (this.trayFlashTimer) return;

    const emptyIcon = nativeImage.createEmpty();
    this.trayFlashOn = false;
    this.trayFlashTimer = setInterval(() => {
      if (!this.tray || this.tray.isDestroyed()) {
        this.stopTrayFlash();
        return;
      }
      this.trayFlashOn = !this.trayFlashOn;
      try {
        this.tray.setImage(this.trayFlashOn ? emptyIcon : this.trayNormalIcon!);
      } catch {
        this.stopTrayFlash();
      }
    }, FLASH_INTERVAL);
  }

  private stopTrayFlash(): void {
    if (this.trayFlashTimer) {
      clearInterval(this.trayFlashTimer);
      this.trayFlashTimer = null;
    }
    if (this.tray && !this.tray.isDestroyed() && this.trayNormalIcon) {
      try {
        this.tray.setImage(this.trayNormalIcon);
      } catch {
        // 忽略
      }
    }
    this.trayFlashOn = false;
  }

  private handleClick(input: SessionNotificationInput): void {
    if (!input.taskId) {
      const sessionWin = this.sessionWindows.get(input.conversationId);
      if (sessionWin && !sessionWin.isDestroyed()) {
        try {
          if (sessionWin.isMinimized()) sessionWin.restore();
          if (!sessionWin.isVisible()) sessionWin.show();
          sessionWin.focus();
          return;
        } catch (err) {
          mainLogger.warn('[session-notification] 恢复独立会话窗口失败，降级到主窗口:', err);
        }
      }
    }

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      try {
        if (this.mainWindow.isMinimized()) this.mainWindow.restore();
        if (!this.mainWindow.isVisible()) this.mainWindow.show();
        this.mainWindow.focus();
      } catch (err) {
        mainLogger.warn('[session-notification] 恢复主窗口失败:', err);
        return;
      }

      if (this.locateCallback) {
        try {
          this.locateCallback(input.conversationId, input.workspaceId, input.taskId);
        } catch (err) {
          mainLogger.warn('[session-notification] 定位回调执行失败:', err);
        }
      }
    }
  }
}

let instance: SessionNotificationService | null = null;

export function getSessionNotificationService(): SessionNotificationService {
  if (!instance) {
    instance = new SessionNotificationService();
  }
  return instance;
}
