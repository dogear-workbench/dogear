/**
 * pi 会话的 Grep/Glob 工具。
 *
 * pi-agent-core 的 harness/tools 目录没有对应的现成实现（只有 read/write/edit/bash），
 * 这里走既有的 ToolDef/zod 约定（toPiTools/toHarnessTools 转换），不新增依赖。
 *
 * 文件收集统一走 ExecutionEnv.listFiles（gitignore-aware、有界、不跟随符号链接，
 * 实现见 list-files.ts / workspace-execution-env.ts）；Grep 的内容读取与行匹配仍是自研逻辑。
 * 根目录（可选 path 参数）和被遍历到的每一层经 env 的 guard 或 resolveWithinPaths 校验。
 */
import fs from 'fs/promises';
import path from 'path';
import { z } from 'zod';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import type { ExecutionEnv } from '@earendil-works/pi-durable/env';
import { defineTool, type ToolDef } from '../pi/tool-adapter.js';
import { resolveWithinPaths } from './workspace-boundary.js';

const GREP_MAX_LINE_LENGTH = 500;

function truncateLine(line: string, maxChars: number): { text: string } {
  if (line.length <= maxChars) return { text: line };
  return { text: `${line.slice(0, maxChars)}... [truncated]` };
}

/** listFiles 的 exclude 名单：.git 由后端无条件跳过，这里补依赖与内部数据目录 */
const LIST_EXCLUDE_NAMES = ['node_modules', '.dogear'];
const MAX_LIST_ENTRIES = 5000;
const MAX_GREP_FILE_BYTES = 2 * 1024 * 1024;

function globToRegExp(pattern: string): RegExp {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*';
        i++;
        if (pattern[i + 1] === '/') i++;
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else if ('.+^${}()|[]\\'.includes(c)) {
      out += `\\${c}`;
    } else {
      out += c;
    }
  }
  return new RegExp(`^${out}$`);
}

interface FileEntry {
  display: string;
  abs: string;
}

async function collectFiles(
  env: ExecutionEnv,
  roots: { abs: string; isPrimary: boolean }[],
): Promise<FileEntry[]> {
  const entries: FileEntry[] = [];
  for (const root of roots) {
    const listFiles = env.listFiles;
    if (!listFiles) continue;
    const listing = await listFiles.call(
      env,
      root.abs,
      { exclude: LIST_EXCLUDE_NAMES, maxEntries: MAX_LIST_ENTRIES },
      BACKGROUND_CONTEXT,
    );
    if (!listing.ok) continue;
    for (const entry of listing.value.entries) {
      if (entry.kind !== 'file') continue;
      const abs = path.join(root.abs, entry.path);
      entries.push({
        display: root.isPrimary ? entry.path : abs.replace(/\\/g, '/'),
        abs,
      });
    }
  }
  return entries;
}

