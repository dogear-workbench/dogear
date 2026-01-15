# Dogear - AI 辅助读书应用实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 从零构建一个 Electron + Next.js + shadcn/ui 的桌面电子书阅读应用,集成 AI 辅助功能

**Architecture:** Electron 主进程管理数据库和文件操作,Next.js 渲染进程提供 UI,通过 IPC 通信,生产环境打包为静态文件

**Tech Stack:** Electron, Next.js 16, shadcn/ui, better-sqlite3, Electron Builder, OpenAI/Claude API

---

## Phase 1: 基础架构搭建

### Task 1.1: 安装项目依赖

**Files:**
- Modify: `package.json`

**Step 1: 安装 Electron 相关依赖**

Run:
```bash
npm install --save-dev electron-builder concurrently wait-on cross-env
npm install --save-dev electron-is-dev
```

Expected: 所有依赖成功安装到 `node_modules`

**Step 2: 安装数据库依赖**

Run:
```bash
npm install better-sqlite3
npm install --save-dev @types/better-sqlite3
```

Expected: better-sqlite3 及其类型定义安装成功

**Step 3: 安装电子书解析库**

Run:
```bash
npm install epub2 pdf-parse iconv-lite
```

Expected: 电子书解析库安装成功

**Step 4: 提交依赖安装**

Run:
```bash
git add package.json package-lock.json
git commit -m "feat: install core dependencies for Electron app"
```

---

### Task 1.2: 创建 Electron 主进程入口

**Files:**
- Create: `electron/main/index.ts`
- Create: `electron/main/database/index.ts`
- Create: `electron/main/database/schema.sql`
- Create: `electron/main/preload/index.ts`

**Step 1: 创建数据库 schema 文件**

Create file `electron/main/database/schema.sql`:
```sql
CREATE TABLE IF NOT EXISTS books (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  author TEXT,
  file_path TEXT UNIQUE,
  file_type TEXT,
  total_pages INTEGER,
  current_page INTEGER DEFAULT 0,
  cover_image TEXT,
  metadata TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_interactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id INTEGER,
  type TEXT NOT NULL,
  user_message TEXT,
  ai_response TEXT,
  context_text TEXT,
  model_info TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_books_created ON books(created_at);
CREATE INDEX IF NOT EXISTS idx_ai_book_id ON ai_interactions(book_id);
CREATE INDEX IF NOT EXISTS idx_ai_created ON ai_interactions(created_at);
```

**Step 2: 创建数据库封装**

Create file `electron/main/database/index.ts`:
```typescript
import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';

// 读取 schema
const schemaPath = path.join(__dirname, 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf-8');

// 初始化数据库
const userDataPath = app.getPath('userData');
const dbPath = path.join(userDataPath, 'dogear.db');

const db = new Database(dbPath);
db.exec(schema);

export interface Book {
  id?: number;
  title: string;
  author?: string;
  file_path: string;
  file_type: string;
  total_pages?: number;
  current_page?: number;
  cover_image?: string;
  metadata?: string;
  created_at?: string;
  updated_at?: string;
}

export interface AIInteraction {
  id?: number;
  book_id?: number;
  type: 'chat' | 'summarize' | 'qna';
  user_message?: string;
  ai_response: string;
  context_text?: string;
  model_info?: string;
  created_at?: string;
}

// 书籍操作
export const dbBooks = {
  getAll: (): Book[] => {
    const stmt = db.prepare('SELECT * FROM books ORDER BY created_at DESC');
    return stmt.all() as Book[];
  },

  getById: (id: number): Book | undefined => {
    const stmt = db.prepare('SELECT * FROM books WHERE id = ?');
    return stmt.get(id) as Book | undefined;
  },

  add: (book: Book): number => {
    const stmt = db.prepare(`
      INSERT INTO books (title, author, file_path, file_type, total_pages, current_page, cover_image, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      book.title,
      book.author || null,
      book.file_path,
      book.file_type,
      book.total_pages || null,
      book.current_page || 0,
      book.cover_image || null,
      book.metadata || null
    );
    return result.lastInsertRowid as number;
  },

  update: (id: number, book: Partial<Book>): void => {
    const fields = Object.keys(book)
      .filter(k => k !== 'id' && k !== 'created_at')
      .map(k => `${k} = ?`)
      .join(', ');

    const values = Object.entries(book)
      .filter(([k]) => k !== 'id' && k !== 'created_at')
      .map(([, v]) => v);

    const stmt = db.prepare(`UPDATE books SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
    stmt.run(...values, id);
  },

  delete: (id: number): void => {
    const stmt = db.prepare('DELETE FROM books WHERE id = ?');
    stmt.run(id);
  }
};

// AI 交互操作
export const dbAI = {
  getByBookId: (bookId: number): AIInteraction[] => {
    const stmt = db.prepare('SELECT * FROM ai_interactions WHERE book_id = ? ORDER BY created_at DESC');
    return stmt.all(bookId) as AIInteraction[];
  },

  add: (interaction: AIInteraction): number => {
    const stmt = db.prepare(`
      INSERT INTO ai_interactions (book_id, type, user_message, ai_response, context_text, model_info)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      interaction.book_id || null,
      interaction.type,
      interaction.user_message || null,
      interaction.ai_response,
      interaction.context_text || null,
      interaction.model_info || null
    );
    return result.lastInsertRowid as number;
  }
};

