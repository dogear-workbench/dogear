/**
 * Electron 主进程入口
 * 负责应用窗口管理和生命周期
 */

import electron, { type BrowserWindow as BrowserWindowType, type Tray as TrayType } from 'electron';
const { app, BrowserWindow, Menu, Tray } = electron;
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { getRendererHandlers } from '@egoist/tipc/main';
import { getAgentManager, shutdownAgentManager } from './agents/agent-manager.js';
import { registerTipcHandlers } from './tipc/index.js';
import type { RendererHandlers } from './tipc/renderer-handlers.js';

// 获取当前文件的路径和目录名(ES Module 环境)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 判断是否为开发环境
const isDev = process.env.NODE_ENV === 'development';

// 开发环境使用独立的 userData 路径，避免与生产环境共享单实例锁文件和 Electron 缓存
// Windows 文件系统不区分大小写：默认 dev (dogear) 和 prod (Dogear) 会指向同一个 AppData 目录
// 改到 Dogear-Dev 后两者彻底隔离，允许 dev 和 prod 同时运行
if (isDev) {
  app.setPath('userData', path.join(app.getPath('appData'), 'Dogear-Dev'));
}

// 单实例锁：确保只能运行一个 Dogear 实例（dev/prod 因 userData 隔离，互相独立）
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

// 主窗口实例
let mainWindow: BrowserWindowType | null = null;

// 系统托盘实例
let tray: TrayType | null = null;

// 是否正在退出（区分"关闭窗口"和"真正退出"）
let isQuitting = false;

// 调试窗口实例(仅开发环境)
let debugWindow: BrowserWindowType | null = null;

// Agent 监控窗口实例
let agentMonitorWindow: BrowserWindowType | null = null;

// 自选股窗口实例
let stockWindow: BrowserWindowType | null = null;

// 会话窗口映射（conversationId → BrowserWindow）
const sessionWindows = new Map<string, BrowserWindowType>();


/**
 * 创建 Electron 主窗口
 * 配置窗口属性、加载页面并根据环境决定是否打开开发者工具
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      // 预加载脚本路径
      preload: path.join(__dirname, '../preload/index.js'),
      // 启用上下文隔离,提高安全性
      contextIsolation: true,
      // 禁用 Node.js 集成,提高安全性
      nodeIntegration: false,
    },
  });

  // 根据环境加载不同的页面
  if (isDev) {
    // 开发环境:加载 Vite 开发服务器
    mainWindow.loadURL('http://localhost:3000');
    // 打开开发者工具
    //mainWindow.webContents.openDevTools();

    // 创建调试窗口
    // createDebugWindow();
  } else {
    // 生产环境:加载构建后的静态文件
    mainWindow.loadFile(path.join(__dirname, '../../out/index.html'));
  }
}

/**
 * 创建调试窗口
 * 仅在开发环境使用,用于显示 Agent 对话流程
 */
