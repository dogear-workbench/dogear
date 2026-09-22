/**
 * 记忆模块 IO 工具层
 *
 * - 路径函数（workspaceId 为第一参数，所有 service / indexer / loader 共用；存全局 config 的 workspaces/{id}/memory 下）
 * - frontmatter 手写解析 / 序列化（不引入 gray-matter 依赖）
 *
 * 只处理主题文件实际使用的字段类型：string / string[] / ISO 时间戳。
 * 复杂 YAML 不支持；解析失败时记日志并返回空 fm。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { getConfigDir } from '../settings-service.js';
import type { MemoryScope } from './memory-types.js';

// ─── 路径函数 ───

export function getMemoryDir(workspaceId: string): string {
  return path.join(getConfigDir(), 'workspaces', workspaceId, 'memory');
}

export function getCoreProfilePath(workspaceId: string): string {
  return path.join(getMemoryDir(workspaceId), 'core-profile.md');
}

export function getTopicsDir(workspaceId: string): string {
  return path.join(getMemoryDir(workspaceId), 'topics');
}

export function getTopicPath(workspaceId: string, slug: string): string {
  return path.join(getTopicsDir(workspaceId), `${slug}.md`);
}

export function getIndexPath(workspaceId: string): string {
  return path.join(getMemoryDir(workspaceId), 'index.json');
}

export function getGlobalMemoryDir(): string {
  return path.join(getConfigDir(), 'memory');
}

export function getGlobalTopicsDir(): string {
  return path.join(getGlobalMemoryDir(), 'topics');
}

export function getGlobalTopicPath(slug: string): string {
  return path.join(getGlobalTopicsDir(), `${slug}.md`);
}

export function getGlobalIndexPath(): string {
  return path.join(getGlobalMemoryDir(), 'index.json');
}

// ─── Scope 路由 ───

export function resolveTopicsDir(scope: MemoryScope, workspaceId: string): string {
  return scope === 'global' ? getGlobalTopicsDir() : getTopicsDir(workspaceId);
}

export function resolveTopicPath(scope: MemoryScope, workspaceId: string, slug: string): string {
  return scope === 'global' ? getGlobalTopicPath(slug) : getTopicPath(workspaceId, slug);
}

export function resolveIndexPath(scope: MemoryScope, workspaceId: string): string {
  return scope === 'global' ? getGlobalIndexPath() : getIndexPath(workspaceId);
}

// ─── Frontmatter 解析 ───

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

type FmValue = string | string[];
export type Frontmatter = Record<string, FmValue>;

/**
 * 解析 key: value 或 key: [a, b, "c"] 形式的简易 YAML。
 * 不支持嵌套、锚点、多行字符串等复杂 YAML 语法。
 */
function parseSimpleYaml(text: string): Frontmatter {
  const result: Frontmatter = {};
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx < 0) continue;
    const key = line.slice(0, colonIdx).trim();
    if (!key) continue;
    const rawValue = line.slice(colonIdx + 1).trim();
    if (!rawValue) {
      result[key] = '';
      continue;
    }
    // 数组形式 [a, b, "c"]
    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      const inner = rawValue.slice(1, -1).trim();
      if (!inner) {
        result[key] = [];
        continue;
      }
      result[key] = inner
        .split(',')
        .map((item) => stripQuotes(item.trim()))
        .filter((item) => item.length > 0);
      continue;
    }
    // 标量（去引号）
    result[key] = stripQuotes(rawValue);
  }
  return result;
}

function stripQuotes(s: string): string {
  // Note: 不 unescape \" → " — 存 JSON 字符串的调用方必须自行 unescape
  // 参考 digest-store.ts parseDigestCard 的处理方式
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

/**
 * 分离 frontmatter 和正文。无 frontmatter 时 fm 为空对象，body 为原始内容。
 */
export function parseFrontmatter(raw: string): { fm: Frontmatter; body: string } {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return { fm: {}, body: raw };
  try {
    const fm = parseSimpleYaml(match[1]);
    return { fm, body: match[2] };
  } catch (err) {
    console.warn('[memory-fs] frontmatter 解析失败，按无 fm 处理:', err);
    return { fm: {}, body: raw };
  }
}

/** 序列化 frontmatter + 正文为 markdown 文件内容 */
export function stringifyFrontmatter(fm: Frontmatter, body: string): string {
  const lines: string[] = ['---'];
  for (const [key, value] of Object.entries(fm)) {
    if (Array.isArray(value)) {
      const items = value.map((v) => quoteIfNeeded(v)).join(', ');
      lines.push(`${key}: [${items}]`);
    } else {
      lines.push(`${key}: ${quoteIfNeeded(value)}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n') + body;
}

function quoteIfNeeded(s: string): string {
  // 含特殊字符（冒号、#、逗号、方括号、引号）时加引号
  if (/[:#,\[\]"']/.test(s)) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

/** 读取 topic 文件并返回 frontmatter（供 indexer rebuild 时用） */
export async function readTopicFrontmatter(filePath: string): Promise<Frontmatter> {
  const raw = await fs.readFile(filePath, 'utf-8');
  return parseFrontmatter(raw).fm;
}
