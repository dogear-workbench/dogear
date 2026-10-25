/**
 * 文章解析工具（dogear-article server）
 *
 * 面向主会话/子会话 Agent 的文章库工具面：URL 入库（服务端解析管线）。
 * 文章库即工作区文件（{workspacePath}/dogear/articles/ 一文一 md），读取检索直接用通用 Read/Grep/Glob。
 */

import path from 'path';
import { z } from 'zod';
import * as articleService from '../../services/article-service.js';
import { ARTICLES_DIR, getArticlesRoot } from '../../services/article/types.js';
import { registerToolGroup } from './tool-registry.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';

/** 规整 folderPath：统一分隔符并剔除空段/越界段，支持任意层级；返回 null 表示规整后为空 */
function sanitizeFolderPath(input: string): string[] | null {
  const parts = input
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== '.' && s !== '..');
  return parts.length > 0 ? parts : null;
}

function formatMetaLine(a: {
  siteName: string | null;
  author: string | null;
  wordCount: number;
  fetchedAt: number;
}): string {
  return `来源: ${a.siteName || '未知'} | 作者: ${a.author || '未知'} | 字数: ${a.wordCount} | 时间: ${new Date(a.fetchedAt).toLocaleString('zh-CN')}`;
}

/**
 * 创建文章解析工具中立定义（ToolDef[]）
 * @param workspaceId - 工作区 ID（事件/解析历史归属）
 * @param workspacePath - 工作区磁盘路径（文章库落 {workspacePath}/dogear/articles/）
 * @returns ToolDef 数组
 */
export function createArticleToolDefs(workspaceId: string, workspacePath: string): ToolDef[] {
  return [
    defineTool(
      'dogear__SaveArticle',
      '抓取网络文章并保存到工作区文章库',
      '把 URL 指向的网络文章抓取并解析后保存到工作区文章库 dogear/articles/（平台脚本 → Readability → AI 兜底管线，与文件树手动导入同一链路，不依赖浏览器扩展）。\n' +
      '每篇文章是一个 Markdown 文件（frontmatter 承载元数据 + 正文），返回落盘路径；读取正文直接用 Read 工具读该路径，检索用 Grep/Glob。静态解析失败时会先落一个占位文件（标题为 "AI 解析中..."）并由后台 AI 继续解析；需立即拿到全文时可用返回的文件路径配合深度解析工具集（dogear__ReadRawHtml / dogear__RunPlatformScript）现场解析。\n' +
      '重复 URL 不会新建条目，直接返回库中已有文章的路径。',
      z.object({
        url: z.string().describe('文章 URL（http/https）'),
        folderPath: z.string().optional().describe('可选：文章库内的目标文件夹路径（支持多层，如 "技术/AI"，各段不存在时自动创建）；缺省存到文章库根目录。AI 解析中的占位文件不应用文件夹'),
      }),
      async (args) => {
        try {
          if (!workspacePath) {
            return {
              content: [{ type: 'text' as const, text: '当前会话未绑定工作区，无法保存文章。' }],
              isError: true,
            };
          }
          let parsedUrl: URL;
          try {
            parsedUrl = new URL(args.url);
          } catch {
            return { content: [{ type: 'text' as const, text: `无效 URL: ${args.url}` }], isError: true };
          }
          if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
            return {
              content: [{ type: 'text' as const, text: `仅支持 http/https URL: ${args.url}` }],
              isError: true,
            };
          }
          let folder: string | undefined;
          if (args.folderPath !== undefined) {
            const parts = sanitizeFolderPath(args.folderPath);
            if (!parts) {
              return {
                content: [{ type: 'text' as const, text: `folderPath 无效: "${args.folderPath}"，规整后为空` }],
                isError: true,
              };
            }
            folder = parts.join('/');
          }

          const result = await articleService.runParseArticlePipeline({
            workspaceId,
            workspacePath,
            url: args.url,
            source: 'agent',
            folder,
          });
          if (!result.ok || !result.article) {
            return {
              content: [{ type: 'text' as const, text: `保存文章失败: ${result.error ?? '未知错误'}` }],
              isError: true,
            };
          }

          const meta = result.article;
          const detail = result.detail;
          const lines: string[] = [];
          const articlePath = result.articlePath ?? '';
          const articleAbsPath = articlePath ? path.join(getArticlesRoot(workspacePath), articlePath.slice(ARTICLES_DIR.length + 1)) : '';

          if (detail?.duplicated) {
            lines.push(`ℹ️ 库中已有此文，返回已有文章。`);
            lines.push(`标题: ${meta.title}`);
            lines.push(`文件路径: ${articleAbsPath}`);
            lines.push(formatMetaLine(meta));
            if (meta.parseStatus === 'ai_parsing') {
              lines.push('后台 AI 解析中，可稍后重新读取该路径获取成品。');
            } else {
              lines.push('用 Read 工具读取该路径获取正文。');
            }
            if (args.folderPath !== undefined) {
              lines.push('注意：文章已存在，保持原位置，folderPath 未应用。');
            }
            return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
          }

          if (meta.parseStatus === 'ai_parsing') {
            lines.push(`⏳ 已创建占位文件，静态解析失败，后台 AI 解析中。`);
            if (detail?.failureReason) lines.push(`静态解析失败原因: ${detail.failureReason}`);
            lines.push(`文件路径: ${articleAbsPath}`);
            if (args.folderPath !== undefined) {
              lines.push('注意：AI 解析中的占位文件保留在文章库根目录，folderPath 未应用。');
            }
            lines.push('解析完成后可稍后重新读取该路径获取成品；需立即拿到全文时，可用文件路径配合深度解析工具集（dogear__ReadRawHtml / dogear__RunPlatformScript）现场解析。');
            return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
          }

          lines.push(`✅ 文章已入库`);
          lines.push(`文件路径: ${articleAbsPath}`);
          lines.push(`标题: ${meta.title}`);
          if (detail) {
            lines.push(
              detail.layer === 'script'
                ? `解析方式: 平台脚本（${detail.scriptName}）`
                : '解析方式: Readability',
            );
          }
          lines.push(formatMetaLine(meta));
          lines.push('用 Read 工具读取该路径获取正文。');

          return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
        } catch (error) {
          return {
            content: [{ type: 'text' as const, text: `保存文章失败: ${error}` }],
            isError: true,
          };
        }
      }
    ),
  ];
}

registerToolGroup({
  server: 'dogear-article',
  label: '文章解析',
  create: createArticleToolDefs,
  placeholder: ['', ''],
});
