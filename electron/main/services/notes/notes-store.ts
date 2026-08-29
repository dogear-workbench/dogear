/**
 * 笔记 IO 原语层：路径、frontmatter 解析/序列化、文件读写、回收站移动、index.json 维护
 *
 * - 真源永远是 md 文件；index.json 只是缓存
 * - frontmatter 手写解析（零依赖）：标量 / 内联数组 / todos 块列表（每行一个 JSON 对象）
 * - 写文件走 safe-json 的原子写；Windows rename 冲突已在 safe-json 内处理
 */
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { safeFileWrite, safeJsonWrite } from '../safe-json.js';
import type { Note, NoteMeta, NoteSource, TodoItem } from './note-types.js';

export const NOTES_DIR = '.dogear/notes';
export const TRASH_DIR_NAME = '.trash';

const INDEX_FILE = 'index.json';
const SHORTID_LEN = 8;
const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';

// ─── 路径 ───

export function getNotesDir(workspacePath: string): string {
  return path.join(workspacePath, NOTES_DIR);
}

export function getTrashDir(workspacePath: string): string {
  return path.join(getNotesDir(workspacePath), TRASH_DIR_NAME);
}

export function getIndexPath(workspacePath: string): string {
  return path.join(getNotesDir(workspacePath), INDEX_FILE);
}

// ─── id / 文件名 ───

export function generateShortId(): string {
  const bytes = randomBytes(SHORTID_LEN);
  let out = '';
  for (let i = 0; i < SHORTID_LEN; i++) out += BASE36[bytes[i] % BASE36.length];
  return out;
}

export function buildNoteFileName(now: Date, id: string): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `${ts}-${id}.md`;
}

// ─── frontmatter 解析 ───

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

interface ParsedFrontmatter {
  id: string;
  created: string;
  updated: string;
  tags: string[];
  links: string[];
  todos: TodoItem[];
  source?: NoteSource;
}

/** 解析卡片文件原文为结构化 Note；解析失败抛错（调用方决定跳过还是报错） */
export function parseNoteFile(raw: string): Note {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) throw new Error('缺少 frontmatter，不是有效的笔记文件');
  const fm = parseFrontmatterLines(match[1]);
  const content = match[2].replace(/^\n/, '');
  return {
    id: fm.id,
    file: '',
    title: extractTitle(content),
    created: fm.created,
    updated: fm.updated,
    tags: fm.tags,
    links: fm.links,
    todos: fm.todos,
    ...(fm.source ? { source: fm.source } : {}),
    content,
  };
}

function parseFrontmatterLines(text: string): ParsedFrontmatter {
  const result: ParsedFrontmatter = {
    id: '',
    created: new Date(0).toISOString(),
    updated: new Date(0).toISOString(),
    tags: [],
    links: [],
    todos: [],
  };
  const source: Partial<NoteSource> = {};
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx < 0) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const rawValue = trimmed.slice(colonIdx + 1).trim();
    if (key === 'todos') {
      if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
        result.todos = parseTodoInlineArray(rawValue);
        continue;
      }
      while (i + 1 < lines.length && /^\s+-\s/.test(lines[i + 1])) {
        i++;
        const todo = parseTodoLine(lines[i]);
        if (todo) result.todos.push(todo);
      }
      continue;
    }
    switch (key) {
      case 'id':
        result.id = parseScalar(rawValue);
        break;
      case 'created':
        result.created = parseScalar(rawValue);
        break;
      case 'updated':
        result.updated = parseScalar(rawValue);
        break;
      case 'tags':
        result.tags = parseStringArray(rawValue);
        break;
      case 'links':
        result.links = parseStringArray(rawValue);
        break;
      case 'source_conversation':
        source.conversationId = parseScalar(rawValue);
        break;
      case 'source_title':
        source.title = parseScalar(rawValue);
        break;
      case 'source_date':
        source.date = parseScalar(rawValue);
        break;
    }
  }
  if (source.conversationId) {
    result.source = { conversationId: source.conversationId, title: source.title ?? '', date: source.date ?? result.created };
  }
  return result;
}

