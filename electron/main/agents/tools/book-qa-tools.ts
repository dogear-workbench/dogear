/**
 * 书籍问答 MCP Server 工具
 *
 * 这些工具允许 Agent 基于原文证据回答用户问题
 * 实现严格的书籍问答功能
 *
 * 设计原则:
 * - 使用 createSdkMcpServer 创建自定义工具
 * - 先搜索摘要（快速），再按需搜索全文
 * - 所有回答都必须基于原文，标注引用来源
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import * as workspaceService from '../../services/workspace-service.js';

/**
 * 中文关键词提取（简单版）
 * 使用正则表达式提取中文词汇和英文单词
 */
function extractKeywords(text: string): string[] {
  // 移除标点符号，保留中文、英文、数字
  const cleaned = text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, ' ');

  // 提取中文词汇（2个或更多汉字）和英文单词
  const words = cleaned.match(/[\u4e00-\u9fa5]{2,}|[a-zA-Z0-9]+/g) || [];

  // 去重并返回
  return [...new Set(words)];
}

/**
 * 计算文本相关度分数
 * 基于关键词出现频率和位置加权
 */
function calculateRelevance(
  text: string,
  keywords: string[],
  title: string = ''
): number {
  let score = 0;
  const lowerText = text.toLowerCase();
  const lowerTitle = title.toLowerCase();

  for (const keyword of keywords) {
    const lowerKeyword = keyword.toLowerCase();

    // 标题中的关键词权重更高
    const titleCount = (lowerTitle.match(new RegExp(lowerKeyword, 'g')) || []).length;
    score += titleCount * 50; // 标题匹配加权

    // 正文中的关键词
    const count = (lowerText.match(new RegExp(lowerKeyword, 'g')) || []).length;
    score += count * 10; // 正文匹配基础分
  }

  return score;
}

/**
 * 搜索结果项
 */
interface SearchResult {
  chapterId?: string;
  chapterNumber?: number;
  title: string;
  summary?: string;
  score: number;
  excerpt?: string;
}

/**
 * 在章节摘要中搜索
 */
async function searchInSummaries(
  workspacePath: string,
  bookId: string,
  keywords: string[],
  maxResults: number
): Promise<SearchResult[]> {
  const workspace = {
    id: 'current',
    name: '当前工作区',
    path: workspacePath,
    is_default: 1,
    created_at: Date.now()
  };

  try {
    const chapters = await workspaceService.loadChapterAnalyses(workspace, bookId);

    // 计算每个章节的相关度
    const results: SearchResult[] = chapters.map(ch => {
      const textToSearch = `${ch.title} ${ch.summary || ''} ${JSON.stringify(ch)}`;
      const score = calculateRelevance(textToSearch, keywords, ch.title);

      return {
        chapterId: ch.chapterId,
        chapterNumber: ch.chapterNumber,
        title: ch.title,
        summary: ch.summary,
        score,
      };
    });

    // 过滤掉零分结果并排序
    return results
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);
  } catch {
    return [];
  }
}

/**
 * 在章节全文中搜索
 */
async function searchInFullContent(
  workspacePath: string,
  bookId: string,
  keywords: string[],
  maxResults: number
): Promise<SearchResult[]> {
  try {
    const { dbChapters } = await import('../../database/index.js');
    const chapters = dbChapters.getChapterMetadata(bookId);

    const results: SearchResult[] = [];

    for (const chapter of chapters) {
      // 获取完整章节内容
      const fullChapter = dbChapters.getById(chapter.id);
      if (!fullChapter) continue;

      const textToSearch = `${chapter.title} ${fullChapter.content}`;
      const score = calculateRelevance(textToSearch, keywords, chapter.title);

      if (score > 0) {
        // 提取包含关键词的片段（最多 200 字）
        let excerpt = '';
        const lowerContent = fullChapter.content.toLowerCase();

        for (const keyword of keywords) {
          const idx = lowerContent.indexOf(keyword.toLowerCase());
          if (idx !== -1) {
            const start = Math.max(0, idx - 50);
            const end = Math.min(fullChapter.content.length, idx + keyword.length + 50);
            excerpt = fullChapter.content.substring(start, end) + '...';
            break;
          }
        }

        results.push({
          chapterId: chapter.id,
          chapterNumber: chapter.chapter_index,
          title: chapter.title,
          score,
          excerpt,
        });
      }
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, maxResults);
  } catch {
    return [];
  }
}

/**
 * 创建书籍问答专用 MCP Server
 * @param workspacePath - 工作区路径
 * @param bookId - 书籍 ID（当前要查询的书籍）
 * @returns MCP Server 配置
 */
