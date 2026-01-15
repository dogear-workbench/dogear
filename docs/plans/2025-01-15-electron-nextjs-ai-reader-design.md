# Dogear - AI 辅助读书应用架构设计

## 项目概述

一个基于 Electron + Next.js + shadcn/ui 的桌面电子书阅读应用,集成了 AI 辅助功能。

## 技术栈

- **Electron** - 桌面应用框架
- **Next.js 16** - 渲染进程 UI 框架 (App Router)
- **shadcn/ui** - UI 组件库
- **better-sqlite3** - 本地嵌入式数据库
- **Electron Builder** - 应用打包工具
- **AI API** - OpenAI/Claude 云端 API

## 架构设计

### 整体架构

```
┌─────────────────────────────────────┐
│  Electron 主进程                     │
│  ├── 数据库管理 (better-sqlite3)     │
│  ├── 文件操作 (电子书导入/解析)       │
│  ├── AI API 调用                     │
│  └── IPC 通信桥接                    │
└─────────────────────────────────────┘
              ↕ IPC
┌─────────────────────────────────────┐
│  Preload Script                     │
│  ├── contextBridge 安全桥接          │
│  └── 暴露受限 API 给渲染进程         │
└─────────────────────────────────────┘
              ↕ window.electronAPI
┌─────────────────────────────────────┐
│  渲染进程 (Next.js)                  │
│  ├── 书籍管理界面                    │
│  ├── 阅读器界面                      │
│  ├── AI 助手界面                     │
│  └── shadcn/ui 组件                 │
└─────────────────────────────────────┘
```

### 开发 vs 生产环境

**开发环境:**
- Next.js 运行在 `http://localhost:3000`
- Electron 加载开发服务器 URL
- 支持热重载和快速迭代

**生产环境:**
- Next.js 构建为静态文件 (`next build + output: 'export'`)
- Electron 加载本地 `file://` 协议
- 无需任何端口或服务器,完全离线运行

## 项目结构

```
dogear/
├── electron/                  # Electron 主进程代码
│   ├── main/
│   │   └── index.ts          # 主进程入口
│   ├── preload/
│   │   └── index.ts          # 预加载脚本
│   └── database/
│       ├── schema.sql        # 数据库表结构
│       └── index.ts          # 数据库操作封装
├── app/                       # Next.js App Router
│   ├── page.tsx              # 首页(书籍列表)
│   ├── book/
│   │   └── [id]/             # 书籍详情和阅读器
│   │       └── page.tsx
│   └── api/                  # Next.js API Routes (可选)
├── components/
│   ├── ui/                   # shadcn/ui 组件
│   ├── book-list.tsx         # 书籍列表组件
│   ├── reader.tsx            # 阅读器组件
│   └── ai-assistant.tsx      # AI 助手组件
├── lib/
│   ├── utils.ts              # 工具函数
│   ├── electron.ts           # Electron API 封装
│   └── hooks.ts              # 自定义 React Hooks
├── public/                   # 静态资源
├── package.json
├── next.config.js            # Next.js 配置
├── tsconfig.json
└── electron-builder.yml      # 打包配置
```

## 核心功能模块

### 1. 书籍管理模块

**功能:**
- 导入电子书 (EPUB/TXT/PDF)
- 显示书籍列表
- 书籍元数据管理 (标题、作者、封面、进度)
- 删除书籍

**技术实现:**
- 文件选择对话框
- 电子书解析库 (epub2, pdf-parse)
- 封面图片提取和显示

### 2. 阅读器模块

**功能:**
- 文本渲染和翻页
- 目录导航
- 阅读进度保存
- 样式自定义 (字体、字号、主题)

**技术实现:**
- 虚拟滚动优化大文件
- 章节分割
- 本地存储阅读进度

### 3. AI 助手模块

**功能:**
- 对话式 AI 交互
- 文本选择 → 快速提问
- 内容摘要生成
- 对话历史管理

**技术实现:**
- OpenAI/Claude API 集成
- 流式响应显示
- Token 计数和成本控制

## 数据库设计

### 表结构