export default db;
```

**Step 3: 创建 Preload 脚本**

Create file `electron/preload/index.ts`:
```typescript
import { contextBridge, ipcRenderer } from 'electron';

export interface ElectronAPI {
  db: {
    getBooks: () => Promise<any[]>;
    getBookById: (id: number) => Promise<any>;
    addBook: (book: any) => Promise<number>;
    updateBook: (id: number, data: any) => Promise<void>;
    deleteBook: (id: number) => Promise<void>;
  };
  ai: {
    chat: (messages: any[]) => Promise<string>;
    summarize: (text: string) => Promise<string>;
  };
  file: {
    selectFile: () => Promise<string | null>;
    importBook: (path: string) => Promise<any>;
  };
}

const electronAPI: ElectronAPI = {
  db: {
    getBooks: () => ipcRenderer.invoke('db:getBooks'),
    getBookById: (id: number) => ipcRenderer.invoke('db:getBookById', id),
    addBook: (book: any) => ipcRenderer.invoke('db:addBook', book),
    updateBook: (id: number, data: any) => ipcRenderer.invoke('db:updateBook', id, data),
    deleteBook: (id: number) => ipcRenderer.invoke('db:deleteBook', id),
  },
  ai: {
    chat: (messages: any[]) => ipcRenderer.invoke('ai:chat', messages),
    summarize: (text: string) => ipcRenderer.invoke('ai:summarize', text),
  },
  file: {
    selectFile: () => ipcRenderer.invoke('file:select'),
    importBook: (path: string) => ipcRenderer.invoke('file:importBook', path),
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
```

**Step 4: 创建主进程入口**

Create file `electron/main/index.ts`:
```typescript
import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { dbBooks, dbAI } from '../main/database';

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
  // TODO: 实现 AI 聊天
  return 'AI response placeholder';
});

ipcMain.handle('ai:summarize', async (_, text: string) => {
  // TODO: 实现 AI 摘要
  return 'Summary placeholder';
});

ipcMain.handle('file:select', async () => {
  // TODO: 实现文件选择
  return null;
});

ipcMain.handle('file:importBook', async (_, filePath: string) => {
  // TODO: 实现书籍导入
  return null;
});
```

**Step 5: 提交主进程代码**

Run:
```bash
git add electron/
git commit -m "feat: add Electron main process and database layer"
```

---

### Task 1.3: 配置 TypeScript 和构建脚本

**Files:**
- Create: `tsconfig.electron.json`
- Modify: `package.json`
- Modify: `next.config.js`

**Step 1: 创建 Electron 的 TypeScript 配置**

Create file `tsconfig.electron.json`:
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./electron",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "moduleResolution": "node",
    "types": ["node"]
  },
  "include": ["electron/**/*"],
  "exclude": ["node_modules", "app", "components", "lib", "public"]
}
```

