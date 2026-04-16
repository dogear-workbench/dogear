# Dogear 工作区与 Agent 文件读取设计方案 v2

## 一、设计原则

### 1.1 核心理念

1. **以书籍为中心**：分析数据与书籍文件存储在同一目录
2. **文件系统为主**：分析结果以 JSON 文件形式存储，数据库只存索引和状态
3. **AI 自由判断**：不预设固定的分析结构，让 AI 根据内容类型自动决定输出什么
4. **渐进增强**：先做基础功能，后续根据需要扩展

### 1.2 与 v1 方案的主要变化

| 方面 | v1 方案 | v2 方案（本方案） |
|------|---------|------------------|
| 数据存储 | 数据库表为主（专用表） | 文件系统为主（JSON） |
| 分析结构 | 预设固定结构（人物、章节等） | AI 根据内容自动判断 |
| 目录组织 | 全局工作区 | 每本书独立目录 |
| 扩展性 | 需要修改 Schema | 无需修改，AI 自适应 |

---

## 二、目录结构设计

### 2.1 完整目录树

```
{userData}/                              # 用户数据目录
│
├── dogear.db                             # SQLite（只存索引、状态）
│
└── books/                                # 默认工作区
    │
    ├── {book-id-1}/                     # 单本书的完整目录
    │   │
    │   ├── original.txt                 # 原始文件（保留）
    │   ├── original.meta                # 原始文件元信息
    │   │
    │   └── .dogear/                     # Dogear 分析数据（隐藏目录）
    │       ├── meta.json                # 书籍元数据
    │       ├── status.json              # 分析状态
    │       ├── analysis.json            # AI 产生的分析结果（核心）
    │       ├── chapters/                # 章节级分析（可选）
    │       │   ├── chapter-001.json
    │       │   ├── chapter-002.json
    │       │   └── ...
    │       └── session/                 # Agent 会话数据
    │           └── analysis-session.json
    │
    ├── {book-id-2}/
    │   └── ...
    │
    └── .index/                          # 全局索引（可选，用于搜索）
        └── books-index.json
```

### 2.2 文件说明

#### meta.json - 书籍元数据

```json
{
  "id": "book-uuid-001",
  "title": "示例书籍",
  "importedAt": 1737528000000,
  "importedFrom": "/path/to/original/file.txt",
  "fileType": "txt",
  "fileSize": 1234567
}
```

#### status.json - 分析状态

```json
{
  "analysisStatus": "analyzed",     // none | analyzing | analyzed | failed
  "analyzedAt": 1737528100000,
  "analyzedBy": "claude-sonnet-4-5",
  "lastError": null
}
```

#### analysis.json - AI 分析结果（核心）

**关键设计**：不预设结构，让 AI 根据内容类型自由组织

```json
{
  "analyzedAt": 1737528100000,
  "model": "claude-sonnet-4-5",

  // AI 自行判断的类型
  "contentType": "fiction",        // fiction | non-fiction | article | reference | other

  // 以下是 AI 根据类型自行添加的字段
  // 没有固定 Schema，完全由 AI 决定

  // === 小说类示例 ===
  "title": "书籍标题",
  "author": "作者",
  "summary": "全书摘要...",
  "themes": ["成长", "友情", "冒险"],
  "characters": [
    {
      "name": "主角",
      "role": "protagonist",
      "description": "..."
    }
  ],
  "keyEvents": [...],

  // === 技术书籍示例 ===
  // "contentType": "technical",
  // "topics": ["React", "TypeScript", "状态管理"],
  // "prerequisites": ["JavaScript", "HTML/CSS"],
  // "keyConcepts": [...],
  // "codeExamples": [...],

  // === 文章示例 ===
  // "contentType": "article",
  // "mainArgument": "...",
  // "keyPoints": [...],
  // "conclusion": "...",

  // 通用字段
  "chapterCount": 10,
  "wordCount": 50000,
  "language": "zh-CN"
}
```

#### chapters/chapter-XXX.json - 章节分析

```json
{
  "chapterId": "chapter-001",
  "chapterNumber": 1,
  "title": "第一章标题",
  "summary": "章节摘要...",

  // AI 根据内容添加的任意字段
  "keyPoints": ["关键点1", "关键点2"],
  "characters": ["人物A", "人物B"],      // 小说类
  "concepts": ["概念X", "概念Y"],        // 技术类
  "examples": ["示例1"],                 // 教程类

  "analyzedAt": 1737528100000
}
```

---

## 三、数据库设计（极简化）

由于分析数据存储在文件系统中，数据库只保留必要的索引和状态。

### 3.1 books 表（修改）

