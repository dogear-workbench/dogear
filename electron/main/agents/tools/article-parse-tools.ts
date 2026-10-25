/**
 * 文章解析工具（ToolDef 格式）
 *
 * 两条消费路径：后台 AI 兜底任务（PARSE_ARTICLE runOnce）与浏览器解析子会话（article 包生效时装配层直接拼装，
 * 刻意不走 registerToolGroup——不进主会话工具面与用户可见工具列表），提供：
 * - 读取原始 HTML、当前已解析内容、解析规则
 * - 覆盖保存解析结果（只更新 frontmatter + 正文，保留伴随 raw.html）
 * - 更新 Skill 规则文件（含路径安全校验，防越界写）
 *
 * 工具以文章 md 绝对路径（articlePath）为锚点，伴随文件为同名 .raw.html。
 */

import { z } from 'zod';
import fs from 'fs/promises';
import path from 'path';
import { safeFileWrite } from '../../services/safe-json.js';
import { parseArticleFile, serializeFrontmatter, type ParsedArticleFile } from '../../services/article/frontmatter.js';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';

/** 安全校验：目标路径必须在允许的根目录之内 */
function assertPathSafe(targetPath: string, allowedRoot: string): void {
  const resolved = path.resolve(targetPath);
  const root = path.resolve(allowedRoot);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`路径安全错误：${targetPath} 超出允许范围 ${allowedRoot}`);
  }
}

/** 文章 md 绝对路径 → 伴随 raw.html 绝对路径 */
function companionHtmlPath(articlePath: string): string {
  return articlePath.replace(/\.md$/i, '.raw.html');
}