```sql
-- 书籍表
CREATE TABLE books (
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

-- AI 交互记录表
CREATE TABLE ai_interactions (
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

-- 索引
CREATE INDEX idx_books_created ON books(created_at);
CREATE INDEX idx_ai_book_id ON ai_interactions(book_id);
CREATE INDEX idx_ai_created ON ai_interactions(created_at);
```

### 数据存储位置

```
用户数据目录 (app.getPath('userData'))/
├── dogear.db                  # 数据库文件
└── books/
    ├── originals/             # 原始电子书文件
    │   └── {book_id}.{ext}
    └── extracted/             # 解析后的内容
        └── {book_id}/
            ├── content.txt
            ├── cover.png
            └── metadata.json
```

## IPC 通信设计

### Preload 暴露的 API

```typescript
window.electronAPI = {
  // 数据库操作
  db: {
    getBooks: () => Promise<Book[]>
    addBook: (book) => Promise<number>
    updateBook: (id, data) => Promise<void>
    deleteBook: (id) => Promise<void>
  },

  // AI 操作
  ai: {
    chat: (messages) => Promise<string>
    summarize: (text) => Promise<string>
  },

  // 文件操作
  file: {
    importBook: (path) => Promise<Book>
    getContent: (bookId) => Promise<string>
  }
}
```

### 主进程 IPC 处理器

```
db:getBooks         → database.getBooks()
db:addBook          → database.addBook()
db:updateBook       → database.updateBook()
db:deleteBook       → database.deleteBook()

ai:chat             → aiService.chat()
ai:summarize        → aiService.summarize()

file:importBook     → bookService.import()
file:getContent     → bookService.getContent()
```

## 构建和打包

### 开发脚本

```json
{
  "scripts": {
    "dev": "concurrently \"npm run dev:next\" \"npm run dev:electron\"",
    "dev:next": "next dev",
    "dev:electron": "wait-on http://localhost:3000 && electron .",
    "build": "next build",
    "dist": "npm run build && electron-builder"
  }
}
```

### Next.js 配置

```javascript
// next.config.js
export default {
  output: 'export',
  images: { unoptimized: true }
}
```

### Electron Builder 配置

```yaml
# electron-builder.yml
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

## 依赖包

### 主要依赖

```json
{
  "electron": "^39.2.7",
  "electron-builder": "^25.1.8",
  "better-sqlite3": "^11.7.0",
  "next": "16.1.2",
  "react": "19.2.3",
  "react-dom": "19.2.3",
  "epub2": "^3.0.5",
  "pdf-parse": "^1.1.1"
}
```

### 开发依赖

```json
{
  "concurrently": "^9.1.2",
  "wait-on": "^8.0.1",
  "@types/better-sqlite3": "^7.6.12"
}
```

## 关键技术决策

### 为什么选择 Next.js + Electron 独立端口模式?

**优势:**
- 开发体验好,支持热重载
- Next.js 生态丰富,开发效率高
- 生产时打包为静态文件,无需服务器
- shadcn/ui 组件开箱即用

**劣势:**
- 比纯 Electron 稍重
- 首次加载略慢

### 为什么选择 better-sqlite3?

**优势:**
- 同步 API,简单易用
- 嵌入式,无需单独数据库服务
- 跨平台,打包后无需配置
- 性能优秀,适合本地应用

### 为什么使用云端 AI 而非本地模型?

**优势:**
- 模型能力强 (GPT-4/Claude)
- 无需本地 GPU
- 减少应用体积

**劣势:**
- 需要网络连接
- API 调用成本

## 实现优先级

### Phase 1: 基础架构
- Electron + Next.js 集成
- 数据库初始化
- IPC 通信搭建

### Phase 2: 书籍管理
- 电子书导入 (EPUB/TXT)
- 书籍列表界面
- 书籍详情显示

### Phase 3: 阅读器
- 文本渲染
- 翻页功能
- 进度保存

### Phase 4: AI 集成
- API 集成
- 对话界面
- 文本交互

### Phase 5: 打包发布
- Electron Builder 配置
- 安装包生成
- 测试和优化
