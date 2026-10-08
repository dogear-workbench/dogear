/**
 * 带工作区边界校验的基础文件工具（Read / Write / Edit），ToolDef 形态。
 *
 * 与 pi-session/builtin-tools.ts 的 harness 版本（Read/Write/Edit/Bash，env 注入边界）
 * 区别：这里面向 runOnce 裸 Agent 场景（无 AgentHarness toolContext），边界在 handler
 * 闭包内用 workspace-boundary.ts 的 resolveWithinWorkspace 独立构造，可在 Worker 线程使用。
 * 不提供 Bash——后台定时任务不接受任意命令执行。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';
import { resolveWithinWorkspace } from '../pi-session/workspace-boundary.js';

const MAX_LINES = 2000;
const MAX_LINE_LENGTH = 2000;
const MAX_OUTPUT_CHARS = 128 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const IMAGE_MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

function errText(prefix: string, error: unknown) {
  return {
    content: [{ type: 'text' as const, text: `${prefix}: ${error instanceof Error ? error.message : String(error)}` }],
    isError: true,
  };
}

export function createWorkspaceFileToolDefs(workspacePath: string): ToolDef[] {
  return [
    defineTool(
      'Read',
      '读取文件内容',
      '读取工作区内的文件。文本文件返回带行号的全文（1 起始，格式「行号→内容」），' +
      '支持 offset/limit 按行分页；超长行自动截断，超过 2000 行输出整体截断。' +
      '支持图片（png/jpg/gif/webp/bmp，≤5MB），以图片附件进入上下文，offset/limit 对图片无效。其他二进制内容不支持。',
      z.object({
        file_path: z.string().describe('文件路径（相对工作区根或绝对路径，必须在工作区内）'),
        offset: z.number().int().min(1).optional().describe('起始行号（1 起始）'),
        limit: z.number().int().min(1).max(2000).optional().describe('最多返回行数'),
      }),
      async ({ file_path, offset, limit }) => {
        try {
          const abs = await resolveWithinWorkspace(workspacePath, file_path);
          const mimeType = IMAGE_MIME_TYPES[path.extname(abs).slice(1).toLowerCase()];
          if (mimeType) {
            const stat = await fs.stat(abs);
            if (stat.size > MAX_IMAGE_BYTES) {
              return errText('读取失败', new Error(`图片 ${(stat.size / 1024 / 1024).toFixed(1)}MB 超过 5MB 上限，无法读入上下文`));
            }
            const buffer = await fs.readFile(abs);
            return { content: [{ type: 'image', data: buffer.toString('base64'), mimeType }] };
          }
          const raw = await fs.readFile(abs, 'utf-8');
          const allLines = raw.split('\n');
          const start = (offset ?? 1) - 1;
          const end = limit !== undefined ? Math.min(allLines.length, start + limit) : Math.min(allLines.length, start + MAX_LINES);
          const lines: string[] = [];
          let totalChars = 0;
          for (let i = start; i < end; i++) {
            const line = allLines[i].length > MAX_LINE_LENGTH ? allLines[i].slice(0, MAX_LINE_LENGTH) + '…' : allLines[i];
            const numbered = `${i + 1}→${line}`;
            totalChars += numbered.length;
            if (totalChars > MAX_OUTPUT_CHARS) {
              lines.push(`[输出超过 ${MAX_OUTPUT_CHARS} 字符，已截断，可用 offset/limit 分页读取]`);
              break;
            }
            lines.push(numbered);
          }
          if (start >= allLines.length) {
            return { content: [{ type: 'text' as const, text: `(文件共 ${allLines.length} 行，offset 超出范围)` }] };
          }
          const truncNote = end < allLines.length ? `\n[共 ${allLines.length} 行，已截断到第 ${end} 行]` : '';
          return { content: [{ type: 'text' as const, text: lines.join('\n') + truncNote }] };
        } catch (error) {
          return errText('读取失败', error);
        }
      },
    ),

    defineTool(
      'Write',
      '写入文本文件（覆盖）',
      '把文本内容写入工作区内的文件（整文件覆盖）。父目录不存在会自动创建。' +
      '新建产物文件（报告、笔记、数据快照等）优先用本工具；修改已有文件的小片段优先用 Edit。',
      z.object({
        file_path: z.string().describe('目标文件路径（相对工作区根或绝对路径，必须在工作区内）'),
        content: z.string().describe('要写入的完整文件内容'),
      }),
      async ({ file_path, content }) => {
        try {
          const abs = await resolveWithinWorkspace(workspacePath, file_path);
          await fs.mkdir(path.dirname(abs), { recursive: true });
          await fs.writeFile(abs, content, 'utf-8');
          return { content: [{ type: 'text' as const, text: `已写入 ${path.relative(workspacePath, abs) || path.basename(abs)}（${content.length} 字符）` }] };
        } catch (error) {
          return errText('写入失败', error);
        }
      },
    ),

    defineTool(
      'Edit',
      '精确替换文件内容片段',
      '对工作区内的文件做精确字符串替换：old_text 必须与文件中唯一一段连续文本完全一致' +
      '（含缩进与换行，非正则、非模糊匹配），替换为 new_text。多处匹配或无匹配都会报错。',
      z.object({
        file_path: z.string().describe('目标文件路径（相对工作区根或绝对路径，必须在工作区内）'),
        old_text: z.string().min(1).describe('要替换的原文片段（必须在文件中唯一）'),
        new_text: z.string().describe('替换后的新内容'),
      }),
      async ({ file_path, old_text, new_text }) => {
        try {
          const abs = await resolveWithinWorkspace(workspacePath, file_path);
          const raw = await fs.readFile(abs, 'utf-8');
          const first = raw.indexOf(old_text);
          if (first === -1) {
            return errText('替换失败', new Error('old_text 未在文件中找到（需与文件内容完全一致）'));
          }
          if (raw.indexOf(old_text, first + 1) !== -1) {
            return errText('替换失败', new Error('old_text 在文件中出现多处，请扩大片段范围保证唯一'));
          }
          await fs.writeFile(abs, raw.slice(0, first) + new_text + raw.slice(first + old_text.length), 'utf-8');
          return { content: [{ type: 'text' as const, text: `已替换 ${path.relative(workspacePath, abs) || path.basename(abs)} 中 1 处片段` }] };
        } catch (error) {
          return errText('替换失败', error);
        }
      },
    ),
  ];
}
