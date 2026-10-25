/**
 * ExecutionEnv.listFiles 的本地实现：gitignore-aware、有界的文件树列举。
 *
 * pi-durable 1.3 的 NodeExecutionEnv 未实现可选 listFiles（接口为 remote daemon 预留），
 * 本模块补齐本地语义：深度优先、同层按名称字节序、符号链接只列出不跟随、
 * work tree 内按 .gitignore 规则链（含 .git/info/exclude）过滤、maxEntries/maxBytes/timeoutMs 三重有界。
 */
import fs from 'fs/promises';
import type { Dirent, Stats } from 'node:fs';
import path from 'path';
import type { Context } from '@earendil-works/chord';
import {
  err,
  ok,
  FileError,
  type FileKind,
  type FileListEntry,
  type FileListing,
  type ListFilesOptions,
  type Result,
} from '@earendil-works/pi-durable/env';

const DEFAULT_MAX_ENTRIES = 50_000;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

interface IgnoreRule {
  negated: boolean;
  dirOnly: boolean;
  regex: RegExp;
}

function escapeRegexChar(ch: string): string {
  return /[.+^${}()|[\]\\*?]/.test(ch) ? `\\${ch}` : ch;
}

function compileClass(seg: string, start: number): { body: string; next: number } | null {
  let i = start + 1;
  let negated = false;
  if (seg[i] === '!' || seg[i] === '^') {
    negated = true;
    i++;
  }
  let body = '';
  let first = true;
  while (i < seg.length) {
    const ch = seg[i];
    if (ch === ']') {
      if (first) {
        body += '\\]';
        first = false;
        i++;
        continue;
      }
      return { body: `[${negated ? '^' : ''}${body}]`, next: i };
    }
    if (ch === '/') return null;
    if (ch === '\\' && i + 1 < seg.length) {
      body += `\\${escapeRegexChar(seg[i + 1])}`;
      i += 2;
      first = false;
      continue;
    }
    body += ch === ']' ? '\\]' : escapeRegexChar(ch);
    first = false;
    i++;
  }
  return null;
}

function compileSegment(seg: string): string {
  let out = '';
  for (let i = 0; i < seg.length; i++) {
    const ch = seg[i];
    if (ch === '*') {
      // git 规则：非独立 segment 的 ** 视同 *
      if (seg[i + 1] === '*') i++;
      out += '[^/]*';
    } else if (ch === '?') {
      out += '[^/]';
    } else if (ch === '[') {
      const cls = compileClass(seg, i);
      if (cls) {
        out += cls.body;
        i = cls.next;
      } else {
        out += '\\[';
      }
    } else if (ch === '\\' && i + 1 < seg.length) {
      out += escapeRegexChar(seg[i + 1]);
      i++;
    } else {
      out += escapeRegexChar(ch);
    }
  }
  return out;
}

function compilePattern(pattern: string): RegExp {
  const segments = pattern.split('/');
  let body = '';
  for (let s = 0; s < segments.length; s++) {
    const seg = segments[s];
    const last = s === segments.length - 1;
    if (seg === '**') {
      body += last ? '.*' : '(?:[^/]+/)*';
      continue;
    }
    body += compileSegment(seg);
    if (!last) body += '/';
  }
  return new RegExp(`^${body}$`);
}

function parseIgnoreFile(text: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    let line = rawLine;
    if (line.startsWith('#')) continue;
    while (line.endsWith(' ') && !line.endsWith('\\ ')) line = line.slice(0, -1);
    if (!line) continue;
    let negated = false;
    if (line.startsWith('!')) {
      negated = true;
      line = line.slice(1);
    }
    let dirOnly = false;
    if (line.endsWith('/')) {
      dirOnly = true;
      line = line.slice(0, -1);
    }
    if (!line) continue;
    const compiled = compilePattern(line);
    const anchored = line.includes('/');
    rules.push({
      negated,
      dirOnly,
      regex: anchored ? compiled : new RegExp(`(?:^|/)${compiled.source.slice(1, -1)}$`),
    });
  }
  return rules;
}

function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