**Step 2: 更新 Next.js 配置**

Modify file `next.config.js`:
```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
```

**Step 3: 更新 package.json 脚本**

Modify `package.json` scripts section:
```json
{
  "scripts": {
    "dev": "concurrently \"npm run dev:next\" \"npm run dev:electron\"",
    "dev:next": "next dev",
    "dev:electron": "wait-on http://localhost:3000 && cross-env NODE_ENV=development electron .",
    "build:next": "next build",
    "build:electron": "tsc -p tsconfig.electron.json",
    "build": "npm run build:next && npm run build:electron",
    "dist": "npm run build && electron-builder",
    "lint": "eslint ."
  }
}
```

**Step 4: 添加 Electron Builder 配置**

Create file `electron-builder.yml`:
```yaml
appId: com.dogear.app
productName: Dogear
directories:
  output: dist
files:
  - electron/**/*
  - out/**/*
  - node_modules/**
  - package.json
win:
  target: nsis
  icon: build/icon.ico
mac:
  target: dmg
  icon: build/icon.icns
```

**Step 5: 提交配置文件**

Run:
```bash
git add tsconfig.electron.json next.config.js package.json electron-builder.yml
git commit -m "feat: configure TypeScript and build scripts"
```

---

## Phase 2: 创建 Next.js 集成层

### Task 2.1: 创建 Electron API 封装

**Files:**
- Create: `lib/electron.ts`
- Create: `lib/types.ts`
- Create: `lib/hooks.ts`

**Step 1: 创建类型定义**

Create file `lib/types.ts`:
```typescript
export interface Book {
  id?: number;
  title: string;
  author?: string;
  file_path: string;
  file_type: string;
  total_pages?: number;
  current_page?: number;
  cover_image?: string;
  metadata?: string;
  created_at?: string;
  updated_at?: string;
}

export interface AIInteraction {
  id?: number;
  book_id?: number;
  type: 'chat' | 'summarize' | 'qna';
  user_message?: string;
  ai_response: string;
  context_text?: string;
  model_info?: string;
  created_at?: string;
}

declare global {
  interface Window {
    electronAPI: {
      db: {
        getBooks: () => Promise<Book[]>;
        getBookById: (id: number) => Promise<Book>;
        addBook: (book: Book) => Promise<number>;
        updateBook: (id: number, data: Partial<Book>) => Promise<void>;
        deleteBook: (id: number) => Promise<void>;
      };
      ai: {
        chat: (messages: any[]) => Promise<string>;
        summarize: (text: string) => Promise<string>;
      };
      file: {
        selectFile: () => Promise<string | null>;
        importBook: (path: string) => Promise<Book>;
      };
    };
  }
}
```

**Step 2: 创建 Electron API 客户端**

Create file `lib/electron.ts`:
```typescript
import { Book, AIInteraction } from './types';

export const electronDB = {
  getBooks: async (): Promise<Book[]> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.db.getBooks();
    }
    return [];
  },

  getBookById: async (id: number): Promise<Book> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.db.getBookById(id);
    }
    throw new Error('Electron API not available');
  },

  addBook: async (book: Book): Promise<number> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.db.addBook(book);
    }
    throw new Error('Electron API not available');
  },

  updateBook: async (id: number, data: Partial<Book>): Promise<void> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.db.updateBook(id, data);
    }
    throw new Error('Electron API not available');
  },

  deleteBook: async (id: number): Promise<void> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.db.deleteBook(id);
    }
    throw new Error('Electron API not available');
  },
};

export const electronAI = {
  chat: async (messages: any[]): Promise<string> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.ai.chat(messages);
    }
    throw new Error('Electron API not available');
  },

  summarize: async (text: string): Promise<string> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.ai.summarize(text);
    }
    throw new Error('Electron API not available');
  },
};

export const electronFile = {
  selectFile: async (): Promise<string | null> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.file.selectFile();
    }
    return null;
  },

  importBook: async (path: string): Promise<Book> => {
    if (typeof window !== 'undefined' && window.electronAPI) {
      return window.electronAPI.file.importBook(path);
    }
    throw new Error('Electron API not available');
  },
};
```

