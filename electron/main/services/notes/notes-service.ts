/**
 * 笔记 Service：CRUD 语义聚合入口（唯一写入入口）
 *
 * - md 文件是唯一真源；get 永远读文件并同步刷新索引；list/search 走 index.json
 * - 所有写操作完成后广播 notesChanged 事件（覆盖 UI / Agent / 外部编辑所有写入方）
 * - 所有方法第一参数是 workspaceId；目录不存在时查询返回 null/[]，写入自动创建
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Note, NoteMeta, NoteSource } from './note-types.js';
import {
  getNotesDir,
  getTrashDir,
  generateShortId,
  buildNoteFileName,
  readNoteFile,
  writeNoteFile,
  listNoteFiles,
  moveNoteFile,
  removeNoteFileCompletely,
  extractTitle,
  readIndex,
  updateIndexEntry,
  removeIndexEntry,
  rebuildIndex,
  noteToIndexItem,
} from './notes-store.js';
import type { RendererHandlers } from '../../tipc/renderer-handlers.js';

export interface CreateNoteInput {
  content: string;
  tags?: string[];
  links?: string[];
  /** 来源身份证（Agent 存卡时传入；用户手记不传） */
  source?: NoteSource;
}

export type NotePatch = Partial<Pick<Note, 'content' | 'tags' | 'links'>>;

export interface SearchNotesInput {
  query?: string;
  tag?: string;
}

export interface NoteSearchResult extends NoteMeta {
  /** 命中片段：首词首个命中处前后各 20 字；词只命中标题/标签时无 */
  snippet?: string;
}

const SEARCH_SNIPPET_RADIUS = 20;
const SEARCH_MAX_RESULTS = 20;

const LINK_RE = /^(article|stock|plan):.+/;

// ─── 读 ───

export async function createNote(workspaceId: string, input: CreateNoteInput): Promise<Note> {
  const now = new Date();
  const id = generateShortId();
  const note: Note = {
    id,
    file: buildNoteFileName(now, id),
    title: extractTitle(input.content),
    created: now.toISOString(),
    updated: now.toISOString(),
    tags: normalizeTags(input.tags),
    links: normalizeLinks(input.links),
    ...(input.source ? { source: input.source } : {}),
    content: input.content,
  };
  await writeNoteFile(path.join(getNotesDir(workspaceId), note.file), note);
  await updateIndexEntry(workspaceId, noteToIndexItem(note));
  void broadcastNotesChanged(workspaceId);
  return note;
}

export async function getNote(workspaceId: string, noteId: string): Promise<Note | null> {
  const filePath = await locateNoteFile(workspaceId, noteId);
  if (!filePath) return null;
  const note = await readNoteFile(filePath);
  if (!note) return null;
  await syncIndexEntry(workspaceId, note);
  return note;
}

export async function listNotes(workspaceId: string): Promise<NoteMeta[]> {
  const index = await readIndex(workspaceId);
  if (index.items.length === 0) {
    const rebuilt = await rebuildIndex(workspaceId);
    return sortByUpdated(rebuilt.items);
  }
  return sortByUpdated(index.items);
}

// ─── 写 ───

export async function updateNote(workspaceId: string, noteId: string, patch: NotePatch): Promise<Note | null> {
  const existing = await getNote(workspaceId, noteId);
  if (!existing) return null;
  const updated: Note = {
    ...existing,
    updated: new Date().toISOString(),
  };
  if (patch.content !== undefined) {
    updated.content = patch.content;
    updated.title = extractTitle(patch.content);
  }
  if (patch.tags !== undefined) updated.tags = normalizeTags(patch.tags);
  if (patch.links !== undefined) updated.links = normalizeLinks(patch.links);

  await writeNoteFile(path.join(getNotesDir(workspaceId), updated.file), updated);
  await updateIndexEntry(workspaceId, noteToIndexItem(updated));
  void broadcastNotesChanged(workspaceId);
  return updated;
}