```sql
CREATE TABLE books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  workspace_id TEXT NOT NULL DEFAULT 'default',

  -- 文件路径
  file_path TEXT NOT NULL,             -- 相对于工作区的路径

  -- 阅读相关
  current_chapter_id TEXT,
  processing_status TEXT DEFAULT 'idle',

  -- 分析相关（只存状态，详细数据在文件系统）
  analysis_status TEXT DEFAULT 'none', -- none | analyzing | analyzed | failed
  analyzed_at INTEGER,

  -- 元信息
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_books_analysis ON books(analysis_status);
CREATE INDEX idx_books_workspace ON books(workspace_id);
```

### 3.2 workspaces 表（简化）

```sql
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  is_default INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
```

**不再需要**：
- ~~book_analysis 表~~ → 用 `.dogear/analysis.json` 替代
- ~~chapter_summaries 表~~ → 用 `.dogear/chapters/*.json` 替代
- ~~characters 表~~ → 嵌入 analysis.json 或 chapters/*.json

---

## 四、Agent 工具设计

### 4.1 工具列表（简化版）

由于数据存储在文件系统，工具也相应简化：

```typescript
// electron/main/agents/tools/book-analysis-tools.ts

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * 创建书籍分析专用 MCP Server
 * 数据存储在 .dogear 目录，而不是数据库
 */