**Step 3: 创建 React Hooks**

Create file `lib/hooks.ts`:
```typescript
'use client';

import { useState, useEffect } from 'react';
import { Book } from './types';
import { electronDB } from './electron';

export function useBooks() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    loadBooks();
  }, []);

  const loadBooks = async () => {
    try {
      setLoading(true);
      const data = await electronDB.getBooks();
      setBooks(data);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  };

  const addBook = async (book: Book) => {
    const id = await electronDB.addBook(book);
    await loadBooks();
    return id;
  };

  const deleteBook = async (id: number) => {
    await electronDB.deleteBook(id);
    await loadBooks();
  };

  return { books, loading, error, addBook, deleteBook, reload: loadBooks };
}

export function useBook(id: number) {
  const [book, setBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    loadBook();
  }, [id]);

  const loadBook = async () => {
    try {
      setLoading(true);
      const data = await electronDB.getBookById(id);
      setBook(data);
      setError(null);
    } catch (err) {
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  };

  const updateBook = async (data: Partial<Book>) => {
    if (book?.id) {
      await electronDB.updateBook(book.id, data);
      await loadBook();
    }
  };

  return { book, loading, error, updateBook };
}
```

**Step 4: 提交封装层代码**

Run:
```bash
git add lib/
git commit -m "feat: add Electron API wrapper and React hooks"
```

---

## Phase 3: 创建书籍管理界面

### Task 3.1: 创建书籍列表页面

**Files:**
- Modify: `app/page.tsx`
- Create: `components/book-list.tsx`
- Create: `components/book-card.tsx`

**Step 1: 创建书籍卡片组件**

Create file `components/book-card.tsx`:
```typescript
'use client';

import { Book } from '@/lib/types';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BookOpen, Trash2 } from 'lucide-react';
import Link from 'next/link';

interface BookCardProps {
  book: Book;
  onDelete?: (id: number) => void;
}

export function BookCard({ book, onDelete }: BookCardProps) {
  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <CardTitle className="flex items-start justify-between">
          <span className="line-clamp-2">{book.title}</span>
        </CardTitle>
        {book.author && (
          <p className="text-sm text-muted-foreground">{book.author}</p>
        )}
      </CardHeader>
      <CardContent>
        <div className="aspect-[3/4] bg-muted rounded-md flex items-center justify-center">
          {book.cover_image ? (
            <img
              src={book.cover_image}
              alt={book.title}
              className="w-full h-full object-cover rounded-md"
            />
          ) : (
            <BookOpen className="w-16 h-16 text-muted-foreground" />
          )}
        </div>
      </CardContent>
      <CardFooter className="flex justify-between">
        <Link href={`/book/${book.id}`}>
          <Button variant="default">
            <BookOpen className="w-4 h-4 mr-2" />
            阅读
          </Button>
        </Link>
        {onDelete && (
          <Button
            variant="destructive"
            size="icon"
            onClick={() => book.id && onDelete(book.id)}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}
```

**Step 2: 创建书籍列表组件**

Create file `components/book-list.tsx`:
```typescript
'use client';

import { useBooks } from '@/lib/hooks';
import { BookCard } from './book-card';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';

export function BookList() {
  const { books, loading, error, deleteBook } = useBooks();

  if (loading) {
    return <div className="text-center py-8">加载中...</div>;
  }

  if (error) {
    return <div className="text-center py-8 text-destructive">加载失败: {error.message}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">我的书架</h1>
        <Button>
          <Plus className="w-4 h-4 mr-2" />
          导入书籍
        </Button>
      </div>

      {books.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-lg mb-4">还没有书籍</p>
          <p>点击"导入书籍"开始添加</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {books.map((book) => (
            <BookCard key={book.id} book={book} onDelete={deleteBook} />
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 3: 更新首页**

Modify file `app/page.tsx`:
```typescript
import { BookList } from '@/components/book-list';