function createDebugWindow() {
  // 如果调试窗口已存在,聚焦它
  if (debugWindow) {
    debugWindow.focus();
    return;
  }

  debugWindow = new BrowserWindow({
    width: 600,
    height: 800,
    title: 'Agent 调试窗口',
    parent: mainWindow || undefined, // 设置为主窗口的子窗口
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'), // 使用主窗口的预加载脚本
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 加载调试窗口页面（HashRouter 路由）
  const debugUrl = isDev
    ? 'http://localhost:3000/#/debug'
    : `file://${path.join(__dirname, '../../out/index.html')}#/debug`;
  debugWindow.loadURL(debugUrl);

  // 调试窗口关闭时清理引用
  debugWindow.on('closed', () => {
    debugWindow = null;
  });

  // 打开调试窗口的开发者工具(可选)
  // debugWindow.webContents.openDevTools();
}

/**
 * 获取调试窗口实例
 * 用于从其他模块发送消息到调试窗口
 */
export function getDebugWindow(): BrowserWindowType | null {
  return debugWindow;
}

/**
 * 发送消息到调试窗口
 */
export function sendToDebugWindow(channel: string, ...args: any[]) {
  if (debugWindow && !debugWindow.isDestroyed()) {
    debugWindow.webContents.send(channel, ...args);
  }
}

/**
 * 创建 Agent 监控窗口
 * 用于可视化显示 Agent 管理器的运行状态
 */
export function createAgentMonitorWindow() {
  // 如果监控窗口已存在,聚焦它
  if (agentMonitorWindow) {
    agentMonitorWindow.focus();
    return;
  }

  agentMonitorWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    title: 'Agent 监控面板',
    parent: mainWindow || undefined,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 加载监控窗口页面（HashRouter 路由）
  const monitorUrl = isDev
    ? 'http://localhost:3000/#/agent-monitor'
    : `file://${path.join(__dirname, '../../out/index.html')}#/agent-monitor`;
  agentMonitorWindow.loadURL(monitorUrl);

  // 监控窗口关闭时清理引用
  agentMonitorWindow.on('closed', () => {
    agentMonitorWindow = null;
  });

  // 开发环境打开开发者工具
  if (isDev) {
    agentMonitorWindow.webContents.openDevTools();
  }
}

/**
 * 获取 Agent 监控窗口实例
 */
export function getAgentMonitorWindow(): BrowserWindowType | null {
  return agentMonitorWindow;
}

/**
 * 发送消息到 Agent 监控窗口
 */
export function sendToAgentMonitorWindow(channel: string, ...args: any[]) {
  if (agentMonitorWindow && !agentMonitorWindow.isDestroyed()) {
    agentMonitorWindow.webContents.send(channel, ...args);
  }
}

/**
 * 创建自选股窗口
 */
export function createStockWindow() {
  if (stockWindow) {
    stockWindow.focus();
    return;
  }

  stockWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: '自选股行情',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const stockUrl = isDev
    ? 'http://localhost:3000/#/stocks'
    : `file://${path.join(__dirname, '../../out/index.html')}#/stocks`;
  stockWindow.loadURL(stockUrl);

  stockWindow.on('closed', () => {
    stockWindow = null;
  });
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
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const url = isDev
    ? `http://localhost:3000/#/session-window/${conversationId}`
    : `file://${path.join(__dirname, '../../out/index.html')}#/session-window/${conversationId}`;
  win.loadURL(url);

  sessionWindows.set(conversationId, win);

  // 提前记录 webContentsId，因为 'closed' 事件时 webContents 已销毁
  const webContentsId = win.webContents.id;
  win.on('closed', async () => {
    sessionWindows.delete(conversationId);

    // 主进程主动 detach 该窗口的所有 attachment（渲染进程的 React cleanup 在窗口销毁时不可靠）
    const { conversationRuntimeService } = await import('./services/conversation-runtime-service.js');
    conversationRuntimeService.detachByWebContentsId(webContentsId);

    // 通知主窗口恢复 Tab（需要附带 workspaceId，以便正确回到对应工作区标签页）
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        const { getByIdGlobal } = await import('./services/conversation-service.js');
        const result = await getByIdGlobal(conversationId);
        const workspaceId = result?.workspaceId || '';
        const h = getRendererHandlers<RendererHandlers>(mainWindow.webContents);
        h.sessionWindowClosed.send({ conversationId, title, workspaceId });
      } catch (err) {
        console.error('[sessionWindowClosed] 获取 workspaceId 失败:', err);
      }
    }
  });
}

/**
 * 关闭所有子窗口（主窗口关闭时调用）
 */
function closeAllChildWindows() {
  if (stockWindow && !stockWindow.isDestroyed()) {
    stockWindow.close();
  }
  if (agentMonitorWindow && !agentMonitorWindow.isDestroyed()) {
    agentMonitorWindow.close();
  }
  if (debugWindow && !debugWindow.isDestroyed()) {
    debugWindow.close();
  }
  for (const [, win] of sessionWindows) {
    if (!win.isDestroyed()) win.close();
  }
  sessionWindows.clear();
}

/**
 * 创建系统托盘图标
 * 关闭主窗口时最小化到托盘，双击托盘图标恢复窗口
 */
