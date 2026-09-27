/**
 * Electron 主进程入口
 * 负责 app 生命周期、单实例锁、协议注册；窗口工厂与托盘拆分见 window-factories.ts / tray.ts
 */

import electron, { type BrowserWindow as BrowserWindowType } from 'electron';
const { app, BrowserWindow, Menu, protocol, net, nativeTheme } = electron;
import * as path from 'path';
import * as fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { pathToFileURL } from 'url';

const execFileP = promisify(execFile);
import { getRendererHandlers } from '@egoist/tipc/main';
import { getAgentManager, shutdownAgentManager } from './agents/agent-manager.js';
import { registerTipcHandlers } from './tipc/index.js';
import type { RendererHandlers } from './tipc/renderer-handlers.js';
import { getSessionNotificationService } from './services/session-notification-service.js';
import {
  createWindowWithBounds,
  closeAllChildWindows,
  setMainWindow,
  syncTitleBarOverlay,
  getNotesWindow,
  sendToDebugWindow,
  createStockWindow,
  createDataCenterWindow,
  createWorkbenchWindow,
  createNotesWindow,
  createSessionWindow,
  getWorkbenchWindowOpen,
  broadcastSettingsChanged,
} from './window-factories.js';
import { createTray, destroyTray, getTray } from './tray.js';

// 子窗口工厂与查询经此 facade re-export，保持 tipc 层 import '../main-app.js' 路径不变
export {
  sendToDebugWindow,
  createStockWindow,
  createDataCenterWindow,
  createWorkbenchWindow,
  createNotesWindow,
  createSessionWindow,
  getWorkbenchWindowOpen,
  getNotesWindow,
  broadcastSettingsChanged,
};

// 判断是否为开发环境
const isDev = process.env.NODE_ENV === 'development';

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

// 是否正在退出（区分"关闭窗口"和"真正退出"）
let isQuitting = false;

/**
 * 创建 Electron 主窗口（带位置/尺寸/最大化记忆）
 * 托盘隐藏与通知注册内聚在此：异步化后 whenReady 里用 mainWindow! 挂监听时序不保证
 */
async function createWindow() {
  mainWindow = await createWindowWithBounds({
    stateKey: 'main-window',
    width: 1200,
    height: 800,
    title: 'Dogear',
    hashPath: '',
  });
  setMainWindow(mainWindow);

  getSessionNotificationService().registerMainWindow(mainWindow);

  getSessionNotificationService().setLocateCallback((conversationId, workspaceId, taskId) => {
    if (taskId) {
      routeFocusTask(taskId, workspaceId);
      return;
    }
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      const handlers = getRendererHandlers<RendererHandlers>(mainWindow.webContents);
      handlers.focusConversation.send({ conversationId, workspaceId });
    } catch (err) {
      console.error('[session-notification] focus 事件发送失败:', err);
    }
  });

  // 有托盘且非真正退出：隐藏到托盘；close 先于 preventDefault 触发，位置补写在 createWindowWithBounds 的 close 监听内已执行
  mainWindow.on('close', (event) => {
    if (!isQuitting && getTray()) {
      event.preventDefault();
      mainWindow!.hide();
      closeAllChildWindows();
    } else {
      closeAllChildWindows();
    }
  });
}

/**
 * 任务通知点击分流：笔记窗口存活则前置并直发定位事件，否则主窗口切笔记 tab（现状）
 */
function routeFocusTask(taskId: string, workspaceId: string) {
  const notes = getNotesWindow();
  if (notes) {
    if (notes.isMinimized()) notes.restore();
    notes.focus();
    try {
      const h = getRendererHandlers<RendererHandlers>(notes.webContents);
      h.notesTaskFocus.send({ taskId, workspaceId });
    } catch {
      // 写后即广播，发送失败静默
    }
    return;
  }
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const h = getRendererHandlers<RendererHandlers>(mainWindow.webContents);
    h.focusTask.send({ taskId, workspaceId });
  } catch (err) {
    console.error('[session-notification] focus 事件发送失败:', err);
  }
}