export default function Home() {
  return (
    <main className="container mx-auto py-8">
      <BookList />
    </main>
  );
}
```

**Step 4: 提交书籍列表界面**

Run:
```bash
git add app/page.tsx components/book-list.tsx components/book-card.tsx
git commit -m "feat: add book list UI"
```

---

### Task 3.2: 添加 shadcn/ui 组件

**Files:**
- Create: `components/ui/card.tsx`
- Create: `components/ui/button.tsx`

**Step 1: 安装并添加 Card 组件**

Run:
```bash
npx shadcn@latest add card
```

Expected: `components/ui/card.tsx` 创建成功

**Step 2: 安装并添加 Button 组件**

Run:
```bash
npx shadcn@latest add button
```

Expected: `components/ui/button.tsx` 创建成功

**Step 3: 提交 UI 组件**

Run:
```bash
git add components/ui/
git commit -m "feat: add shadcn/ui components"
```

---

## Phase 4: 实现文件导入功能

### Task 4.1: 实现文件选择和导入

**Files:**
- Modify: `electron/main/index.ts`
- Create: `electron/main/services/book-service.ts`

**Step 1: 创建书籍服务**

Create file `electron/main/services/book-service.ts`:
```typescript
import { dialog } from 'electron';
import fs from 'fs';
import path from 'path';
import { EPub } from 'epub2';
import pdf from 'pdf-parse';
import { dbBooks, Book } from '../database';

export async function selectBookFile(): Promise<string | null> {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: '电子书', extensions: ['epub', 'txt', 'pdf'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
}

export async function importBook(filePath: string): Promise<Book> {
  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath, ext);

  let bookData: Partial<Book> = {
    title: fileName,
    file_path: filePath,
    file_type: ext.slice(1),
  };

  try {
    if (ext === '.epub') {
      bookData = await parseEpub(filePath);
    } else if (ext === '.txt') {
      bookData = await parseTxt(filePath);
    } else if (ext === '.pdf') {
      bookData = await parsePdf(filePath);
    }

    const bookId = dbBooks.add(bookData as Book);
    return dbBooks.getById(bookId)!;
  } catch (error) {
    throw new Error(`导入失败: ${(error as Error).message}`);
  }
}

async function parseEpub(filePath: string): Promise<Partial<Book>> {
  return new Promise((resolve, reject) => {
    const epub = new EPub(filePath);

    epub.on('error', reject);

    epub.on('end', () => {
      const metadata = epub.metadata;
      const book: Partial<Book> = {
        title: metadata.title || 'Unknown',
        author: metadata.creator,
        file_type: 'epub',
      };

      // TODO: 提取封面图片
      // TODO: 提取章节内容

      resolve(book);
    });

    epub.parse();
  });
}

async function parseTxt(filePath: string): Promise<Partial<Book>> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const fileName = path.basename(filePath, '.txt');

  return {
    title: fileName,
    file_type: 'txt',
    total_pages: Math.ceil(content.length / 2000), // 粗略估算
  };
}

async function parsePdf(filePath: string): Promise<Partial<Book>> {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdf(dataBuffer);

  return {
    title: data.info?.Title || path.basename(filePath, '.pdf'),
    author: data.info?.Author,
    file_type: 'pdf',
    total_pages: data.numpages,
  };
}
```

**Step 2: 更新主进程 IPC 处理器**

Modify file `electron/main/index.ts`,添加导入:
```typescript
import * as bookService from './services/book-service';

// 在 ipcMain.handle 部分添加:

ipcMain.handle('file:select', async () => {
  return bookService.selectBookFile();
});

