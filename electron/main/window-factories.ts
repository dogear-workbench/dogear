/**
 * 窗口工厂：子窗口单例创建、位置记忆、标题栏 overlay
 */
import electron, { type BrowserWindow as BrowserWindowType } from 'electron';
const { BrowserWindow, nativeTheme } = electron;
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { getRendererHandlers } from '@egoist/tipc/main';
import type { RendererHandlers } from './tipc/renderer-handlers.js';
import { getSessionNotificationService } from './services/session-notification-service.js';
import { broadcastToWindows } from './services/renderer-broadcast.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isDev = process.env.NODE_ENV === 'development';

function getRendererPath(): string {
  if (isDev) {
    return 'http://localhost:3000';
  }
  return 'app://dogear/index.html';
}

const TITLE_BAR_HEIGHT = 36;
const TITLE_BAR_SCHEMES = {
  light: { color: '#F5F1E8', symbolColor: '#33302B' },
  dark: { color: '#1E242C', symbolColor: '#C6CBD2' },
};

function currentTitleBarOverlay() {
  const scheme = nativeTheme.shouldUseDarkColors ? TITLE_BAR_SCHEMES.dark : TITLE_BAR_SCHEMES.light;
  return { ...scheme, height: TITLE_BAR_HEIGHT };
}

// darwin 用系统默认原生标题栏：红绿灯+标题画在原生条里，视口从原生条下方开始，页面布局不受影响；
// titleBarOverlay 的 WCO 按钮是 Windows 专属（hiddenInset 会让红绿灯压住从 y=0 渲染的页面内容，已弃用）
function titleBarOptions(): Record<string, never> | { titleBarStyle: 'hidden'; titleBarOverlay: ReturnType<typeof currentTitleBarOverlay> } {
  if (process.platform === 'darwin') {
    return {};
  }
  return { titleBarStyle: 'hidden', titleBarOverlay: currentTitleBarOverlay() };
}

export function syncTitleBarOverlay() {
  const overlay = currentTitleBarOverlay();
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      win.setTitleBarOverlay(overlay);
    } catch {
      // 未启用 overlay 的窗口（原生标题栏）忽略
    }
  }
}

// 主窗口实例（由 main-app 创建后注入，会话窗口关闭通知要用）
let mainWindow: BrowserWindowType | null = null;

export function setMainWindow(win: BrowserWindowType | null): void {
  mainWindow = win;
}

export function getMainWindow(): BrowserWindowType | null {
  return mainWindow;
}

// 数据中心窗口实例
let dataCenterWindow: BrowserWindowType | null = null;

// 工作台窗口实例
let workbenchWindow: BrowserWindowType | null = null;

// 笔记窗口实例
let notesWindow: BrowserWindowType | null = null;

// 会话窗口映射（conversationId → BrowserWindow）
const sessionWindows = new Map<string, BrowserWindowType>();

/**
 * 发送消息到调试窗口（no-op）
 * 调试窗口基础设施已随 /debug 路由删除（Step 3），保留空实现维持 tipc/agent.ts 调用点
 */
export function sendToDebugWindow(_channel: string, ..._args: unknown[]) {}

/**
 * 创建带位置记忆的窗口：创建时读取上次 bounds 并校验可视范围，moved/resized 防抖持久化，close 补写
 * 照工作台窗口原有逻辑收敛，供主/工作台/笔记/数据中心窗口复用
 */
export async function createWindowWithBounds(options: {
  stateKey: string;
  width: number;
  height: number;
  title: string;
  hashPath: string;
}): Promise<BrowserWindowType> {
  const { loadWindowBounds, saveWindowBounds } = await import('./services/window-state-service.js');
  const saved = await loadWindowBounds(options.stateKey);
  const hasPosition = !!saved && saved.x !== null && saved.y !== null;

  const win = new BrowserWindow({
    width: saved?.width ?? options.width,
    height: saved?.height ?? options.height,
    x: hasPosition ? saved!.x ?? undefined : undefined,
    y: hasPosition ? saved!.y ?? undefined : undefined,
    title: options.title,
    ...titleBarOptions(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(options.hashPath ? `${getRendererPath()}#${options.hashPath}` : getRendererPath());

  // dev 下自动弹出 DevTools；detach 独立窗口避免停靠面板改变页面视口（滚动行为调试需还原真实布局）
  if (isDev) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  if (hasPosition) {
    const bounds = win.getBounds();
    const { screen } = electron;
    const workArea = screen.getDisplayMatching(bounds).workArea;
    const overlapX = Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x);
    const overlapY = Math.min(bounds.y + bounds.height, workArea.y + workArea.height) - Math.max(bounds.y, workArea.y);
    if (overlapX < 60 || overlapY < 60) {
      win.center();
    }
  }

  if (saved?.maximized) {
    win.maximize();
  }

  let saveTimer: NodeJS.Timeout | null = null;
  const persistBounds = () => {
    if (win.isDestroyed()) return;
    if (win.isMinimized() || win.isFullScreen()) return;
    // 最大化时 getBounds 拿到的是整屏尺寸，改存 normal bounds + 最大化标记供重开还原
    const maximized = win.isMaximized();
    const { x, y, width, height } = maximized ? win.getNormalBounds() : win.getBounds();
    void saveWindowBounds(options.stateKey, { x, y, width, height, maximized });
  };
  const schedulePersistBounds = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      persistBounds();
    }, 500);
  };
  win.on('moved', schedulePersistBounds);
  win.on('resized', schedulePersistBounds);
  win.on('close', () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    persistBounds();
  });

  return win;
}

