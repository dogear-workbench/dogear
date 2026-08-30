/**
 * 笔记 Service：CRUD 语义聚合入口（唯一写入入口）
 *
 * - md 文件是唯一真源；get 永远读文件并同步刷新索引；list/search/listTodos 走 index.json
 * - 所有写操作完成后广播 notesChanged 事件（覆盖 UI / Agent / 外部编辑所有写入方）
 * - 所有方法第一参数是 workspacePath；目录不存在时查询返回 null/[]，写入自动创建
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Note, NoteMeta, NoteSource, NoteTodoEntry, TodoStatus } from './note-types.js';
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

export interface ListTodosInput {
  status?: TodoStatus;
  hasPlan?: boolean;
}

const LINK_RE = /^(article|stock|plan):.+/;

// ─── 读 ───

export async function createNote(workspacePath: string, input: CreateNoteInput): Promise<Note> {
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
    todos: [],
    ...(input.source ? { source: input.source } : {}),
    content: input.content,
  };
  await writeNoteFile(path.join(getNotesDir(workspacePath), note.file), note);
  await updateIndexEntry(workspacePath, noteToIndexItem(note));
  void broadcastNotesChanged(workspacePath);
  return note;
}

export async function getNote(workspacePath: string, noteId: string): Promise<Note | null> {
  const filePath = await locateNoteFile(workspacePath, noteId);
  if (!filePath) return null;
  const note = await readNoteFile(filePath);
  if (!note) return null;
  await syncIndexEntry(workspacePath, note);
  return note;
}

export async function listNotes(workspacePath: string): Promise<NoteMeta[]> {
  const index = await readIndex(workspacePath);
  if (index.items.length === 0) {
    const rebuilt = await rebuildIndex(workspacePath);
    return sortByUpdated(rebuilt.items);
  }
  return sortByUpdated(index.items);
}

// ─── 写 ───

export async function updateNote(workspacePath: string, noteId: string, patch: NotePatch): Promise<Note | null> {
  const existing = await getNote(workspacePath, noteId);
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
  updated.todos = [];

  await writeNoteFile(path.join(getNotesDir(workspacePath), updated.file), updated);
  await updateIndexEntry(workspacePath, noteToIndexItem(updated));
  void broadcastNotesChanged(workspacePath);
  return updated;
}

export async function appendNote(workspacePath: string, noteId: string, text: string): Promise<Note | null> {
  const existing = await getNote(workspacePath, noteId);
  if (!existing) return null;
  const glue = existing.content.length > 0 && !existing.content.endsWith('\n') ? '\n' : '';
  const content = existing.content + glue + text;
  return updateNote(workspacePath, noteId, { content });
}

// ─── 软删除 / 回收站 ───

export async function removeNote(workspacePath: string, noteId: string): Promise<boolean> {
  const filePath = await locateNoteFile(workspacePath, noteId);
  if (!filePath) return false;
  const trashDir = getTrashDir(workspacePath);
  await fs.mkdir(trashDir, { recursive: true });
  await moveNoteFile(filePath, path.join(trashDir, path.basename(filePath)));
  await removeIndexEntry(workspacePath, noteId);
  void broadcastNotesChanged(workspacePath);
  return true;
}

export async function restoreNote(workspacePath: string, noteId: string): Promise<boolean> {
  const trashPath = await locateTrashedFile(workspacePath, noteId);
  if (!trashPath) return false;
  const note = await readNoteFile(trashPath);
  if (!note) return false;
  const targetPath = path.join(getNotesDir(workspacePath), note.file);
  const targetExists = await fs.access(targetPath).then(() => true).catch(() => false);
  if (targetExists) throw new Error(`恢复失败：主目录已存在同名文件 ${note.file}`);
  await moveNoteFile(trashPath, targetPath);
  await updateIndexEntry(workspacePath, noteToIndexItem(note));
  void broadcastNotesChanged(workspacePath);
  return true;
}

export async function purgeNote(workspacePath: string, noteId: string): Promise<boolean> {
  const trashPath = await locateTrashedFile(workspacePath, noteId);
  if (!trashPath) return false;
  await removeNoteFileCompletely(trashPath);
  void broadcastNotesChanged(workspacePath);
  return true;
}

export async function listTrashNotes(workspacePath: string): Promise<NoteMeta[]> {
  const trashDir = getTrashDir(workspacePath);
  const files = await listNoteFiles(trashDir);
  const items: NoteMeta[] = [];
  for (const file of files) {
    const note = await readNoteFile(path.join(trashDir, file));
    if (note) items.push(note);
  }
  return sortByUpdated(items);
}

// ─── 搜索 / 待办聚合 ───

export async function searchNotes(workspacePath: string, input: SearchNotesInput): Promise<NoteMeta[]> {
  const items = await listNotes(workspacePath);
  const tag = input.tag?.trim();
  const query = input.query?.trim().toLowerCase();
  const tagMatched = tag ? items.filter((it) => it.tags.includes(tag)) : items;
  if (!query) return tagMatched;
  const matched: NoteMeta[] = [];
  for (const item of tagMatched) {
    if (item.title.toLowerCase().includes(query)) {
      matched.push(item);
      continue;
    }
    const note = await getNote(workspacePath, item.id);
    if (note && note.content.toLowerCase().includes(query)) matched.push(item);
  }
  return matched;
}

export async function listNoteTodos(workspacePath: string, input: ListTodosInput): Promise<NoteTodoEntry[]> {
  const items = await listNotes(workspacePath);
  const entries: NoteTodoEntry[] = [];
  for (const item of items) {
    for (const todo of item.todos) {
      if (input.status && todo.status !== input.status) continue;
      if (input.hasPlan !== undefined && Boolean(todo.plan) !== input.hasPlan) continue;
      entries.push({ noteId: item.id, noteTitle: item.title, todo });
    }
  }
  return entries;
}

// ─── 内部工具 ───

function sortByUpdated(items: NoteMeta[]): NoteMeta[] {
  return [...items].sort((a, b) => (a.updated < b.updated ? 1 : -1));
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
      throw new Error(`非法引用「${link}」，必须是 article:<id> / stock:<code> / plan:<path>`);
    }
    if (seen.has(link)) continue;
    seen.add(link);
    result.push(link);
  }
  return result;
}

/** 索引优先定位主目录卡片文件；索引缺失/文件丢失时扫描目录按 id 兜底 */
async function locateNoteFile(workspacePath: string, noteId: string): Promise<string | null> {
  const notesDir = getNotesDir(workspacePath);
  const index = await readIndex(workspacePath);
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

async function locateTrashedFile(workspacePath: string, noteId: string): Promise<string | null> {
  const suffix = `-${noteId}.md`;
  const trashDir = getTrashDir(workspacePath);
  for (const file of await listNoteFiles(trashDir)) {
    if (!file.endsWith(suffix)) continue;
    const filePath = path.join(trashDir, file);
    const note = await readNoteFile(filePath);
    if (note && note.id === noteId) return filePath;
  }
  return null;
}

/** get 读到的文件真源与索引不一致时刷新（避免每次 get 都写索引） */
async function syncIndexEntry(workspacePath: string, note: Note): Promise<void> {
  const index = await readIndex(workspacePath);
  const entry = index.items.find((it) => it.id === note.id);
  if (entry && entry.file === note.file && entry.updated === note.updated) return;
  await updateIndexEntry(workspacePath, noteToIndexItem(note));
}

export async function broadcastNotesChanged(workspacePath: string): Promise<void> {
  try {
    const [{ BrowserWindow }, { getRendererHandlers }] = await Promise.all([
      import('electron'),
      import('@egoist/tipc/main'),
    ]);
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      try {
        getRendererHandlers<RendererHandlers>(win.webContents).notesChanged.send({ workspacePath });
      } catch {
        // 窗口已销毁，忽略
      }
    }
  } catch {
    // 非 Electron 环境（冒烟脚本）无窗口可广播
  }
}
