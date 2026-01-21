# Dogear 工作区与 Agent 文件读取设计方案

## 一、概述

本文档描述 Dogear 电子书阅读器的工作区管理和 Agent 文件读取功能的实现方案。

### 核心目标

1. **统一书籍存储**：所有导入的书籍集中管理，复制到指定工作区目录
2. **Agent 读取能力**：让 Agent 可以直接读取原始书籍文件进行分析
3. **分析活动可见**：用户可以看到 Agent 正在读取什么文件、做什么分析
4. **结构化持久化**：通过自定义工具（Function Call）让 AI 存储结构化数据到数据库
5. **智能检索**：后续问答时 AI 先查索引/摘要，按需读取详细内容，减少 Token 消耗

---

## 二、数据结构设计

### 2.1 工作区

```typescript
interface Workspace {
  id: string;           // 工作区唯一标识
  name: string;         // 工作区名称
  path: string;         // 工作区绝对路径
  createdAt: number;    // 创建时间戳
  isDefault: boolean;   // 是否为默认工作区
}
```

**第一阶段（简化版）**：系统自动创建一个默认工作区，用户无需管理。

### 2.2 书籍

```typescript
interface Book {
  id: string;                    // 书籍唯一标识
  title: string;                 // 书名
  workspaceId: string;           // 所属工作区
  filePath: string;              // 工作区内的文件路径 (相对路径)
  originalPath: string;          // 原始导入路径（只读，用于参考）
  fileSize: number;              // 文件大小
  fileType: string;              // 文件类型 (txt, epub, pdf等)

  // 阅读相关
  currentChapterId: string;
  processingStatus: 'idle' | 'processing' | 'completed' | 'failed';
  processingProgress?: number;

  // 分析相关
  analysisStatus: 'none' | 'analyzing' | 'analyzed' | 'failed';
  analysisResult?: BookAnalysis;  // 分析结果（结构化缓存）
  lastAnalyzedAt?: number;        // 最后分析时间
  agentSessionId?: string;        // Agent 会话ID（用于恢复）

  createdAt: number;
  updatedAt: number;
}
```

### 2.3 书籍分析结果

```typescript
interface BookAnalysis {
  bookId: string;

  // 基本信息
  title: string;
  author?: string;
  genre?: string[];

  // 结构化摘要
  summary: string;           // 全书摘要
  themes: string[];          // 主题列表

  // 章节分析
  chapterAnalyses: ChapterAnalysis[];

  // 内容分析
  characters?: Character[];  // 人物分析（小说类）
  keyPoints: string[];       // 关键点列表

  // 元信息
  analyzedAt: number;
  model: string;             // 使用的模型
}

interface ChapterAnalysis {
  chapterId: string;
  chapterTitle: string;
  summary: string;           // 章节摘要
  keyPoints: string[];       // 关键点
  characters?: string[];     // 出现的人物
}

interface Character {
  name: string;
  description: string;
  relationships?: Record<string, string>; // 与其他人物的关系
}
```

---

## 三、目录结构设计

```
用户数据目录 (app.getPath('userData'))
│
├── books/                          # 默认工作区
│   ├── {book-id-1}/
│   │   ├── original.txt           # 原始文件（保留）
│   │   └── metadata.json          # 书籍元数据（可选，用于快速读取）
│   ├── {book-id-2}/
│   │   ├── original.epub
│   │   └── metadata.json
│   └── ...
│
├── dogear.db                        # SQLite 数据库
│
└── agents/                          # Agent 会话缓存
    ├── sessions/                   # SDK 持久化的会话
    └── analysis-cache/             # 分析结果缓存
```

---

## 四、Agent SDK 集成设计

### 4.1 核心架构：自定义工具（MCP Server）

**关键设计决策**：使用 SDK 的 `createSdkMcpServer` 创建自定义工具，让 AI 通过 Function Call 直接存储结构化数据。

