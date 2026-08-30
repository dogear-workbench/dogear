import { test, expect, beforeEach } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  createTodo,
  listTodos,
  getTodo,
  updateTodoText,
  updateTodoDue,
  setTodoStatus,
  softDeleteTodo,
  restoreTodo,
  purgeTodo,
} from './todo-service.js';

let workspacePath: string;

beforeEach(async () => {
  workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'dogear-todo-test-'));
});

test('createTodo：默认 pending/manual，可带 due/noteId/status', async () => {
  const todo = await createTodo(workspacePath, { text: '买菜' });
  expect(todo.status).toBe('pending');
  expect(todo.source).toBe('manual');
  expect(todo.due).toBeUndefined();
  expect(todo.deletedAt).toBeUndefined();

  const linked = await createTodo(workspacePath, {
    text: '问客户',
    due: '2026-09-01',
    noteId: 'note-1',
    source: 'agent',
    status: 'done',
  });
  expect(linked.due).toBe('2026-09-01');
  expect(linked.noteId).toBe('note-1');
  expect(linked.source).toBe('agent');
  expect(linked.status).toBe('done');

  await expect(createTodo(workspacePath, { text: '   ' })).rejects.toThrow();
});

test('listTodos：过滤软删项，updatedAt 倒序', async () => {
  const a = await createTodo(workspacePath, { text: '一' });
  await createTodo(workspacePath, { text: '二' });
  await softDeleteTodo(workspacePath, a.id);
  const list = await listTodos(workspacePath);
  expect(list).toHaveLength(1);
  expect(list[0].text).toBe('二');
});

test('updateText / updateDue（null 清除）/ setStatus', async () => {
  const todo = await createTodo(workspacePath, { text: '原文本', due: '2026-09-01' });
  const retexted = await updateTodoText(workspacePath, todo.id, '新文本');
  expect(retexted.text).toBe('新文本');
  const noDue = await updateTodoDue(workspacePath, todo.id, null);
  expect(noDue.due).toBeUndefined();
  const withDue = await updateTodoDue(workspacePath, todo.id, '2026-10-01');
  expect(withDue.due).toBe('2026-10-01');
  const done = await setTodoStatus(workspacePath, todo.id, 'done');
  expect(done.status).toBe('done');
  await expect(updateTodoText(workspacePath, todo.id, '  ')).rejects.toThrow();
  await expect(setTodoStatus(workspacePath, 'ghost', 'done')).rejects.toThrow();
});

test('软删/恢复/彻底删除', async () => {
  const todo = await createTodo(workspacePath, { text: '待删' });
  await softDeleteTodo(workspacePath, todo.id);
  await softDeleteTodo(workspacePath, todo.id);
  expect((await getTodo(workspacePath, todo.id))?.deletedAt).toBeTruthy();

  const restored = await restoreTodo(workspacePath, todo.id);
  expect(restored.deletedAt).toBeUndefined();
  await expect(restoreTodo(workspacePath, todo.id)).rejects.toThrow();

  expect(await purgeTodo(workspacePath, todo.id)).toBe(true);
  expect(await getTodo(workspacePath, todo.id)).toBeNull();
  expect(await purgeTodo(workspacePath, todo.id)).toBe(false);
});
