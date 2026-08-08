/**
 * 文章阅读 MCP Server 工具
 *
 * 提供 ReadArticle 和 ListArticles 工具，允许 Agent 按需读取工作区中已保存的文章内容。
 * 用于「引用文章」功能：用户在对话中引用文章后，Agent 通过此工具获取文章的 Markdown 正文。
 */

import { z } from 'zod';
import * as articleService from '../../services/article-service.js';
import { registerToolGroup } from './tool-registry.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';

/**
 * 创建文章阅读工具中立定义（ToolDef[]）
 * @param workspacePath - 工作区路径
 * @returns ToolDef 数组
 */
export function createArticleToolDefs(workspacePath: string): ToolDef[] {
  return [
    // ========================================
    // 工具 1: 读取文章内容
    // ========================================
    defineTool(
      'ReadArticle',
      '读取文章正文和元数据',
      '读取指定文章的完整 Markdown 内容和元数据。\n' +
      '返回的内容包括标题、作者、来源、原始 URL 和 Markdown 正文。',
      z.object({
        articleId: z.string().describe('文章 ID（UUID 格式，从引用信息或 ListArticles 结果中获取）'),
      }),
      async (args) => {
        try {
          const article = await articleService.getArticle(workspacePath, args.articleId);

          return {
            content: [{
              type: 'text' as const,
              text: `📄 文章信息\n` +
                    `标题: ${article.title}\n` +
                    `作者: ${article.author || '未知'}\n` +
                    `来源: ${article.siteName || '未知'}\n` +
                    `URL: ${article.url}\n` +
                    `字数: ${article.wordCount}\n` +
                    `抓取时间: ${new Date(article.fetchedAt).toLocaleString('zh-CN')}\n\n` +
                    `--- 正文 ---\n\n${article.content}`,
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: 'text' as const,
              text: `读取文章失败: ${error}`,
            }],
            isError: true,
          };
        }
      }
    ),

    // ========================================
    // 工具 2: 列出工作区所有文章
    // ========================================
    defineTool(
      'ListArticles',
      '列出工作区所有文章',
      '列出当前工作区中所有已保存的文章（仅元数据，不含正文）。',
      z.object({}),
      async () => {
        try {
          const articles = await articleService.listArticles(workspacePath);

          if (articles.length === 0) {
            return {
              content: [{ type: 'text' as const, text: '当前工作区没有已保存的文章。' }],
            };
          }

          const list = articles.map((a, i) =>
            `${i + 1}. 《${a.title}》\n` +
            `   ID: ${a.id}\n` +
            `   来源: ${a.siteName || '未知'} | 作者: ${a.author || '未知'}\n` +
            `   字数: ${a.wordCount} | 时间: ${new Date(a.fetchedAt).toLocaleString('zh-CN')}`
          ).join('\n\n');

          return {
            content: [{
              type: 'text' as const,
              text: `📰 工作区文章列表（共 ${articles.length} 篇）：\n\n${list}`,
            }],
          };
        } catch (error) {
          return {
            content: [{
              type: 'text' as const,
              text: `获取文章列表失败: ${error}`,
            }],
            isError: true,
          };
        }
      }
    ),
  ];
}

registerToolGroup({
  server: 'dogear-article',
  label: '文章管理',
  create: createArticleToolDefs,
  placeholder: [''],
});
