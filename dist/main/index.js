"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path = __importStar(require("path"));
const database_1 = require("../main/database");
const bookService = __importStar(require("./services/book-service"));
const aiService = __importStar(require("./services/ai-service"));
const isDev = process.env.NODE_ENV === 'development';
let mainWindow = null;
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, '../preload/index.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });
    if (isDev) {
        mainWindow.loadURL('http://localhost:3000');
        mainWindow.webContents.openDevTools();
    }
    else {
        mainWindow.loadFile(path.join(__dirname, '../../out/index.html'));
    }
}
electron_1.app.whenReady().then(() => {
    createWindow();
    electron_1.app.on('activate', () => {
        if (electron_1.BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
// IPC Handlers
electron_1.ipcMain.handle('db:getBooks', () => {
    return database_1.dbBooks.getAll();
});
electron_1.ipcMain.handle('db:getBookById', (_, id) => {
    return database_1.dbBooks.getById(id);
});
electron_1.ipcMain.handle('db:addBook', (_, book) => {
    return database_1.dbBooks.add(book);
});
electron_1.ipcMain.handle('db:updateBook', (_, id, data) => {
    return database_1.dbBooks.update(id, data);
});
electron_1.ipcMain.handle('db:deleteBook', (_, id) => {
    return database_1.dbBooks.delete(id);
});
electron_1.ipcMain.handle('ai:chat', async (_, messages) => {
    return aiService.chat(messages);
});
electron_1.ipcMain.handle('ai:summarize', async (_, text) => {
    return aiService.summarize(text);
});
electron_1.ipcMain.handle('file:select', async () => {
    return bookService.selectBookFile();
});
electron_1.ipcMain.handle('file:importBook', async (_, filePath) => {
    return bookService.importBook(filePath);
});