ipcMain.handle('file:importBook', async (_, filePath: string) => {
  return bookService.importBook(filePath);
});
```

**Step 3: 更新导入按钮功能**

Modify file `components/book-list.tsx`:
```typescript
'use client';

import { useBooks } from '@/lib/hooks';
import { electronFile } from '@/lib/electron';
import { BookCard } from './book-card';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import { useState } from 'react';

export function BookList() {
  const { books, loading, error, deleteBook, reload } = useBooks();
  const [importing, setImporting] = useState(false);

  const handleImport = async () => {
    try {
      setImporting(true);
      const filePath = await electronFile.selectFile();
      if (filePath) {
        await electronFile.importBook(filePath);
        reload();
      }
    } catch (error) {
      console.error('Import failed:', error);
      alert(`导入失败: ${(error as Error).message}`);
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return <div className="text-center py-8">加载中...</div>;
  }

  if (error) {
    return <div className="text-center py-8 text-destructive">加载失败: {error.message}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">我的书架</h1>
        <Button onClick={handleImport} disabled={importing}>
          <Plus className="w-4 h-4 mr-2" />
          {importing ? '导入中...' : '导入书籍'}
        </Button>
      </div>

      {books.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-lg mb-4">还没有书籍</p>
          <p>点击"导入书籍"开始添加</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {books.map((book) => (
            <BookCard key={book.id} book={book} onDelete={deleteBook} />
          ))}
        </div>
      )}
    </div>
  );
}
```

**Step 4: 提交文件导入功能**

Run:
```bash
git add electron/main/services/ electron/main/index.ts components/book-list.tsx
git commit -m "feat: add file import functionality"
```

---

## Phase 5: 创建阅读器界面

### Task 5.1: 创建基础阅读器

**Files:**
- Create: `app/book/[id]/page.tsx`
- Create: `components/reader.tsx`

**Step 1: 创建阅读器页面**

Create file `app/book/[id]/page.tsx`:
```typescript
'use client';

import { useBook } from '@/lib/hooks';
import { Reader } from '@/components/reader';
import { notFound } from 'next/navigation';

interface BookPageProps {
  params: { id: string };
}

export default function BookPage({ params }: BookPageProps) {
  const bookId = parseInt(params.id);
  const { book, loading, error } = useBook(bookId);

  if (loading) {
    return <div className="text-center py-8">加载中...</div>;
  }

  if (error || !book) {
    return notFound();
  }

  return <Reader book={book} />;
}
```

**Step 2: 创建阅读器组件**

Create file `components/reader.tsx`:
```typescript
'use client';

import { useState } from 'react';
import { Book } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import Link from 'next/link';

interface ReaderProps {
  book: Book;
}

export function Reader({ book }: ReaderProps) {
  const [currentPage, setCurrentPage] = useState(book.current_page || 0);

  const nextPage = () => {
    if (book.total_pages && currentPage < book.total_pages - 1) {
      setCurrentPage(currentPage + 1);
    }
  };

  const prevPage = () => {
    if (currentPage > 0) {
      setCurrentPage(currentPage - 1);
    }
  };

  return (
    <div className="h-screen flex flex-col">
      <header className="border-b px-4 py-2 flex items-center justify-between">
        <Link href="/">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <h1 className="text-lg font-semibold">{book.title}</h1>
        <div className="text-sm text-muted-foreground">
          {currentPage + 1} / {book.total_pages || '?'}
        </div>
      </header>

      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-3xl mx-auto">
          <div className="prose prose-lg dark:prose-invert">
            <p>阅读内容加载中...</p>
            <p>当前页面: {currentPage}</p>
          </div>
        </div>
      </div>

      <footer className="border-t px-4 py-2 flex justify-center gap-4">
        <Button onClick={prevPage} disabled={currentPage === 0}>
          <ChevronLeft className="w-4 h-4 mr-2" />
          上一页
        </Button>
        <Button onClick={nextPage} disabled={!book.total_pages || currentPage >= book.total_pages - 1}>
          下一页
          <ChevronRight className="w-4 h-4 ml-2" />
        </Button>
      </footer>
    </div>
  );
}
```

**Step 3: 提交阅读器界面**

Run:
```bash
git add app/book/ components/reader.tsx
git commit -m "feat: add basic reader UI"
```

---

## Phase 6: 实现 AI 功能 (Placeholder)

### Task 6.1: 创建 AI 服务框架

**Files:**
- Create: `electron/main/services/ai-service.ts`

**Step 1: 创建 AI 服务**

Create file `electron/main/services/ai-service.ts`:
```typescript
// AI 服务实现框架
// TODO: 集成 OpenAI/Claude API