async function readArticleFile(articlePath: string): Promise<ParsedArticleFile | null> {
  try {
    return parseArticleFile(await fs.readFile(articlePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * 创建文章解析工具集
 * 工具通过调用时的入参定位文件，无需工厂函数接受闭包参数。
 */
export function createArticleParseToolDefs(): ToolDef[] {
  return [
    defineTool(
      'dogear__ReadRawHtml',
      '读取原始 HTML',
      '读取文章的原始 HTML（最多 50KB，截断防止 token 超限）\n' +
      '供 AI 在固定解析失败或质量不达标时，重新分析 HTML 结构，找到正文内容。',
      z.object({
        articlePath: z.string().describe('文章 md 文件的绝对路径（dogear__SaveArticle 返回的 articlePath）'),
        maxBytes: z.number().default(51200).describe('最多读取的字节数，默认 50KB'),
      }),
      async (args) => {
        try {
          const htmlPath = companionHtmlPath(args.articlePath);
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

    defineTool(
      'dogear__ReadCurrentContent',
      '读取当前已解析内容',
      '读取当前已解析的文章内容（frontmatter 元数据 + 正文合并展示）\n' +
      '用于质量检查：判断标题、正文长度、内容完整性等是否达标。',
      z.object({
        articlePath: z.string().describe('文章 md 文件的绝对路径（dogear__SaveArticle 返回的 articlePath）'),
      }),
      async (args) => {
        try {
          const raw = await fs.readFile(args.articlePath, 'utf-8').catch(() => '');
          const parsed = raw ? parseArticleFile(raw) : null;
          const meta = parsed?.meta ?? {};
          const content = parsed?.content ?? raw;
          return {
            content: [{
              type: 'text' as const,
              text: `## 元数据\n\n\`\`\`json\n${JSON.stringify(meta, null, 2)}\n\`\`\`\n\n## 正文（Markdown）\n\n${content}`,
            }],
          };
        } catch (error) {
          return { content: [{ type: 'text' as const, text: `❌ 读取文章内容失败: ${error}` }], isError: true };
        }
      }
    ),

    defineTool(
      'dogear__ReadParserRules',
      '读取解析规则',
      '读取解析规则文件（通用规则 + 匹配的平台规则）\n' +
      '在开始解析前调用，获取已积累的解析经验和策略。',
      z.object({
        skillsDir: z.string().describe('Skill 规则目录的绝对路径（应用数据目录下 article-parser/ 的绝对路径）'),
        platform: z.string().optional().describe('平台名称（如 "wechat"），不传则只返回通用规则'),
      }),
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
              result += `\n\n---\n\n# ${args.platform} 平台规则\n\n（暂无此平台的专项规则。如需新增，使用 dogear__ReadPlatformScript / dogear__RunPlatformScript / dogear__UpdatePlatformScript 创建 Python 脚本）`;
            }
          }

          return { content: [{ type: 'text' as const, text: result }] };
        } catch (error) {
          return { content: [{ type: 'text' as const, text: `❌ 读取规则文件失败: ${error}` }], isError: true };
        }
      }
    ),

    defineTool(
      'dogear__SaveParsedArticle',
      '保存解析结果',
      '覆盖保存 AI 重新解析的文章结果\n' +
      '更新 frontmatter 元数据与正文，保留伴随的 raw.html 不变。\n' +
      '调用前请确认内容质量达标（标题非空、正文 > 200 字符）。',
      z.object({
        articlePath:   z.string().describe('文章 md 文件的绝对路径（dogear__SaveArticle 返回的 articlePath）'),
        title:         z.string().describe('文章标题'),
        content:       z.string().describe('文章正文（Markdown 格式）'),
        author:        z.string().optional().describe('作者'),
        siteName:      z.string().optional().describe('站点名称'),
        excerpt:       z.string().optional().describe('摘要（不超过 200 字符）'),
      }),
      async (args) => {
        try {
          const parsed = await readArticleFile(args.articlePath);
          if (!parsed) {
            return { content: [{ type: 'text' as const, text: `❌ 文章文件不存在或格式无效: ${args.articlePath}` }], isError: true };
          }

          const wordCount = args.content.replace(/\s+/g, '').length;
          const updatedMeta = {
            ...parsed.meta,
            title:     args.title,
            author:    args.author   ?? parsed.meta.author   ?? null,
            siteName:  args.siteName ?? parsed.meta.siteName ?? null,
            excerpt:   args.excerpt  ?? parsed.meta.excerpt  ?? null,
            wordCount,
          };

          await safeFileWrite(args.articlePath, serializeFrontmatter(updatedMeta) + args.content);

          return {
            content: [{
              type: 'text' as const,
              text: `✅ 已保存解析结果\n标题：${args.title}\n字数：${wordCount}\n路径：${args.articlePath}`,
            }],
          };
        } catch (error) {
          return { content: [{ type: 'text' as const, text: `❌ 保存失败: ${error}` }], isError: true };
        }
      }
    ),

    defineTool(
      'dogear__ListPlatformScripts',
      '列出平台脚本',
      '列出所有已有的平台脚本（*.py 文件）',
      z.object({
        skillsDir: z.string().describe('Skill 规则目录的绝对路径'),
      }),
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

    defineTool(
      'dogear__ReadPlatformScript',
      '读取平台脚本',
      '读取单个平台脚本的源码',
      z.object({
        skillsDir: z.string().describe('Skill 规则目录的绝对路径'),
        platform:  z.string().describe('平台名称（如 "wechat"）'),
      }),
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

    defineTool(
      'dogear__RunPlatformScript',
      '试跑平台脚本',
      '在 Python 沙箱里试跑平台脚本。支持两种模式：\n' +
      '- 生产模式：传 skillsDir+platform+articlePath，跑已落盘的脚本对当前 raw.html\n' +
      '- 调试模式：传 scriptContent+articlePath，跑候选源码（不落盘）对当前 raw.html',
      z.object({
        articlePath:   z.string().describe('文章 md 文件的绝对路径（用来读伴随的 raw.html）'),
        skillsDir:     z.string().optional().describe('Skill 目录（生产模式必填）'),
        platform:      z.string().optional().describe('平台名称（生产模式必填）'),
        scriptContent: z.string().optional().describe('脚本源码（调试模式必填）'),
        timeoutMs:     z.number().optional().default(5000).describe('超时毫秒数，默认 5000'),
      }),
      async (args) => {
        try {
          const htmlPath = companionHtmlPath(args.articlePath);
          const html = await fs.readFile(htmlPath, 'utf-8').catch(() => null);
          if (html === null) {
            return { content: [{ type: 'text' as const, text: `❌ raw.html 不存在：${htmlPath}` }], isError: true };
          }

          const parsed = await readArticleFile(args.articlePath);
          const url: string = parsed?.meta.url ?? '';

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
          return { content: [{ type: 'text' as const, text: `❌ dogear__RunPlatformScript 失败: ${error}` }], isError: true };
        }
      }
    ),

    defineTool(
      'dogear__UpdatePlatformScript',
      '落盘平台脚本',
      '落盘平台脚本。只在 dogear__RunPlatformScript 试跑成功后调用。\n' +
      '路径白名单：只能写 platforms/<name>.py；name 必须是 [a-z0-9_-]{1,32}。',
      z.object({
        skillsDir: z.string().describe('Skill 目录的绝对路径'),
        platform:  z.string().describe('平台名称'),
        content:   z.string().describe('脚本完整源码（UTF-8）'),
      }),
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

    defineTool(
      'dogear__ReadParseHistory',
      '读取解析历史',
      '读取最近 N 条解析历史（history.jsonl 的尾部）',
      z.object({
        skillsDir: z.string().describe('Skill 目录的绝对路径'),
        limit:     z.number().optional().default(20).describe('读取条数，默认 20'),
      }),
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
  ];
}