function parseTodoLine(line: string): TodoItem | null {
  const json = line.replace(/^\s*-\s*/, '').trim();
  try {
    const obj = JSON.parse(json) as Partial<TodoItem>;
    if (typeof obj.text !== 'string' || !obj.text) return null;
    const todo: TodoItem = { id: String(obj.id ?? ''), text: obj.text, status: 'pending' };
    if (obj.status === 'in_progress' || obj.status === 'done') todo.status = obj.status;
    if (typeof obj.plan === 'string' && obj.plan) todo.plan = obj.plan;
    return todo;
  } catch {
    console.warn('[notes-store] todo 行解析失败，跳过:', json.slice(0, 80));
    return null;
  }
}

function parseTodoInlineArray(rawValue: string): TodoItem[] {
  const items = splitArrayItems(rawValue.slice(1, -1));
  const todos: TodoItem[] = [];
  for (const item of items) {
    const todo = parseTodoLine(`- ${item}`);
    if (todo) todos.push(todo);
  }
  return todos;
}

function parseScalar(rawValue: string): string {
  return unescapeQuotes(stripQuotes(rawValue));
}

function parseStringArray(rawValue: string): string[] {
  if (!rawValue.startsWith('[') || !rawValue.endsWith(']')) return [];
  const inner = rawValue.slice(1, -1).trim();
  if (!inner) return [];
  return splitArrayItems(inner)
    .map((item) => unescapeQuotes(stripQuotes(item.trim())))
    .filter((item) => item.length > 0);
}

/** 引号感知的逗号分割（元素可含逗号，用引号包裹） */
function splitArrayItems(inner: string): string[] {
  const items: string[] = [];
  let current = '';
  let inQuote: string | null = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (inQuote) {
      if (ch === '\\' && inQuote === '"') {
        current += ch + (inner[i + 1] ?? '');
        i++;
        continue;
      }
      if (ch === inQuote) inQuote = null;
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      current += ch;
      continue;
    }
    if (ch === ',') {
      items.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) items.push(current.trim());
  return items;
}

function stripQuotes(s: string): string {
  if (s.length >= 2) {
    const first = s[0];
    const last = s[s.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return s.slice(1, -1);
    }
  }
  return s;
}

