# 网络文章解析功能 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 Dogear 添加网络文章 URL 解析能力，抓取并存储文章到工作区文件系统，提供简单的前端 UI 入口。

**Architecture:** 主进程中新增 article-service 负责 fetch + Readability 解析 + Turndown 转 Markdown，通过文件系统存储到 `工作区/.dogear/articles/{uuid}/`。TIPC 路由暴露给渲染进程调用，前端在主页增加"导入文章"按钮和文章列表/预览。

**Tech Stack:** @mozilla/readability, linkedom, turndown, @egoist/tipc, Next.js + shadcn/ui

---

### Task 1: 安装依赖

**Files:**
- Modify: `package.json`

**Step 1: 安装运行时依赖**

```bash
npm install @mozilla/readability linkedom turndown
```

**Step 2: 安装类型声明**

```bash
npm install -D @types/turndown
```

注意：`@mozilla/readability` 自带类型声明。`linkedom` 自带类型声明。

**Step 3: 验证安装**

```bash
node -e "require('@mozilla/readability'); require('linkedom'); require('turndown'); console.log('OK')"
```

Expected: `OK`

**Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add readability, linkedom, turndown dependencies for article parsing"
```

---

### Task 2: 创建文章类型定义

**Files:**
- Create: `types/article.ts`
- Modify: `types/index.ts`

**Step 1: 创建 types/article.ts**

```typescript
/**
 * 网络文章相关类型定义
 */

/** 文章元数据（存储在 meta.json） */
export interface ArticleMeta {
  id: string;                    // 文章唯一标识(UUID)
  url: string;                   // 原始 URL
  title: string;                 // 文章标题
  author: string | null;         // 作者
  siteName: string | null;       // 站点名称
  excerpt: string | null;        // 摘要（Readability 自动提取）
  wordCount: number;             // 字数
  fetchedAt: number;             // 抓取时间戳
  language: string | null;       // 语言
}

/** 文章完整数据（meta + 正文内容） */
export interface Article extends ArticleMeta {
  content: string;               // Markdown 正文
}
```

**Step 2: 在 types/index.ts 中导出**

在 `types/index.ts` 末尾追加:

```typescript
// 文章相关类型
export * from './article.js';
```

**Step 3: Commit**

```bash
git add types/article.ts types/index.ts
git commit -m "feat: add Article type definitions"
```

---

### Task 3: 创建 article-service.ts 后端服务

**Files:**
- Create: `electron/main/services/article-service.ts`

**Step 1: 创建 article-service.ts**

实现以下函数：

1. `fetchAndParseArticle(url: string)` — 核心解析函数
   - 使用 Node.js 内置 `fetch` 获取 HTML
   - 使用 `linkedom` 的 `parseHTML` 解析为 DOM
   - 使用 `Readability` 提取结构化内容
   - 使用 `TurndownService` 将 HTML 正文转为 Markdown
   - 返回 `{ meta: ArticleMeta, content: string, rawHtml: string }`

2. `saveArticle(workspacePath: string, articleData)` — 存储到文件系统
   - 在 `workspacePath/.dogear/articles/{uuid}/` 下创建目录
   - 写入 `meta.json`、`content.md`、`raw.html`

3. `listArticles(workspacePath: string)` — 列出所有文章
   - 读取 `.dogear/articles/` 下所有子目录的 `meta.json`
   - 返回 `ArticleMeta[]`

4. `getArticle(workspacePath: string, articleId: string)` — 获取单篇文章
   - 读取指定文章的 `meta.json` + `content.md`
   - 返回 `Article`

5. `deleteArticle(workspacePath: string, articleId: string)` — 删除文章
   - 删除整个 `articles/{uuid}/` 目录

关键代码片段（fetchAndParseArticle）:

```typescript
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import path from 'path';
import type { ArticleMeta, Article } from '../../../types/article.js';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
});

export async function fetchAndParseArticle(url: string) {
  // 1. 抓取 HTML
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  const html = await response.text();

  // 2. 解析 DOM
  const { document } = parseHTML(html);

  // 3. Readability 提取
  const reader = new Readability(document);
  const article = reader.parse();
  if (!article) throw new Error('无法解析文章内容，页面可能不是标准文章格式');

  // 4. HTML → Markdown
  const markdown = turndown.turndown(article.content);

  // 5. 组装结果
  const id = uuidv4();
  const meta: ArticleMeta = {
    id,
    url,
    title: article.title || '未知标题',
    author: article.byline || null,
    siteName: article.siteName || null,
    excerpt: article.excerpt || null,
    wordCount: article.textContent?.length || 0,
    fetchedAt: Date.now(),
    language: article.lang || null,
  };

  return { meta, content: markdown, rawHtml: html };
}
```

**Step 2: Commit**

```bash
git add electron/main/services/article-service.ts
git commit -m "feat: add article-service with fetch, parse, save, list, get, delete"
```

---

### Task 4: 创建 TIPC 路由 article.ts

**Files:**
- Create: `electron/main/tipc/article.ts`
- Modify: `electron/main/tipc/index.ts`

**Step 1: 创建 electron/main/tipc/article.ts**

遵循现有 TIPC 路由模式（参照 `file.ts`、`workspace.ts`）:

```typescript
import { tipc } from '@egoist/tipc/main';
import { dbWorkspaces } from '../database/index.js';
import * as articleService from '../services/article-service.js';