```
┌─────────────────────────────────────────────────────────────┐
│                      Agent 分析流程                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  用户: "分析这本书"                                          │
│     │                                                       │
│     ▼                                                       │
│  ┌─────────────────────────────────────────────────┐        │
│  │ 1. Agent 使用 Read 工具读取书籍文件              │        │
│  │    → Hook 监听 → 显示进度"正在读取 chapter1.txt" │        │
│  └─────────────────────────────────────────────────┘        │
│     │                                                       │
│     ▼                                                       │
│  ┌─────────────────────────────────────────────────┐        │
│  │ 2. Agent 分析内容后，调用 SaveBookInfo 工具      │        │
│  │    → 直接存入数据库（book_info 表）              │        │
│  └─────────────────────────────────────────────────┘        │
│     │                                                       │
│     ▼                                                       │
│  ┌─────────────────────────────────────────────────┐        │
│  │ 3. Agent 对每个章节调用 SaveChapterSummary 工具  │        │
│  │    → 存入 chapter_summaries 表                   │        │
│  └─────────────────────────────────────────────────┘        │
│     │                                                       │
│     ▼                                                       │
│  ┌─────────────────────────────────────────────────┐        │
│  │ 4. Agent 调用 SaveAnalysisComplete 工具          │        │
│  │    → 标记分析完成，返回结果统计                  │        │
│  └─────────────────────────────────────────────────┘        │
│     │                                                       │
│     ▼                                                       │
│  分析完成！数据已结构化存入数据库                             │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 自定义工具定义

使用 `createSdkMcpServer` 创建自定义工具：

```typescript
// electron/main/agents/tools/book-analysis-tools.ts

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

/**
 * 创建书籍分析专用 MCP Server
 * Agent 可以通过调用这些工具直接将分析结果存入数据库
 */