function unescapeQuotes(s: string): string {
  return s.replace(/\\(["'])/g, '$1');
}

// ─── frontmatter 序列化 ───

export function serializeNoteFile(note: Omit<Note, 'file' | 'title'>): string {
  const lines: string[] = ['---'];
  lines.push(`id: ${quoteIfNeeded(note.id)}`);
  lines.push(`created: ${quoteIfNeeded(note.created)}`);
  lines.push(`updated: ${quoteIfNeeded(note.updated)}`);
  if (note.tags.length > 0) lines.push(`tags: ${serializeStringArray(note.tags)}`);
  if (note.links.length > 0) lines.push(`links: ${serializeStringArray(note.links)}`);
  if (note.source) {
    lines.push(`source_conversation: ${quoteIfNeeded(note.source.conversationId)}`);
    lines.push(`source_title: ${quoteIfNeeded(note.source.title)}`);
    lines.push(`source_date: ${quoteIfNeeded(note.source.date)}`);
  }
  if (note.todos.length > 0) {
    lines.push('todos:');
    for (const todo of note.todos) lines.push(`  - ${JSON.stringify(cleanTodo(todo))}`);
  }
  lines.push('---', '');
  return lines.join('\n') + note.content;
}

function cleanTodo(todo: TodoItem): TodoItem {
  const clean: TodoItem = { id: todo.id, text: todo.text, status: todo.status };
  if (todo.plan) clean.plan = todo.plan;
  return clean;
}

function serializeStringArray(items: string[]): string {
  return `[${items.map((item) => quoteIfNeeded(item)).join(', ')}]`;
}

function quoteIfNeeded(s: string): string {
  if (/[:#[\]"']/.test(s) || s.includes(', ')) {
    return `"${s.replace(/([\\"])/g, '\\$1')}"`;
  }
  return s;
}

// ─── 文件读写 ───

export async function readNoteFile(filePath: string): Promise<Note | null> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
  try {
    const note = parseNoteFile(raw);
    note.file = path.basename(filePath);
    return note;
  } catch (err) {
    console.warn(`[notes-store] 解析失败: ${filePath}`, err);
    return null;
  }
}

export async function writeNoteFile(filePath: string, note: Omit<Note, 'file' | 'title'>): Promise<void> {
  await safeFileWrite(filePath, serializeNoteFile(note));
}

export async function listNoteFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => e.name)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

export async function moveNoteFile(fromPath: string, toPath: string): Promise<void> {
  await fs.mkdir(path.dirname(toPath), { recursive: true });
  try {
    await fs.rename(fromPath, toPath);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'EPERM') {
      await fs.copyFile(fromPath, toPath);
      await fs.unlink(fromPath);
    } else {
      throw err;
    }
  }
}

export async function removeNoteFileCompletely(filePath: string): Promise<void> {
  for (const suffix of ['', '.bak', '.tmp']) {
    try { await fs.unlink(filePath + suffix); } catch { /* 不存在，忽略 */ }
  }
}

/** 正文首行作为标题（去 markdown 前缀标记，截 40 字）；空正文返回空串 */
export function extractTitle(content: string): string {
  const firstLine = content
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!firstLine) return '';
  return firstLine.replace(/^(#+\s*|[-*>]\s*|\d+\.\s*)/, '').slice(0, 40);
}

// ─── index.json ───

export interface NoteIndex {
  version: 1;
  items: NoteMeta[];
}

export async function readIndex(workspacePath: string): Promise<NoteIndex> {
  try {
    const raw = await fs.readFile(getIndexPath(workspacePath), 'utf-8');
    const data = JSON.parse(raw) as NoteIndex;
    if (data.version === 1 && Array.isArray(data.items)) return data;
  } catch {
    // 缺失/损坏 → 返回空索引，由上层（listNotes）全量重建；不回退 .bak，避免旧快照里的幽灵条目
  }
  return { version: 1, items: [] };
}

export async function writeIndex(workspacePath: string, index: NoteIndex): Promise<void> {
  await safeJsonWrite(getIndexPath(workspacePath), index);
}

export function noteToIndexItem(note: Note): NoteMeta {
  return {
    id: note.id,
    file: note.file,
    title: note.title,
    created: note.created,
    updated: note.updated,
    tags: [...note.tags],
    links: [...note.links],
    todos: note.todos.map((t) => ({ ...t })),
    ...(note.source ? { source: { ...note.source } } : {}),
  };
}

/** 单条 upsert（按 id 覆盖或追加） */
export async function updateIndexEntry(workspacePath: string, item: NoteMeta): Promise<void> {
  const index = await readIndex(workspacePath);
  const idx = index.items.findIndex((it) => it.id === item.id);
  if (idx >= 0) index.items[idx] = item;
  else index.items.push(item);
  await writeIndex(workspacePath, index);
}

export async function removeIndexEntry(workspacePath: string, noteId: string): Promise<void> {
  const index = await readIndex(workspacePath);
  const next = index.items.filter((it) => it.id !== noteId);
  if (next.length === index.items.length) return;
  index.items = next;
  await writeIndex(workspacePath, index);
}

/** 全量重建：扫描主目录 .md 文件，重写 index.json */
export async function rebuildIndex(workspacePath: string): Promise<NoteIndex> {
  const notesDir = getNotesDir(workspacePath);
  const files = await listNoteFiles(notesDir);
  const items: NoteMeta[] = [];
  for (const file of files) {
    const note = await readNoteFile(path.join(notesDir, file));
    if (note) items.push(noteToIndexItem(note));
  }
  const index: NoteIndex = { version: 1, items };
  await writeIndex(workspacePath, index);
  return index;
}