const t = tipc.create();

export const articleRouter = {
  parseArticle: t.procedure
    .input<{ url: string; workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = dbWorkspaces.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };
        const result = await articleService.fetchAndParseArticle(input.url);
        await articleService.saveArticle(workspace.path, result);
        return { article: result.meta };
      } catch (error) {
        return { error: String(error) };
      }
    }),

  getArticles: t.procedure
    .input<{ workspaceId: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = dbWorkspaces.getById(input.workspaceId);
        if (!workspace) return { articles: [], error: '工作区不存在' };
        const articles = await articleService.listArticles(workspace.path);
        return { articles };
      } catch (error) {
        return { articles: [], error: String(error) };
      }
    }),

  getArticle: t.procedure
    .input<{ workspaceId: string; articleId: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = dbWorkspaces.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };
        const article = await articleService.getArticle(workspace.path, input.articleId);
        return { article };
      } catch (error) {
        return { error: String(error) };
      }
    }),

  deleteArticle: t.procedure
    .input<{ workspaceId: string; articleId: string }>()
    .action(async ({ input }) => {
      try {
        const workspace = dbWorkspaces.getById(input.workspaceId);
        if (!workspace) return { error: '工作区不存在' };
        await articleService.deleteArticle(workspace.path, input.articleId);
        return { success: true };
      } catch (error) {
        return { error: String(error) };
      }
    }),
};
```

**Step 2: 在 tipc/index.ts 注册路由**

在 `electron/main/tipc/index.ts` 中:
- 添加 import: `import { articleRouter } from './article.js';`
- 在 router 对象中展开: `...articleRouter,`

**Step 3: Commit**

```bash
git add electron/main/tipc/article.ts electron/main/tipc/index.ts
git commit -m "feat: add article TIPC router with parse, list, get, delete endpoints"
```

---

### Task 5: 前端 UI — 文章列表组件

**Files:**
- Create: `components/ArticleList.tsx`

**Step 1: 创建 ArticleList.tsx**

功能：
- 展示文章列表，每篇显示标题、站点名、摘要（截断）、时间
- 支持选中状态高亮
- 支持删除按钮
- 空状态提示

参照现有 `ConversationList` 组件的风格，使用 shadcn/ui 的 Button、ScrollArea 等组件。

Props:
```typescript
interface ArticleListProps {
  articles: ArticleMeta[];
  selectedArticleId: string | null;
  onArticleSelect: (article: ArticleMeta) => void;
  onDeleteArticle: (articleId: string) => void;
  loading: boolean;
}
```

**Step 2: Commit**

```bash
git add components/ArticleList.tsx
git commit -m "feat: add ArticleList component for displaying parsed articles"
```

---

### Task 6: 前端 UI — 文章内容预览组件

**Files:**
- Create: `components/ArticlePreview.tsx`

**Step 1: 创建 ArticlePreview.tsx**

功能：
- 展示文章的完整 Markdown 正文
- 顶部显示元数据（标题、作者、来源站点、原始链接）
- 正文使用 Markdown 渲染（简单的 dangerouslySetInnerHTML 或直接显示纯文本即可）

Props:
```typescript
interface ArticlePreviewProps {
  article: Article | null;
  loading: boolean;
}
```

**Step 2: Commit**

```bash
git add components/ArticlePreview.tsx
git commit -m "feat: add ArticlePreview component for article content display"
```

---

### Task 7: 前端 UI — 集成到主页

**Files:**
- Modify: `app/page.tsx`

**Step 1: 在主页集成文章功能**

修改点：
1. 顶部栏：在"导入书籍"按钮旁增加"导入文章"按钮
2. 点击"导入文章"弹出输入框（使用 `window.prompt` 或简单的 state 控制的输入框）
3. 右侧预览区域：当选中文章时，显示 ArticlePreview 替代书籍预览
4. 新增状态: `articles`, `selectedArticle`, `parsingArticle`(loading)
5. 新增函数: `handleImportArticle`, `loadArticles`, `handleArticleSelect`, `handleDeleteArticle`

左侧可以在对话列表下方增加一个"文章"区域，或用 Tab 切换。推荐在左侧底部用折叠面板展示文章列表。

**Step 2: Commit**

```bash
git add app/page.tsx
git commit -m "feat: integrate article parsing UI into main page"
```

---

### Task 8: 构建验证

**Step 1: 运行构建**

```bash
npm run build
```

Expected: 构建成功，无类型错误。

**Step 2: 手动测试**

启动应用，测试以下流程：
1. 点击"导入文章"按钮
2. 输入一个测试 URL（如 `https://blog.csdn.net/` 上的任意文章）
3. 验证文章解析成功，列表中出现新文章
4. 点击文章，右侧预览显示正文
5. 删除文章

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete article parsing feature with Readability + linkedom"
```
