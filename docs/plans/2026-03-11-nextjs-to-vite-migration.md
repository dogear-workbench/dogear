# Next.js → Vite + React Router + Bun 迁移计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将前端构建框架从 Next.js 迁移到 Vite + React Router v7，包管理器从 npm 切换到 Bun。

**Architecture:** 这是一个 Electron 桌面应用，Next.js 仅用于客户端渲染（所有页面都是 `'use client'`）、文件系统路由和静态导出。迁移为 Vite SPA + React Router v7，Electron 主进程不变。

**Tech Stack:** Vite 6, React Router v7, Bun, React 19, Tailwind CSS 4, Zustand 5

---

## 迁移范围摘要

| 类别 | 数量 | 说明 |
|------|------|------|
| Next.js 导入 | 6 个文件 | next/navigation, next/link, next/font |
| 页面文件 | 5 个 page.tsx + 1 个 layout.tsx | 结构重组 |
| `'use client'` 指令 | 16 个文件 | 全部删除 |
| 配置文件 | 5 个 | next.config.ts, tsconfig, postcss, eslint, package.json |
| Electron 集成 | 1 个文件 | electron/main/index.ts 加载路径 |

## 路由映射

| 当前路径 | 文件 | React Router 路由 |
|----------|------|-------------------|
| `/` | `app/page.tsx` | `<Route path="/" element={<HomePage />} />` |
| `/settings` | `app/settings/page.tsx` | `<Route path="/settings" element={<SettingsPage />} />` |
| `/book/:id` | `app/book/[id]/page.tsx` | `<Route path="/book/:id" element={<BookPage />} />` |
| `/agent-monitor` | `app/agent-monitor/page.tsx` | `<Route path="/agent-monitor" element={<AgentMonitorPage />} />` |
| `/debug` | `app/debug/page.tsx` | `<Route path="/debug" element={<DebugPage />} />` |

---

### Task 1: 安装 Bun 并切换包管理器

**Files:**
- Delete: `package-lock.json`
- Modify: `package.json` (scripts)

**Step 1: 安装 Bun（如未安装）**

Run: `bun --version`
如果未安装: `powershell -c "irm bun.sh/install.ps1 | iex"`

**Step 2: 用 Bun 安装依赖**

```bash
rm -f package-lock.json
bun install
```

Expected: 生成 `bun.lock`，依赖安装成功

**Step 3: 验证现有项目可用**

Run: `bun run build:electron`
Expected: tsc 编译成功

**Step 4: Commit**

```bash
git add bun.lock package.json
git rm package-lock.json 2>/dev/null || true
git commit -m "chore: switch from npm to bun as package manager"
```

---

### Task 2: 安装 Vite + React Router 依赖

**Files:**
- Modify: `package.json`

**Step 1: 安装 Vite 及相关依赖**

```bash
bun add react-router
bun add -D vite @vitejs/plugin-react
```

**Step 2: 卸载 Next.js 相关依赖**

```bash
bun remove next eslint-config-next
```

**Step 3: 验证依赖安装**

Run: `bun pm ls | grep -E "vite|react-router"`
Expected: 显示 vite 和 react-router

**Step 4: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add Vite + React Router, remove Next.js dependencies"
```

---

### Task 3: 创建 Vite 配置和入口文件

**Files:**
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/main.tsx`
- Move: `app/globals.css` → `src/globals.css`

**Step 1: 创建 `vite.config.ts`**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: './',
  root: '.',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  build: {
    outDir: 'out',
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    strictPort: true,
  },
});
```

**Step 2: 创建 `index.html`（项目根目录）**

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Dogear - AI 阅读助手</title>
    <meta name="description" content="智能书籍阅读与分析工具" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Geist:wght@100..900&family=Geist+Mono:wght@100..900&display=swap" rel="stylesheet" />
  </head>
  <body class="antialiased">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

**Step 3: 创建 `src/main.tsx`**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './globals.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

**Step 4: 移动 globals.css 到 src/**

```bash
mkdir -p src
cp app/globals.css src/globals.css
```

修改 `src/globals.css`：将 font 变量改为直接引用 Google Fonts 家族名称：

```css
/* 替换这两行 */
--font-sans: var(--font-geist-sans);
--font-mono: var(--font-geist-mono);

