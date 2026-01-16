/**
 * Electron 主进程入口
 * 负责应用窗口管理和生命周期
 */

import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { getAgentManager, shutdownAgentManager } from './agents/agent-manager.js';
import { registerAllHandlers } from './ipc/index.js';

// 获取当前文件的路径和目录名(ES Module 环境)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 判断是否为开发环境
const isDev = process.env.NODE_ENV === 'development';

// 主窗口实例
let mainWindow: BrowserWindow | null = null;

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
    // 开发环境:加载 Next.js 开发服务器
    mainWindow.loadURL('http://localhost:3000');
    // 打开开发者工具
    mainWindow.webContents.openDevTools();
  } else {
    // 生产环境:加载构建后的静态文件
    mainWindow.loadFile(path.join(__dirname, '../../out/index.html'));
  }
}

// ==================== 应用生命周期 ====================

// 当 Electron 完成初始化时创建窗口
app.whenReady().then(async () => {
  // 注册所有 IPC 处理器
  registerAllHandlers();

  // 初始化 Agent 管理器
  const agentManager = getAgentManager({
    maxWorkers: 4,
    workerIdleTimeout: 60000,
    taskRetryLimit: 2,
    enableAutoCleanup: true
  });
  await agentManager.start();

  createWindow();

  // 当应用被激活时(如在 macOS 上点击 Dock 图标)
  // 如果没有其他窗口打开,则创建新窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 当所有窗口都关闭时退出应用(在 macOS 上除外)
app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin') {
    // 关闭 Agent 管理器
    await shutdownAgentManager();
    app.quit();
  }
});

// 应用退出前清理
app.on('before-quit', async () => {
  // 关闭 Agent 管理器
  await shutdownAgentManager();
});
