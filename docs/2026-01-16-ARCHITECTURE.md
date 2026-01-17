# Electron 架构说明

## 简化后的三层架构

```
┌─────────────────────────────────────────────────────┐
│  前端组件 (React)                                    │
│  - components/book-list.tsx                         │
│  - components/reader.tsx                            │
│  - lib/hooks.ts                                     │
│                                                     │
│  调用方式: window.electronAPI.xxx.yyy()             │
└─────────────────────────────────────────────────────┘
                         ↓ IPC 通信
┌─────────────────────────────────────────────────────┐
│  Preload 层 (安全桥接)                              │
│  - electron/preload/index.ts                       │
│  - electron/preload/api/*.ts                        │
│                                                     │
│  作用: 使用 contextBridge 安全暴露 API              │
│       通过 ipcRenderer 调用主进程                   │
└─────────────────────────────────────────────────────┘
                         ↓ IPC 通信
┌─────────────────────────────────────────────────────┐
│  主进程层                                             │
│  ┌───────────────────────────────────────────────┐  │
│  │ IPC 注册层                                     │  │
│  │ - electron/main/ipc/*.ts                      │  │
│  │ 注册: ipcMain.handle('xxx:yyy', handler)      │  │
│  └───────────────────────────────────────────────┘  │
│                    ↓                                 │
│  ┌───────────────────────────────────────────────┐  │
│  │ 服务层 (Service)                               │  │
│  │ - electron/main/services/*.ts                 │  │
│  │ 实现: 真正的函数实现逻辑                       │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

## 各层职责

### 1. 前端层 (渲染进程)

**位置**: `components/`, `lib/`

**职责**:
- React 组件和 UI 逻辑
- 直接调用 `window.electronAPI` 与主进程通信

**示例**:
```typescript
// 直接调用
const books = await window.electronAPI.db.getBooks();
const filePath = await window.electronAPI.file.selectFile();
```

### 2. Preload 层 (预加载脚本)

**位置**: `electron/preload/`

**职责**:
- 作为渲染进程和主进程之间的**安全桥梁**
- 使用 `contextBridge` 安全暴露 API
- 防止渲染进程直接访问危险的 Node.js API

**核心文件**:
- [electron/preload/index.ts](../electron/preload/index.ts) - 入口,暴露 API 到 window
- [electron/preload/api/index.ts](../electron/preload/api/index.ts) - 汇总所有 API
- [electron/preload/api/books.ts](../electron/preload/api/books.ts) - 书籍相关 API
- 其他 API 文件 (ai, files, agents 等)

**示例**:
```typescript
// electron/preload/api/books.ts
const { ipcRenderer } = require('electron');

export const dbAPI = {
  getBooks: () => ipcRenderer.invoke('db:getBooks'),
  getBookById: (id: string) => ipcRenderer.invoke('db:getBookById', id),
  // ...
};

// electron/preload/index.ts
contextBridge.exposeInMainWorld('electronAPI', electronAPI);
```

### 3. 主进程层

#### 3.1 IPC 注册层

**位置**: `electron/main/ipc/`

**职责**:
- 注册 IPC 处理器,接收来自 preload 的请求
- 调用 service 层执行实际业务逻辑
- 返回结果给渲染进程

**核心文件**:
- [electron/main/ipc/books.ts](../electron/main/ipc/books.ts) - 书籍相关 IPC
- [electron/main/ipc/ai.ts](../electron/main/ipc/ai.ts) - AI 相关 IPC
- [electron/main/ipc/files.ts](../electron/main/ipc/files.ts) - 文件操作 IPC
- [electron/main/ipc/agents.ts](../electron/main/ipc/agents.ts) - Agent 相关 IPC

**示例**:
```typescript
// electron/main/ipc/books.ts
import { ipcMain } from 'electron';
import { dbBooks } from '../database/index.js';

export function registerBookHandlers() {
  ipcMain.handle('db:getBooks', () => {
    return dbBooks.getAll();
  });

  ipcMain.handle('db:getBookById', (_, id: string) => {
    return dbBooks.getById(id);
  });
}
```

#### 3.2 服务层 (Service)

**位置**: `electron/main/services/`

**职责**:
- 实现真正的业务逻辑
- 文件处理、数据转换等复杂操作
- 调用数据库层

**核心文件**:
- [electron/main/services/book-service.ts](../electron/main/services/book-service.ts) - 书籍处理服务
- [electron/main/services/ai-service.ts](../electron/main/services/ai-service.ts) - AI 服务
- [electron/main/services/chapter-recognizer.ts](../electron/main/services/chapter-recognizer.ts) - 章节识别

**示例**:
```typescript
// electron/main/services/book-service.ts
export async function importBook(filePath: string): Promise<Book> {
  // 1. 读取文件
  const content = fs.readFileSync(filePath, 'utf-8');

  // 2. 识别章节
  const chapterRecognizer = new ChapterRecognizer();
  const chapterDataList = chapterRecognizer.recognize(content);

  // 3. 保存到数据库
  // ...

  return book;
}
```

## 类型定义

**位置**: [types/electron-api.ts](../types/electron-api.ts)

**职责**:
- 为 `window.electronAPI` 提供完整的 TypeScript 类型定义
- 前端可以获得类型提示和检查

**示例**:
```typescript
// types/electron-api.ts
export interface DBAPI {
  getBooks: () => Promise<Book[]>;
  getBookById: (id: string) => Promise<Book>;
  // ...
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
```

## 数据流向

```
用户点击按钮
    ↓
前端组件调用 window.electronAPI.file.selectFile()
    ↓
Preload 层接收,调用 ipcRenderer.invoke('file:selectFile')
    ↓
主进程 IPC 层处理,调用 dialog.showOpenDialog
    ↓
返回文件路径到前端
```

## 为什么这样设计?

1. **安全性**: Preload 层防止前端直接访问 Node.js API
2. **类型安全**: 统一的类型定义确保前后端类型一致
3. **职责清晰**: 每一层有明确的职责
4. **易于维护**: 修改业务逻辑只需改动 service 层

## 对比: 简化前 vs 简化后

### 简化前 (5层架构)
```
前端组件 → lib/electron.ts → Preload → IPC → Service
```
- 有冗余的封装层 `lib/electron.ts`
- 类型定义分散在多处

### 简化后 (3层架构)
```
前端组件 → Preload → IPC + Service
```
- 删除了 `lib/electron.ts` 封装层
- 类型定义统一在 `types/electron-api.ts`
- 更简洁直观

## 总结

现在的架构是**标准的三层架构**:
1. **前端层**: UI 和业务逻辑
2. **Preload 层**: 安全通信桥接
3. **主进程层**: IPC 注册 + 业务实现

每个文件都有明确的职责,没有冗余,易于理解和维护。