export async function appendNote(workspaceId: string, noteId: string, text: string): Promise<Note | null> {
  const existing = await getNote(workspaceId, noteId);
  if (!existing) return null;
  const glue = existing.content.length > 0 && !existing.content.endsWith('\n') ? '\n' : '';
  const content = existing.content + glue + text;
  return updateNote(workspaceId, noteId, { content });
}

// ─── 软删除 / 回收站 ───

export async function removeNote(workspaceId: string, noteId: string): Promise<boolean> {
  const filePath = await locateNoteFile(workspaceId, noteId);
  if (!filePath) return false;
  const trashDir = getTrashDir(workspaceId);
  await fs.mkdir(trashDir, { recursive: true });
  await moveNoteFile(filePath, path.join(trashDir, path.basename(filePath)));
  // safeFileWrite 的单代 .bak 不随 rename 走，留在原目录会堆积，一并删掉
  await fs.unlink(`${filePath}.bak`).catch(() => {});
  await removeIndexEntry(workspaceId, noteId);
  void broadcastNotesChanged(workspaceId);
  return true;
}

export async function restoreNote(workspaceId: string, noteId: string): Promise<boolean> {
  const trashPath = await locateTrashedFile(workspaceId, noteId);
  if (!trashPath) return false;
  const note = await readNoteFile(trashPath);
  if (!note) return false;
  const targetPath = path.join(getNotesDir(workspaceId), note.file);
  const targetExists = await fs.access(targetPath).then(() => true).catch(() => false);
  if (targetExists) throw new Error(`恢复失败：主目录已存在同名文件 ${note.file}`);
  await moveNoteFile(trashPath, targetPath);
  await updateIndexEntry(workspaceId, noteToIndexItem(note));
  void broadcastNotesChanged(workspaceId);
  return true;
}

export async function purgeNote(workspaceId: string, noteId: string): Promise<boolean> {
  const trashPath = await locateTrashedFile(workspaceId, noteId);
  if (!trashPath) return false;
  await removeNoteFileCompletely(trashPath);
  void broadcastNotesChanged(workspaceId);
  return true;
}

export async function listTrashNotes(workspaceId: string): Promise<NoteMeta[]> {
  const trashDir = getTrashDir(workspaceId);
  const files = await listNoteFiles(trashDir);
  const items: NoteMeta[] = [];
  for (const file of files) {
    const note = await readNoteFile(path.join(trashDir, file));
    if (note) items.push(note);
  }
  return sortByUpdated(items);
}

export async function getTrashedNote(workspaceId: string, noteId: string): Promise<Note | null> {
  const trashPath = await locateTrashedFile(workspaceId, noteId);
  if (!trashPath) return null;
  return readNoteFile(trashPath);
}

// ─── 搜索 / 待办聚合 ───