export function createBookAnalysisTools(db: Database) {
  return createSdkMcpServer({
    name: 'dogear-book-analysis',
    version: '1.0.0',
    tools: [
      // 工具 1: 保存书籍基本信息
      tool(
        'SaveBookInfo',
        '保存书籍的基本分析信息（书名、作者、摘要、主题等）',
        {
          bookId: z.string().describe('书籍ID'),
          title: z.string().describe('书名'),
          author: z.string().optional().describe('作者'),
          genre: z.array(z.string()).optional().describe('书籍分类'),
          summary: z.string().describe('全书摘要，200字以内'),
          themes: z.array(z.string()).describe('主要主题列表'),
          keyPoints: z.array(z.string()).describe('全书关键点'),
        },
        async (args, extra) => {
          try {
            await db.bookInfo.save(args.bookId, {
              title: args.title,
              author: args.author,
              genre: args.genre,
              summary: args.summary,
              themes: args.themes,
              keyPoints: args.keyPoints,
            });
            return {
              content: [{
                type: 'text',
                text: `已保存书籍信息: ${args.title}`,
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

      // 工具 2: 保存章节摘要
      tool(
        'SaveChapterSummary',
        '保存单个章节的摘要和关键点',
        {
          bookId: z.string().describe('书籍ID'),
          chapterId: z.string().describe('章节ID'),
          chapterTitle: z.string().describe('章节标题'),
          chapterNumber: z.number().describe('章节序号'),
          summary: z.string().describe('章节摘要，100字以内'),
          keyPoints: z.array(z.string()).describe('章节关键点'),
          characters: z.array(z.string()).optional().describe('本章节出现的人物'),
        },
        async (args, extra) => {
          try {
            await db.chapterSummaries.save({
              bookId: args.bookId,
              chapterId: args.chapterId,
              chapterTitle: args.chapterTitle,
              chapterNumber: args.chapterNumber,
              summary: args.summary,
              keyPoints: args.keyPoints,
              characters: args.characters,
            });
            return {
              content: [{
                type: 'text',
                text: `已保存章节摘要: ${args.chapterTitle}`,
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

      // 工具 3: 保存人物信息（小说类）
      tool(
        'SaveCharacter',
        '保存人物信息（名称、描述、关系）',
        {
          bookId: z.string().describe('书籍ID'),
          name: z.string().describe('人物名称'),
          description: z.string().describe('人物描述'),
          relationships: z.record(z.string()).optional().describe('与其他人物的关系'),
        },
        async (args, extra) => {
          try {
            await db.characters.save(args.bookId, {
              name: args.name,
              description: args.description,
              relationships: args.relationships,
            });
            return {
              content: [{
                type: 'text',
                text: `已保存人物: ${args.name}`,
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

      // 工具 4: 标记分析完成
      tool(
        'CompleteAnalysis',
        '标记书籍分析完成',
        {
          bookId: z.string().describe('书籍ID'),
          totalChapters: z.number().describe('总章节数'),
          totalCharacters: z.number().optional().describe('总人数（小说类）'),
          notes: z.string().optional().describe('分析备注'),
        },
        async (args, extra) => {
          try {
            await db.books.updateAnalysisStatus(args.bookId, 'analyzed');
            // 返回分析统计
            const stats = await db.getAnalysisStats(args.bookId);
            return {
              content: [{
                type: 'text',
                text: `分析完成！\n` +
                      `- 书籍ID: ${args.bookId}\n` +
                      `- 已分析章节: ${stats.chaptersAnalyzed}/${args.totalChapters}\n` +
                      `- 已保存人物: ${stats.charactersSaved}\n` +
                      `- 数据已持久化到数据库`,
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

      // 工具 5: 查询章节摘要（用于后续问答）
      tool(
        'QueryChapterSummaries',
        '查询书籍的章节摘要列表，用于快速定位相关内容',
        {
          bookId: z.string().describe('书籍ID'),
          keywords: z.array(z.string()).optional().describe('关键词过滤'),
        },
        async (args, extra) => {
          try {
            const summaries = await db.chapterSummaries.query(args.bookId, args.keywords);
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
                text: `查询失败: ${error}`,
              }],
              isError: true,
            };
          }
        }
      ),

      // 工具 6: 读取章节详细内容（按需加载）
      tool(
        'ReadChapterContent',
        '读取指定章节的完整内容',
        {
          chapterId: z.string().describe('章节ID'),
        },
        async (args, extra) => {
          try {
            const chapter = await db.chapters.getContent(args.chapterId);
            return {
              content: [{
                type: 'text',
                text: `章节: ${chapter.title}\n\n${chapter.content}`,
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

### 4.3 核心配置

```typescript
// 在 agent-worker.ts 中配置 query
import { createBookAnalysisTools } from './tools/book-analysis-tools.js';

// 创建 MCP Server（自定义工具）
const bookAnalysisMcpServer = createBookAnalysisTools(db);

const queryOptions: Options = {
  // 允许 Agent 访问书籍工作区目录
  additionalDirectories: [workspacePath],

  // 内置工具
  allowedTools: ['Read', 'Glob', 'Grep'],

  // 自定义 MCP Server（关键！）
  mcpServers: {
    'dogear-book-analysis': bookAnalysisMcpServer,
  },

  // 启用会话持久化
  persistSession: true,

  // Hooks - 让分析活动可见
  hooks: {
    PreToolUse: [{
      hooks: [toolUseHook]
    }],
    PostToolUse: [{
      hooks: [toolResultHook]
    }]
  }
};
```

### 4.4 分析流程设计（更新版）

```
用户点击"分析书籍"
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. 创建 Agent 会话                                           │
│    - 配置 additionalDirectories（访问书籍文件）              │
│    - 注册自定义 MCP Server（数据库写入工具）                 │
│    - 设置分析专用 System Prompt                              │
└─────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Agent 使用 Read 工具读取书籍文件                           │
│    → PreToolUse Hook 监听 → 发送进度到前端                   │
│    "正在读取: chapter1.txt"                                  │
└─────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Agent 分析后调用 SaveBookInfo 工具                        │
│    → 数据直接写入数据库，无需 JSON 解析                      │
│    → PostToolUse Hook 通知成功                               │
└─────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Agent 对每个章节调用 SaveChapterSummary 工具             │
│    → 逐个保存章节摘要和关键点                                │
│    → 前端实时显示"已分析 3/10 章"                            │
└─────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Agent 调用 CompleteAnalysis 工具                          │
│    → 标记分析完成                                            │
│    → 返回统计信息给用户                                      │
└─────────────────────────────────────────────────────────────┘
```

### 4.5 System Prompt 设计（更新版）

```typescript
const BOOK_ANALYSIS_SYSTEM_PROMPT = `你是一个专业的文学分析助手。

你的任务是分析用户提供的电子书文件，并将分析结果通过工具保存到数据库。

## 可用工具

1. **Read** - 读取书籍文件内容
2. **SaveBookInfo** - 保存书籍基本信息（书名、作者、摘要、主题、关键点）
3. **SaveChapterSummary** - 保存章节摘要和关键点
4. **SaveCharacter** - 保存人物信息（小说类）
5. **CompleteAnalysis** - 标记分析完成
6. **QueryChapterSummaries** - 查询已保存的章节摘要
7. **ReadChapterContent** - 读取章节详细内容（从数据库）

## 分析流程

请按以下步骤进行分析：

### 第一步：读取文件
使用 Read 工具读取书籍文件。如果文件很大，可以分章节读取。

### 第二步：保存基本信息
分析完成后，先调用 SaveBookInfo 保存：
- 书名和作者
- 全书摘要（200字以内）
- 主要主题（3-5个）
- 全书关键点（5-10个）

### 第三步：逐章分析
对每个章节：
1. 读取章节内容
2. 调用 SaveChapterSummary 保存：
   - 章节标题和序号
   - 章节摘要（100字以内）
   - 章节关键点（3-5个）
   - 出现的人物（如果是小说）

### 第四步：人物分析（可选，小说类）
如果小说中有多个人物，调用 SaveCharacter 为每个人物保存：
- 人物名称
- 人物描述
- 与其他人物的关系

### 第五步：完成
调用 CompleteAnalysis 标记分析完成。

## 重要提示

- **数据准确性**：通过工具调用保存的数据会被直接存储，请确保准确性
- **分批处理**：如果有大量章节，可以分批处理，随时保存进度
- **摘要质量**：摘要应该简洁明了，捕捉章节的核心内容
- **关键点**：每个关键点应该是一个独立的、可检索的信息单元

## 示例对话

用户：请分析这本书

你的操作：
1. [使用 Read 工具读取文件]
2. [调用 SaveBookInfo: 书名="xxx", 摘要="...", ...]
3. [调用 SaveChapterSummary: 章节标题="第一章", ...]
4. ...
5. [调用 CompleteAnalysis]
6. 回复用户："分析完成！本书共xx章，已提取xx个关键点，识别xx个人物。"
`;
```

### 4.6 工具使用监听（Hooks）

```typescript
// 监听 Agent 使用工具，发送进度到前端
async function toolUseHook(input: PreToolUseHookInput): Promise<SyncHookJSONOutput> {
  const { tool_name, tool_input } = input;

  // 根据工具类型发送不同的进度信息
  if (tool_name === 'Read') {
    const filePath = (tool_input as any).file_path;
    sendProgressToMain({
      type: 'reading_file',
      message: `正在读取: ${basename(filePath)}`
    });
  } else if (tool_name === 'SaveBookInfo') {
    sendProgressToMain({
      type: 'saving_info',
      message: '正在保存书籍信息...'
    });
  } else if (tool_name === 'SaveChapterSummary') {
    const title = (tool_input as any).chapterTitle;
    sendProgressToMain({
      type: 'saving_chapter',
      message: `正在保存章节摘要: ${title}`
    });
  } else if (tool_name === 'CompleteAnalysis') {
    sendProgressToMain({
      type: 'completing',
      message: '正在完成分析...'
    });
  }

  return { continue: true };
}

async function toolResultHook(input: PostToolUseHookInput): Promise<SyncHookJSONOutput> {
  const { tool_name } = input;

  if (tool_name === 'SaveChapterSummary') {
    // 更新进度：已保存章节数
    updateProgress();
  } else if (tool_name === 'CompleteAnalysis') {
    // 分析完成
    sendProgressToMain({ type: 'completed' });
  }

  return { continue: true };
}
```

---

## 五、智能问答设计（基于已分析数据）

### 5.1 核心思想

**问题**：用户问一个简单问题，不应该每次都让 AI 读取整本书。

**解决方案**：两阶段查询策略
1. **第一阶段**：AI 先查询章节摘要（快速、低 Token）
2. **第二阶段**：根据摘要判断需要哪些详细内容，按需读取

### 5.2 问答流程设计

```
用户提问: "主角在第几章第一次遇到反派？"
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│ 第一阶段：快速检索（摘要层）                                  │
├─────────────────────────────────────────────────────────────┤
│ AI 调用 QueryChapterSummaries 工具                           │
│ → 返回所有章节的摘要和关键点（轻量级数据）                    │
│ → AI 在本地分析，找到可能相关的章节                          │
│ 例如："第5章摘要提到主角遇到了神秘人物"                      │
└─────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────┐
│ 第二阶段：精确读取（详细内容层）                              │
├─────────────────────────────────────────────────────────────┤
│ AI 调用 ReadChapterContent 工具                              │
│ → 只读取第4、5、6章的详细内容                                │
│ → 基于完整内容给出精确答案                                   │
│                                                              │
│ Token 消耗对比：                                              │
│ - 传统方式：读取全书 100% 内容 = ~50K tokens                 │
│ - 智能方式：摘要 5K + 详细 15K = ~20K tokens (节省 60%)      │
└─────────────────────────────────────────────────────────────┘
```

### 5.3 问答专用工具配置

在问答场景下，配置不同的工具集：

```typescript
// 分析模式：所有工具
const analysisTools = {
  'dogear-book-analysis': createBookAnalysisTools(db),
  mcpServers: {
    'dogear-book-analysis': bookAnalysisMcpServer,
  },
  allowedTools: ['Read', 'Glob', 'Grep', 'Write'],
};

// 问答模式：只读工具
const qaTools = {
  mcpServers: {
    'dogear-book-analysis': bookAnalysisMcpServer,
  },
  allowedTools: ['Read'],  // 问答时不需要 Write
};
```

### 5.4 问答专用 System Prompt

```typescript
const QA_SYSTEM_PROMPT = (bookInfo: BookAnalysisInfo) => `
你是一个书籍阅读助手，正在帮助用户回答关于《${bookInfo.title}》的问题。

## 可用工具

1. **QueryChapterSummaries** - 查询所有章节的摘要（快速，低消耗）
2. **ReadChapterContent** - 读取指定章节的完整内容（详细，高消耗）

## 回答策略

**重要：为了节省 Token 并提高响应速度，请按以下步骤回答问题：**

### 第一步：先用摘要判断
当用户提问时，首先调用 QueryChapterSummaries 获取所有章节摘要。
分析摘要，判断哪些章节可能与问题相关。

### 第二步：按需读取详细内容
只读取相关章节的完整内容，基于这些内容回答问题。

### 第三步：引用来源
在回答时，请引用具体的章节名称，如"根据第5章《xx》的内容..."

## 书籍概览

- 书名：${bookInfo.title}
- 作者：${bookInfo.author || '未知'}
- 主题：${bookInfo.themes?.join(', ') || '无'}
- 全书摘要：${bookInfo.summary}

## 章节索引

这本书共有 ${bookInfo.totalChapters} 章。
${bookInfo.chapterList?.map((c, i) => `${i + 1}. ${c.title}`).join('\n') || ''}

请基于以上信息和工具来回答用户的问题。
`;
```

### 5.5 实际对话示例

```
用户: "主角是在哪里第一次遇到反派的？"

AI 的思考过程：
1. 调用 QueryChapterSummaries(bookId="xxx")
2. 收到摘要：
   - 第3章: 主角踏上旅程
   - 第5章: 主角在酒馆遇到神秘人，发生冲突
   - 第7章: 主角发现神秘人的真实身份
3. 判断：第5章最相关
4. 调用 ReadChapterContent(chapterId="chapter-5")
5. 基于详细内容回答

AI 回答：
"根据第5章《初次相遇》的内容，主角在"老橡树酒馆"第一次遇到反派。
当时主角正在酒馆休息，一个身穿黑斗篷的人走了进来...

(第5章，第2段)"
```

### 5.6 数据库查询优化

为了支持智能问答，需要建立合适的索引：

```sql
-- 章节摘要表（已在前文定义）
CREATE TABLE chapter_summaries (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  chapter_number INTEGER,
  chapter_title TEXT,
  summary TEXT,
  key_points TEXT,  -- JSON array
  characters TEXT,  -- JSON array (optional)
  created_at INTEGER,
  FOREIGN KEY (book_id) REFERENCES books(id),
  FOREIGN KEY (chapter_id) REFERENCES chapters(id)
);

-- 索引：用于快速查询
CREATE INDEX idx_chapter_summaries_book ON chapter_summaries(book_id);
CREATE INDEX idx_chapter_summaries_number ON chapter_summaries(book_id, chapter_number);

-- 全文搜索索引（可选，用于关键词搜索）
CREATE VIRTUAL TABLE chapter_summaries_fts USING fts5(
  chapter_title, summary, key_points,
  content=chapter_summaries
);
```

### 5.7 扩展：Web 搜索集成（预留）

```typescript
// 工具 7: Web 搜索（用于补充信息）
tool(
  'WebSearch',
  '在网络上搜索相关信息，用于补充书籍内容（如作者背景、历史背景等）',
  {
    query: z.string().describe('搜索关键词'),
  },
  async (args, extra) => {
    // 调用 WebSearch API
    const results = await webSearch(args.query);
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(results, null, 2),
      }],
    };
  }
),
```

---

## 六、UI 设计

### 6.1 主窗口布局（修改后）

```
┌──────────────────────────────────────────────────────────┐
│  Dogear                                [设置]          [×]│
├──────────────┬───────────────────────────────────────────┤
│              │  我的书架                                    │
│ 书架         │                                            │
│ ─────────────│  ┌────────┐ ┌────────┐ ┌────────┐         │
│ ▼ 全部书     │  │ 书籍1  │ │ 书籍2  │ │ 书籍3  │  ...    │
│ ─────────────│  │ 封面   │ │ 封面   │ │ 封面   │         │
│ 📖 全部书    │  │ 书名   │ │ 书名   │ │ 书名   │         │
│ ⭐ 最近阅读  │  │ [阅读] │ │ [阅读] │ │ [阅读] │         │
│ 🔖 已分析    │  │ [分析] │ │ [分析] │ │ [分析] │         │
└──────────────┴────────┴────────┴────────┴────────────────┘
```

### 6.2 分析界面

当用户点击"分析"按钮时：

```
┌──────────────────────────────────────────────────────────┐
│  正在分析《书名》                                  [×]     │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  进度：正在读取文件...                                     │
│  ████████████████████████████████░░░░  75%               │
│                                                           │
│  📋 活动日志：                                             │
│  ┌─────────────────────────────────────────────────┐    │
│  │ 10:23:01  正在读取: chapter1.txt                 │    │
│  │ 10:23:05  正在读取: chapter2.txt                 │    │
│  │ 10:23:10  正在分析章节结构...                    │    │
│  │ 10:23:15  提取关键点中...                        │    │
│  └─────────────────────────────────────────────────┘    │
│                                                           │
│  [取消分析]                                               │
└──────────────────────────────────────────────────────────┘
```

分析完成后：

```
┌──────────────────────────────────────────────────────────┐
│  《书名》分析结果                                 [×]     │
├──────────────────────────────────────────────────────────┤
│                                                           │
│  📊 基本信息                                              │
│  作者: xxx    类型: 小说    主题: 成长、友情              │
│                                                           │
│  📝 内容简介                                              │
│  这是一本关于...的书籍...                                  │
│                                                           │
│  📑 章节分析                                              │
│  第一章: 开始的旅程                                      │
│    - 关键点: 主人公登场、初次冒险                         │
│  第二章: 意外的发现                                      │
│    - 关键点: 发现神秘物品、遇到同伴                       │
│                                                           │
│  [继续对话] [重新分析] [导出报告]                         │
└──────────────────────────────────────────────────────────┘
```

### 6.3 基于分析的对话界面

在分析完成后，用户可以继续与 Agent 对话：

```
┌──────────────────────────────────────────────────────────┐
│  AI 助手 - 《书名》                              [×]     │
├─────────────────────────────────────┬────────────────────┤
│                                     │                    │
│  用户: 这本书主要讲了什么？           │  📖 已分析          │
│                                     │  📊 基于分析结果对话 │
│  AI: [基于分析结果的回答]            │                    │
│     这本书主要讲述了...               │                    │
│     根据之前的分析，主要主题是...      │                    │
│                                     │                    │
│  ┌─────────────────────────┐        │                    │
│  │ 输入问题...              │ [发送] │                    │
│  └─────────────────────────┘        │                    │
└─────────────────────────────────────┴────────────────────┘
```

---

## 七、IPC 通信设计

### 7.1 新增 IPC 通道

```typescript
// 工作区管理
interface WorkspaceAPI {
  // 获取默认工作区
  getDefaultWorkspace(): Promise<Workspace>;

  // 创建工作区（预留）
  createWorkspace(name: string, path: string): Promise<Workspace>;

  // 获取工作区中的书籍文件路径
  getBookFilePath(bookId: string): Promise<string>;
}

// 书籍分析
interface BookAnalysisAPI {
  // 开始分析书籍
  startAnalysis(bookId: string): Promise<string>;  // 返回分析任务ID

  // 获取分析状态
  getAnalysisStatus(bookId: string): Promise<AnalysisStatus>;

  // 获取分析结果
  getAnalysisResult(bookId: string): Promise<BookAnalysis | null>;

  // 基于分析结果对话
  chatWithAnalysis(bookId: string, message: string): AsyncIterable<string>;

  // 重新分析
  reanalyze(bookId: string): Promise<void>;
}

interface AnalysisStatus {
  status: 'none' | 'analyzing' | 'analyzed' | 'failed';
  progress: number;           // 0-100
  currentStep: string;        // 当前步骤描述
  logs: AnalysisLog[];        // 活动日志
  error?: string;
}

interface AnalysisLog {
  timestamp: number;
  type: 'info' | 'reading_file' | 'processing' | 'complete' | 'error';
  message: string;
  data?: any;  // 额外数据（如文件名）
}
```

### 7.2 Agent Worker 事件

```typescript
// Agent 发送到主进程的事件
interface AgentAnalysisEvent {
  type: 'analysis_progress' | 'analysis_complete' | 'analysis_error';
  bookId: string;
  taskId: string;
  data: {
    progress: number;
    step: string;
    log?: AnalysisLog;
    result?: BookAnalysis;
    error?: string;
  };
}
```

---

## 八、数据库 Schema 变更

### 8.1 新增工作区表

```sql
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  is_default INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
```

### 8.2 修改书籍表

```sql
-- 新增字段
ALTER TABLE books ADD COLUMN workspace_id TEXT NOT NULL DEFAULT 'default';
ALTER TABLE books ADD COLUMN file_path TEXT;  -- 相对于工作区的路径
ALTER TABLE books ADD COLUMN original_path TEXT;  -- 原始导入路径
ALTER TABLE books ADD COLUMN file_size INTEGER;
ALTER TABLE books ADD COLUMN file_type TEXT;

-- 分析相关
ALTER TABLE books ADD COLUMN analysis_status TEXT DEFAULT 'none';
ALTER TABLE books ADD COLUMN analysis_result TEXT;  -- JSON
ALTER TABLE books ADD COLUMN last_analyzed_at INTEGER;
ALTER TABLE books ADD COLUMN agent_session_id TEXT;

-- 索引
CREATE INDEX idx_books_workspace ON books(workspace_id);
CREATE INDEX idx_books_analysis_status ON books(analysis_status);
```

### 8.3 新增章节摘要表（核心功能）

```sql
-- 章节摘要表：存储每章的摘要和关键点
CREATE TABLE chapter_summaries (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  chapter_number INTEGER,
  chapter_title TEXT,
  summary TEXT,              -- 章节摘要（100字以内）
  key_points TEXT,           -- 关键点 JSON 数组
  characters TEXT,           -- 出现的人物 JSON 数组（可选）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id),
  FOREIGN KEY (chapter_id) REFERENCES chapters(id)
);

-- 索引：用于快速查询
CREATE INDEX idx_chapter_summaries_book ON chapter_summaries(book_id);
CREATE INDEX idx_chapter_summaries_number ON chapter_summaries(book_id, chapter_number);
```

### 8.4 新增书籍信息表（可选）

```sql
-- 书籍分析结果表：存储全书级别的分析
CREATE TABLE book_analysis (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL UNIQUE,
  title TEXT,
  author TEXT,
  genre TEXT,                 -- JSON 数组
  summary TEXT,               -- 全书摘要
  themes TEXT,                -- 主题 JSON 数组
  key_points TEXT,            -- 关键点 JSON 数组
  analyzed_at INTEGER NOT NULL,
  model TEXT,                 -- 使用的模型
  FOREIGN KEY (book_id) REFERENCES books(id)
);
```

### 8.5 新增人物表（可选，小说类）

```sql
-- 人物表：存储小说中的人物信息
CREATE TABLE characters (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  relationships TEXT,         -- 关系 JSON 对象
  created_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id)
);
```

---

## 九、实现步骤

### Phase 1: 基础架构（高优先级）

1. **数据库变更**
   - [ ] 创建 workspaces 表
   - [ ] 创建 chapter_summaries 表（核心功能）
   - [ ] 创建 book_analysis 表（可选）
   - [ ] 修改 books 表添加新字段
   - [ ] 数据迁移（现有书籍关联到默认工作区）

2. **文件管理**
   - [ ] 实现工作区管理模块
   - [ ] 修改书籍导入流程（复制文件到工作区）
   - [ ] 添加文件路径管理

### Phase 2: Agent 工具开发（高优先级）

3. **创建 MCP Server**
   - [ ] 创建 `book-analysis-tools.ts` 文件
   - [ ] 实现 `SaveBookInfo` 工具
   - [ ] 实现 `SaveChapterSummary` 工具（核心）
   - [ ] 实现 `QueryChapterSummaries` 工具（核心）
   - [ ] 实现 `ReadChapterContent` 工具
   - [ ] 实现 `CompleteAnalysis` 工具

4. **Agent Worker 配置**
   - [ ] 配置 additionalDirectories
   - [ ] 注册 MCP Server 到 mcpServers
   - [ ] 实现 PreToolUse/PostToolUse Hooks
   - [ ] 创建分析专用 System Prompt
   - [ ] 创建问答专用 System Prompt

### Phase 3: 分析流程（高优先级）

5. **分析任务**
   - [ ] 实现分析任务调度
   - [ ] 实现进度事件发送
   - [ ] 实现错误处理和重试

6. **问答流程**
   - [ ] 实现基于摘要的两阶段查询
   - [ ] 实现会话管理和复用

### Phase 4: UI 实现（中优先级）

7. **主界面修改**
   - [ ] 添加左侧书架边栏
   - [ ] 修改书籍列表布局
   - [ ] 添加分析入口按钮

8. **分析界面**
   - [ ] 分析进度对话框
   - [ ] 分析结果展示页面
   - [ ] 基于分析的对话界面

### Phase 5: 优化和扩展（低优先级）

9. **性能优化**
   - [ ] 大文件分段读取策略
   - [ ] 分析结果增量更新
   - [ ] 会话缓存管理

10. **高级功能**
    - [ ] 多工作区支持
    - [ ] 分析结果导出
    - [ ] 自定义分析 Prompt

---

## 十、方案总结

### 核心创新点

1. **Function Call 持久化**：不是让 AI 输出 JSON 然后解析，而是直接调用我们的工具写入数据库
   - 优势：数据结构更可控，避免 JSON 解析错误
   - 优势：每调用一次工具都是一次"提交点"，进度可见

2. **两阶段智能问答**：
   - 第一阶段：查询摘要（低 Token）
   - 第二阶段：按需读取详细内容（高 Token，但精确）
   - 节省 60%+ Token 消耗

3. **分析活动可见**：
   - 通过 Hooks 监听工具使用
   - 用户实时看到 AI 在做什么

### 与传统方案的对比

| 方面 | 传统方案（JSON 输出） | 本方案（Function Call） |
|------|---------------------|------------------------|
| 数据可靠性 | 需要解析 JSON，可能失败 | 工具调用直接写入，类型安全 |
| 进度可见性 | 只能看到开始和结束 | 每个工具调用都有事件 |
| Token 效率 | 每次问答读全书 | 先读摘要，按需读详细 |
| 可扩展性 | 难以添加新字段 | 添加新工具即可 |

---

## 十一、技术风险和应对

| 风险 | 影响 | 应对措施 |
|------|------|----------|
| 文件过大导致 Token 超限 | 分析失败 | 实现分段读取，按章节分析 |
| Hook 延迟导致进度不及时 | 用户体验差 | 在 Agent Prompt 中要求主动报告进度 |
| JSON 解析失败 | 结果无法存储 | 结合正则提取和重试机制 |
| 会话恢复成本高 | 性能问题 | 关键信息单独存数据库，会话仅用于深度对话 |

---

## 十二、后续扩展方向

1. **Skill 系统**：创建专门的分析 Skill，可由用户调用
2. **增量分析**：书籍更新时只分析变化部分
3. **多模态**：支持图片类书籍的视觉分析
4. **知识图谱**：基于分析结果构建人物/概念关系图
5. **分享功能**：导出分析报告，与他人分享