async function findWorkTree(startDir: string): Promise<string | null> {
  let dir = startDir;
  for (;;) {
    try {
      await fs.access(path.join(dir, '.git'));
      return dir;
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }
}

async function readIgnoreFile(file: string): Promise<IgnoreRule[] | null> {
  try {
    return parseIgnoreFile(await fs.readFile(file, 'utf-8'));
  } catch {
    return null;
  }
}

class IgnoreSet {
  private cache = new Map<string, IgnoreRule[]>();
  private infoExcludeRules: IgnoreRule[] | undefined;

  constructor(private readonly workTree: string | null) {}

  private async rulesFor(dir: string): Promise<IgnoreRule[]> {
    const cached = this.cache.get(dir);
    if (cached) return cached;
    let rules: IgnoreRule[] = [];
    if (this.workTree !== null && (dir === this.workTree || dir.startsWith(this.workTree + path.sep))) {
      rules = (await readIgnoreFile(path.join(dir, '.gitignore'))) ?? [];
    }
    this.cache.set(dir, rules);
    return rules;
  }

  private async infoExclude(): Promise<IgnoreRule[]> {
    if (this.infoExcludeRules !== undefined) return this.infoExcludeRules;
    this.infoExcludeRules = this.workTree === null
      ? []
      : (await readIgnoreFile(path.join(this.workTree, '.git', 'info', 'exclude'))) ?? [];
    return this.infoExcludeRules;
  }

  async decide(candidateAbs: string, isDir: boolean): Promise<'allow' | 'exclude'> {
    if (this.workTree === null) return 'allow';
    let dir = path.dirname(candidateAbs);
    for (;;) {
      const rel = toPosix(path.relative(dir, candidateAbs));
      for (const rule of await this.rulesFor(dir)) {
        if (rule.dirOnly && !isDir) continue;
        if (rule.regex.test(rel)) return rule.negated ? 'allow' : 'exclude';
      }
      if (path.relative(dir, this.workTree) === '') break;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    const relToRoot = toPosix(path.relative(this.workTree, candidateAbs));
    for (const rule of await this.infoExclude()) {
      if (rule.dirOnly && !isDir) continue;
      if (rule.regex.test(relToRoot)) return rule.negated ? 'allow' : 'exclude';
    }
    return 'allow';
  }
}

export async function listFilesTree(
  rootDir: string,
  options: ListFilesOptions | undefined,
  context: Context,
): Promise<Result<FileListing, FileError>> {
  const hidden = options?.hidden ?? true;
  const gitignore = options?.gitignore ?? true;
  const exclude = new Set(options?.exclude ?? []);
  const maxEntries = options?.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(maxEntries) || maxEntries < 0) {
    return err(new FileError('invalid', `maxEntries 必须是非负整数: ${maxEntries}`, rootDir));
  }
  if (!Number.isInteger(maxBytes) || maxBytes < 0) {
    return err(new FileError('invalid', `maxBytes 必须是非负整数: ${maxBytes}`, rootDir));
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    return err(new FileError('invalid', `timeoutMs 必须是正整数: ${timeoutMs}`, rootDir));
  }
  if (context.abortSignal?.aborted) {
    return err(new FileError('aborted', '已中止', rootDir));
  }

  let baseDir = rootDir;
  let startStat: Stats;
  try {
    startStat = await fs.lstat(rootDir);
  } catch (error) {
    return err(new FileError('not_found', `目录不存在: ${rootDir}`, rootDir, error instanceof Error ? error : undefined));
  }
  if (startStat.isSymbolicLink()) {
    try {
      const target = await fs.readlink(rootDir);
      baseDir = path.resolve(path.dirname(rootDir), target);
      const resolved = await fs.lstat(baseDir);
      if (!resolved.isDirectory()) {
        return err(new FileError('not_directory', `不是目录: ${rootDir}`, rootDir));
      }
    } catch {
      return err(new FileError('not_found', `符号链接目标不存在: ${rootDir}`, rootDir));
    }
  } else if (!startStat.isDirectory()) {
    return err(new FileError('not_directory', `不是目录: ${rootDir}`, rootDir));
  }

  const ignores = new IgnoreSet(gitignore ? await findWorkTree(baseDir) : null);
  const entries: FileListEntry[] = [];
  let bytes = 0;
  let truncated = false;
  const deadline = Date.now() + timeoutMs;

  type WalkResult = Result<void, FileError>;
  const walk = async (dir: string, relPrefix: string): Promise<WalkResult> => {
    if (context.abortSignal?.aborted) return err(new FileError('aborted', '已中止', rootDir));
    if (Date.now() > deadline) {
      truncated = true;
      return ok(undefined);
    }
    let dirents: Dirent[];
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return ok(undefined);
    }
    dirents.sort((a, b) => Buffer.compare(Buffer.from(a.name, 'utf-8'), Buffer.from(b.name, 'utf-8')));
    for (const dirent of dirents) {
      const name = dirent.name;
      if (name === '.git') continue;
      if (exclude.has(name)) continue;
      if (!hidden && name.startsWith('.')) continue;
      let kind: FileKind;
      if (dirent.isSymbolicLink()) kind = 'symlink';
      else if (dirent.isDirectory()) kind = 'directory';
      else if (dirent.isFile()) kind = 'file';
      else continue;
      const rel = relPrefix ? `${relPrefix}/${name}` : name;
      const relBytes = Buffer.byteLength(rel, 'utf-8') + 2;
      if (entries.length >= maxEntries || bytes + relBytes > maxBytes) {
        truncated = true;
        return ok(undefined);
      }
      const candidateAbs = path.join(dir, name);
      if ((await ignores.decide(candidateAbs, kind === 'directory')) === 'exclude') continue;
      entries.push({ path: rel, kind });
      bytes += relBytes;
      if (kind === 'directory') {
        const sub = await walk(candidateAbs, rel);
        if (!sub.ok) return sub;
        if (truncated) return ok(undefined);
      }
    }
    return ok(undefined);
  };

  const walked = await walk(baseDir, '');
  if (!walked.ok) return walked;
  return ok({ entries, truncated });
}
