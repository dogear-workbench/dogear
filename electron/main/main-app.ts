/**
 * Electron 主进程入口
 * 负责应用窗口管理和生命周期
 */

import electron, { type BrowserWindow as BrowserWindowType, type Tray as TrayType } from 'electron';
const { app, BrowserWindow, Menu, Tray, protocol, net, nativeTheme } = electron;
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname } from 'path';
import { getRendererHandlers } from '@egoist/tipc/main';
import { getAgentManager, shutdownAgentManager } from './agents/agent-manager.js';
import { registerTipcHandlers } from './tipc/index.js';
import type { RendererHandlers } from './tipc/renderer-handlers.js';
import { getSessionNotificationService } from './services/session-notification-service.js';

// 获取当前文件的路径和目录名(ES Module 环境)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 判断是否为开发环境
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

function syncTitleBarOverlay() {
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

// file:// 页面 origin 为 opaque(null)，CSS 字体等 CORS 严格资源会被拦，改用 standard scheme 的 app://
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

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

// 自选股窗口实例
let stockWindow: BrowserWindowType | null = null;

// 数据中心窗口实例
let dataCenterWindow: BrowserWindowType | null = null;

// 伴随工作台窗口实例
let workbenchWindow: BrowserWindowType | null = null;

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
    titleBarStyle: 'hidden',
    titleBarOverlay: currentTitleBarOverlay(),
    webPreferences: {
      // 预加载脚本路径
      preload: path.join(__dirname, '../preload/index.js'),
      // 启用上下文隔离,提高安全性
      contextIsolation: true,
      // 禁用 Node.js 集成,提高安全性
      nodeIntegration: false,
    },
  });

  // 根据环境加载页面（dev 走 Vite dev server，生产走 app:// 自定义协议）
  mainWindow.loadURL(getRendererPath());
  if (isDev) {
    // 打开开发者工具
    //mainWindow.webContents.openDevTools();

    // 创建调试窗口
    // createDebugWindow();
  }

  getSessionNotificationService().registerMainWindow(mainWindow);

  getSessionNotificationService().setLocateCallback((conversationId, workspaceId, taskId) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      const handlers = getRendererHandlers<RendererHandlers>(mainWindow.webContents);
      if (taskId) {
        handlers.focusTask.send({ taskId, workspaceId });
      } else {
        handlers.focusConversation.send({ conversationId, workspaceId });
      }
    } catch (err) {
      console.error('[session-notification] focus 事件发送失败:', err);
    }
  });
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
  const debugUrl = `${getRendererPath()}#/debug`;
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
    titleBarStyle: 'hidden',
    titleBarOverlay: currentTitleBarOverlay(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const stockUrl = `${getRendererPath()}#/stocks`;
  stockWindow.loadURL(stockUrl);

  stockWindow.on('closed', () => {
    stockWindow = null;
  });
}

/**
 * 创建数据中心窗口（单例，已存在则聚焦）
 */
