/**
 * 人待办存储原语层：HumanTodo CRUD + 软删除 + .dogear/todos.json 读写
 *
 * - 写操作统一走 mutateTodos（withFileLock 串行化 + 原子落盘），模式同 task-store
 * - 所有写操作完成后广播 todosChanged（覆盖 UI / Agent 所有写入方）；非 Electron 环境（冒烟脚本）静默跳过
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { safeJsonRead, withFileLock } from './safe-json.js';
import type { RendererHandlers } from '../tipc/renderer-handlers.js';

async function broadcastTodosChanged(workspacePath: string): Promise<void> {
  try {
    const [{ BrowserWindow }, { getRendererHandlers }] = await Promise.all([
      import('electron'),
      import('@egoist/tipc/main'),
    ]);
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      try {
        getRendererHandlers<RendererHandlers>(win.webContents).todosChanged.send({ workspacePath });
      } catch {
        // 窗口已销毁，忽略
      }
    }
  } catch {
    // 非 Electron 环境（冒烟脚本）无窗口可广播
  }
}

export type HumanTodoStatus = 'pending' | 'done';

export type HumanTodoSource = 'manual' | 'agent';

export interface HumanTodo {
  id: string;
  text: string;
  status: HumanTodoStatus;
  due?: string;
  noteId?: string;
  source: HumanTodoSource;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export interface CreateTodoInput {
  text: string;
  due?: string;
  noteId?: string;
  source?: HumanTodoSource;
  status?: HumanTodoStatus;
}

interface TodosFile {
  version: 1;
  todos: HumanTodo[];
}

const TODOS_FILE = 'todos.json';

function emptyTodosFile(): TodosFile {
  return { version: 1, todos: [] };
}

function getTodosFilePath(workspacePath: string): string {
  return path.join(workspacePath, '.dogear', TODOS_FILE);
}

function generateTodoId(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += (bytes[i] % 36).toString(36);
  return out;
}

async function readTodosFile(workspacePath: string): Promise<TodosFile> {
  return safeJsonRead(getTodosFilePath(workspacePath), emptyTodosFile());
}

// safeJsonWrite 内部会对同一路径 withFileLock，在 mutateTodos 持锁期间调用会重入死锁，
// 故复制 task-store 同款原子写（tmp 验证 + bak 备份 + rename）但不重复加锁
async function writeTodosFileLocked(filePath: string, file: TodosFile): Promise<void> {
  const tmpPath = filePath + '.tmp';
  const bakPath = filePath + '.bak';
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(tmpPath, JSON.stringify(file, null, 2), 'utf-8');
  JSON.parse(await fs.readFile(tmpPath, 'utf-8'));
  try {
    await fs.access(filePath);
    try { await fs.unlink(bakPath); } catch { /* .bak 不存在 */ }
    await fs.rename(filePath, bakPath);
  } catch { /* 首次写入无原文件 */ }
  try { await fs.unlink(filePath); } catch { /* 文件不存在 */ }
  await fs.rename(tmpPath, filePath);
}

async function mutateTodos<T>(workspacePath: string, fn: (todos: HumanTodo[]) => T): Promise<T> {
  const filePath = getTodosFilePath(workspacePath);
  return withFileLock(filePath, async () => {
    const file = await readTodosFile(workspacePath);
    const result = fn(file.todos);
    await writeTodosFileLocked(filePath, file);
    return result;
  });
}

function requireText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) throw new Error('待办内容不能为空');
  return trimmed;
}

export async function createTodo(workspacePath: string, input: CreateTodoInput): Promise<HumanTodo> {
  const now = new Date().toISOString();
  const todo: HumanTodo = {
    id: generateTodoId(),
    text: requireText(input.text),
    status: input.status ?? 'pending',
    ...(input.due ? { due: input.due } : {}),
    ...(input.noteId ? { noteId: input.noteId } : {}),
    source: input.source ?? 'manual',
    createdAt: now,
    updatedAt: now,
  };
  await mutateTodos(workspacePath, (todos) => {
    todos.push(todo);
  });
  broadcastTodosChanged(workspacePath);
  return { ...todo };
}

/** 未删除待办，updatedAt 倒序 */
export async function listTodos(workspacePath: string): Promise<HumanTodo[]> {
  const file = await readTodosFile(workspacePath);
  return file.todos
    .filter((t) => !t.deletedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** 回收站：已删除待办，最近删除在前 */
export async function listDeletedTodos(workspacePath: string): Promise<HumanTodo[]> {
  const file = await readTodosFile(workspacePath);
  return file.todos
    .filter((t) => t.deletedAt)
    .sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''));
}

export async function getTodo(workspacePath: string, todoId: string): Promise<HumanTodo | null> {
  const file = await readTodosFile(workspacePath);
  const todo = file.todos.find((t) => t.id === todoId);
  return todo ? { ...todo } : null;
}

interface TodoPatch {
  text?: string;
  due?: string | null;
  status?: HumanTodoStatus;
}

async function patchTodo(workspacePath: string, todoId: string, patch: TodoPatch): Promise<HumanTodo> {
  return mutateTodos(workspacePath, (todos) => {
    const todo = todos.find((t) => t.id === todoId);
    if (!todo) throw new Error(`待办 ${todoId} 不存在`);
    if (patch.text !== undefined) todo.text = requireText(patch.text);
    if (patch.due !== undefined) {
      if (patch.due === null) delete todo.due;
      else todo.due = patch.due;
    }
    if (patch.status !== undefined) todo.status = patch.status;
    todo.updatedAt = new Date().toISOString();
    return { ...todo };
  });
  broadcastTodosChanged(workspacePath);
}

export async function updateTodoText(workspacePath: string, todoId: string, text: string): Promise<HumanTodo> {
  return patchTodo(workspacePath, todoId, { text });
}

/** due 传 null 清除 */
export async function updateTodoDue(workspacePath: string, todoId: string, due: string | null): Promise<HumanTodo> {
  return patchTodo(workspacePath, todoId, { due });
}

export async function setTodoStatus(workspacePath: string, todoId: string, status: HumanTodoStatus): Promise<HumanTodo> {
  return patchTodo(workspacePath, todoId, { status });
}

export async function softDeleteTodo(workspacePath: string, todoId: string): Promise<HumanTodo> {
  return mutateTodos(workspacePath, (todos) => {
    const todo = todos.find((t) => t.id === todoId);
    if (!todo) throw new Error(`待办 ${todoId} 不存在`);
    if (!todo.deletedAt) todo.deletedAt = new Date().toISOString();
    return { ...todo };
  });
  broadcastTodosChanged(workspacePath);
}

export async function restoreTodo(workspacePath: string, todoId: string): Promise<HumanTodo> {
  return mutateTodos(workspacePath, (todos) => {
    const todo = todos.find((t) => t.id === todoId);
    if (!todo) throw new Error(`待办 ${todoId} 不存在`);
    if (!todo.deletedAt) throw new Error(`待办 ${todoId} 不在回收站`);
    delete todo.deletedAt;
    todo.updatedAt = new Date().toISOString();
    return { ...todo };
  });
  broadcastTodosChanged(workspacePath);
}

export async function purgeTodo(workspacePath: string, todoId: string): Promise<boolean> {
  const purged = await mutateTodos(workspacePath, (todos) => {
    const idx = todos.findIndex((t) => t.id === todoId);
    if (idx < 0) return false;
    todos.splice(idx, 1);
    return true;
  });
  if (purged) broadcastTodosChanged(workspacePath);
  return purged;
}