/**
 * 创建数据中心窗口（单例，已存在则聚焦）
 */
export async function createDataCenterWindow() {
  if (dataCenterWindow) {
    if (dataCenterWindow.isMinimized()) dataCenterWindow.restore();
    dataCenterWindow.focus();
    return;
  }

  dataCenterWindow = await createWindowWithBounds({
    stateKey: 'data-center-window',
    width: 1200,
    height: 800,
    title: '数据中心',
    hashPath: '/data-center',
  });
  broadcastToWindows((h) => h.dataCenterWindowOpened.send(null));

  dataCenterWindow.on('closed', () => {
    dataCenterWindow = null;
    broadcastToWindows((h) => h.dataCenterWindowClosed.send(null));
  });
}

/**
 * 创建工作台窗口（单例，已存在则聚焦）
 */
export async function createWorkbenchWindow() {
  if (workbenchWindow) {
    if (workbenchWindow.isMinimized()) workbenchWindow.restore();
    workbenchWindow.focus();
    return;
  }

  workbenchWindow = await createWindowWithBounds({
    stateKey: 'workbench-window',
    width: 560,
    height: 840,
    title: '工作台',
    hashPath: '/workbench-window',
  });
  broadcastToWindows((h) => h.workbenchWindowOpened.send(null));

  workbenchWindow.on('closed', () => {
    workbenchWindow = null;
    broadcastToWindows((h) => h.workbenchWindowClosed.send(null));
  });
}

/** 工作台窗口是否存活（会话窗口冷启动互斥态同步用） */
export function getWorkbenchWindowOpen(): boolean {
  return workbenchWindow !== null && !workbenchWindow.isDestroyed();
}

/**
 * 创建笔记窗口（单例，已存在则聚焦）
 * 弹出 = 主窗口隐藏笔记哨兵 tab（tab 开关状态保留），关窗广播恢复
 */
export async function createNotesWindow() {
  if (notesWindow) {
    if (notesWindow.isMinimized()) notesWindow.restore();
    notesWindow.focus();
    return;
  }

  notesWindow = await createWindowWithBounds({
    stateKey: 'notes-window',
    width: 1200,
    height: 800,
    title: '笔记',
    hashPath: '/notes-window',
  });
  broadcastToWindows((h) => h.notesWindowOpened.send(null));

  notesWindow.on('closed', () => {
    notesWindow = null;
    broadcastToWindows((h) => h.notesWindowClosed.send(null));
  });
}

/** 存活笔记窗口实例（Step 5 focusTask 分流用，销毁竞态返回 null） */
export function getNotesWindow(): BrowserWindowType | null {
  return notesWindow && !notesWindow.isDestroyed() ? notesWindow : null;
}

/**
 * 设置已落盘，通知所有窗口刷新 store（主题/字号等 UI 域由渲染层订阅即时热更；
 * agent 快照域由主进程按 diff 对受影响会话标脏，与本广播无关）
 */
export function broadcastSettingsChanged() {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      const h = getRendererHandlers<RendererHandlers>(win.webContents);
      h.settingsChanged.send(null);
    } catch (err) {
      console.error('[settings] 广播 settingsChanged 失败:', err);
    }
  }
}

/**
 * 创建独立会话窗口
 * 同一个 conversationId 只创建一个窗口，重复调用则聚焦已有窗口
 */
export function createSessionWindow(conversationId: string, title: string) {
  if (sessionWindows.has(conversationId)) {
    const existing = sessionWindows.get(conversationId)!;
    if (!existing.isDestroyed()) {
      existing.focus();
      return;
    }
  }

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: `会话: ${title}`,
    ...titleBarOptions(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const url = `${getRendererPath()}#/session-window/${conversationId}`;
  win.loadURL(url);

  sessionWindows.set(conversationId, win);

  getSessionNotificationService().registerSessionWindow(conversationId, win);

  // 提前记录 webContentsId，因为 'closed' 事件时 webContents 已销毁
  const webContentsId = win.webContents.id;
  win.on('closed', async () => {
    sessionWindows.delete(conversationId);

    // 主进程主动 detach 该窗口的所有 attachment（渲染进程的 React cleanup 在窗口销毁时不可靠）
    const { conversationRuntimeService } = await import('./services/conversation-runtime-service.js');
    conversationRuntimeService.detachByWebContentsId(webContentsId);

    let workspaceId = '';
    try {
      const { getByIdGlobal } = await import('./services/conversation-service.js');
      const result = await getByIdGlobal(conversationId);
      workspaceId = result?.workspaceId || '';
    } catch (err) {
      console.error('[sessionWindowClosed] 获取 workspaceId 失败:', err);
    }

    // 通知主窗口恢复 Tab（需要附带 workspaceId，以便正确回到对应工作区标签页）
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        const h = getRendererHandlers<RendererHandlers>(mainWindow.webContents);
        h.sessionWindowClosed.send({ conversationId, title, workspaceId });
      } catch (err) {
        console.error('[sessionWindowClosed] 通知主窗口失败:', err);
      }
    }
  });
}

/**
 * 关闭所有子窗口（主窗口关闭时调用）
 */
export function closeAllChildWindows() {
  if (dataCenterWindow && !dataCenterWindow.isDestroyed()) {
    dataCenterWindow.close();
  }
  if (workbenchWindow && !workbenchWindow.isDestroyed()) {
    workbenchWindow.close();
  }
  if (notesWindow && !notesWindow.isDestroyed()) {
    notesWindow.close();
  }
  for (const [, win] of sessionWindows) {
    if (!win.isDestroyed()) win.close();
  }
  sessionWindows.clear();
}
