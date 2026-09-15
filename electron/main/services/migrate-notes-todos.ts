/**
 * 待办实体退役迁移：todos.json 的遗留人待办条目 → 笔记正文勾选项
 *
 * - 幂等：todos.json 不存在直接跳过；跑完全部条目后原子改名 .migrated 防重跑
 * - 带 noteId 且笔记存在 → appendNote 并入该卡正文尾部一行；无 noteId 或笔记缺失 → createNote 新卡（tags 置 ['待办']）
 * - done → `- [x]`，pending → `- [ ]`；due 取日期部分行尾加 ` 📅 YYYY-MM-DD`
 * - 回收站条目（deletedAt 非空）不迁，随文件改名一并退役
 * - 单条失败 warn 跳过不阻断；改名前清理遗留 .migrated（上次 rename 半途失败的残档）
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import * as notesService from './notes/notes-service.js';
import * as workspaceJsonService from './workspace-json-service.js';
import { mainLogger } from '../agents/logger.js';

const log = mainLogger.child('migrate-notes-todos');

export interface MigrateTodosToNotesResult {
  migratedTodos: number;
  appendedNotes: number;
  createdNotes: number;
  skipped: number;
}

interface LegacyTodo {
  text?: string;
  status?: 'pending' | 'done';
  due?: string;
  noteId?: string;
  deletedAt?: string;
}

function todosJsonPath(workspacePath: string): string {
  return path.join(workspacePath, '.dogear', 'todos.json');
}

function todoLine(text: string, status: string, due?: string): string {
  const box = status === 'done' ? '- [x]' : '- [ ]';
  const date = due?.match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  return `${box} ${text}${date ? ` 📅 ${date}` : ''}`;
}

function emptyResult(): MigrateTodosToNotesResult {
  return { migratedTodos: 0, appendedNotes: 0, createdNotes: 0, skipped: 0 };
}

export async function migrateTodosToNotes(workspacePath: string, workspaceId: string): Promise<MigrateTodosToNotesResult> {
  const source = todosJsonPath(workspacePath);
  const raw = await fs.readFile(source, 'utf-8').catch(() => null);
  if (raw === null) return emptyResult();

  let todos: LegacyTodo[];
  try {
    const parsed = JSON.parse(raw) as { todos?: LegacyTodo[] };
    todos = Array.isArray(parsed.todos) ? parsed.todos : [];
  } catch (err) {
    log.warn(`todos.json 解析失败，跳过迁移: ${workspacePath}`, err);
    return emptyResult();
  }

  const result = emptyResult();
  for (const todo of todos) {
    const text = (todo.text ?? '').trim();
    if (todo.deletedAt || !text) {
      result.skipped++;
      continue;
    }
    try {
      const line = todoLine(text, todo.status ?? 'pending', todo.due);
      if (todo.noteId && (await notesService.appendNote(workspaceId, todo.noteId, line))) {
        result.appendedNotes++;
      } else {
        await notesService.createNote(workspaceId, { content: line, tags: ['待办'] });
        result.createdNotes++;
      }
      result.migratedTodos++;
    } catch (err) {
      log.warn(`待办「${text}」迁移失败，跳过该条`, err);
    }
  }

  const migrated = `${source}.migrated`;
  await fs.unlink(migrated).catch(() => {});
  await fs.rename(source, migrated);
  return result;
}

/** 应用启动入口：遍历全部工作区执行迁移，单工作区失败不影响其他 */
export async function migrateTodosToNotesAllWorkspaces(): Promise<void> {
  const workspaces = await workspaceJsonService.getAll();
  for (const ws of workspaces) {
    try {
      const result = await migrateTodosToNotes(ws.path, ws.id);
      if (result.migratedTodos > 0 || result.skipped > 0) {
        log.info(
          `工作区 ${ws.id} 待办迁移完成：${result.appendedNotes} 条并入卡片，${result.createdNotes} 条建新卡，${result.skipped} 条跳过`,
        );
      }
    } catch (err) {
      log.error(`工作区 ${ws.id} 待办迁移失败`, err);
    }
  }
}