// ==================== 应用生命周期 ====================

// macOS GUI 启动 PATH 只有系统 4 目录，Homebrew 等工具探测不到；
// 用登录 shell 的 PATH 前置合并（shell 独有条目优先，原 PATH 条目去重保序）
async function injectLoginShellPath() {
  if (process.platform !== 'darwin') return;
  try {
    const { stdout } = await execFileP('/bin/zsh', ['-l', '-c', 'echo $PATH'], { timeout: 5000 });
    const shellEntries = stdout.trim().split(path.delimiter).filter(Boolean);
    const current = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
    const seen = new Set(current);
    const prepend: string[] = [];
    for (const entry of shellEntries) {
      if (!seen.has(entry)) {
        seen.add(entry);
        prepend.push(entry);
      }
    }
    process.env.PATH = [...prepend, ...current].join(path.delimiter);
  } catch (err) {
    console.error('[main] 注入登录 shell PATH 失败:', err);
  }
}

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
  await injectLoginShellPath();

  app.setAppUserModelId('com.dogear.app');

  const resolveWithinDir = (baseDir: string, decodedPath: string): string => {
    const filePath = path.resolve(baseDir, '.' + decodedPath);
    return filePath.startsWith(baseDir + path.sep) ? filePath : '';
  };

  // 热更产物随 userData 持久化，全量替换 .app 后可能落后于主进程版本，仅版本一致才加载
  const isHotfixCurrent = (hotfixDir: string): boolean => {
    try {
      return (
        fs.readFileSync(path.join(hotfixDir, '.hotfix-version'), 'utf-8').trim() === app.getVersion()
      );
    } catch {
      return false;
    }
  };

  protocol.handle('app', async (request) => {
    const { pathname } = new URL(request.url);
    const decodedPath = decodeURIComponent(pathname);
    let filePath = '';
    if (process.platform === 'darwin') {
      const hotfixDir = path.join(app.getPath('userData'), 'hotfix-out');
      const candidate = resolveWithinDir(hotfixDir, decodedPath);
      if (candidate && isHotfixCurrent(hotfixDir) && fs.existsSync(candidate)) {
        filePath = candidate;
      }
    }
    if (!filePath) {
      const outDir = path.join(process.resourcesPath, 'out');
      filePath = resolveWithinDir(outDir, decodedPath);
      if (!filePath) {
        return new Response(null, { status: 403 });
      }
    }
    const resp = await net.fetch(pathToFileURL(filePath).toString());
    const fontMime = FONT_MIME[path.extname(filePath).toLowerCase()];
    if (fontMime) {
      return new Response(resp.body, { headers: { 'content-type': fontMime } });
    }
    return resp;
  });

  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'windowMenu' },
    ]));
  } else {
    Menu.setApplicationMenu(null);
  }

  // 注册所有 IPC 处理器（通过 tipc）
  registerTipcHandlers();

  // 浏览器扩展网关（pipe server，接收 NM bridge 转发的帧流）
  try {
    const { initBrowserGateway } = await import('./services/browser/browser-gateway.js');
    initBrowserGateway(app.getVersion(), app.getPath('userData'));
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

  // 登录观测器：挂全局分区 webRequest 监听 + 首启存量迁移；先 init 再 migrate，两者共享同一份清单内存态
  try {
    const { initLoginObserver, migrateInitialLoginAccounts } = await import(
      './services/browser/login-observer.js'
    );
    initLoginObserver();
    void migrateInitialLoginAccounts();
  } catch (error) {
    console.error('[login-observer] 初始化失败:', error);
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

  void createWindow();
  createTray({
    isDev,
    getMainWindow: () => mainWindow,
    setQuitting: (v) => { isQuitting = v; },
  });

  // 内嵌浏览器宿主自测：DOGEAR_EMBEDDED_BROWSER_SELFTEST=1 bun run dev:electron 时验证后台 tab 加载链路
  if (isDev && process.env.DOGEAR_EMBEDDED_BROWSER_SELFTEST === '1') {
    void import('./services/browser/embedded/dev-selftest.js')
      .then((m) => m.runEmbeddedBrowserSelfTest())
      .catch((err) => console.error('[embedded-selftest] 失败:', err));
  }

  void import('./services/scheduler/scheduler-service.js')
    .then((m) => m.getSchedulerService().init())
    .catch((err) => console.error('调度器初始化失败:', err));

  // 数据备份调度：启动即查 + 每 30 分钟 tick，配置实时读 settings（改动即生效）
  void import('./services/backup-service/index.js')
    .then((m) =>
      m.startBackupScheduler(() =>
        import('./services/settings-service.js')
          .then((s) => s.loadSettings())
          .then((st) => st.backup?.categories ?? null),
      ),
    )
    .catch((err) => console.error('启动备份调度器失败:', err));

  // 通知中心过期清理：启动时删除已读且超 24h 的条目
  void import('./services/notification-center-service.js')
    .then((m) => m.getNotificationCenterService().pruneExpired())
    .catch((err) => console.error('通知过期清理失败:', err));

  // sessionId 丢失自愈：按 harness 文件创建时间对齐回填
  void import('./services/session-id-repair.js')
    .then((m) => m.repairNullSessionIdsAcrossWorkspaces())
    .catch((err) => console.error('sessionId 自愈扫描失败:', err));

  // 任务队列启动：各工作区遗留 running 任务回 queued 后开跑
  void import('./services/task-queue.js')
    .then((m) => m.recoverAndStartTaskQueue())
    .catch((err) => console.error('任务队列启动失败:', err));

  // 工作区文件树监视：每工作区递归 fs.watch，随 workspaces.json 增删起停
  void import('./services/workspace-watcher.js')
    .then((m) => m.syncWorkspaceWatchers())
    .catch((err) => console.error('启动 workspace-watcher 失败:', err));

  // 话题自动归档：启动跑一次 + 每 24h 一次（归档广播由 group-service 发出）
  void import('./services/auto-archive-service.js')
    .then((m) => m.startAutoArchiveTimer())
    .catch((err) => console.error('启动自动归档定时失败:', err));

  // 飞书 Bot 自动连接：已保存凭证即建常驻 WS，并接好消息处理与 Agent 回复链路
  void import('./tipc/feishu.js')
    .then((m) => m.autoConnectFeishu())
    .catch((err) => console.error('飞书自动连接失败:', err));

  // 当应用被激活时(如在 macOS 上点击 Dock 图标)
  // 主窗口存活则唤回（hide 到托盘后 getAllWindows 仍计数，只判窗口数会永远唤不回）
  app.on('activate', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } else if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow();
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
  // 停止数据备份调度器
  try {
    const { stopBackupScheduler } = await import('./services/backup-service/index.js');
    stopBackupScheduler();
  } catch (error) {
    console.error('停止备份调度器失败:', error);
  }
  // 销毁托盘图标
  destroyTray();
  // 杀掉所有 PTY 终端实例（agent 后台命令 + 用户 shell）
  try {
    const { killAll } = await import('./services/pty-service.js');
    killAll();
  } catch (error) {
    console.error('关闭 PTY 终端失败:', error);
  }
  // 收尾浏览器扩展网关：goodbye 广播 + 管道关闭 + 停止管道监听
  try {
    const { closeBrowserGateway } = await import('./services/browser/browser-gateway.js');
    await closeBrowserGateway();
  } catch (error) {
    console.error('关闭浏览器扩展网关失败:', error);
  }
  // 关闭内嵌浏览器宿主（销毁全部 WebContentsView）
  try {
    const { getEmbeddedBrowserManager } = await import('./services/browser/embedded/embedded-browser-manager.js');
    getEmbeddedBrowserManager().dispose();
  } catch (error) {
    console.error('关闭内嵌浏览器宿主失败:', error);
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