/* 改为 */
--font-sans: "Geist", ui-sans-serif, system-ui, sans-serif;
--font-mono: "Geist Mono", ui-monospace, monospace;
```

**Step 5: Commit**

```bash
git add vite.config.ts index.html src/main.tsx src/globals.css
git commit -m "feat: add Vite config, entry point, and index.html"
```

---

### Task 4: 创建 React Router 路由配置和 App 组件

**Files:**
- Create: `src/App.tsx`

**Step 1: 创建 `src/App.tsx`**

```tsx
import { HashRouter, Routes, Route, Navigate } from 'react-router';
import HomePage from '@/app/page';
import SettingsPage from '@/app/settings/page';
import BookPage from '@/app/book/BookPage';
import AgentMonitorPage from '@/app/agent-monitor/page';
import DebugPage from '@/app/debug/page';

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/book/:id" element={<BookPage />} />
        <Route path="/agent-monitor" element={<AgentMonitorPage />} />
        <Route path="/debug" element={<DebugPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
```

注意：使用 `HashRouter` 而非 `BrowserRouter`，因为 Electron 生产环境通过 `file://` 协议加载，BrowserRouter 在 `file://` 下不工作。

**Step 2: Commit**

```bash
git add src/App.tsx
git commit -m "feat: add React Router app with HashRouter for Electron compatibility"
```

---

### Task 5: 迁移页面 — 移除 Next.js 导入

**Files:**
- Modify: `app/page.tsx` — 替换 `useRouter` → `useNavigate`
- Modify: `app/settings/page.tsx` — 替换 `useRouter` → `useNavigate`
- Modify: `app/book/[id]/page.tsx` → 移动为 `app/book/BookPage.tsx`，使用 `useParams`
- Modify: `components/book-card.tsx` — 替换 `next/link` → `react-router`
- Modify: `components/reader.tsx` — 替换 `next/link` → `react-router`

**Step 1: 修改 `app/page.tsx`**

```diff
- import { useRouter } from 'next/navigation';
+ import { useNavigate } from 'react-router';

  // 在组件内:
- const router = useRouter();
+ const navigate = useNavigate();

  // 使用处:
- router.push('/settings');
+ navigate('/settings');
```

同时删除第一行的 `'use client';`

**Step 2: 修改 `app/settings/page.tsx`**

```diff
- import { useRouter } from 'next/navigation';
+ import { useNavigate } from 'react-router';

- const router = useRouter();
+ const navigate = useNavigate();

- router.back();
+ navigate(-1);
```

同时删除第一行的 `'use client';`

**Step 3: 迁移 `app/book/[id]/page.tsx` → `app/book/BookPage.tsx`**

创建新文件 `app/book/BookPage.tsx`：

```tsx
import React from 'react';
import { useParams, Navigate } from 'react-router';
import { useBook } from '@/lib/hooks';
import { Reader } from '@/components/reader';

export default function BookPage() {
  const { id } = useParams<{ id: string }>();
  const { book, loading, error } = useBook(id!);

  if (loading) {
    return <div className="text-center py-8">加载中...</div>;
  }

  if (error || !book) {
    return <Navigate to="/" replace />;
  }

  return <Reader book={book} />;
}
```

删除旧文件 `app/book/[id]/page.tsx`。

**Step 4: 修改 `components/book-card.tsx`**

```diff
- import Link from 'next/link';
+ import { Link } from 'react-router';

  // 使用处:
- <Link href={`/book/${book.id}`}>
+ <Link to={`/book/${book.id}`}>
```

同时删除 `'use client';`

**Step 5: 修改 `components/reader.tsx`**

```diff
- import Link from 'next/link';
+ import { Link } from 'react-router';

  // 所有使用处:
- <Link href="/">
+ <Link to="/">
```

同时删除 `'use client';`

**Step 6: 删除其余 14 个文件的 `'use client';` 指令**

在以下文件中删除第一行 `'use client';`：
- `components/AgentChat.tsx`
- `components/BookConversationList.tsx`
- `components/workspace-selector.tsx`
- `components/book-list.tsx`
- `components/book-analysis.tsx`
- `components/agent-test.tsx`
- `components/WorkspaceExplorer.tsx`
- `components/MarkdownRenderer.tsx`
- `components/ArticlePreview.tsx`
- `app/agent-monitor/page.tsx`
- `app/debug/page.tsx`

**Step 7: Commit**

```bash
git add -A
git commit -m "refactor: migrate all pages from Next.js to React Router"
```

---

### Task 6: 更新 TypeScript 配置

**Files:**
- Modify: `tsconfig.json`
- Delete: `next-env.d.ts` (如存在)

**Step 1: 更新 `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": [
    "src/**/*.ts",
    "src/**/*.tsx",
    "app/**/*.ts",
    "app/**/*.tsx",
    "components/**/*.ts",
    "components/**/*.tsx",
    "lib/**/*.ts",
    "lib/**/*.tsx",
    "stores/**/*.ts",
    "types/**/*.ts"
  ],
  "exclude": ["node_modules", "dist", "out", "electron"]
}
```

变更点：
- 移除 Next.js plugin
- 移除 `.next/types` include
- 移除 `next-env.d.ts` include
- 改为显式 include 目录

**Step 2: 删除 Next.js 生成的类型文件**

```bash
rm -f next-env.d.ts
```

**Step 3: Commit**

```bash
git add tsconfig.json
git rm -f next-env.d.ts 2>/dev/null || true
git commit -m "refactor: update tsconfig for Vite, remove Next.js plugin"
```

---

### Task 7: 更新 ESLint 配置

**Files:**
- Modify: `eslint.config.mjs`

**Step 1: 更新 `eslint.config.mjs`**

```javascript
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  ...tseslint.configs.recommended,
  globalIgnores([
    "dist/**",
    "out/**",
    "build/**",
    "node_modules/**",
    "electron/**",
  ]),
]);

export default eslintConfig;
```

**Step 2: 安装 ESLint 依赖**

```bash
bun add -D typescript-eslint
```

**Step 3: 验证 ESLint**

Run: `bun run lint`
Expected: 无报错（可能有 warnings，但不应有 errors）

**Step 4: Commit**

```bash
git add eslint.config.mjs package.json bun.lock
git commit -m "refactor: update ESLint config, remove Next.js ESLint plugins"
```

---

### Task 8: 更新 package.json scripts

**Files:**
- Modify: `package.json`

**Step 1: 更新 scripts**

```json
{
  "scripts": {
    "dev": "bun run build:electron && concurrently \"bun run dev:renderer\" \"bun run dev:electron\"",
    "dev:renderer": "vite",
    "dev:electron": "wait-on http://localhost:3000 && cross-env NODE_ENV=development electron .",
    "dev:watch": "concurrently \"bun run dev:renderer\" \"bun run watch:electron\" \"bun run dev:electron\"",
    "watch:electron": "tsc -p tsconfig.electron.json --watch",
    "build:renderer": "vite build",
    "build:electron": "tsc -p tsconfig.electron.json",
    "build": "bun run build:renderer && bun run build:electron",
    "dist": "bun run build && electron-builder",
    "postinstall": "electron-rebuild",
    "lint": "eslint ."
  }
}
```

变更点：
- `dev:next` → `dev:renderer` (使用 `vite`)
- `build:next` → `build:renderer` (使用 `vite build`)

**Step 2: Commit**

```bash
git add package.json
git commit -m "refactor: update package.json scripts for Vite"
```

---

### Task 9: 更新 Electron 主进程加载路径

**Files:**
- Modify: `electron/main/index.ts`

**Step 1: 更新生产环境加载路径**

Vite 用 HashRouter 生成单个 `index.html`，生产环境只需加载这一个文件：

```diff
  if (isDev) {
-   // 开发环境:加载 Next.js 开发服务器
+   // 开发环境:加载 Vite 开发服务器
    mainWindow.loadURL('http://localhost:3000');
  } else {
    // 生产环境:加载构建后的静态文件
    mainWindow.loadFile(path.join(__dirname, '../../out/index.html'));
  }
```

对于 agent-monitor 窗口也需要更新：

```diff
  const monitorUrl = isDev
    ? 'http://localhost:3000/agent-monitor'
-   : `file://${path.join(__dirname, '../../out/agent-monitor/index.html')}`;
-  agentMonitorWindow.loadURL(monitorUrl);
+   : `file://${path.join(__dirname, '../../out/index.html')}#/agent-monitor`;
+  agentMonitorWindow.loadURL(monitorUrl);
```

同理，debug 窗口：

```diff
- debugWindow.loadURL('http://localhost:3000/debug');
+ const debugUrl = isDev
+   ? 'http://localhost:3000/#/debug'
+   : `file://${path.join(__dirname, '../../out/index.html')}#/debug`;
+ debugWindow.loadURL(debugUrl);
```

注意：开发环境的 URL 也需要加 `/#/` hash 前缀才能让 HashRouter 正确匹配路由。但 Vite dev server 会自动处理根路径的 `index.html`，主窗口加载 `http://localhost:3000` 后，HashRouter 默认匹配 `/`，所以主窗口不需要改。

实际上，开发环境下 agent-monitor 和 debug 窗口也要改用 hash 路由：

```
http://localhost:3000/#/agent-monitor
http://localhost:3000/#/debug
```

**Step 2: Commit**

```bash
git add electron/main/index.ts
git commit -m "refactor: update Electron window URLs for Vite + HashRouter"
```

---

### Task 10: 清理 Next.js 残留文件

**Files:**
- Delete: `next.config.ts`
- Delete: `app/layout.tsx`（功能已移到 `index.html` + `src/main.tsx`）
- Delete: `app/book/[id]/` 目录（已迁移为 `app/book/BookPage.tsx`）
- Delete: `.next/` 目录
- Update: `.gitignore`

**Step 1: 删除文件**

```bash
rm -f next.config.ts
rm -f app/layout.tsx
rm -rf "app/book/[id]"
rm -rf .next
```

**Step 2: 更新 `.gitignore`**

将 `.next` 替换为 Vite 的缓存目录：

```diff
- .next
- out
+ # Vite
+ out
+ node_modules/.vite
```

**Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove Next.js config and build artifacts"
```

---

### Task 11: 验证开发环境

**Step 1: 启动 Vite 开发服务器**

```bash
bun run dev:renderer
```

Expected: Vite 启动在 http://localhost:3000，无编译错误

**Step 2: 启动完整开发环境**

```bash
bun run dev
```

Expected: Electron 窗口打开，主页正常显示

**Step 3: 验证所有路由**

在应用中：
- 首页 `/` — 三栏布局正常
- 点击设置图标 → `/settings` — 设置页正常
- 设置页点返回 → 回到首页
- 点击书籍阅读 → `/book/:id` — 阅读器正常
- Agent 监控窗口正常打开

**Step 4: 验证生产构建**

```bash
bun run build
```

Expected: `out/` 目录生成 `index.html` + 静态资源

**Step 5: Commit（如有修复）**

```bash
git add -A
git commit -m "fix: resolve migration issues found during testing"
```

---

### Task 12: 最终清理和构建验证

**Step 1: 检查是否有遗漏的 Next.js 引用**

```bash
grep -r "next/" --include="*.ts" --include="*.tsx" --include="*.mjs" . | grep -v node_modules | grep -v .next
grep -r "'use client'" --include="*.ts" --include="*.tsx" . | grep -v node_modules
```

Expected: 无结果（所有 Next.js 引用已清除）

**Step 2: 运行 lint**

```bash
bun run lint
```

Expected: 无 errors

**Step 3: 运行完整构建**

```bash
bun run build
```

Expected: 构建成功

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore: complete Next.js to Vite migration, final cleanup"
```

---

## 不需要改动的部分（确认清单）

- [x] `stores/` — 所有 Zustand store（无 Next.js 依赖）
- [x] `lib/client.ts` — tipc 客户端（无 Next.js 依赖）
- [x] `lib/hooks.ts` — 自定义 Hook（无 Next.js 依赖）
- [x] `lib/utils.ts` — cn() 工具（无 Next.js 依赖）
- [x] `components/ui/` — shadcn/ui 组件（无 Next.js 依赖）
- [x] `electron/main/` — 整个主进程（除 index.ts 的 URL 路径）
- [x] `electron/preload/` — 预加载脚本
- [x] `postcss.config.mjs` — Tailwind CSS 4 配置（Vite 直接兼容）
- [x] `types/` — TypeScript 类型定义
- [x] `.dogear/` — 数据存储
