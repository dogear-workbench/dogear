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
  interruptTask,
  reportTaskResult,
  executeTask,
  completeTaskManually,
  moveTaskToBacklog,
  moveTaskToPlan,
  softDeleteTask,
  restoreTask,
  purgeTask,
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
  expect(task?.execProfile).toBeUndefined();
});

test('execProfile：显式传参落盘读回，缺省不落字段（读侧 ?? default 兜底）', async () => {
  const codeTask = await createTask(workspacePath, { title: '代码实施', planPath, execProfile: 'code-impl' });
  expect(codeTask.execProfile).toBe('code-impl');
  expect((await getTask(workspacePath, codeTask.id))?.execProfile).toBe('code-impl');

  const defaultTask = await createTask(workspacePath, { title: '默认执行', planPath });
  expect(defaultTask.execProfile).toBeUndefined();
  expect((await listTasks(workspacePath)).find((t) => t.id === defaultTask.id)?.execProfile).toBeUndefined();
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

test('生命周期：rejected 可移待办/手动完成（手动处置打回任务）', async () => {
  const id = await seedQueued();
  await markTaskRunning(workspacePath, id, 'exec-6');
  await rejectTask(workspacePath, id, '费率上限中断');

  const backlog = await moveTaskToBacklog(workspacePath, id);
  expect(backlog.status).toBe('backlog');
  expect(backlog.result).toBe('费率上限中断');

  await executeTask(workspacePath, id);
  await markTaskRunning(workspacePath, id, 'exec-7');
  await rejectTask(workspacePath, id, '再次失败');
  const done = await completeTaskManually(workspacePath, id);
  expect(done.status).toBe('done');
  expect(done.result).toBe('手动标记完成');
});

test('状态机：非法迁移抛错', async () => {
  const id = await seedQueued();
  await expect(completeTask(workspacePath, id, '跳过 running')).rejects.toThrow();
  await expect(reviewTask(workspacePath, id, 'approve')).rejects.toThrow();
  await expect(markTaskRunning(workspacePath, 'ghost', 'exec')).rejects.toThrow();
});

test('recoverInterruptedTasks：running 无条件置 interrupted，其他状态不动', async () => {
  const a = await seedQueued();
  const b = await createTask(workspacePath, { title: '已在审', planPath });
  await markTaskRunning(workspacePath, a, 'exec-4');
  await markTaskRunning(workspacePath, b.id, 'exec-5');
  await completeTask(workspacePath, b.id, '待审');

  const result = await recoverInterruptedTasks(workspacePath);
  expect(result.recovered).toBe(1);
  const recovered = await getTask(workspacePath, a);
  expect(recovered?.status).toBe('interrupted');
  expect(recovered?.result).toContain('应用重启时任务执行中断');
  expect((await getTask(workspacePath, b.id))?.status).toBe('review');
  expect((await listTasksGrouped(workspacePath)).interrupted).toHaveLength(1);
});

test('interruptTask：running 置 interrupted 并写入原因，可重新入队', async () => {
  const id = await seedQueued();
  await markTaskRunning(workspacePath, id, 'exec-i');
  const interrupted = await interruptTask(workspacePath, id, '执行会话卡死强制中断');
  expect(interrupted.status).toBe('interrupted');
  expect(interrupted.result).toBe('执行会话卡死强制中断');
  const queued = await executeTask(workspacePath, id);
  expect(queued.status).toBe('queued');
});

test('reportTaskResult：按 execSessionId 原子迁移 review，未命中返回 null', async () => {
  const id = await seedQueued();
  expect(await reportTaskResult(workspacePath, 'exec-mismatch', '不该生效')).toBeNull();

  await markTaskRunning(workspacePath, id, 'exec-r');
  const reported = await reportTaskResult(workspacePath, 'exec-r', '会话申报的结果摘要');
  expect(reported?.status).toBe('review');
  expect(reported?.result).toBe('会话申报的结果摘要');
  expect(await reportTaskResult(workspacePath, 'exec-r', '重复申报')).toBeNull();
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

test('createTask 支持 backlog 初始状态，executeTask 入队', async () => {
  const task = await createTask(workspacePath, { title: '积压任务', planPath, status: 'backlog' });
  expect(task.status).toBe('backlog');
  expect((await listTasksGrouped(workspacePath)).backlog).toHaveLength(1);

  await expect(markTaskRunning(workspacePath, task.id, 'exec')).rejects.toThrow();
  const queued = await executeTask(workspacePath, task.id);
  expect(queued.status).toBe('queued');
  await expect(executeTask(workspacePath, task.id)).rejects.toThrow();
});

test('createTask skipPlanCheck 允许 plan 缺失落盘', async () => {
  const task = await createTask(workspacePath, {
    title: '历史任务',
    planPath: path.join(workspacePath, 'gone.md'),
    status: 'done',
    skipPlanCheck: true,
  });
  expect(task.status).toBe('done');
});

test('软删任务从列表隐藏，恢复还原，彻底删除移出', async () => {
  const a = await seedQueued();
  const deleted = await softDeleteTask(workspacePath, a);
  expect(deleted.deletedAt).toBeTruthy();
  expect(await listTasks(workspacePath)).toHaveLength(0);
  expect((await listTasksGrouped(workspacePath)).queued).toHaveLength(0);
  expect(await getTask(workspacePath, a)).not.toBeNull();

  await softDeleteTask(workspacePath, a);
  const restored = await restoreTask(workspacePath, a);
  expect(restored.deletedAt).toBeUndefined();
  expect(await listTasks(workspacePath)).toHaveLength(1);
  await expect(restoreTask(workspacePath, a)).rejects.toThrow();

  expect(await purgeTask(workspacePath, a)).toBe(true);
  expect(await getTask(workspacePath, a)).toBeNull();
  expect(await purgeTask(workspacePath, a)).toBe(false);
  await expect(softDeleteTask(workspacePath, a)).rejects.toThrow();
});

const T0 = '2026-01-01T00:00:00.000Z';

async function seedTasksFileV1(): Promise<string> {
  const tasksPath = path.join(workspacePath, '.dogear', 'tasks.json');
  await fs.mkdir(path.dirname(tasksPath), { recursive: true });
  await fs.writeFile(
    tasksPath,
    JSON.stringify({
      version: 1,
      tasks: [
        { id: 't1', title: '旧积压', status: 'backlog', planPath, createdAt: T0, updatedAt: T0 },
        { id: 't2', title: '旧完成', status: 'done', planPath, createdAt: T0, updatedAt: T0 },
      ],
    }),
    'utf-8',
  );
  return tasksPath;
}

async function readTasksFileRaw(tasksPath: string): Promise<{ version: number; tasks: Array<{ id: string; status: string }> }> {
  return JSON.parse(await fs.readFile(tasksPath, 'utf-8'));
}

test('version 1 存量迁移：backlog 转 plan，其他态不动，写回 version 2 且幂等', async () => {
  const tasksPath = await seedTasksFileV1();

  const groups = await listTasksGrouped(workspacePath);
  expect(groups.plan.map((t) => t.id)).toEqual(['t1']);
  expect(groups.done.map((t) => t.id)).toEqual(['t2']);

  const raw = await readTasksFileRaw(tasksPath);
  expect(raw.version).toBe(2);
  expect(raw.tasks.find((t) => t.id === 't1')?.status).toBe('plan');
  expect(raw.tasks.find((t) => t.id === 't2')?.status).toBe('done');

  await listTasksGrouped(workspacePath);
  const raw2 = await readTasksFileRaw(tasksPath);
  expect(raw2.version).toBe(2);
  expect(raw2.tasks.find((t) => t.id === 't2')?.status).toBe('done');
});

test('createTask upsert：plan 态同标题更新 planPath 不新建；其他态同标题仍新建', async () => {
  const placeholder = await createTask(workspacePath, { title: '同一件事', status: 'plan' });
  expect(placeholder.planPath).toBeUndefined();

  const again = await createTask(workspacePath, { title: '同一件事', planPath, status: 'plan' });
  expect(again.id).toBe(placeholder.id);
  expect(again.planPath).toBe(planPath);
  expect(await listTasks(workspacePath)).toHaveLength(1);

  const backlogSameTitle = await createTask(workspacePath, { title: '同一件事', planPath, status: 'backlog' });
  expect(backlogSameTitle.id).toBe(placeholder.id);
  expect(backlogSameTitle.status).toBe('plan');
  expect(await listTasks(workspacePath)).toHaveLength(1);

  const backlogTask = await createTask(workspacePath, { title: '另一件事', planPath, status: 'backlog' });
  const sameTitlePlan = await createTask(workspacePath, { title: '另一件事', planPath, status: 'plan' });
  expect(sameTitlePlan.id).not.toBe(backlogTask.id);
  expect(await listTasks(workspacePath)).toHaveLength(3);
});

test('占位任务：无 planPath 可创建，getTaskDetail 无 planError，归入 plan 分组', async () => {
  const task = await createTask(workspacePath, { title: '占位', status: 'plan' });
  expect(task.planPath).toBeUndefined();
  const detail = await getTaskDetail(workspacePath, task.id);
  expect(detail?.planContent).toBeNull();
  expect(detail?.planError).toBeUndefined();
  expect((await listTasksGrouped(workspacePath)).plan).toHaveLength(1);
});

test('executeTask 接受 plan 态直接入队', async () => {
  const task = await createTask(workspacePath, { title: '直接执行', planPath, status: 'plan' });
  const queued = await executeTask(workspacePath, task.id);
  expect(queued.status).toBe('queued');
});

test('moveTaskToBacklog / moveTaskToPlan 三栏往返', async () => {
  const created = await createTask(workspacePath, { title: '计划任务', planPath, status: 'plan' });
  const toBacklog = await moveTaskToBacklog(workspacePath, created.id);
  expect(toBacklog.status).toBe('backlog');
  await expect(moveTaskToPlan(workspacePath, created.id)).rejects.toThrow();

  const done = await completeTaskManually(workspacePath, created.id);
  expect(done.status).toBe('done');
  const backToPlan = await moveTaskToPlan(workspacePath, created.id);
  expect(backToPlan.status).toBe('plan');

  await executeTask(workspacePath, created.id);
  const rejected = await rejectTask(workspacePath, created.id, '打回');
  expect(rejected.status).toBe('rejected');
  const rePlan = await moveTaskToPlan(workspacePath, created.id);
  expect(rePlan.status).toBe('plan');
});
