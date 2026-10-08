const noop = () => {};

const app = {
  isPackaged: false,
  whenReady: () => Promise.resolve(),
  getPath: () => process.env.DOGEAR_CONFIG_DIR ?? process.cwd(),
  on: noop,
  quit: noop,
  exit: noop,
};

class BrowserWindow {
  static getAllWindows() {
    return [];
  }

  isDestroyed() {
    return true;
  }

  webContents = {
    send: noop,
  };
}

const ipcMain = {
  handle: noop,
  on: noop,
  once: noop,
  removeAllListeners: noop,
};

const nativeImage = {
  createEmpty: () => ({}),
  createFromPath: () => ({}),
  createFromBuffer: () => ({}),
};

const Notification = class {
  static isSupported() {
    return false;
  }
};

const Tray = class {};

const dialog = { showMessageBox: async () => ({ response: 0 }), showErrorBox: noop };
const shell = { openExternal: async () => {}, openPath: async () => '' };
const clipboard = { writeText: noop, readText: () => '' };
const screen = { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) };
const session = { defaultSession: {} };
const net = { fetch: () => Promise.reject(new Error('electron unavailable in eval runner')) };
const globalShortcut = { register: () => false, unregisterAll: noop };
const Menu = { buildFromTemplate: () => ({}), setApplicationMenu: noop };

const nativeTheme = { shouldUseDarkColors: false, on: noop };

const eventTargetLike = {
  on: noop,
  once: noop,
  off: noop,
  removeAllListeners: noop,
};

const electron = {
  app,
  BrowserWindow,
  ipcMain,
  nativeImage,
  nativeTheme,
  Notification,
  Tray,
  dialog,
  shell,
  clipboard,
  screen,
  session,
  net,
  powerMonitor: eventTargetLike,
  globalShortcut,
  Menu,
};

export {
  electron as default,
  app,
  BrowserWindow,
  ipcMain,
  nativeImage,
  nativeTheme,
  Notification,
  Tray,
  dialog,
  shell,
  clipboard,
  screen,
  session,
  net,
  eventTargetLike as powerMonitor,
  globalShortcut,
  Menu,
};
