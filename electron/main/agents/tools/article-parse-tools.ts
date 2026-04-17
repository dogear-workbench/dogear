/**
 * 文章解析 MCP Server 工具
 *
 * 供 Agent Worker 中的 PARSE_ARTICLE 任务使用，提供：
 * - 读取原始 HTML、当前已解析内容、解析规则
 * - 覆盖保存解析结果（只更新 meta.json + content.md，保留 raw.html）
 * - 更新 Skill 规则文件（含路径安全校验，防越界写）
 *
 * Phase 1：工具骨架定义，Phase 2 中 Worker handler 接入。
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { safeJsonWrite, safeFileWrite } from '../../services/safe-json.js';
import { registerTools } from './tool-registry.js';

// 注册工具元数据
registerTools([
  { name: 'ReadRawHtml',       description: '读取文章的原始 HTML（最多 50KB，截断防止 token 超限）',  server: 'dogear-article-parse', category: 'article' },
  { name: 'ReadCurrentContent', description: '读取当前已解析的文章内容（meta.json + content.md）',   server: 'dogear-article-parse', category: 'article' },
  { name: 'ReadParserRules',   description: '读取解析规则文件（通用规则 + 匹配的平台规则）',           server: 'dogear-article-parse', category: 'article' },
  { name: 'SaveParsedArticle', description: '覆盖保存 AI 重新解析的文章结果（不修改 raw.html）',      server: 'dogear-article-parse', category: 'article' },
  { name: 'UpdateParserRule',  description: '更新 Skill 规则文件，将新发现的解析经验写回',            server: 'dogear-article-parse', category: 'article' },
]);

/** 安全校验：目标路径必须在允许的根目录之内 */
function assertPathSafe(targetPath: string, allowedRoot: string): void {
  const resolved = path.resolve(targetPath);
  const root = path.resolve(allowedRoot);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`路径安全错误：${targetPath} 超出允许范围 ${allowedRoot}`);
  }
}

/**
 * 创建文章解析专用 MCP Server
 * 工具通过调用时的入参定位文件，无需工厂函数接受闭包参数。
 */
