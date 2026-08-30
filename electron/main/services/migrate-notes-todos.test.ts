import { test, expect, beforeEach } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { migrateNotesTodos } from './migrate-notes-todos.js';
import { listTasksGrouped, getTask } from './task-store.js';
import { listTodos } from './todo-service.js';
import { getNotesDir, readNoteFile, readIndex } from './notes/notes-store.js';

let workspacePath: string;

beforeEach(async () => {
  workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'dogear-migrate-test-'));
});

async function seedNote(noteId: string, todoLines: string[]): Promise<void> {
  await fs.mkdir(path.join(workspacePath, 'docs', 'plans'), { recursive: true });
  await fs.writeFile(path.join(workspacePath, 'docs', 'plans', 'p.md'), '# 计划');
  const raw = [
    '---',
    `id: ${noteId}`,
    'created: 2026-08-01T00:00:00.000Z',
    'updated: 2026-08-02T00:00:00.000Z',
    'tags: [设计]',
    ...((todoLines.length > 0 ? ['todos:'] : []) as string[]),
    ...todoLines.map((l) => `  - ${l}`),
    '---',
    '',
    '正文第一行',
    '',
  ].join('\n');
  await fs.mkdir(getNotesDir(workspacePath), { recursive: true });
  await fs.writeFile(path.join(getNotesDir(workspacePath), `20260801-000000-${noteId}.md`), raw);
}

test('迁移：带 plan 的 pending/done 入任务体系，无 plan 转人待办，frontmatter 清 todos', async () => {
  await seedNote(
    'note0001',
    [
      '{"id":"t1","text":"实施 A","status":"pending","plan":"docs/plans/p.md"}',
      '{"id":"t2","text":"实施 B","status":"done","plan":"docs/plans/p.md"}',
      '{"id":"t3","text":"记得买咖啡","status":"pending"}',
    ],
  );

  const result = await migrateNotesTodos(workspacePath);
  expect(result.migratedNotes).toBe(1);
  expect(result.createdTasks).toBe(2);
  expect(result.createdHumanTodos).toBe(1);

  const groups = await listTasksGrouped(workspacePath);
  expect(groups.backlog).toHaveLength(1);
  expect(groups.backlog[0].title).toBe('实施 A');
  expect(groups.backlog[0].noteId).toBe('note0001');
  expect(groups.backlog[0].planPath).toBe(path.join(workspacePath, 'docs', 'plans', 'p.md'));
  expect(groups.done).toHaveLength(1);
  expect(groups.done[0].title).toBe('实施 B');

  const humanTodos = await listTodos(workspacePath);
  expect(humanTodos).toHaveLength(1);
  expect(humanTodos[0].text).toBe('记得买咖啡');
  expect(humanTodos[0].source).toBe('manual');

  const noteFile = path.join(getNotesDir(workspacePath), '20260801-000000-note0001.md');
  const note = await readNoteFile(noteFile);
  expect(note?.tags).toEqual(['设计']);
  expect(note?.content).toContain('正文第一行');
  const rawAfter = await fs.readFile(noteFile, 'utf-8');
  expect(rawAfter).not.toContain('todos:');
  const index = await readIndex(workspacePath);
  expect(index.items[0].tags).toEqual(['设计']);
});

test('迁移幂等：跑过一次后再次迁移跳过', async () => {
  await seedNote('note0002', ['{"id":"t1","text":"实施 A","status":"pending","plan":"docs/plans/p.md"}']);

  await migrateNotesTodos(workspacePath);
  const second = await migrateNotesTodos(workspacePath);
  expect(second.migratedNotes).toBe(0);
  expect(second.createdTasks).toBe(0);

  const groups = await listTasksGrouped(workspacePath);
  expect(groups.backlog).toHaveLength(1);
});

test('plan 文件缺失仍创建任务保留记录，in_progress 归 backlog', async () => {
  await seedNote('note0003', ['{"id":"t1","text":"实施 C","status":"in_progress","plan":"docs/plans/gone.md"}']);

  const result = await migrateNotesTodos(workspacePath);
  expect(result.createdTasks).toBe(1);
  const groups = await listTasksGrouped(workspacePath);
  expect(groups.backlog[0].title).toBe('实施 C');
  expect((await getTask(workspacePath, groups.backlog[0].id))?.planPath).toBe(
    path.join(workspacePath, 'docs', 'plans', 'gone.md'),
  );
});

test('无 todos 的笔记跳过，回收站目录不扫描', async () => {
  await seedNote('note0004', []);
  const trashDir = path.join(getNotesDir(workspacePath), '.trash');
  await fs.mkdir(trashDir, { recursive: true });
  const raw = [
    '---',
    'id: note0005',
    'created: 2026-08-01T00:00:00.000Z',
    'updated: 2026-08-02T00:00:00.000Z',
    'todos:',
    '  - {"id":"t1","text":"回收站里的待办","status":"pending"}',
    '---',
    '',
  ].join('\n');
  await fs.writeFile(path.join(trashDir, '20260801-000000-note0005.md'), raw);

  const result = await migrateNotesTodos(workspacePath);
  expect(result.migratedNotes).toBe(0);
  expect(result.createdTasks).toBe(0);
  expect(result.createdHumanTodos).toBe(0);
});