export async function searchNotes(workspaceId: string, input: SearchNotesInput): Promise<NoteSearchResult[]> {
  const items = await listNotes(workspaceId);
  const tag = input.tag?.trim();
  const words = (input.query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const tagMatched = tag ? items.filter((it) => it.tags.includes(tag)) : items;
  if (words.length === 0) return tagMatched;
  const hits: Array<{ meta: NoteSearchResult; level: number }> = [];
  for (const item of tagMatched) {
    const filePath = await locateNoteFile(workspaceId, item.id);
    const note = filePath ? await readNoteFile(filePath) : null;
    const content = note?.content ?? '';
    const title = item.title.toLowerCase();
    const tags = item.tags.map((t) => t.toLowerCase());
    const contentLower = content.toLowerCase();
    let level = 0;
    let matchedAll = true;
    for (const word of words) {
      let wordLevel = 0;
      if (title.includes(word)) wordLevel = 3;
      else if (tags.some((t) => t.includes(word))) wordLevel = 2;
      else if (contentLower.includes(word)) wordLevel = 1;
      if (wordLevel === 0) {
        matchedAll = false;
        break;
      }
      level = Math.max(level, wordLevel);
    }
    if (!matchedAll) continue;
    hits.push({ meta: { ...item, snippet: buildSnippet(content, words[0]) }, level });
  }
  hits.sort((a, b) => b.level - a.level || (a.meta.updated < b.meta.updated ? 1 : -1));
  return hits.slice(0, SEARCH_MAX_RESULTS).map((h) => h.meta);
}

// ─── 内部工具 ───

function sortByUpdated(items: NoteMeta[]): NoteMeta[] {
  return [...items].sort((a, b) => (a.updated < b.updated ? 1 : -1));
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildSnippet(content: string, word: string): string | undefined {
  const m = new RegExp(escapeRegExp(word), 'i').exec(content);
  if (!m) return undefined;
  const start = Math.max(0, m.index - SEARCH_SNIPPET_RADIUS);
  const end = Math.min(content.length, m.index + m[0].length + SEARCH_SNIPPET_RADIUS);
  // 片段单行展示，换行与连续空白压成一个空格
  const body = content.slice(start, end).replace(/\s+/g, ' ').trim();
  if (!body) return undefined;
  return `${start > 0 ? '…' : ''}${body}${end < content.length ? '…' : ''}`;
}

function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    if (typeof tag !== 'string') throw new Error('标签必须是字符串');
    const trimmed = tag.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    result.push(trimmed);
  }
  return result;
}

function normalizeLinks(links: string[] | undefined): string[] {
  if (!links) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const link of links) {
    if (typeof link !== 'string' || !LINK_RE.test(link)) {
      throw new Error(`非法引用「${link}」，必须是 article:<路径> / stock:<代码> / plan:<路径>`);
    }
    if (seen.has(link)) continue;
    seen.add(link);
    result.push(link);
  }
  return result;
}

/** 索引优先定位主目录卡片文件；索引缺失/文件丢失时扫描目录按 id 兜底 */
async function locateNoteFile(workspaceId: string, noteId: string): Promise<string | null> {
  const notesDir = getNotesDir(workspaceId);
  const index = await readIndex(workspaceId);
  const entry = index.items.find((it) => it.id === noteId);
  if (entry) {
    const filePath = path.join(notesDir, entry.file);
    try {
      await fs.access(filePath);
      return filePath;
    } catch {
      // 索引陈旧，走扫描兜底
    }
  }
  const suffix = `-${noteId}.md`;
  for (const file of await listNoteFiles(notesDir)) {
    if (!file.endsWith(suffix)) continue;
    const filePath = path.join(notesDir, file);
    const note = await readNoteFile(filePath);
    if (note && note.id === noteId) return filePath;
  }
  return null;
}

async function locateTrashedFile(workspaceId: string, noteId: string): Promise<string | null> {
  const suffix = `-${noteId}.md`;
  const trashDir = getTrashDir(workspaceId);
  for (const file of await listNoteFiles(trashDir)) {
    if (!file.endsWith(suffix)) continue;
    const filePath = path.join(trashDir, file);
    const note = await readNoteFile(filePath);
    if (note && note.id === noteId) return filePath;
  }
  return null;
}

/** get 读到的文件真源与索引不一致时刷新（避免每次 get 都写索引） */
async function syncIndexEntry(workspaceId: string, note: Note): Promise<void> {
  const index = await readIndex(workspaceId);
  const entry = index.items.find((it) => it.id === note.id);
  if (entry && entry.file === note.file && entry.updated === note.updated) return;
  await updateIndexEntry(workspaceId, noteToIndexItem(note));
}

export async function broadcastNotesChanged(workspaceId: string): Promise<void> {
  try {
    const [{ BrowserWindow }, { getRendererHandlers }] = await Promise.all([
      import('electron'),
      import('@egoist/tipc/main'),
    ]);
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      try {
        getRendererHandlers<RendererHandlers>(win.webContents).notesChanged.send({ workspaceId });
      } catch {
        // 窗口已销毁，忽略
      }
    }
  } catch {
    // 非 Electron 环境（冒烟脚本）无窗口可广播
  }
}