export function createDataCenterWindow() {
  if (dataCenterWindow) {
    dataCenterWindow.focus();
    return;
  }

  dataCenterWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: '数据中心',
    titleBarStyle: 'hidden',
    titleBarOverlay: currentTitleBarOverlay(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const dataCenterUrl = `${getRendererPath()}#/data-center`;
  dataCenterWindow.loadURL(dataCenterUrl);

  dataCenterWindow.on('closed', () => {
    dataCenterWindow = null;
  });
}

/**
 * 创建伴随工作台窗口（单例，已存在则聚焦）
 * 位置记忆：moved/resized 防抖存 window-state.json，创建时读取并用 screen 校验可视范围
 */
export async function createWorkbenchWindow() {
  if (workbenchWindow) {
    if (workbenchWindow.isMinimized()) workbenchWindow.restore();
    workbenchWindow.focus();
    return;
  }

  const { loadWindowBounds, saveWindowBounds } = await import('./services/window-state-service.js');
  const saved = await loadWindowBounds('workbench-window');
  const hasPosition = !!saved && saved.x !== null && saved.y !== null;

  workbenchWindow = new BrowserWindow({
    width: saved?.width ?? 560,
    height: saved?.height ?? 840,
    x: hasPosition ? saved!.x ?? undefined : undefined,
    y: hasPosition ? saved!.y ?? undefined : undefined,
    title: '伴随工作台',
    titleBarStyle: 'hidden',
    titleBarOverlay: currentTitleBarOverlay(),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const workbenchUrl = `${getRendererPath()}#/workbench-window`;
  workbenchWindow.loadURL(workbenchUrl);

  if (hasPosition) {
    const bounds = workbenchWindow.getBounds();
    const { screen } = electron;
    const workArea = screen.getDisplayMatching(bounds).workArea;
    const overlapX = Math.min(bounds.x + bounds.width, workArea.x + workArea.width) - Math.max(bounds.x, workArea.x);
    const overlapY = Math.min(bounds.y + bounds.height, workArea.y + workArea.height) - Math.max(bounds.y, workArea.y);
    if (overlapX < 60 || overlapY < 60) {
      workbenchWindow.center();
    }
  }

  let saveTimer: NodeJS.Timeout | null = null;
  const persistBounds = () => {
    if (!workbenchWindow || workbenchWindow.isDestroyed()) return;
    if (workbenchWindow.isMinimized() || workbenchWindow.isMaximized() || workbenchWindow.isFullScreen()) return;
    const { x, y, width, height } = workbenchWindow.getBounds();
    void saveWindowBounds('workbench-window', { x, y, width, height });
  };
  const schedulePersistBounds = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      persistBounds();
    }, 500);
  };
  workbenchWindow.on('moved', schedulePersistBounds);
  workbenchWindow.on('resized', schedulePersistBounds);
  workbenchWindow.on('close', () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    persistBounds();
  });

  workbenchWindow.on('closed', () => {
    workbenchWindow = null;
  });
}

/**
 * 设置已落盘，通知所有窗口刷新（restartSessions=true 时同时重启活跃会话）
 * 发起保存的窗口 store 已同步，重复 loadSettings 幂等无妨；
 * 广播到全部窗口是主题/字号等 UI 设置跨窗口即时生效的前提
 */