export function createBookQATools(workspacePath: string, bookId: string) {
  return createSdkMcpServer({
    name: 'dogear-book-qa',
    version: '1.0.0',
    tools: [
      // ========================================
      // 工具 1: 搜索书籍内容（核心）
      // ========================================
      tool(
        'SearchBookContent',
        '搜索书籍中与用户问题相关的内容\n' +
        '工作流程：\n' +
        '1. 先搜索章节摘要（快速、低 token）\n' +
        '2. 如果摘要不够，再搜索章节全文\n' +
        '3. 返回按相关度排序的结果，包含章节信息和相关度分数\n\n' +
        '使用场景：回答任何关于书籍内容的问题时，首先调用此工具。\n\n' +
        '注意：bookId 参数可选，如果不提供则使用当前会话关联的书籍。',
        {
          bookId: z.string().optional().describe('书籍ID（可选，不提供则使用当前书籍）'),
          query: z.string().describe('搜索查询（提取问题的关键概念，多个关键词用空格分隔）'),
          searchMode: z.enum(['summary', 'full', 'auto'])
            .default('auto')
            .describe('搜索模式：summary=摘要搜索（快）, full=全文搜索（详细）, auto=自动选择'),
          maxResults: z.number()
            .default(5)
            .describe('最大返回结果数'),
        },
        async (args, extra) => {
          try {
            // 使用闭包中的 bookId，如果 args 中没有提供的话
            const targetBookId = args.bookId ?? bookId;

            const keywords = extractKeywords(args.query);

            if (keywords.length === 0) {
              return {
                content: [{
                  type: 'text',
                  text: '⚠️ 无法从查询中提取有效关键词，请提供更具体的搜索词。',
                }],
              };
            }

            let results: SearchResult[] = [];

            // 决定搜索模式
            const mode = args.searchMode === 'auto' ? 'summary' : args.searchMode;

            if (mode === 'summary') {
              results = await searchInSummaries(workspacePath, targetBookId, keywords, args.maxResults);

              // 如果摘要搜索结果很少，自动进行全文搜索
              if (results.length === 0 || results.every(r => r.score < 20)) {
                const fullResults = await searchInFullContent(workspacePath, targetBookId, keywords, args.maxResults);
                // 合并结果，全文结果权重稍高
                results = [...results, ...fullResults.map(r => ({ ...r, score: r.score * 1.2 }))]
                  .sort((a, b) => b.score - a.score)
                  .slice(0, args.maxResults);
              }
            } else {
              results = await searchInFullContent(workspacePath, targetBookId, keywords, args.maxResults);
            }

            if (results.length === 0) {
              return {
                content: [{
                  type: 'text',
                  text: `🔍 搜索结果：未找到与"${args.query}"相关的内容。\n\n` +
                        `使用的关键词：${keywords.join(', ')}\n\n` +
                        `建议：\n` +
                        `1. 尝试使用不同的关键词\n` +
                        `2. 使用 RequestMoreInfo 工具请求用户提供更多信息`,
                }],
              };
            }

            // 格式化结果
            const formattedResults = results.map((r, i) => {
              let text = `\n${i + 1}. [${r.title}]`;
              if (r.chapterNumber !== undefined) {
                text += ` (第${r.chapterNumber}章)`;
              }
              text += `\n   相关度分数: ${Math.round(r.score)}`;
              if (r.summary) {
                text += `\n   摘要: ${r.summary}`;
              }
              if (r.excerpt) {
                text += `\n   片段: ${r.excerpt}`;
              }
              if (r.chapterId) {
                text += `\n   章节ID: ${r.chapterId}`;
              }
              return text;
            }).join('\n');

            return {
              content: [{
                type: 'text',
                text: `🔍 搜索结果（找到 ${results.length} 条相关内容）：${formattedResults}\n\n` +
                      `提示：使用 GetCitationContext 工具可以获取章节的完整内容和上下文。`,
              }],
            };
          } catch (error) {
            return {
              content: [{
                type: 'text',
                text: `❌ 搜索失败: ${error}`,
              }],
              isError: true,
            };
          }
        }
      ),

      // ========================================
      // 工具 2: 获取引用上下文
      // ========================================
      tool(
        'GetCitationContext',
        '获取指定位置的原文内容和上下文\n' +
        '用于在回答时提供准确的引用和更详细的上下文信息。',
        {
          bookId: z.string().describe('书籍ID'),
          chapterId: z.string().describe('章节ID（从 SearchBookContent 结果中获取）'),
          position: z.object({
            start: z.number().describe('起始字符位置'),
            end: z.number().describe('结束字符位置'),
          }).optional().describe('可选的字符位置范围'),
          contextLines: z.number()
            .default(3)
            .describe('前后文行数（用于提取上下文）'),
        },
        async (args, extra) => {
          try {
            const { dbChapters } = await import('../../database/index.js');
            const chapter = dbChapters.getById(args.chapterId);

            if (!chapter) {
              return {
                content: [{
                  type: 'text',
                  text: `❌ 章节不存在: ${args.chapterId}`,
                }],
              };
            }

            let content = chapter.content;
            let positionInfo = '';

            // 如果指定了位置范围，提取对应片段
            if (args.position) {
              const { start, end } = args.position;
              if (start >= 0 && end <= content.length && start < end) {
                const beforeStart = Math.max(0, start - 100);
                const afterEnd = Math.min(content.length, end + 100);

                const before = content.substring(beforeStart, start);
                const target = content.substring(start, end);
                const after = content.substring(end, afterEnd);

                positionInfo = `\n位置范围: ${start} - ${end}`;

                content = `...${before}[${target}]${after}...`;
              }
            }

            // 返回章节内容和引用信息
            return {
              content: [{
                type: 'text',
                text: `📖 [${chapter.title}] 引用内容：\n\n` +
                      `${positionInfo}\n` +
                      `章节ID: ${chapter.id}\n` +
                      `章节序号: ${chapter.chapter_index}\n` +
                      `字符数: ${chapter.character_count}\n\n` +
                      `--- 内容 ---\n\n${content}`,
              }],
            };
          } catch (error) {
            return {
              content: [{
                type: 'text',
                text: `❌ 获取引用失败: ${error}`,
              }],
              isError: true,
            };
          }
        }
      ),

      // ========================================
      // 工具 3: 请求更多信息
      // ========================================
      tool(
        'RequestMoreInfo',
        '当搜索后仍无法找到相关内容时，调用此工具请求用户提供更多信息\n' +
        '**重要**：不要编造答案，必须先搜索，找不到时再调用此工具。',
        {
          reason: z.string().describe('为什么找不到（简短说明）'),
          searchedKeywords: z.array(z.string()).describe('已搜索的关键词列表'),
          suggestions: z.array(z.string()).describe('建议用户提供的信息（如具体章节、不同关键词等）'),
        },
        async (args, extra) => {
          const suggestionsText = args.suggestions.map((s, i) => `${i + 1}. ${s}`).join('\n');

          return {
            content: [{
              type: 'text',
              text: `🤔 需要更多信息\n\n` +
                    `原因：${args.reason}\n\n` +
                    `已搜索的关键词：\n${args.searchedKeywords.map(k => `- ${k}`).join('\n')}\n\n` +
                    `建议您提供：\n${suggestionsText}`,
            }],
          };
        }
      ),

      // ========================================
      // 工具 4: 获取书籍信息（辅助工具）
      // ========================================
      tool(
        'GetBookInfo',
        '从数据库获取书籍的基本信息（书名、作者、文件类型等）\n' +
        '用于了解书籍概况，帮助理解问题背景。',
        {
          bookId: z.string().describe('书籍ID'),
        },
        async (args, extra) => {
          try {
            const { dbBooks } = await import('../../database/index.js');
            const book = dbBooks.getById(args.bookId);

            if (!book) {
              return {
                content: [{
                  type: 'text',
                  text: `❌ 书籍不存在: ${args.bookId}`,
                }],
              };
            }

            return {
              content: [{
                type: 'text',
                text: `📚 书籍信息：\n\n` +
                      `书名: ${book.title}\n` +
                      `作者: ${book.author || '未知'}\n` +
                      `文件类型: ${book.file_type}\n` +
                      `总章节数: ${book.total_chapters}\n` +
                      `总字符数: ${book.total_characters}\n` +
                      `分析状态: ${book.analysis_status || 'none'}`,
              }],
            };
          } catch (error) {
            return {
              content: [{
                type: 'text',
                text: `❌ 读取失败: ${error}`,
              }],
            };
          }
        }
      ),
    ],
  });
}

/**
 * 书籍问答专用的 System Prompt（可选）
 * 用于在创建会话时提供额外的上下文
 */
export const BOOK_QA_SYSTEM_PROMPT = `你是一个书籍阅读助手，正在帮助用户基于原文回答问题。

## 核心原则

1. **严格基于原文**：所有答案必须来自书籍原文
2. **标注引用来源**：每个回答都要标注章节
3. **诚实面对未知**：找不到时明确说明，不要编造

## 可用工具

1. **GetBookInfo** - 获取书籍基本信息
2. **SearchBookContent** - 搜索书籍内容（核心工具）
3. **GetCitationContext** - 获取详细的引用和上下文
4. **RequestMoreInfo** - 请求用户提供更多信息

## 工作流程

1. 收到问题后，首先调用 SearchBookContent 搜索相关内容
2. 如果找到结果，使用 GetCitationContext 获取详细内容
3. 基于原文回答，并标注引用来源 [章节标题]
4. 如果找不到，调用 RequestMoreInfo 请求更多信息
`;
