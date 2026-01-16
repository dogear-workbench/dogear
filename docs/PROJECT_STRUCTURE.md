# 项目目录结构说明

## 📁 重构后的目录结构

```
c:/dogear/
├── shared/                          # 共享类型定义 (新增)
│   └── types/                       # 类型定义目录
│       ├── index.ts                 # 统一导出
│       ├── books.ts                 # 书籍相关类型 (Book, Chapter, ChapterMetadata)
│       ├── ai.ts                    # AI 相关类型 (AIInteraction, AIMessage)
│       ├── agents.ts                # Agent 相关类型 (AgentTask, TaskStatus, TaskType)
│       └── electron-api.ts          # Electron API 类型 (前端使用的 window.electronAPI)
│
├── electron/
│   ├── main/
│   │   ├── index.ts                 # 主进程入口 (简化版 - 只负责窗口管理)
│   │   ├── ipc/                     # IPC 处理器 (新增拆分)
│   │   │   ├── index.ts             # IPC 注册入口
│   │   │   ├── books.ts             # 书籍相关 IPC (db:*, book:*)
│   │   │   ├── ai.ts                # AI 相关 IPC (ai:*)
│   │   │   ├── files.ts             # 文件相关 IPC (file:*)
│   │   │   └── agents.ts            # Agent 相关 IPC (agent:*)
│   │   ├── services/                # 服务层 (保持不变)
│   │   ├── agents/                  # Agent 系统 (保持不变)
│   │   └── database/                # 数据库 (保持不变)
│   │
│   └── preload/                     # 预加载脚本 (重构为分文件)
│       ├── index.ts                 # 预加载入口 (简化版)
│       ├── types.ts                 # Preload 内部类型定义
│       ├── api/                     # API 实现 (新增拆分)
│       │   ├── index.ts             # API 统一导出
│       │   ├── books.ts             # 书籍 API (db, book)
│       │   ├── ai.ts                # AI API
│       │   ├── files.ts             # 文件 API
│       │   └── agents.ts            # Agent API
│       └── (旧的 index.ts 已重构)
│
└── lib/                             # 前端工具库
    ├── types.ts                     # 类型定义 (简化为重新导出 shared/types)
    ├── electron.ts                  # Electron API 工具函数 (保持不变)
    ├── hooks.ts                     # React Hooks (保持不变)
    └── utils.ts                     # 工具函数 (保持不变)
```

## 🏗️ 编译流程

### **源代码 → 编译 → 输出**

```
源代码                          编译配置                     输出目录
electron/**/*.ts     →     tsconfig.electron.json    →    dist/**/*.js
                           rootDir: ./electron
                           outDir: ./dist
```

**关键特性**:
- ✅ TypeScript 自动保持目录结构
- ✅ 分文件开发完全支持
- ✅ 编译后的 `dist/` 目录结构与源代码 `electron/` 一致

### **编译验证**

```bash
# 编译 Electron 代码
npm run build:electron

# 查看编译后的结构
find dist -name "*.js"
```

**编译结果示例**:
```
dist/main/ipc/books.js      ← electron/main/ipc/books.ts
dist/main/ipc/ai.js         ← electron/main/ipc/ai.ts
dist/preload/api/books.js   ← electron/preload/api/books.ts
```

## 📦 类型共享架构

### **三层类型系统**

```
┌─────────────────────────────────────────────────────────┐
│  1. shared/types/          (共享类型定义)                │
│     - books.ts                                          │
│     - ai.ts                                             │
│     - agents.ts                                         │
│     - electron-api.ts (前端 Window 接口)                 │
└─────────────────────────────────────────────────────────┘
                          ↓ 导入
┌─────────────────────────────────────────────────────────┐
│  2. electron/main/       (主进程 - 使用共享类型)          │
│     - ipc/books.ts                                      │
│     - ipc/ai.ts                                         │
│     - services/book-service.ts                          │
│     - agents/task-types.ts (独立定义,保持兼容)           │
└─────────────────────────────────────────────────────────┘
                          ↓ IPC 通讯
┌─────────────────────────────────────────────────────────┐
│  3. electron/preload/    (预加载脚本 - 内部类型)          │
│     - types.ts (内部接口定义,使用 any)                   │
│     - api/books.ts                                     │
│     - api/ai.ts                                         │
└─────────────────────────────────────────────────────────┘
                          ↓ contextBridge
┌─────────────────────────────────────────────────────────┐
│  4. 前端 (Next.js)        (渲染进程 - 使用共享类型)        │
│     - lib/types.ts (重新导出 shared/types)              │
│     - window.electronAPI (使用 electron-api.ts 的类型)    │
└─────────────────────────────────────────────────────────┘
```