export async function chat(messages: any[]): Promise<string> {
  // Placeholder
  return 'AI 响应功能待实现';
}

export async function summarize(text: string): Promise<string> {
  // Placeholder
  return '摘要功能待实现';
}
```

**Step 2: 在主进程中导入 AI 服务**

Modify file `electron/main/index.ts`:
```typescript
import * as aiService from './services/ai-service';

// 更新 IPC handlers
ipcMain.handle('ai:chat', async (_, messages) => {
  return aiService.chat(messages);
});

ipcMain.handle('ai:summarize', async (_, text: string) => {
  return aiService.summarize(text);
});
```

**Step 3: 提交 AI 框架**

Run:
```bash
git add electron/main/services/ai-service.ts electron/main/index.ts
git commit -m "feat: add AI service framework"
```

---

## Phase 7: 构建和打包

### Task 7.1: 测试构建流程

**Files:**
- No files created

**Step 1: 编译 Electron TypeScript**

Run:
```bash
npm run build:electron
```

Expected: 生成 `dist/` 目录,包含编译后的 `.js` 文件

**Step 2: 构建 Next.js 静态文件**

Run:
```bash
npm run build:next
```

Expected: 生成 `out/` 目录,包含静态 HTML/JS/CSS

**Step 3: 验证开发模式**

Run:
```bash
npm run dev
```

Expected:
- Next.js 运行在 http://localhost:3000
- Electron 窗口自动打开并加载应用

**Step 4: 测试应用功能**

在开发模式中测试:
- [ ] 可以打开应用
- [ ] 可以导入书籍
- [ ] 可以显示书籍列表
- [ ] 可以打开阅读器

**Step 5: 提交构建配置**

Run:
```bash
git add .
git commit -m "feat: implement basic Electron + Next.js integration"
```

---

### Task 7.2: 打包桌面应用

**Files:**
- No files created

**Step 1: 执行完整构建**

Run:
```bash
npm run build
```

Expected: 成功构建 Next.js 和 Electron TypeScript

**Step 2: 打包应用**

Run:
```bash
npm run dist
```

Expected: 在 `dist/` 目录生成安装包 (.exe 或 .dmg)

**Step 3: 测试安装包**

Run: 双击安装包并测试应用功能

Expected: 应用正常安装和运行

**Step 4: 最终提交**

Run:
```bash
git add .
git commit -m "feat: complete basic Electron app packaging"
```

---

## 验收标准

### 最小可行产品 (MVP)

- [x] Electron + Next.js 集成成功
- [x] 数据库正常工作
- [x] 可以导入 EPUB/TXT/PDF 文件
- [x] 书籍列表显示正常
- [x] 基础阅读器界面完成
- [ ] 可以打包成桌面应用

### 待完成功能 (后续迭代)

- [ ] EPUB 内容解析和渲染
- [ ] TXT 内容分页和渲染
- [ ] PDF 内容渲染
- [ ] AI API 集成
- [ ] AI 助手界面
- [ ] 阅读进度持久化
- [ ] 书签和高亮功能

---

## Notes

- 当前实现提供基础框架,核心功能为占位符
- better-sqlite3 需要在打包时重新编译原生模块
- 开发时使用 `wait-on` 确保 Next.js 就绪后再启动 Electron
- 生产环境使用 `output: 'export'` 生成静态文件