export function broadcastSettingsChanged(restartSessions: boolean) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      const h = getRendererHandlers<RendererHandlers>(win.webContents);
      h.settingsChanged.send({ restartSessions });
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
    titleBarStyle: 'hidden',
    titleBarOverlay: currentTitleBarOverlay(),
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
function closeAllChildWindows() {
  if (stockWindow && !stockWindow.isDestroyed()) {
    stockWindow.close();
  }
  if (dataCenterWindow && !dataCenterWindow.isDestroyed()) {
    dataCenterWindow.close();
  }
  if (workbenchWindow && !workbenchWindow.isDestroyed()) {
    workbenchWindow.close();
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

  getSessionNotificationService().registerTray(tray, iconPath);
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
const FONT_MIME: Record<string, string> = {
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

app.whenReady().then(async () => {
  app.setAppUserModelId('com.dogear.app');

  protocol.handle('app', async (request) => {
    const { pathname } = new URL(request.url);
    const outDir = path.join(process.resourcesPath, 'out');
    const filePath = path.resolve(outDir, '.' + decodeURIComponent(pathname));
    if (!filePath.startsWith(outDir + path.sep)) {
      return new Response(null, { status: 403 });
    }
    const resp = await net.fetch(pathToFileURL(filePath).toString());
    const fontMime = FONT_MIME[path.extname(filePath).toLowerCase()];
    if (fontMime) {
      return new Response(resp.body, { headers: { 'content-type': fontMime } });
    }
    return resp;
  });

  Menu.setApplicationMenu(null);

  // 注册所有 IPC 处理器（通过 tipc）
  registerTipcHandlers();

  // 浏览器扩展网关（pipe server，接收 NM bridge 转发的帧流）
  try {
    const { initBrowserGateway } = await import('./services/browser/browser-gateway.js');
    initBrowserGateway(app.getVersion());
  } catch (error) {
    console.error('初始化浏览器扩展网关失败:', error);
  }

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

  // 初始化跨会话复盘 Skill 目录
  try {
    const { ensureReviewSkillInitialized } = await import('./services/memory/review-skill-service.js');
    await ensureReviewSkillInitialized();
  } catch (error) {
    console.error('初始化复盘 Skill 目录失败:', error);
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

  // 会话组 P1: 给老会话补 groupId
  try {
    const workspaceJsonService = await import('./services/workspace-json-service.js');
    const conversationService = await import('./services/conversation-service.js');
    const workspaces = await workspaceJsonService.getAll();
    let total = 0;
    for (const ws of workspaces) {
      total += await conversationService.migrateOrphanConversations(ws.id);
    }
    if (total > 0) console.log(`[group-migration] ${total} 条会话补齐 groupId`);
  } catch (error) {
    console.error('会话组迁移失败:', error);
  }

  // sessionId 持久化迁移：sdkSessionId 合并到 sessionId + 空壳指针修复 + 空壳 jsonl 清理
  // 必须在 migration-p3 之前执行：migration-p3 的 migrateDigestCards 用 c.sessionId 构建 sessionToConv Map
  try {
    const { runSessionIdMigration } = await import('./services/migration-session-id.js');
    await runSessionIdMigration();
  } catch (error) {
    console.error('[migration-session-id] 失败:', error);
  }

  // workspace config 迁移：enabledToolPacks + enabledSkills 从旧位置迁移到 workspace config.json
  try {
    const { migrateWorkspaceConfig } = await import('./services/migration-workspace-config.js');
    await migrateWorkspaceConfig();
  } catch (error) {
    console.error('[migration-workspace-config] 失败:', error);
  }

  // 存量对话 modelSelection 旧三档 tier（haiku/sonnet/opus）映射为 piModels 真实模型 id
  try {
    const { migrateLegacyModelSelections } = await import('./services/conversation-service.js');
    const migrated = await migrateLegacyModelSelections();
    if (migrated > 0) console.log(`[migration-model-selection] ${migrated} 条对话的 modelSelection 已迁移`);
  } catch (error) {
    console.error('[migration-model-selection] 失败:', error);
  }

  // Phase 3 迁移：旧会话卡升级为组卡 + smart-categories/conversation-tree 字段升级
  try {
    const { runMigrationP3 } = await import('./services/memory/migration-p3.js');
    const configDir = app.isPackaged
      ? path.join(app.getPath('userData'), '.dogear')
      : path.join(process.cwd(), '.dogear');
    await runMigrationP3(configDir);
  } catch (error) {
    console.error('[migration-p3] 失败:', error);
  }

  // Phase 4 迁移：组卡 digests/<groupId>.md → groups/<groupId>/digest.md，删 _cleaned/
  try {
    const { runMigrationP4 } = await import('./services/memory/migration-p4.js');
    const configDir = app.isPackaged
      ? path.join(app.getPath('userData'), '.dogear')
      : path.join(process.cwd(), '.dogear');
    await runMigrationP4(configDir);
    const { runTopicLifecycleMigration } = await import('./services/topic-lifecycle-service.js');
    const result = await runTopicLifecycleMigration();
    if (result.errors.length > 0) {
      console.error('[topic-lifecycle-migration] 失败:', result.errors);
    } else {
      console.log(
        `[topic-lifecycle-migration] 完成: 删除 ${result.conversationsDeleted} 条旧归档会话，` +
        `处理 ${result.workspacesProcessed} 个工作区，跳过 ${result.workspacesSkipped} 个工作区`,
      );
    }
  } catch (error) {
    console.error('[migration-p4/topic-lifecycle] 失败:', error);
  } finally {
    // 无论迁移成功失败都放开 gate（失败情况下 group-digest / category / review trigger 会读到新路径的空目录，
    // 比永远堵住更好——用户可以看到问题、手动重跑迁移或触发提炼）
    const { markMigrationComplete } = await import('./services/memory/migration-gate.js');
    markMigrationComplete();
  }

  // 初始化 Agent 管理器
  const agentManager = getAgentManager({
    maxWorkers: 4,
    workerIdleTimeout: 60000,
    taskRetryLimit: 2,
    enableAutoCleanup: true
  });
  await agentManager.start();

  // 启动时应用外观主题（nativeTheme.themeSource 管系统跟随与原生标题栏深浅）
  try {
    const { loadSettings, applyThemeSource } = await import('./services/settings-service.js');
    const appSettings = await loadSettings();
    applyThemeSource(appSettings.appearance?.theme);
  } catch (error) {
    console.error('初始化主题失败:', error);
  }
  nativeTheme.on('updated', syncTitleBarOverlay);

  createWindow();
  createTray();

  void import('./services/scheduler/scheduler-service.js')
    .then((m) => m.getSchedulerService().init())
    .catch((err) => console.error('调度器初始化失败:', err));

  // 一次性清理旧持久层遗留的 delegation-state.json（重启后的历史子会话由 conversation 补集提供）
  void import('./agents/delegation-bridge.js')
    .then((m) => m.cleanupLegacyStateFile())
    .catch((err) => console.error('清理旧版 delegation-state.json 失败:', err));

  // sessionId 丢失自愈：按 harness 文件创建时间对齐回填
  void import('./services/session-id-repair.js')
    .then((m) => m.repairNullSessionIdsAcrossWorkspaces())
    .catch((err) => console.error('sessionId 自愈扫描失败:', err));

  // 待办实体退役迁移：todos.json 人待办并入笔记正文勾选项（幂等，迁完改名 .migrated）
  void import('./services/migrate-notes-todos.js')
    .then((m) => m.migrateTodosToNotesAllWorkspaces())
    .catch((err) => console.error('待办迁移失败:', err));

  // 任务队列启动：各工作区遗留 running 任务回 queued 后开跑
  void import('./services/task-queue.js')
    .then((m) => m.recoverAndStartTaskQueue())
    .catch((err) => console.error('任务队列启动失败:', err));

  // 首页报告文件监视：dashboard.md 任意写入都广播给前端实时刷新
  void import('./services/memory/dashboard-watcher.js')
    .then((m) => m.startDashboardWatcher())
    .catch((err) => console.error('启动 dashboard-watcher 失败:', err));

  // 工作区文件树监视：每工作区递归 fs.watch，随 workspaces.json 增删起停
  void import('./services/workspace-watcher.js')
    .then((m) => m.syncWorkspaceWatchers())
    .catch((err) => console.error('启动 workspace-watcher 失败:', err));

  // 话题自动归档：启动跑一次 + 每 24h 一次（归档广播由 group-service 发出）
  void import('./services/auto-archive-service.js')
    .then((m) => m.startAutoArchiveTimer())
    .catch((err) => console.error('启动自动归档定时失败:', err));

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
  // 停止调度器（分钟 tick）
  try {
    const { getSchedulerService } = await import('./services/scheduler/scheduler-service.js');
    getSchedulerService().stop();
  } catch (error) {
    console.error('停止调度器失败:', error);
  }
  // 销毁托盘图标
  if (tray && !tray.isDestroyed()) {
    tray.destroy();
    tray = null;
  }
  // 杀掉所有 PTY 终端实例（agent 后台命令 + 用户 shell）
  try {
    const { killAll } = await import('./services/pty-service.js');
    killAll();
  } catch (error) {
    console.error('关闭 PTY 终端失败:', error);
  }
  // 强杀受控浏览器实例
  try {
    const { getBrowserManager } = await import('./services/browser/browser-manager.js');
    await getBrowserManager().dispose();
  } catch (error) {
    console.error('关闭受控浏览器失败:', error);
  }
  // 关闭所有 pi 会话
  try {
    const { shutdownPiSessionManager } = await import('./agents/pi-session/pi-session-manager.js');
    shutdownPiSessionManager();
  } catch (error) {
    console.error('关闭 PiSessionManager 失败:', error);
  }
  // 通知服务 dispose：注销 Notification 监听、停止 flashFrame
  try {
    getSessionNotificationService().dispose();
  } catch (error) {
    console.error('通知服务 dispose 失败:', error);
  }
  // 停止工作区文件树监视
  try {
    void import('./services/workspace-watcher.js')
      .then((m) => m.stopAllWorkspaceWatchers())
      .catch(() => {});
  } catch {
    // ignore
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