export function createSearchToolDefs(allowedPaths: string[], env: ExecutionEnv): ToolDef[] {
  const primaryPath = allowedPaths[0];
  const allRoots = allowedPaths.map((abs, i) => ({ abs, isPrimary: i === 0 }));
  return [
    defineTool(
      'Glob',
      '按通配符匹配文件路径',
      '按 glob 模式匹配工作区内的文件路径，支持 * / ? / ** 通配符（如 "**/*.ts"、"src/*.tsx"）。' +
      '遵循 .gitignore 忽略规则，被 git 忽略的文件不参与匹配。' +
      '返回匹配的相对路径列表（按路径排序，默认最多 100 条）。' +
      '`.dogear` 数据目录默认跳过以防数据文件淹没结果；需搜索其中内容（如文章库）时把 path 显式指到对应子目录。',
      z.object({
        pattern: z.string().describe('glob 模式，相对工作区根目录或 path 参数指定的子目录'),
        path: z.string().optional().describe('限定搜索的相对子目录，默认整个工作区根目录'),
        limit: z.number().int().min(1).max(500).optional().describe('最多返回条数，默认 100'),
      }),
      async ({ pattern, path: subPath, limit }) => {
        try {
          const regex = globToRegExp(pattern);
          let entries: FileEntry[];
          if (subPath) {
            const root = await resolveWithinPaths(allowedPaths, subPath);
            const isPrimary = path.relative(primaryPath, root).startsWith('..') === false;
            entries = await collectFiles(env, [{ abs: root, isPrimary }]);
          } else {
            entries = await collectFiles(env, allRoots);
          }
          const matched = entries
            .filter((e) => regex.test(e.display))
            .map((e) => e.display)
            .sort();
          const capped = matched.slice(0, limit ?? 100);
          const text = capped.length > 0
            ? capped.join('\n') + (matched.length > capped.length ? `\n\n[共 ${matched.length} 条，已截断到 ${capped.length} 条]` : '')
            : '(无匹配文件)';
          return { content: [{ type: 'text' as const, text }] };
        } catch (error) {
          return {
            content: [{ type: 'text' as const, text: `Glob 失败: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true,
          };
        }
      },
      { replay: 'safe', outputLimits: { maxBytes: 256 * 1024 } },
    ),

    defineTool(
      'Grep',
      '正则搜索文件内容',
      '在工作区文件内容中按正则表达式搜索匹配行，返回 "相对路径:行号: 内容"（超长行自动截断）。' +
      '遵循 .gitignore 忽略规则，被 git 忽略的文件不参与搜索。' +
      '可选 glob 参数按文件名过滤，可选 path 参数限定搜索的子目录。' +
      '`.dogear` 数据目录默认跳过以防数据文件淹没结果；需搜索其中内容（如文章库）时把 path 显式指到对应子目录。',
      z.object({
        pattern: z.string().describe('正则表达式（JavaScript 语法）'),
        path: z.string().optional().describe('限定搜索的相对子目录，默认整个工作区根目录'),
        glob: z.string().optional().describe('可选文件名 glob 过滤，如 "*.ts"'),
        caseInsensitive: z.boolean().optional().describe('是否忽略大小写，默认 false'),
        limit: z.number().int().min(1).max(500).optional().describe('最多返回匹配行数，默认 200'),
      }),
      async ({ pattern, path: subPath, glob, caseInsensitive, limit }) => {
        let regex: RegExp;
        try {
          regex = new RegExp(pattern, caseInsensitive ? 'i' : '');
        } catch (error) {
          return {
            content: [{ type: 'text' as const, text: `正则表达式无效: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true,
          };
        }
        try {
          let entries: FileEntry[];
          if (subPath) {
            const root = await resolveWithinPaths(allowedPaths, subPath);
            const rootStat = await fs.stat(root);
            if (rootStat.isFile()) {
              const isPrimary = path.relative(primaryPath, root).startsWith('..') === false;
              entries = [{ display: isPrimary ? path.relative(primaryPath, root).replace(/\\/g, '/') : root.replace(/\\/g, '/'), abs: root }];
            } else {
              const isPrimary = path.relative(primaryPath, root).startsWith('..') === false;
              entries = await collectFiles(env, [{ abs: root, isPrimary }]);
            }
          } else {
            entries = await collectFiles(env, allRoots);
          }
          const globRegex = glob ? globToRegExp(glob) : null;
          const maxMatches = limit ?? 200;
          const matches: string[] = [];
          for (const entry of entries) {
            if (matches.length >= maxMatches) break;
            const basename = path.basename(entry.abs);
            if (globRegex && !globRegex.test(basename)) continue;
            let stat;
            try {
              stat = await fs.stat(entry.abs);
            } catch {
              continue;
            }
            if (stat.size > MAX_GREP_FILE_BYTES) continue;
            let text: string;
            try {
              text = await fs.readFile(entry.abs, 'utf-8');
            } catch {
              continue;
            }
            const lines = text.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (matches.length >= maxMatches) break;
              if (regex.test(lines[i])) {
                const { text: truncated } = truncateLine(lines[i], GREP_MAX_LINE_LENGTH);
                matches.push(`${entry.display}:${i + 1}: ${truncated}`);
              }
            }
          }
          const text = matches.length > 0 ? matches.join('\n') : '(无匹配)';
          return { content: [{ type: 'text' as const, text }] };
        } catch (error) {
          return {
            content: [{ type: 'text' as const, text: `Grep 失败: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true,
          };
        }
      },
      { replay: 'safe', outputLimits: { maxBytes: 256 * 1024 } },
    ),
  ];
}