function createTray() {
  // 开发环境用 build/icon.ico，生产环境 electron-builder extraResources 会复制到 resourcesPath
  const iconPath = isDev
    ? path.join(process.cwd(), 'build/icon.ico')
    : path.join(process.resourcesPath, 'icon.ico');

  try {
    tray = new Tray(iconPath);
  } catch (err) {
    console.error('创建托盘失败，图标路径:', iconPath, err);
    // 托盘创建失败时，关闭窗口应直接退出而非隐藏
    isQuitting = true;
    return;
  }
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setToolTip('Dogear');
  tray.setContextMenu(contextMenu);
  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

// ==================== 应用生命周期 ====================

// 第二个实例启动时，聚焦到已有主窗口
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

// 当 Electron 完成初始化时创建窗口
app.whenReady().then(async () => {
  // 完全隐藏默认菜单栏
  Menu.setApplicationMenu(null);

  // 注册所有 IPC 处理器（通过 tipc）
  registerTipcHandlers();

  // 初始化配置目录路径（供 logger 和 Worker 使用）
  try {
    const { initConfigDir } = await import('./agents/logger.js');
    const configDir = app.isPackaged
      ? path.join(app.getPath('userData'), '.dogear')
      : path.join(process.cwd(), '.dogear');
    initConfigDir(configDir);
  } catch (error) {
    console.error('初始化配置目录失败:', error);
  }

  // 初始化日志文件写入
  try {
    const { initFileLogging } = await import('./agents/logger.js');
    await initFileLogging();
  } catch (error) {
    console.error('初始化日志系统失败:', error);
  }

  // 初始化文章解析器 Skill 规则目录
  try {
    const { ensureSkillsInitialized } = await import('./services/article-parser-skills-service.js');
    await ensureSkillsInitialized();
  } catch (error) {
    console.error('初始化文章解析 Skill 目录失败:', error);
  }

  // 执行数据迁移（旧路径 → 新路径）
  try {
    const workspaceJsonService = await import('./services/workspace-json-service.js');
    await workspaceJsonService.migrateFromLegacy();
    const conversationService = await import('./services/conversation-service.js');
    await conversationService.migrateFromLegacy();
  } catch (error) {
    console.error('数据迁移失败:', error);
  }

  // 初始化 Agent 管理器
  const agentManager = getAgentManager({
    maxWorkers: 4,
    workerIdleTimeout: 60000,
    taskRetryLimit: 2,
    enableAutoCleanup: true
  });
  await agentManager.start();

  createWindow();
  createTray();

  // 主窗口关闭时：有托盘且非真正退出则隐藏到托盘，否则关闭所有子窗口并退出
  mainWindow!.on('close', (event) => {
    if (!isQuitting && tray && !tray.isDestroyed()) {
      event.preventDefault();
      mainWindow!.hide();
      closeAllChildWindows();
    } else {
      closeAllChildWindows();
    }
  });

  // 当应用被激活时(如在 macOS 上点击 Dock 图标)
  // 如果没有其他窗口打开,则创建新窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 当所有窗口都关闭时，因为有托盘，不自动退出
// 真正退出由托盘菜单"退出"或其他显式调用触发
app.on('window-all-closed', () => {
  // 保留托盘，不退出
});

// 应用退出前清理
app.on('before-quit', async () => {
  // 标记为真正退出，使 close 事件不再拦截
  isQuitting = true;
  // 销毁托盘图标
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
    tray = null;
  }
  // 关闭所有 Query-based sessions（会话进程 / SDK 子进程）
  try {
    const { shutdownQueryBasedSessionManager } = await import('./agents/query-based-session.js');
    shutdownQueryBasedSessionManager();
  } catch (error) {
    console.error('关闭 QueryBasedSessionManager 失败:', error);
  }
  // 关闭 Agent Worker 线程池
  await shutdownAgentManager();
});

// ==================== 主进程全局异常捕获 ====================

process.on('uncaughtException', (error) => {
  // 动态导入 logger，避免模块加载顺序问题
  import('./agents/logger.js').then(({ mainLogger }) => {
    mainLogger.error('[主进程未捕获异常]', error.message, error.stack || '');
  }).catch(() => {
    console.error('[主进程未捕获异常]', error);
  });
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;

  import('./agents/logger.js').then(({ mainLogger }) => {
    mainLogger.error('[主进程未处理的Promise拒绝]', message, stack || '');
  }).catch(() => {
    console.error('[主进程未处理的Promise拒绝]', reason);
  });
});