export function createArticleParseMcpServer() {
  return createSdkMcpServer({
    name: 'dogear-article-parse',
    version: '1.0.0',
    tools: [
      // ===== 工具 1: ReadRawHtml =====
      tool(
        'ReadRawHtml',
        '读取文章的原始 HTML（最多 50KB，截断防止 token 超限）\n' +
        '供 AI 在固定解析失败或质量不达标时，重新分析 HTML 结构，找到正文内容。',
        {
          articleDir: z.string().describe('文章目录的绝对路径（payload.articleDir）'),
          maxBytes: z.number().default(51200).describe('最多读取的字节数，默认 50KB'),
        },
        async (args) => {
          try {
            const htmlPath = path.join(args.articleDir, 'raw.html');
            const stat = await fs.stat(htmlPath).catch(() => null);
            if (!stat) {
              return { content: [{ type: 'text' as const, text: '❌ raw.html 不存在，无法重新解析。' }], isError: true };
            }
            const buf = Buffer.alloc(args.maxBytes);
            const fh = await fs.open(htmlPath, 'r');
            const { bytesRead } = await fh.read(buf, 0, args.maxBytes, 0);
            await fh.close();
            const html = buf.slice(0, bytesRead).toString('utf-8');
            const truncated = bytesRead < stat.size ? `\n\n[已截断，原始大小 ${stat.size} 字节，只读前 ${args.maxBytes} 字节]` : '';
            return { content: [{ type: 'text' as const, text: html + truncated }] };
          } catch (error) {
            return { content: [{ type: 'text' as const, text: `❌ 读取 raw.html 失败: ${error}` }], isError: true };
          }
        }
      ),

      // ===== 工具 2: ReadCurrentContent =====
      tool(
        'ReadCurrentContent',
        '读取当前已解析的文章内容（meta.json + content.md 合并展示）\n' +
        '用于质量检查：判断标题、正文长度、内容完整性等是否达标。',
        {
          articleDir: z.string().describe('文章目录的绝对路径（payload.articleDir）'),
        },
        async (args) => {
          try {
            const metaRaw = await fs.readFile(path.join(args.articleDir, 'meta.json'), 'utf-8').catch(() => '{}');
            const contentRaw = await fs.readFile(path.join(args.articleDir, 'content.md'), 'utf-8').catch(() => '');
            const meta = JSON.parse(metaRaw);
            return {
              content: [{
                type: 'text' as const,
                text: `## 元数据\n\n\`\`\`json\n${JSON.stringify(meta, null, 2)}\n\`\`\`\n\n## 正文（Markdown）\n\n${contentRaw}`,
              }],
            };
          } catch (error) {
            return { content: [{ type: 'text' as const, text: `❌ 读取文章内容失败: ${error}` }], isError: true };
          }
        }
      ),

      // ===== 工具 3: ReadParserRules =====
      tool(
        'ReadParserRules',
        '读取解析规则文件（通用规则 + 匹配的平台规则）\n' +
        '在开始解析前调用，获取已积累的解析经验和策略。',
        {
          skillsDir: z.string().describe('Skill 规则目录的绝对路径（payload.skillsDir）'),
          platform: z.string().optional().describe('平台名称（如 "wechat"），不传则只返回通用规则'),
        },
        async (args) => {
          try {
            const commonPath = path.join(args.skillsDir, 'common.md');
            const commonContent = await fs.readFile(commonPath, 'utf-8').catch(() => '（通用规则文件不存在）');
            let result = `# 通用解析规则\n\n${commonContent}`;

            if (args.platform) {
              const platformPath = path.join(args.skillsDir, 'platforms', `${args.platform}.md`);
              const platformContent = await fs.readFile(platformPath, 'utf-8').catch(() => null);
              if (platformContent) {
                result += `\n\n---\n\n# ${args.platform} 平台规则\n\n${platformContent}`;
              } else {
                result += `\n\n---\n\n# ${args.platform} 平台规则\n\n（暂无此平台的专项规则，请基于通用规则解析并考虑调用 UpdateParserRule 新增规则）`;
              }
            }

            return { content: [{ type: 'text' as const, text: result }] };
          } catch (error) {
            return { content: [{ type: 'text' as const, text: `❌ 读取规则文件失败: ${error}` }], isError: true };
          }
        }
      ),

      // ===== 工具 4: SaveParsedArticle =====
      tool(
        'SaveParsedArticle',
        '覆盖保存 AI 重新解析的文章结果\n' +
        '只更新 meta.json 和 content.md，保留原始 raw.html 不变。\n' +
        '调用前请确认内容质量达标（标题非空、正文 > 200 字符）。',
        {
          articleDir:    z.string().describe('文章目录的绝对路径（payload.articleDir）'),
          title:         z.string().describe('文章标题'),
          content:       z.string().describe('文章正文（Markdown 格式）'),
          author:        z.string().optional().describe('作者'),
          siteName:      z.string().optional().describe('站点名称'),
          excerpt:       z.string().optional().describe('摘要（不超过 200 字符）'),
        },
        async (args) => {
          try {
            // 读取现有 meta.json，保留原有字段（id, url, fetchedAt, language 等）
            const metaPath = path.join(args.articleDir, 'meta.json');
            const metaRaw = await fs.readFile(metaPath, 'utf-8').catch(() => '{}');
            const existingMeta = JSON.parse(metaRaw);

            const wordCount = args.content.replace(/\s+/g, '').length;
            const updatedMeta = {
              ...existingMeta,
              title:     args.title,
              author:    args.author   ?? existingMeta.author   ?? null,
              siteName:  args.siteName ?? existingMeta.siteName ?? null,
              excerpt:   args.excerpt  ?? existingMeta.excerpt  ?? null,
              wordCount,
            };

            await safeJsonWrite(metaPath, updatedMeta);
            await safeFileWrite(path.join(args.articleDir, 'content.md'), args.content);

            return {
              content: [{
                type: 'text' as const,
                text: `✅ 已保存解析结果\n标题：${args.title}\n字数：${wordCount}\n路径：${args.articleDir}`,
              }],
            };
          } catch (error) {
            return { content: [{ type: 'text' as const, text: `❌ 保存失败: ${error}` }], isError: true };
          }
        }
      ),

      // ===== 工具 5: UpdateParserRule =====
      tool(
        'UpdateParserRule',
        '更新 Skill 规则文件，将新发现的解析经验写回\n' +
        '只在发现了通用规则或平台规则文件中未覆盖的新模式时调用。\n' +
        '更新时精简合并而非直接追加，保持规则文件简洁（common.md ≤ 10KB，平台规则 ≤ 5KB）。',
        {
          skillsDir: z.string().describe('Skill 规则目录的绝对路径（payload.skillsDir）'),
          type:      z.enum(['common', 'platform']).describe('"common" 更新通用规则，"platform" 更新平台规则'),
          platform:  z.string().optional().describe('平台名称（type="platform" 时必填，如 "wechat"）'),
          content:   z.string().describe('规则文件的完整新内容（全量替换，非追加）'),
        },
        async (args) => {
          try {
            let targetPath: string;
            if (args.type === 'common') {
              targetPath = path.join(args.skillsDir, 'common.md');
              assertPathSafe(targetPath, args.skillsDir);
            } else {
              if (!args.platform) {
                return { content: [{ type: 'text' as const, text: '❌ type="platform" 时必须提供 platform 参数' }], isError: true };
              }
              // platform 名称只允许字母数字和连字符，防止路径注入
              if (!/^[a-zA-Z0-9\-_]+$/.test(args.platform)) {
                return { content: [{ type: 'text' as const, text: `❌ platform 名称不合法：${args.platform}` }], isError: true };
              }
              targetPath = path.join(args.skillsDir, 'platforms', `${args.platform}.md`);
              assertPathSafe(targetPath, args.skillsDir);
              await fs.mkdir(path.dirname(targetPath), { recursive: true });
            }

            await safeFileWrite(targetPath, args.content);

            return {
              content: [{
                type: 'text' as const,
                text: `✅ 规则文件已更新：${path.relative(args.skillsDir, targetPath)}\n大小：${Buffer.byteLength(args.content, 'utf-8')} 字节`,
              }],
            };
          } catch (error) {
            return { content: [{ type: 'text' as const, text: `❌ 更新规则失败: ${error}` }], isError: true };
          }
        }
      ),
    ],
  });
}