export function createBookAnalysisTools(workspacePath: string) {
  return createSdkMcpServer({
    name: 'dogear-book-analysis',
    version: '1.0.0',
    tools: [
      // 工具 1: 保存全书分析结果（核心）
      tool(
        'SaveAnalysis',
        '保存书籍的分析结果到 .dogear/analysis.json',
        {
          bookId: z.string().describe('书籍ID'),
          analysis: z.any().describe('分析结果（任意结构）'),
        },
        async (args, extra) => {
          try {
            const analysisPath = path.join(
              workspacePath,
              args.bookId,
              '.dogear',
              'analysis.json'
            );

            // 确保 .dogear 目录存在
            await fs.mkdir(path.dirname(analysisPath), { recursive: true });

            // 保存分析结果
            const data = {
              analyzedAt: Date.now(),
              model: 'claude-sonnet-4-5',
              ...args.analysis,
            };

            await fs.writeFile(analysisPath, JSON.stringify(data, null, 2));

            return {
              content: [{
                type: 'text',
                text: `已保存分析结果到: ${analysisPath}`,
              }],
            };
          } catch (error) {
            return {
              content: [{
                type: 'text',
                text: `保存失败: ${error}`,
              }],
              isError: true,
            };
          }
        }
      ),

      // 工具 2: 保存章节分析
      tool(
        'SaveChapterAnalysis',
        '保存单个章节的分析结果到 .dogear/chapters/chapter-XXX.json',
        {
          bookId: z.string().describe('书籍ID'),
          chapterId: z.string().describe('章节ID'),
          chapterNumber: z.number().describe('章节序号'),
          title: z.string().describe('章节标题'),
          analysis: z.any().describe('章节分析结果（任意结构）'),
        },
        async (args, extra) => {
          try {
            const chaptersDir = path.join(
              workspacePath,
              args.bookId,
              '.dogear',
              'chapters'
            );

            // 确保 chapters 目录存在
            await fs.mkdir(chaptersDir, { recursive: true });

            // 文件名：chapter-001.json
            const filename = `chapter-${String(args.chapterNumber).padStart(3, '0')}.json`;
            const chapterPath = path.join(chaptersDir, filename);

            const data = {
              chapterId: args.chapterId,
              chapterNumber: args.chapterNumber,
              title: args.title,
              analyzedAt: Date.now(),
              ...args.analysis,
            };

            await fs.writeFile(chapterPath, JSON.stringify(data, null, 2));

            return {
              content: [{
                type: 'text',
                text: `已保存章节分析: ${args.title}`,
              }],
            };
          } catch (error) {
            return {
              content: [{
                type: 'text',
                text: `保存失败: ${error}`,
              }],
              isError: true,
            };
          }
        }
      ),

      // 工具 3: 标记分析完成
      tool(
        'CompleteAnalysis',
        '标记分析完成，更新状态',
        {
          bookId: z.string().describe('书籍ID'),
          notes: z.string().optional().describe('分析备注'),
        },
        async (args, extra) => {
          try {
            // 更新数据库状态（通过 IPC 调用主进程）
            // 这里简化处理
            return {
              content: [{
                type: 'text',
                text: `分析完成！书籍ID: ${args.bookId}\n` +
                      `分析结果已保存到 .dogear/ 目录`,
              }],
            };
          } catch (error) {
            return {
              content: [{
                type: 'text',
                text: `完成标记失败: ${error}`,
              }],
              isError: true,
            };
          }
        }
      ),

      // 工具 4: 读取已保存的分析结果
      tool(
        'LoadAnalysis',
        '读取书籍的已有分析结果',
        {
          bookId: z.string().describe('书籍ID'),
        },
        async (args, extra) => {
          try {
            const analysisPath = path.join(
              workspacePath,
              args.bookId,
              '.dogear',
              'analysis.json'
            );

            const content = await fs.readFile(analysisPath, 'utf-8');
            const analysis = JSON.parse(content);

            return {
              content: [{
                type: 'text',
                text: `已有分析结果：\n${JSON.stringify(analysis, null, 2)}`,
              }],
            };
          } catch (error) {
            return {
              content: [{
                type: 'text',
                text: `读取失败或暂无分析: ${error}`,
              }],
            };
          }
        }
      ),

      // 工具 5: 读取章节摘要列表（用于问答）
      tool(
        'LoadChapterSummaries',
        '读取所有章节的分析摘要',
        {
          bookId: z.string().describe('书籍ID'),
        },
        async (args, extra) => {
          try {
            const chaptersDir = path.join(
              workspacePath,
              args.bookId,
              '.dogear',
              'chapters'
            );

            const files = await fs.readdir(chaptersDir);
            const summaries = [];

            for (const file of files.sort()) {
              const filePath = path.join(chaptersDir, file);
              const content = await fs.readFile(filePath, 'utf-8');
              const chapter = JSON.parse(content);

              // 只返回摘要信息，不返回完整内容
              summaries.push({
                chapterNumber: chapter.chapterNumber,
                title: chapter.title,
                summary: chapter.summary,
                keyPoints: chapter.keyPoints,
                // 其他 AI 添加的关键字段
              });
            }

            return {
              content: [{
                type: 'text',
                text: JSON.stringify(summaries, null, 2),
              }],
            };
          } catch (error) {
            return {
              content: [{
                type: 'text',
                text: `读取失败: ${error}`,
              }],
            };
          }
        }
      ),

      // 工具 6: 读取原始章节内容
      tool(
        'ReadChapterContent',
        '读取指定章节的原始内容',
        {
          bookId: z.string().describe('书籍ID'),
          chapterId: z.string().describe('章节ID'),
        },
        async (args, extra) => {
          try {
            // 从数据库或原始文件读取章节内容
            // 这里需要通过 IPC 调用主进程获取
            return {
              content: [{
                type: 'text',
                text: `章节内容...`,
              }],
            };
          } catch (error) {
            return {
              content: [{
                type: 'text',
                text: `读取失败: ${error}`,
              }],
              isError: true,
            };
          }
        }
      ),
    ],
  });
}
```

### 4.2 System Prompt 设计

```typescript
const BOOK_ANALYSIS_SYSTEM_PROMPT = `你是一个智能书籍分析助手。

## 你的任务

分析用户提供的书籍内容，并将分析结果保存到文件系统。

## 可用工具

1. **Read** - 读取书籍文件内容
2. **SaveAnalysis** - 保存全书分析结果（任意结构）
3. **SaveChapterAnalysis** - 保存章节分析结果（任意结构）
4. **CompleteAnalysis** - 标记分析完成
5. **LoadAnalysis** - 读取已有的分析结果
6. **LoadChapterSummaries** - 读取章节摘要列表
7. **ReadChapterContent** - 读取章节原始内容

## 分析流程

### 第一步：判断内容类型

首先判断你正在分析的内容类型：
- **小说/故事**（fiction）：有角色、情节、对话
- **技术/理论**（non-fiction）：讲解概念、知识、方法
- **文章/随笔**（article）：短篇、单一主题
- **工具/手册**（reference）：API 文档、教程、说明书
- **其他**（other）

### 第二步：根据类型决定分析结构

**对于小说/故事**：
\`\`\`json
{
  "contentType": "fiction",
  "title": "书名",
  "author": "作者",
  "summary": "全书摘要",
  "themes": ["主题1", "主题2"],
  "characters": [
    {"name": "名字", "role": "角色", "description": "描述"}
  ],
  "keyEvents": ["事件1", "事件2"]
}
\`\`\`

**对于技术/理论书籍**：
\`\`\`json
{
  "contentType": "non-fiction",
  "title": "书名",
  "author": "作者",
  "summary": "全书摘要",
  "topics": ["主题1", "主题2"],
  "keyConcepts": ["概念1", "概念2"],
  "prerequisites": ["前置知识"],
  "targetAudience": "目标读者"
}
\`\`\`

**对于文章**：
\`\`\`json
{
  "contentType": "article",
  "title": "标题",
  "author": "作者",
  "summary": "摘要",
  "mainArgument": "核心论点",
  "keyPoints": ["论点1", "论点2"],
  "conclusion": "结论"
}
\`\`\`

### 第三步：逐章分析

对每个章节，根据内容类型保存相应的分析信息。

### 第四步：完成

调用 CompleteAnalysis 标记分析完成。

## 重要提示

1. **灵活应变**：不要被固定的结构限制，根据内容特点添加有意义的字段
2. **保持简洁**：摘要应该精炼，关键点应该独立
3. **准确性**：确保保存的信息准确反映内容
4. **中文优先**：使用中文进行分析和存储

## 示例对话

用户：请分析这本书

你的操作：
1. [读取文件，判断类型]
2. [根据类型选择分析结构]
3. [调用 SaveAnalysis 保存全书分析]
4. [逐章调用 SaveChapterAnalysis]
5. [调用 CompleteAnalysis]
6. 回复用户："分析完成！这是一本XX类型的书籍，共XX章..."
`;
```

---

## 五、智能问答设计

### 5.1 问答 System Prompt

```typescript
const QA_SYSTEM_PROMPT = (bookInfo: any) => `
你是一个书籍阅读助手，正在帮助用户回答关于《${bookInfo.title}》的问题。

## 可用工具

1. **LoadAnalysis** - 读取全书分析结果
2. **LoadChapterSummaries** - 读取所有章节摘要（快速）
3. **ReadChapterContent** - 读取章节完整内容（详细）

## 回答策略

**重要：为了节省 Token 并提高响应速度，请按以下步骤回答问题：**

### 第一步：先加载分析结果
调用 LoadAnalysis 了解这本书的类型和结构。

### 第二步：根据问题类型决定策略

- 如果问题关于全书（如"这本书讲了什么"）：直接用分析结果回答
- 如果问题关于具体内容：调用 LoadChapterSummaries 获取章节摘要
- 如果需要详细信息：根据摘要判断，调用 ReadChapterContent 读取相关章节

### 第三步：引用来源
在回答时，请引用具体的章节名称。

## 书籍信息

${JSON.stringify(bookInfo, null, 2)}

请基于以上信息和工具来回答用户的问题。
`;
```

---

## 六、实现步骤

### Phase 1: 基础架构

1. **目录结构**
   - [ ] 创建工作区目录结构
   - [ ] 实现书籍导入时的目录创建
   - [ ] 创建 .dogear 隐藏目录

2. **文件管理**
   - [ ] 实现 meta.json 读写
   - [ ] 实现 status.json 读写
   - [ ] 实现分析文件的创建和更新

3. **数据库**
   - [ ] 简化 books 表
   - [ ] 创建 workspaces 表
   - [ ] 添加 analysis_status 相关字段

### Phase 2: Agent 工具

4. **MCP Server**
   - [ ] 创建文件系统版本的工具
   - [ ] SaveAnalysis：保存任意结构的分析结果
   - [ ] SaveChapterAnalysis：保存章节分析
   - [ ] LoadAnalysis / LoadChapterSummaries：读取工具

5. **System Prompt**
   - [ ] 设计让 AI 自行判断类型的 Prompt
   - [ ] 为不同类型提供示例结构

### Phase 3: 分析流程

6. **分析任务**
   - [ ] 实现分析调度
   - [ ] 实现进度事件（读取文件、保存分析等）
   - [ ] 错误处理

### Phase 4: 问答流程

7. **智能问答**
   - [ ] 先加载分析结果判断类型
   - [ ] 根据问题决定加载哪些内容
   - [ ] 两阶段查询（摘要 → 详细）

### Phase 5: UI

8. **界面**
   - [ ] 分析按钮和进度显示
   - [ ] 分析结果展示（根据类型动态渲染）
   - [ ] 问答界面

---

## 七、方案总结

### v2 方案的优势

1. **完全灵活**：AI 可以根据内容类型自行决定输出什么结构
2. **易于扩展**：添加新的分析内容不需要修改数据库 Schema
3. **便于调试**：分析结果直接存储为 JSON 文件，可以直接查看和编辑
4. **便于备份**：每本书的分析数据和书籍文件在一起，备份和删除都很简单

### 数据流向

```
书籍文件 → Agent 分析 → SaveAnalysis 工具 → .dogear/analysis.json
                              ↓
                         SaveChapterAnalysis 工具
                              ↓
                         .dogear/chapters/*.json

用户问答 → LoadAnalysis → 读取分析结果 → 判断内容类型
                              ↓
                         LoadChapterSummaries → 获取摘要
                              ↓
                         ReadChapterContent → 按需读取详细内容
```

### 后续扩展方向

1. **向量搜索**：可以在 .dogear 目录下添加 embeddings.json 存储向量
2. **多模态**：在 analysis.json 中添加图片、表格的分析
3. **增量更新**：检测文件变化，只重新分析变化部分
4. **导出功能**：直接复制 .dogear 目录即可导出分析结果