## 🔍 为什么这样设计?

### **1. shared/types/** - 共享类型定义
**目的**: 让主进程、预加载进程、渲染进程共享类型定义

**优点**:
- ✅ 类型一致性保证
- ✅ 减少重复代码
- ✅ 前端获得完整的类型提示

**示例**:
```typescript
// shared/types/books.ts
export interface Book {
  id?: string;
  title: string;
  // ...
}

// shared/types/electron-api.ts
declare global {
  interface Window {
    electronAPI: {
      db: {
        getBooks: () => Promise<Book[]>;  // 使用具体类型
      };
    };
  }
}
```

### **2. electron/preload/types.ts** - Preload 内部类型
**目的**: 预加载脚本内部使用,不暴露给前端

**为什么用 `any`**:
- Preload 只是一个**桥接层**
- 不需要关心具体数据结构
- 通过 IPC 透传数据即可

**示例**:
```typescript
// electron/preload/types.ts
interface ElectronAPI {
  db: {
    getBooks: () => Promise<any[]>;  // 使用 any,因为是中间层
  };
}

// electron/preload/api/books.ts
export const dbAPI = {
  getBooks: () => ipcRenderer.invoke('db:getBooks'),  // 透传调用
};
```

### **3. electron/main/ipc/** - IPC 处理器拆分
**目的**: 将 IPC 处理器按功能模块拆分

**优点**:
- ✅ 代码组织清晰
- ✅ 易于维护和扩展
- ✅ 每个 IPC 处理器职责单一

**示例**:
```typescript
// electron/main/ipc/books.ts
export function registerBookHandlers() {
  ipcMain.handle('db:getBooks', () => {
    return dbBooks.getAll();
  });
  // ...
}

// electron/main/ipc/index.ts
export function registerAllHandlers() {
  registerBookHandlers();
  registerAIHandlers();
  // ...
}
```

## 🔧 开发指南

### **添加新的 IPC 接口**

1. **定义类型** ([shared/types/books.ts](shared/types/books.ts)):
   ```typescript
   export interface NewType {
     // ...
   }
   ```

2. **添加到 Window 接口** ([shared/types/electron-api.ts](shared/types/electron-api.ts)):
   ```typescript
   declare global {
     interface Window {
       electronAPI: {
         newFeature: {
           doSomething: () => Promise<NewType>;
         };
       };
     }
   }
   ```

3. **实现 Preload API** ([electron/preload/api/new-feature.ts](electron/preload/api/new-feature.ts)):
   ```typescript
   export const newFeatureAPI = {
     doSomething: () => ipcRenderer.invoke('newFeature:doSomething'),
   };
   ```

4. **注册 IPC 处理器** ([electron/main/ipc/new-feature.ts](electron/main/ipc/new-feature.ts)):
   ```typescript
   export function registerNewFeatureHandlers() {
     ipcMain.handle('newFeature:doSomething', async () => {
       // 实现
     });
   }
   ```

5. **在主进程注册** ([electron/main/ipc/index.ts](electron/main/ipc/index.ts)):
   ```typescript
   import { registerNewFeatureHandlers } from './new-feature.js';

   export function registerAllHandlers() {
     // ...
     registerNewFeatureHandlers();
   }
   ```

## ✅ 验证步骤

### **1. 编译验证**
```bash
npm run build:electron
```

### **2. 检查编译输出**
```bash
# 查看编译后的目录结构
find dist -name "*.js" | grep -E "(ipc|preload/api)"
```

**预期输出**:
```
dist/main/ipc/books.js
dist/main/ipc/ai.js
dist/main/ipc/files.js
dist/main/ipc/agents.js
dist/preload/api/books.js
dist/preload/api/ai.js
dist/preload/api/files.js
dist/preload/api/agents.js
```

### **3. 运行验证**
```bash
npm run dev
```

## 📝 总结

| 方面 | 重构前 | 重构后 |
|------|--------|--------|
| **类型定义** | 混在 lib/types.ts | 拆分到 shared/types/ 功能模块 |
| **IPC 处理器** | 全在 main/index.ts (218行) | 拆分到 main/ipc/ 功能文件 |
| **Preload 脚本** | 单个 index.ts (106行) | 拆分到 preload/api/ 功能文件 |
| **代码组织** | 按技术分层 | 按功能模块分层 |
| **可维护性** | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |

这是一个**标准的 Electron 应用架构**,易于维护和扩展！
