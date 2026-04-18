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
  { name: 'ReadRawHtml',          description: '读取文章的原始 HTML（最多 50KB，截断防止 token 超限）',  server: 'dogear-article-parse', category: 'article' },
  { name: 'ReadCurrentContent',   description: '读取当前已解析的文章内容（meta.json + content.md）',   server: 'dogear-article-parse', category: 'article' },
  { name: 'ReadParserRules',      description: '读取解析规则文件（通用规则 + 匹配的平台规则）',           server: 'dogear-article-parse', category: 'article' },
  { name: 'SaveParsedArticle',    description: '覆盖保存 AI 重新解析的文章结果（不修改 raw.html）',      server: 'dogear-article-parse', category: 'article' },
  { name: 'ListPlatformScripts',  description: '列出所有已有的平台脚本（*.py 文件）',                   server: 'dogear-article-parse', category: 'article' },
  { name: 'ReadPlatformScript',   description: '读取单个平台脚本的源码',                                server: 'dogear-article-parse', category: 'article' },
  { name: 'RunPlatformScript',    description: '在 Python 沙箱里试跑脚本（支持候选源码，不落盘）',       server: 'dogear-article-parse', category: 'article' },
  { name: 'UpdatePlatformScript', description: '落盘平台脚本文件（仅在 RunPlatformScript 成功后调用）',  server: 'dogear-article-parse', category: 'article' },
  { name: 'ReadParseHistory',     description: '读取最近 N 条解析历史',                                 server: 'dogear-article-parse', category: 'article' },
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

      // ===== 工具 5: ListPlatformScripts =====
      tool(
        'ListPlatformScripts',
        '列出所有已有的平台脚本（*.py 文件）',
        {
          skillsDir: z.string().describe('Skill 规则目录的绝对路径'),
        },
        async (args) => {
          try {
            const dir = path.join(args.skillsDir, 'platforms');
            assertPathSafe(dir, args.skillsDir);
            const entries = await fs.readdir(dir).catch(() => [] as string[]);
            const scripts = entries
              .filter((n) => n.endsWith('.py'))
              .map((n) => n.slice(0, -3));
            const details = await Promise.all(scripts.map(async (p) => {
              const st = await fs.stat(path.join(dir, p + '.py'));
              return {
                platform: p,
                path: `platforms/${p}.py`,
                sizeBytes: st.size,
                lastModified: st.mtime.toISOString(),
              };
            }));
            return {
              content: [{
                type: 'text' as const,
                text: details.length
                  ? `已有 ${details.length} 个平台脚本:\n\n\`\`\`json\n${JSON.stringify(details, null, 2)}\n\`\`\``
                  : '暂无平台脚本。',
              }],
            };
          } catch (error) {
            return { content: [{ type: 'text' as const, text: `❌ 列出脚本失败: ${error}` }], isError: true };
          }
        }
      ),

      // ===== 工具 6: ReadPlatformScript =====
      tool(
        'ReadPlatformScript',
        '读取单个平台脚本的源码',
        {
          skillsDir: z.string().describe('Skill 规则目录的绝对路径'),
          platform:  z.string().describe('平台名称（如 "wechat"）'),
        },
        async (args) => {
          try {
            if (!/^[a-z0-9_-]{1,32}$/.test(args.platform)) {
              return { content: [{ type: 'text' as const, text: `❌ platform 名称不合法: ${args.platform}` }], isError: true };
            }
            const p = path.join(args.skillsDir, 'platforms', `${args.platform}.py`);
            assertPathSafe(p, args.skillsDir);
            const content = await fs.readFile(p, 'utf-8').catch(() => null);
            if (content === null) {
              return { content: [{ type: 'text' as const, text: `该平台暂无脚本：platforms/${args.platform}.py 不存在` }] };
            }
            return {
              content: [{
                type: 'text' as const,
                text: `# platforms/${args.platform}.py (${Buffer.byteLength(content, 'utf-8')} 字节)\n\n\`\`\`python\n${content}\n\`\`\``,
              }],
            };
          } catch (error) {
            return { content: [{ type: 'text' as const, text: `❌ 读取脚本失败: ${error}` }], isError: true };
          }
        }
      ),

      // ===== 工具 7: RunPlatformScript =====
      tool(
        'RunPlatformScript',
        '在 Python 沙箱里试跑平台脚本。支持两种模式：\n' +
        '- 生产模式：传 skillsDir+platform+articleDir，跑已落盘的脚本对当前 raw.html\n' +
        '- 调试模式：传 scriptContent+articleDir，跑候选源码（不落盘）对当前 raw.html',
        {
          articleDir:    z.string().describe('文章目录的绝对路径（用来读 raw.html）'),
          skillsDir:     z.string().optional().describe('Skill 目录（生产模式必填）'),
          platform:      z.string().optional().describe('平台名称（生产模式必填）'),
          scriptContent: z.string().optional().describe('脚本源码（调试模式必填）'),
          timeoutMs:     z.number().optional().default(5000).describe('超时毫秒数，默认 5000'),
        },
        async (args) => {
          try {
            const htmlPath = path.join(args.articleDir, 'raw.html');
            const html = await fs.readFile(htmlPath, 'utf-8').catch(() => null);
            if (html === null) {
              return { content: [{ type: 'text' as const, text: `❌ raw.html 不存在：${htmlPath}` }], isError: true };
            }

            const metaRaw = await fs.readFile(path.join(args.articleDir, 'meta.json'), 'utf-8').catch(() => '{}');
            const meta = JSON.parse(metaRaw);
            const url: string = meta.url || '';

            const params: Record<string, unknown> = { url, html, timeout_ms: args.timeoutMs };
            if (args.scriptContent) {
              params.script_content = args.scriptContent;
            } else if (args.skillsDir && args.platform) {
              if (!/^[a-z0-9_-]{1,32}$/.test(args.platform)) {
                return { content: [{ type: 'text' as const, text: `❌ platform 名称不合法: ${args.platform}` }], isError: true };
              }
              params.script_path = path.join(args.skillsDir, 'platforms', `${args.platform}.py`);
            } else {
              return { content: [{ type: 'text' as const, text: '❌ 必须提供 scriptContent 或 (skillsDir + platform)' }], isError: true };
            }

            const { pythonBridge } = await import('../../services/stock/python-bridge.js');
            const result = await pythonBridge.call<Record<string, unknown>>('run_article_script', params, 30_000);

            const resultContent = typeof result.content === 'string' ? result.content : '';
            const previewContent = resultContent.length > 2000
              ? resultContent.slice(0, 2000) + '\n\n[已截断，总长 ' + resultContent.length + ' 字符]'
              : resultContent;

            const summary = {
              ok: result.ok,
              title: result.title,
              author: result.author,
              site_name: result.site_name,
              excerpt: result.excerpt,
              language: result.language,
              duration_ms: result.duration_ms,
              error_type: result.error_type,
              error_message: result.error_message,
              stdout: result.stdout,
            };

            return {
              content: [{
                type: 'text' as const,
                text: `## 脚本执行结果\n\n\`\`\`json\n${JSON.stringify(summary, null, 2)}\n\`\`\`\n\n${result.ok ? '## 正文预览\n\n' + previewContent : '## Traceback\n\n```\n' + (result.traceback || '(无)') + '\n```'}`,
              }],
            };
          } catch (error) {
            return { content: [{ type: 'text' as const, text: `❌ RunPlatformScript 失败: ${error}` }], isError: true };
          }
        }
      ),

      // ===== 工具 8: UpdatePlatformScript =====
      tool(
        'UpdatePlatformScript',
        '落盘平台脚本。只在 RunPlatformScript 试跑成功后调用。\n' +
        '路径白名单：只能写 platforms/<name>.py；name 必须是 [a-z0-9_-]{1,32}。',
        {
          skillsDir: z.string().describe('Skill 目录的绝对路径'),
          platform:  z.string().describe('平台名称'),
          content:   z.string().describe('脚本完整源码（UTF-8）'),
        },
        async (args) => {
          try {
            if (!/^[a-z0-9_-]{1,32}$/.test(args.platform)) {
              return { content: [{ type: 'text' as const, text: `❌ platform 名称不合法: ${args.platform}` }], isError: true };
            }
            const bytes = Buffer.byteLength(args.content, 'utf-8');
            if (bytes > 20 * 1024) {
              return { content: [{ type: 'text' as const, text: `❌ 脚本过大（${bytes} 字节），上限 20 KB` }], isError: true };
            }
            const { pythonBridge } = await import('../../services/stock/python-bridge.js');
            const dryrun = await pythonBridge.call<Record<string, unknown>>('run_article_script', {
              script_content: args.content,
              url: 'https://example.com/__syntax_check__',
              html: '<html><body>dry</body></html>',
              timeout_ms: 2000,
            }, 10_000);

            const errorType = dryrun.error_type as string | undefined;
            if (errorType === 'SyntaxError' || errorType === 'ScriptSecurityError') {
              return {
                content: [{
                  type: 'text' as const,
                  text: `❌ 脚本预检失败：${errorType} — ${dryrun.error_message}`,
                }],
                isError: true,
              };
            }

            const targetPath = path.join(args.skillsDir, 'platforms', `${args.platform}.py`);
            assertPathSafe(targetPath, args.skillsDir);
            await fs.mkdir(path.dirname(targetPath), { recursive: true });
            await safeFileWrite(targetPath, args.content);

            return {
              content: [{
                type: 'text' as const,
                text: `✅ 已保存：platforms/${args.platform}.py（${bytes} 字节）`,
              }],
            };
          } catch (error) {
            return { content: [{ type: 'text' as const, text: `❌ 保存脚本失败: ${error}` }], isError: true };
          }
        }
      ),

      // ===== 工具 9: ReadParseHistory =====
      tool(
        'ReadParseHistory',
        '读取最近 N 条解析历史（history.jsonl 的尾部）',
        {
          skillsDir: z.string().describe('Skill 目录的绝对路径'),
          limit:     z.number().optional().default(20).describe('读取条数，默认 20'),
        },
        async (args) => {
          try {
            const p = path.join(args.skillsDir, 'history.jsonl');
            const raw = await fs.readFile(p, 'utf-8').catch(() => '');
            const lines = raw.split('\n').filter((l) => l.trim()).slice(-args.limit);
            const entries = lines.map((l) => {
              try { return JSON.parse(l); } catch { return { raw: l }; }
            });
            return {
              content: [{
                type: 'text' as const,
                text: `## 最近 ${entries.length} 条解析历史\n\n\`\`\`json\n${JSON.stringify(entries, null, 2)}\n\`\`\``,
              }],
            };
          } catch (error) {
            return { content: [{ type: 'text' as const, text: `❌ 读取历史失败: ${error}` }], isError: true };
          }
        }
      ),
    ],
  });
}
