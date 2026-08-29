import { test, expect, beforeEach } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  createTask,
  listTasks,
  listTasksGrouped,
  getTask,
  getTaskDetail,
  reviewTask,
  markTaskRunning,
  completeTask,
  rejectTask,
  recoverInterruptedTasks,
} from './task-store.js';

let workspacePath: string;
let planPath: string;

beforeEach(async () => {
  workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'dogear-task-test-'));
  await fs.mkdir(path.join(workspacePath, 'docs'), { recursive: true });
  planPath = path.join(workspacePath, 'docs', 'plan.md');
  await fs.writeFile(planPath, '# 测试计划\n按计划实施');
});

async function seedQueued(): Promise<string> {
  const task = await createTask(workspacePath, { title: '实施测试', planPath, originSessionId: 'conv-1' });
  return task.id;
}

test('createTask：plan 不存在时抛错不落盘', async () => {
  await expect(
    createTask(workspacePath, { title: '坏任务', planPath: path.join(workspacePath, 'nope.md') }),
  ).rejects.toThrow();
  expect(await listTasks(workspacePath)).toHaveLength(0);
});

test('createTask：落盘 queued 并带来源会话', async () => {
  const task = await getTask(workspacePath, await seedQueued());
  expect(task?.status).toBe('queued');
  expect(task?.originSessionId).toBe('conv-1');
  expect(task?.execSessionId).toBeUndefined();
});

test('生命周期：queued → running → review → done', async () => {
  const id = await seedQueued();
  await markTaskRunning(workspacePath, id, 'exec-1');
  expect((await getTask(workspacePath, id))?.status).toBe('running');
  expect((await getTask(workspacePath, id))?.execSessionId).toBe('exec-1');
  await completeTask(workspacePath, id, '完成了关键改动');
  const reviewed = await getTask(workspacePath, id);
  expect(reviewed?.status).toBe('review');
  expect(reviewed?.result).toBe('完成了关键改动');
  const done = await reviewTask(workspacePath, id, 'approve');
  expect(done.status).toBe('done');
});

test('生命周期：running → rejected，review 可打回', async () => {
  const id = await seedQueued();
  await markTaskRunning(workspacePath, id, 'exec-2');
  const rejected = await rejectTask(workspacePath, id, '执行轮次失败');
  expect(rejected.status).toBe('rejected');
  expect(rejected.result).toBe('执行轮次失败');
  expect((await listTasksGrouped(workspacePath)).rejected).toHaveLength(1);

  const id2 = await seedQueued();
  await markTaskRunning(workspacePath, id2, 'exec-3');
  await completeTask(workspacePath, id2, '待审');
  const rejected2 = await reviewTask(workspacePath, id2, 'reject');
  expect(rejected2.status).toBe('rejected');
});

test('状态机：非法迁移抛错', async () => {
  const id = await seedQueued();
  await expect(completeTask(workspacePath, id, '跳过 running')).rejects.toThrow();
  await expect(reviewTask(workspacePath, id, 'approve')).rejects.toThrow();
  await expect(markTaskRunning(workspacePath, 'ghost', 'exec')).rejects.toThrow();
});

test('recoverInterruptedTasks：running 回 queued，其他状态不动', async () => {
  const a = await seedQueued();
  const b = await createTask(workspacePath, { title: '已在审', planPath });
  await markTaskRunning(workspacePath, a, 'exec-4');
  await markTaskRunning(workspacePath, b.id, 'exec-5');
  await completeTask(workspacePath, b.id, '待审');

  const recovered = await recoverInterruptedTasks(workspacePath);
  expect(recovered).toBe(1);
  expect((await getTask(workspacePath, a))?.status).toBe('queued');
  expect((await getTask(workspacePath, b.id))?.status).toBe('review');
});

test('listTasksGrouped 按状态分组', async () => {
  const a = await seedQueued();
  const b = await createTask(workspacePath, { title: '执行中', planPath });
  await markTaskRunning(workspacePath, b.id, 'exec-6');
  const groups = await listTasksGrouped(workspacePath);
  expect(groups.queued.map((t) => t.id)).toContain(a);
  expect(groups.running).toHaveLength(1);
  expect(groups.done).toHaveLength(0);
});

test('getTaskDetail 聚合 plan 内容，plan 丢失时带 planError', async () => {
  const id = await seedQueued();
  const detail = await getTaskDetail(workspacePath, id);
  expect(detail?.planContent).toBe('# 测试计划\n按计划实施');

  await fs.unlink(planPath);
  const broken = await getTaskDetail(workspacePath, id);
  expect(broken?.planContent).toBeNull();
  expect(broken?.planError).toContain('读取失败');
});
