import { test, expect, beforeEach, afterEach } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { migrateTodosToNotes } from './migrate-notes-todos.js';
import { getNotesDir, listNoteFiles, readNoteFile, readIndex } from './notes/notes-store.js';

const WS_ID = 'ws-migrate-test';

let workspacePath: string;
let configDir: string;
let prevEnv: string | undefined;

beforeEach(async () => {
  workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'dogear-migrate-test-'));
  configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dogear-migrate-config-'));
  prevEnv = process.env.DOGEAR_CONFIG_DIR;
  process.env.DOGEAR_CONFIG_DIR = configDir;
});

afterEach(async () => {
  if (prevEnv === undefined) delete process.env.DOGEAR_CONFIG_DIR;
  else process.env.DOGEAR_CONFIG_DIR = prevEnv;
  await fs.rm(configDir, { recursive: true, force: true });
});

async function seedNote(noteId: string, content: string): Promise<void> {
  const raw = [
    '---',
    `id: ${noteId}`,
    'created: 2026-08-01T00:00:00.000Z',
    'updated: 2026-08-02T00:00:00.000Z',
    '---',
    '',
    content,
    '',
  ].join('\n');
  await fs.mkdir(getNotesDir(WS_ID), { recursive: true });
  await fs.writeFile(path.join(getNotesDir(WS_ID), `20260801-000000-${noteId}.md`), raw);
}

async function seedTodos(todos: object[]): Promise<void> {
  await fs.mkdir(path.join(workspacePath, '.dogear'), { recursive: true });
  await fs.writeFile(
    path.join(workspacePath, '.dogear', 'todos.json'),
    JSON.stringify({ version: 1, todos }),
  );
}

test('带 noteId 的待办并入已有卡片尾部一行（pending/done/due）', async () => {
  await seedNote('note0001', '已有正文');
  await seedTodos([
    { id: 't1', text: '记得买咖啡', status: 'pending', noteId: 'note0001' },
    { id: 't2', text: '交报告', status: 'done', due: '2026-09-01T00:00:00.000Z', noteId: 'note0001' },
  ]);

  const result = await migrateTodosToNotes(workspacePath, WS_ID);
  expect(result.migratedTodos).toBe(2);
  expect(result.appendedNotes).toBe(2);
  expect(result.createdNotes).toBe(0);

  const note = await readNoteFile(
    path.join(getNotesDir(WS_ID), '20260801-000000-note0001.md'),
  );
  expect(note?.content).toContain('已有正文');
  expect(note?.content).toContain('- [ ] 记得买咖啡');
  expect(note?.content).toContain('- [x] 交报告 📅 2026-09-01');
});

test('无 noteId 的待办建新卡（tags 待办，索引入）', async () => {
  await seedTodos([{ id: 't1', text: '记得买咖啡', status: 'pending' }]);

  const result = await migrateTodosToNotes(workspacePath, WS_ID);
  expect(result.createdNotes).toBe(1);
  expect(result.appendedNotes).toBe(0);

  const index = await readIndex(WS_ID);
  expect(index.items).toHaveLength(1);
  expect(index.items[0].tags).toEqual(['待办']);
  const file = path.join(getNotesDir(WS_ID), index.items[0].file);
  const note = await readNoteFile(file);
  expect(note?.content).toContain('- [ ] 记得买咖啡');
});

test('noteId 指向不存在的笔记时退化为建新卡', async () => {
  await seedTodos([{ id: 't1', text: '悬空待办', status: 'pending', noteId: 'ghost01' }]);

  const result = await migrateTodosToNotes(workspacePath, WS_ID);
  expect(result.migratedTodos).toBe(1);
  expect(result.appendedNotes).toBe(0);
  expect(result.createdNotes).toBe(1);
});

test('已删条目（deletedAt）跳过不迁', async () => {
  await seedTodos([
    { id: 't1', text: '已删待办', status: 'pending', deletedAt: '2026-08-30T00:00:00.000Z' },
    { id: 't2', text: '存活待办', status: 'pending' },
  ]);

  const result = await migrateTodosToNotes(workspacePath, WS_ID);
  expect(result.migratedTodos).toBe(1);
  expect(result.skipped).toBe(1);

  const index = await readIndex(WS_ID);
  expect(index.items).toHaveLength(1);
  const note = await readNoteFile(path.join(getNotesDir(WS_ID), index.items[0].file));
  expect(note?.content).not.toContain('已删待办');
});

test('幂等：迁完 todos.json 改名 .migrated，重跑零操作', async () => {
  await seedTodos([{ id: 't1', text: '记得买咖啡', status: 'pending' }]);

  await migrateTodosToNotes(workspacePath, WS_ID);
  await expect(fs.access(path.join(workspacePath, '.dogear', 'todos.json'))).rejects.toThrow();
  await fs.access(path.join(workspacePath, '.dogear', 'todos.json.migrated'));

  const second = await migrateTodosToNotes(workspacePath, WS_ID);
  expect(second.migratedTodos).toBe(0);
  expect(second.createdNotes).toBe(0);

  const files = await listNoteFiles(getNotesDir(WS_ID));
  expect(files).toHaveLength(1);
});

test('todos.json 不存在时零操作', async () => {
  const result = await migrateTodosToNotes(workspacePath, WS_ID);
  expect(result.migratedTodos).toBe(0);
  await expect(fs.access(path.join(workspacePath, '.dogear', 'todos.json.migrated'))).rejects.toThrow();
});
