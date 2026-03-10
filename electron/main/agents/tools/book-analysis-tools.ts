/**
 * 书籍分析 MCP Server 工具
 *
 * 这些工具允许 Agent 通过 Function Call 将分析结果保存到文件系统
 * 而不是数据库，从而实现更灵活的数据结构
 *
 * 设计原则 (v2):
 * - 使用 createSdkMcpServer 创建自定义工具
 * - 分析数据存储在 .dogear/ 目录中，而不是数据库
 * - AI 可以根据内容类型自由决定输出什么结构
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import * as workspaceService from '../../services/workspace-service.js';

/**
 * 创建书籍分析专用 MCP Server
 * @param workspacePath - 工作区路径（用于直接构造路径，避免每次查询数据库）
 * @returns MCP Server 配置
 */
export function createBookAnalysisTools(workspacePath: string) {
  // 创建一个轻量级的 workspace 对象，用于传递给 service 函数
  const workspace = {
    id: 'current',
    name: '当前工作区',
    path: workspacePath,
    is_default: 1,
    created_at: Date.now()
  };

  return createSdkMcpServer({
    name: 'dogear-book-analysis',
    version: '1.0.0',
    tools: [
      // ========================================
      // 工具 1: 保存全书分析结果（核心）
      // ========================================
      tool(
        'SaveAnalysis',
        '保存书籍的全书分析结果到 .dogear/analysis.json\n' +
        '这是一个通用工具，AI 可以根据书籍类型自由决定输出什么结构。\n' +
        '对于小说：可以输出 characters, keyEvents 等字段\n' +
        '对于技术书：可以输出 topics, keyConcepts 等字段\n' +
        '对于文章：可以输出 mainArgument, keyPoints 等字段',
        {
          bookId: z.string().describe('书籍ID'),
          contentType: z.string().describe('内容类型: fiction(小说) | non-fiction(非虚构/技术) | article(文章) | reference(参考书) | other(其他)'),
          analysis: z.any().describe('分析结果（任意结构，根据书籍类型自由组织）'),
        },
        async (args, extra) => {
          try {
            // 处理 analysis 参数：可能是对象或 JSON 字符串
            let analysisData = args.analysis;
            if (typeof analysisData === 'string') {
              try {
                analysisData = JSON.parse(analysisData);
              } catch {
                // 如果解析失败，保持原样
              }
            }

            // 使用 workspaceService 保存分析结果
            await workspaceService.saveAnalysisResult(workspace, args.bookId, {
              contentType: args.contentType,
              ...(typeof analysisData === 'object' && analysisData !== null ? analysisData : {})
            });

            // 同时保存分析状态
            await workspaceService.saveAnalysisStatus(workspace, args.bookId, {
              analysisStatus: 'analyzed',
              analyzedAt: Date.now()
            });

            return {
              content: [{
                type: 'text',
                text: `✅ 已保存全书分析结果\n` +
                      `类型: ${args.contentType}\n` +
                      `位置: .dogear/analysis.json`,
              }],
            };
          } catch (error) {
            return {
              content: [{
                type: 'text',
                text: `❌ 保存失败: ${error}`,
              }],
              isError: true,
            };
          }
        }
      ),

      // ========================================
      // 工具 2: 保存章节分析
      // ========================================
      tool(
        'SaveChapterAnalysis',
        '保存单个章节的分析结果到 .dogear/chapters/chapter-XXX.json\n' +
        '每个章节的分析结构也可以根据类型自由组织',
        {
          bookId: z.string().describe('书籍ID'),
          chapterId: z.string().describe('章节ID（从数据库获取的UUID）'),
          chapterNumber: z.number().describe('章节序号'),
          title: z.string().describe('章节标题'),
          summary: z.string().describe('章节摘要（100字以内）'),
          analysis: z.any().describe('章节的其他分析数据（任意结构）'),
        },
        async (args, extra) => {
          try {
            // 处理 analysis 参数：可能是对象或 JSON 字符串
            let analysisData = args.analysis;
            if (typeof analysisData === 'string') {
              try {
                analysisData = JSON.parse(analysisData);
              } catch {
                // 如果解析失败，保持原样
              }
            }

            await workspaceService.saveChapterAnalysis(workspace, args.bookId, args.chapterNumber, {
              chapterId: args.chapterId,
              title: args.title,
              summary: args.summary,
              ...(typeof analysisData === 'object' && analysisData !== null ? analysisData : {})
            });

            return {
              content: [{
                type: 'text',
                text: `✅ 已保存章节分析: ${args.title}`,
              }],
            };
          } catch (error) {
            return {
              content: [{
                type: 'text',
                text: `❌ 保存失败: ${error}`,
              }],
              isError: true,
            };
          }
        }
      ),

      // ========================================
      // 工具 3: 标记分析完成
      // ========================================
      tool(
        'CompleteAnalysis',
        '标记书籍分析完成，并返回统计信息',
        {
          bookId: z.string().describe('书籍ID'),
          totalChapters: z.number().describe('总章节数'),
          notes: z.string().optional().describe('分析备注'),
        },
        async (args, extra) => {
          try {
            // 读取所有章节分析
            const chapters = await workspaceService.loadChapterAnalyses(workspace, args.bookId);

            // 读取全书分析
            const analysis = await workspaceService.loadAnalysisResult(workspace, args.bookId);

            const summary = `✅ 分析完成！\n` +
              `📚 书籍ID: ${args.bookId}\n` +
              `📖 总章节数: ${args.totalChapters}\n` +
              `📝 已分析章节: ${chapters.length}\n` +
              `🏷️ 内容类型: ${analysis?.contentType || '未知'}\n` +
              `📁 数据已保存到 .dogear/ 目录`;

            return {
              content: [{
                type: 'text',
                text: summary,
              }],
            };
          } catch (error) {
            return {
              content: [{
                type: 'text',
                text: `❌ 完成标记失败: ${error}`,
              }],
              isError: true,
            };
          }
        }
      ),

      // ========================================
      // 工具 4: 读取已保存的分析结果（用于问答）
      // ========================================
      tool(
        'LoadAnalysis',
        '读取书籍的已有分析结果，用于理解书籍结构和类型',
        {
          bookId: z.string().describe('书籍ID'),
        },
        async (args, extra) => {
          try {
            const analysis = await workspaceService.loadAnalysisResult(workspace, args.bookId);

            if (!analysis) {
              return {
                content: [{
                  type: 'text',
                  text: `暂无分析结果`,
                }],
              };
            }

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
                text: `读取失败: ${error}`,
              }],
            };
          }
        }
      ),

      // ========================================
      // 工具 5: 读取章节摘要列表（用于问答时快速定位）
      // ========================================
      tool(
        'LoadChapterSummaries',
        '读取所有章节的分析摘要，用于快速定位相关内容\n' +
        '这个工具返回的数据量很小，适合先做初步判断',
        {
          bookId: z.string().describe('书籍ID'),
        },
        async (args, extra) => {
          try {
            const chapters = await workspaceService.loadChapterAnalyses(workspace, args.bookId);

            // 只返回摘要信息，不返回完整内容
            const summaries = chapters.map(ch => ({
              chapterNumber: ch.chapterNumber,
              title: ch.title,
              summary: ch.summary,
              // AI 可能添加的其他字段也返回
              ...Object.keys(ch).reduce((acc: any, key) => {
                if (key !== 'content' && key !== 'analyzedAt' && key !== 'chapterId' && key !== 'chapterNumber') {
                  acc[key] = (ch as any)[key];
                }
                return acc;
              }, {})
            }));

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

      // ========================================
      // 工具 6: 读取原始章节内容（按需加载详细内容）
      // ========================================
      tool(
        'ReadChapterContent',
        '读取指定章节的原始完整内容\n' +
        '注意：这个工具会返回大量文本，请谨慎使用',
        {
          bookId: z.string().describe('书籍ID'),
          chapterId: z.string().describe('章节ID'),
        },
        async (args, extra) => {
          try {
            // 从 chapters.json 获取章节内容（需要动态导入以避免循环依赖）
            const bookService = await import('../../services/book-service.js');
            const chapter = await bookService.getChapterFromFile(args.chapterId, args.bookId);

            if (!chapter) {
              return {
                content: [{
                  type: 'text',
                  text: `章节不存在: ${args.chapterId}`,
                }],
              };
            }

            return {
              content: [{
                type: 'text',
                text: `📖 ${chapter.title}\n\n` +
                      `内容：\n${chapter.content}`,
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

      // ========================================
      // 工具 7: 获取书籍信息（从数据库）
      // ========================================
      tool(
        'GetBookInfo',
        '从数据库获取书籍的基本信息（书名、文件类型、章节数等）',
        {
          bookId: z.string().describe('书籍ID'),
        },
        async (args, extra) => {
          try {
            const bookService = await import('../../services/book-service.js');
            const book = await bookService.getBookById(args.bookId);

            if (!book) {
              return {
                content: [{
                  type: 'text',
                  text: `书籍不存在: ${args.bookId}`,
                }],
              };
            }

            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  id: book.id,
                  title: book.title,
                  author: book.author,
                  fileType: book.file_type,
                  totalChapters: book.total_chapters,
                  totalCharacters: book.total_characters,
                  analysisStatus: book.analysis_status,
                }, null, 2),
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

      // ========================================
      // 工具 8: 获取章节列表（从数据库）
      // ========================================
      tool(
        'GetChapterList',
        '从数据库获取书籍的章节列表（不包含内容）',
        {
          bookId: z.string().describe('书籍ID'),
        },
        async (args, extra) => {
          try {
            const bookService = await import('../../services/book-service.js');
            const chapters = await bookService.getChapterMetadataFromFile(args.bookId);

            return {
              content: [{
                type: 'text',
                text: JSON.stringify(chapters.map(ch => ({
                  id: ch.id,
                  index: ch.chapter_index,
                  title: ch.title,
                  characterCount: ch.character_count
                })), null, 2),
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
    ],
  });
}

/**
 * 分析专用的 System Prompt
 */
export const BOOK_ANALYSIS_SYSTEM_PROMPT = `你是一个智能书籍分析助手。

## 你的任务

分析用户提供的书籍内容，并将分析结果通过工具保存到文件系统。

## 可用工具

1. **Read** - 读取书籍文件内容（内置工具，可以直接使用 Read 工具读取文件系统中的文件）
2. **GetBookInfo** - 从数据库获取书籍基本信息
3. **GetChapterList** - 获取章节列表
4. **SaveAnalysis** - 保存全书分析结果（任意结构）
5. **SaveChapterAnalysis** - 保存章节分析结果（任意结构）
6. **CompleteAnalysis** - 标记分析完成
7. **LoadAnalysis** - 读取已有的分析结果
8. **LoadChapterSummaries** - 读取章节摘要列表
9. **ReadChapterContent** - 读取章节原始内容

## 分析流程

### 第一步：判断内容类型

首先判断你正在分析的内容类型：
- **fiction**（小说/故事）：有角色、情节、对话
- **non-fiction**（非虚构/技术）：讲解概念、知识、方法
- **article**（文章）：短篇、单一主题
- **reference**（参考书）：API 文档、教程、说明书
- **other**（其他）

### 第二步：根据类型决定分析结构

**对于小说/故事（fiction）**：
\`\`\`json
{
  "contentType": "fiction",
  "title": "书名",
  "author": "作者",
  "summary": "全书摘要（200字以内）",
  "themes": ["主题1", "主题2"],
  "characters": [
    {"name": "主角", "role": "protagonist", "description": "描述"}
  ],
  "keyEvents": ["事件1", "事件2"]
}
\`\`\`

**对于技术/理论书籍（non-fiction）**：
\`\`\`json
{
  "contentType": "non-fiction",
  "title": "书名",
  "author": "作者",
  "summary": "全书摘要（200字以内）",
  "topics": ["主题1", "主题2"],
  "keyConcepts": ["概念1", "概念2"],
  "prerequisites": ["前置知识"],
  "targetAudience": "目标读者"
}
\`\`\`

**对于文章（article）**：
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

对每个章节，根据内容类型保存相应的分析信息：
- 章节摘要（100字以内）
- 关键点（3-5个）
- 其他相关字段（如人物、概念等）

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
1. [使用 GetBookInfo 获取书籍信息]
2. [使用 GetChapterList 获取章节列表]
3. [使用 Read 工具读取书籍文件]
4. [判断类型，调用 SaveAnalysis 保存全书分析]
5. [逐章调用 SaveChapterAnalysis]
6. [调用 CompleteAnalysis]
7. 回复用户："分析完成！这是一本XX类型的书籍，共XX章..."
`;

/**
 * 问答专用的 System Prompt
 */
export function getQASystemPrompt(bookInfo: any): string {
  return `你是一个书籍阅读助手，正在帮助用户回答关于《${bookInfo.title || ''}》的问题。

## 可用工具

1. **LoadAnalysis** - 读取全书分析结果
2. **LoadChapterSummaries** - 读取所有章节摘要（快速，低消耗）
3. **ReadChapterContent** - 读取章节完整内容（详细，高消耗）

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

请基于以上信息和工具来回答用户的问题。`;
}
