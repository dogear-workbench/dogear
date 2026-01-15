import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { dbBooks, dbAI } from '../main/database';
import * as bookService from './services/book-service';
import * as aiService from './services/ai-service';

const isDev = process.env.NODE_ENV === 'development';

let mainWindow: BrowserWindow | null = null;

function createWindow() {
  mainWindow = new BrowserWindow({
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
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../out/index.html'));
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers
ipcMain.handle('db:getBooks', () => {
  return dbBooks.getAll();
});

ipcMain.handle('db:getBookById', (_, id: number) => {
  return dbBooks.getById(id);
});

ipcMain.handle('db:addBook', (_, book) => {
  return dbBooks.add(book);
});

ipcMain.handle('db:updateBook', (_, id: number, data) => {
  return dbBooks.update(id, data);
});

ipcMain.handle('db:deleteBook', (_, id: number) => {
  return dbBooks.delete(id);
});

ipcMain.handle('ai:chat', async (_, messages) => {
  return aiService.chat(messages);
});

ipcMain.handle('ai:summarize', async (_, text: string) => {
  return aiService.summarize(text);
});

ipcMain.handle('file:select', async () => {
  return bookService.selectBookFile();
});

ipcMain.handle('file:importBook', async (_, filePath: string) => {
  return bookService.importBook(filePath);
});
