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
  rejectTask,
  recoverInterruptedTasks,
  interruptTask,
  reportTaskResult,
  executeTask,
  completeTaskManually,
  moveTaskToBacklog,
  moveTaskToPlan,
  updateTask,
  softDeleteTask,
  restoreTask,
  purgeTask,
} from './task-store.js';
import { setWorkspaceDataConfigDir, resetWorkspaceDataConfigDir } from './workspace-data-root.js';

const TEST_WS_ID = 'ws-test';

let workspacePath: string;
let configDir: string;
let planPath: string;

function tasksFilePath(): string {
  return path.join(configDir, 'workspaces', TEST_WS_ID, 'tasks.json');
}

beforeEach(async () => {
  workspacePath = await fs.mkdtemp(path.join(os.tmpdir(), 'dogear-task-test-'));
  configDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dogear-task-cfg-'));
  resetWorkspaceDataConfigDir();
  setWorkspaceDataConfigDir(configDir);
  await fs.mkdir(path.join(workspacePath, 'docs'), { recursive: true });
  planPath = path.join(workspacePath, 'docs', 'plan.md');
  await fs.writeFile(planPath, '# 测试计划\n按计划实施');
});

async function seedQueued(): Promise<string> {
  const task = await createTask(TEST_WS_ID, workspacePath, { title: '实施测试', planPath, originSessionId: 'conv-1' });
  return task.id;
}

test('createTask：plan 不存在时抛错不落盘', async () => {
  await expect(
    createTask(TEST_WS_ID, workspacePath, { title: '坏任务', planPath: path.join(workspacePath, 'nope.md') }),
  ).rejects.toThrow();
  expect(await listTasks(TEST_WS_ID)).toHaveLength(0);
});

test('createTask：落盘 queued 并带来源会话，tasks.json 落 configDir/workspaces/{wsid}/', async () => {
  const task = await getTask(TEST_WS_ID, await seedQueued());
  expect(task?.status).toBe('queued');
  expect(task?.originSessionId).toBe('conv-1');
  expect(task?.execSessionId).toBeUndefined();
  expect(task?.execProfile).toBeUndefined();
  await fs.access(tasksFilePath());
});

test('execProfile：显式传参落盘读回，缺省不落字段（读侧 ?? default 兜底）', async () => {
  const codeTask = await createTask(TEST_WS_ID, workspacePath, { title: '代码实施', planPath, execProfile: 'code-impl' });
  expect(codeTask.execProfile).toBe('code-impl');
  expect((await getTask(TEST_WS_ID, codeTask.id))?.execProfile).toBe('code-impl');

  const defaultTask = await createTask(TEST_WS_ID, workspacePath, { title: '默认执行', planPath });
  expect(defaultTask.execProfile).toBeUndefined();
  expect((await listTasks(TEST_WS_ID)).find((t) => t.id === defaultTask.id)?.execProfile).toBeUndefined();
});

test('生命周期：queued → running → review → done', async () => {
  const id = await seedQueued();
  await markTaskRunning(TEST_WS_ID, id, 'exec-1');
  expect((await getTask(TEST_WS_ID, id))?.status).toBe('running');
  expect((await getTask(TEST_WS_ID, id))?.execSessionId).toBe('exec-1');
  await reportTaskResult(TEST_WS_ID, 'exec-1');
  const reviewed = await getTask(TEST_WS_ID, id);
  expect(reviewed?.status).toBe('review');
  expect(reviewed?.result).toBeUndefined();
  const done = await reviewTask(TEST_WS_ID, id, 'approve');
  expect(done.status).toBe('done');
});

test('生命周期：running → rejected，review 可打回', async () => {
  const id = await seedQueued();
  await markTaskRunning(TEST_WS_ID, id, 'exec-2');
  const rejected = await rejectTask(TEST_WS_ID, id, '执行轮次失败');
  expect(rejected.status).toBe('rejected');
  expect(rejected.result).toBe('执行轮次失败');
  expect((await listTasksGrouped(TEST_WS_ID)).rejected).toHaveLength(1);

  const id2 = await seedQueued();
  await markTaskRunning(TEST_WS_ID, id2, 'exec-3');
  await reportTaskResult(TEST_WS_ID, 'exec-3');
  const rejected2 = await reviewTask(TEST_WS_ID, id2, 'reject');
  expect(rejected2.status).toBe('rejected');
});

test('生命周期：rejected 可移待办/手动完成（手动处置打回任务）', async () => {
  const id = await seedQueued();
  await markTaskRunning(TEST_WS_ID, id, 'exec-6');
  await rejectTask(TEST_WS_ID, id, '费率上限中断');

  const backlog = await moveTaskToBacklog(TEST_WS_ID, id);
  expect(backlog.status).toBe('backlog');
  expect(backlog.result).toBe('费率上限中断');

  await executeTask(TEST_WS_ID, id);
  await markTaskRunning(TEST_WS_ID, id, 'exec-7');
  await rejectTask(TEST_WS_ID, id, '再次失败');
  const done = await completeTaskManually(TEST_WS_ID, id);
  expect(done.status).toBe('done');
  expect(done.result).toBe('再次失败');
});

test('状态机：非法迁移抛错', async () => {
  const id = await seedQueued();
  expect(await reportTaskResult(TEST_WS_ID, 'exec')).toBeNull();
  await expect(reviewTask(TEST_WS_ID, id, 'approve')).rejects.toThrow();
  await expect(markTaskRunning(TEST_WS_ID, 'ghost', 'exec')).rejects.toThrow();
});

test('recoverInterruptedTasks：running 无条件置 interrupted，其他状态不动', async () => {
  const a = await seedQueued();
  const b = await createTask(TEST_WS_ID, workspacePath, { title: '已在审', planPath });
  await markTaskRunning(TEST_WS_ID, a, 'exec-4');
  await markTaskRunning(TEST_WS_ID, b.id, 'exec-5');
  await reportTaskResult(TEST_WS_ID, 'exec-5');

  const result = await recoverInterruptedTasks(TEST_WS_ID);
  expect(result.recovered).toBe(1);
  const recovered = await getTask(TEST_WS_ID, a);
  expect(recovered?.status).toBe('interrupted');
  expect(recovered?.result).toContain('应用重启时任务执行中断');
  expect((await getTask(TEST_WS_ID, b.id))?.status).toBe('review');
  expect((await listTasksGrouped(TEST_WS_ID)).interrupted).toHaveLength(1);
});

test('interruptTask：running 置 interrupted 并写入原因，可重新入队', async () => {
  const id = await seedQueued();
  await markTaskRunning(TEST_WS_ID, id, 'exec-i');
  const interrupted = await interruptTask(TEST_WS_ID, id, '执行会话卡死强制中断');
  expect(interrupted.status).toBe('interrupted');
  expect(interrupted.result).toBe('执行会话卡死强制中断');
  const queued = await executeTask(TEST_WS_ID, id);
  expect(queued.status).toBe('queued');
});

test('reportTaskResult：按 execSessionId 原子迁移 review 不写 result，未命中返回 null', async () => {
  const id = await seedQueued();
  expect(await reportTaskResult(TEST_WS_ID, 'exec-mismatch')).toBeNull();

  await markTaskRunning(TEST_WS_ID, id, 'exec-r');
  const reported = await reportTaskResult(TEST_WS_ID, 'exec-r');
  expect(reported?.status).toBe('review');
  expect(reported?.result).toBeUndefined();
  expect(await reportTaskResult(TEST_WS_ID, 'exec-r')).toBeNull();
});

test('listTasksGrouped 按状态分组', async () => {
  const a = await seedQueued();
  const b = await createTask(TEST_WS_ID, workspacePath, { title: '执行中', planPath });
  await markTaskRunning(TEST_WS_ID, b.id, 'exec-6');
  const groups = await listTasksGrouped(TEST_WS_ID);
  expect(groups.queued.map((t) => t.id)).toContain(a);
  expect(groups.running).toHaveLength(1);
  expect(groups.done).toHaveLength(0);
});

test('getTaskDetail 聚合 plan 内容，plan 丢失时带 planError', async () => {
  const id = await seedQueued();
  const detail = await getTaskDetail(TEST_WS_ID, workspacePath, id);
  expect(detail?.planContent).toBe('# 测试计划\n按计划实施');

  await fs.unlink(planPath);
  const broken = await getTaskDetail(TEST_WS_ID, workspacePath, id);
  expect(broken?.planContent).toBeNull();
  expect(broken?.planError).toContain('读取失败');
});

test('createTask 支持 backlog 初始状态，executeTask 入队', async () => {
  const task = await createTask(TEST_WS_ID, workspacePath, { title: '积压任务', planPath, status: 'backlog' });
  expect(task.status).toBe('backlog');
  expect((await listTasksGrouped(TEST_WS_ID)).backlog).toHaveLength(1);

  await expect(markTaskRunning(TEST_WS_ID, task.id, 'exec')).rejects.toThrow();
  const queued = await executeTask(TEST_WS_ID, task.id);
  expect(queued.status).toBe('queued');
  await expect(executeTask(TEST_WS_ID, task.id)).rejects.toThrow();
});

test('createTask skipPlanCheck 允许 plan 缺失落盘', async () => {
  const task = await createTask(TEST_WS_ID, workspacePath, {
    title: '历史任务',
    planPath: path.join(workspacePath, 'gone.md'),
    status: 'done',
    skipPlanCheck: true,
  });
  expect(task.status).toBe('done');
});

test('软删任务从列表隐藏，恢复还原，彻底删除移出', async () => {
  const a = await seedQueued();
  const deleted = await softDeleteTask(TEST_WS_ID, a);
  expect(deleted.deletedAt).toBeTruthy();
  expect(await listTasks(TEST_WS_ID)).toHaveLength(0);
  expect((await listTasksGrouped(TEST_WS_ID)).queued).toHaveLength(0);
  expect(await getTask(TEST_WS_ID, a)).not.toBeNull();

  await softDeleteTask(TEST_WS_ID, a);
  const restored = await restoreTask(TEST_WS_ID, a);
  expect(restored.deletedAt).toBeUndefined();
  expect(await listTasks(TEST_WS_ID)).toHaveLength(1);
  await expect(restoreTask(TEST_WS_ID, a)).rejects.toThrow();

  expect(await purgeTask(TEST_WS_ID, a)).toBe(true);
  expect(await getTask(TEST_WS_ID, a)).toBeNull();
  expect(await purgeTask(TEST_WS_ID, a)).toBe(false);
  await expect(softDeleteTask(TEST_WS_ID, a)).rejects.toThrow();
});

const T0 = '2026-01-01T00:00:00.000Z';

async function seedTasksFileV1(): Promise<string> {
  const tasksPath = tasksFilePath();
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

async function readTasksFileRaw(
  tasksPath: string,
): Promise<{ version: number; tasks: Array<{ id: string; status: string; planPath?: string }> }> {
  return JSON.parse(await fs.readFile(tasksPath, 'utf-8'));
}

test('version 1 存量迁移：backlog 转 plan，写回 version 3 且幂等', async () => {
  const tasksPath = await seedTasksFileV1();

  const groups = await listTasksGrouped(TEST_WS_ID);
  expect(groups.plan.map((t) => t.id)).toEqual(['t1']);
  expect(groups.done.map((t) => t.id)).toEqual(['t2']);

  const raw = await readTasksFileRaw(tasksPath);
  expect(raw.version).toBe(3);
  expect(raw.tasks.find((t) => t.id === 't1')?.status).toBe('plan');
  expect(raw.tasks.find((t) => t.id === 't2')?.status).toBe('done');

  await listTasksGrouped(TEST_WS_ID);
  const raw2 = await readTasksFileRaw(tasksPath);
  expect(raw2.version).toBe(3);
  expect(raw2.tasks.find((t) => t.id === 't2')?.status).toBe('done');
});

test('version 2→3：仅 bump 版本号，存量绝对 planPath 原样保留（读侧 resolvePlanPath 兼容），幂等', async () => {
  const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dogear-outside-plan-'));
  const outsidePlanPath = path.join(outsideDir, 'plan.md');
  await fs.writeFile(outsidePlanPath, '# 外部计划', 'utf-8');
  const tasksPath = tasksFilePath();
  await fs.mkdir(path.dirname(tasksPath), { recursive: true });
  await fs.writeFile(
    tasksPath,
    JSON.stringify({
      version: 2,
      tasks: [
        { id: 'in', title: '工作区内', status: 'queued', planPath, createdAt: T0, updatedAt: T0 },
        { id: 'out', title: '工作区外', status: 'queued', planPath: outsidePlanPath, createdAt: T0, updatedAt: T0 },
      ],
    }),
    'utf-8',
  );

  await listTasks(TEST_WS_ID);

  const raw = await readTasksFileRaw(tasksPath);
  expect(raw.version).toBe(3);
  expect(raw.tasks.find((t) => t.id === 'in')?.planPath).toBe(planPath);
  expect(raw.tasks.find((t) => t.id === 'out')?.planPath).toBe(outsidePlanPath);

  await listTasks(TEST_WS_ID);
  const raw2 = await readTasksFileRaw(tasksPath);
  expect(raw2.version).toBe(3);
});

test('planPath round-trip：createTask 落盘存相对，读侧还原绝对且内容可读', async () => {
  const created = await createTask(TEST_WS_ID, workspacePath, { title: '往返', planPath });
  expect(created.planPath).toBe('docs/plan.md');

  const raw = await readTasksFileRaw(tasksFilePath());
  expect(raw.version).toBe(3);
  expect(raw.tasks[0]?.planPath).toBe('docs/plan.md');

  expect((await getTask(TEST_WS_ID, created.id))?.planPath).toBe('docs/plan.md');
  const detail = await getTaskDetail(TEST_WS_ID, workspacePath, created.id);
  expect(detail?.planPath).toBe(planPath);
  expect(detail?.planContent).toBe('# 测试计划\n按计划实施');
});

test('version 3 直写绝对 planPath（迁移保留/历史手写形态）读取不回归', async () => {
  const tasksPath = tasksFilePath();
  await fs.mkdir(path.dirname(tasksPath), { recursive: true });
  await fs.writeFile(
    tasksPath,
    JSON.stringify({
      version: 3,
      tasks: [{ id: 'abs', title: '绝对遗留', status: 'plan', planPath, createdAt: T0, updatedAt: T0 }],
    }),
    'utf-8',
  );
  const detail = await getTaskDetail(TEST_WS_ID, workspacePath, 'abs');
  expect(detail?.planPath).toBe(planPath);
  expect(detail?.planContent).toBe('# 测试计划\n按计划实施');
});

test('createTask 接受工作区相对 planPath 入参，落盘归一化后读侧可读', async () => {
  const task = await createTask(TEST_WS_ID, workspacePath, { title: '相对入参', planPath: 'docs/plan.md' });
  expect(task.planPath).toBe('docs/plan.md');
  const detail = await getTaskDetail(TEST_WS_ID, workspacePath, task.id);
  expect(detail?.planContent).toBe('# 测试计划\n按计划实施');
});

test('createTask 同标题拒绝：plan 态已存在时抛错不新建；其他态同标题仍新建', async () => {
  const first = await createTask(TEST_WS_ID, workspacePath, { title: '同一件事', planPath, status: 'plan' });
  expect(first.planPath).toBe('docs/plan.md');
  expect(await listTasks(TEST_WS_ID)).toHaveLength(1);

  await expect(
    createTask(TEST_WS_ID, workspacePath, { title: '同一件事', planPath, status: 'plan' }),
  ).rejects.toThrow('已存在');
  expect(await listTasks(TEST_WS_ID)).toHaveLength(1);

  const backlogTask = await createTask(TEST_WS_ID, workspacePath, { title: '另一件事', planPath, status: 'backlog' });
  const sameTitlePlan = await createTask(TEST_WS_ID, workspacePath, { title: '另一件事', planPath, status: 'plan' });
  expect(sameTitlePlan.id).not.toBe(backlogTask.id);
  expect(await listTasks(TEST_WS_ID)).toHaveLength(3);
});

test('updateTask：三字段 patch 生效，planPath 归一化落盘且 updatedAt 刷新', async () => {
  const created = await createTask(TEST_WS_ID, workspacePath, {
    title: '可编辑',
    planPath,
    status: 'plan',
    execProfile: 'code-impl',
  });
  const before = await getTask(TEST_WS_ID, created.id);
  const planB = path.join(workspacePath, 'docs', 'plan-b.md');
  await fs.writeFile(planB, '# 备用计划', 'utf-8');

  const updated = await updateTask(TEST_WS_ID, workspacePath, created.id, {
    title: '  改名后  ',
    planPath: planB,
    execProfile: 'default',
  });
  expect(updated.title).toBe('改名后');
  expect(updated.planPath).toBe('docs/plan-b.md');
  expect(updated.execProfile).toBe('default');
  expect(updated.updatedAt >= before!.updatedAt).toBe(true);

  const reread = await getTask(TEST_WS_ID, created.id);
  expect(reread?.title).toBe('改名后');
  expect(reread?.planPath).toBe('docs/plan-b.md');

  const detail = await getTaskDetail(TEST_WS_ID, workspacePath, created.id);
  expect(detail?.planContent).toBe('# 备用计划');

  await expect(updateTask(TEST_WS_ID, workspacePath, created.id, { title: '   ' })).rejects.toThrow(
    '任务标题不能为空',
  );
});

test('updateTask title 撞名拒绝：plan 态同标题抛错，排除自身，backlog 态同名不拦', async () => {
  const a = await createTask(TEST_WS_ID, workspacePath, { title: '甲', planPath, status: 'plan' });
  const b = await createTask(TEST_WS_ID, workspacePath, { title: '乙', planPath, status: 'plan' });
  await expect(updateTask(TEST_WS_ID, workspacePath, a.id, { title: '乙' })).rejects.toThrow('已存在');
  expect((await getTask(TEST_WS_ID, a.id))?.title).toBe('甲');

  const selfRename = await updateTask(TEST_WS_ID, workspacePath, b.id, { title: '乙' });
  expect(selfRename.title).toBe('乙');

  await createTask(TEST_WS_ID, workspacePath, { title: '丙', planPath, status: 'backlog' });
  const renamed = await updateTask(TEST_WS_ID, workspacePath, a.id, { title: '丙' });
  expect(renamed.title).toBe('丙');
});

test('updateTask planPath 不存在拒绝且不落盘', async () => {
  const created = await createTask(TEST_WS_ID, workspacePath, { title: '挂载校验', planPath, status: 'backlog' });
  await expect(
    updateTask(TEST_WS_ID, workspacePath, created.id, { planPath: path.join(workspacePath, 'nope.md') }),
  ).rejects.toThrow();
  expect((await getTask(TEST_WS_ID, created.id))?.planPath).toBe('docs/plan.md');
});

test('updateTask 非 plan/backlog 状态拒绝，任务不存在拒绝', async () => {
  const id = await seedQueued();
  await expect(updateTask(TEST_WS_ID, workspacePath, id, { execProfile: 'code-impl' })).rejects.toThrow(
    '仅计划/积压任务可编辑',
  );
  await expect(updateTask(TEST_WS_ID, workspacePath, id, { title: '排队中改名' })).rejects.toThrow();
  await expect(updateTask(TEST_WS_ID, workspacePath, 'ghost', { title: '不存在' })).rejects.toThrow('不存在');
});

test('存量任务无 planPath（历史遗留，直写 tasks.json）：getTaskDetail 无 planError，归入 plan 分组', async () => {
  const tasksPath = tasksFilePath();
  await fs.mkdir(path.dirname(tasksPath), { recursive: true });
  await fs.writeFile(
    tasksPath,
    JSON.stringify({
      version: 2,
      tasks: [{ id: 'legacy', title: '历史遗留', status: 'plan', createdAt: T0, updatedAt: T0 }],
    }),
    'utf-8',
  );
  const detail = await getTaskDetail(TEST_WS_ID, workspacePath, 'legacy');
  expect(detail?.planContent).toBeNull();
  expect(detail?.planError).toBeUndefined();
  expect((await listTasksGrouped(TEST_WS_ID)).plan).toHaveLength(1);
});

test('executeTask 接受 plan 态直接入队', async () => {
  const task = await createTask(TEST_WS_ID, workspacePath, { title: '直接执行', planPath, status: 'plan' });
  const queued = await executeTask(TEST_WS_ID, task.id);
  expect(queued.status).toBe('queued');
});

test('moveTaskToBacklog / moveTaskToPlan 三栏往返', async () => {
  const created = await createTask(TEST_WS_ID, workspacePath, { title: '计划任务', planPath, status: 'plan' });
  const toBacklog = await moveTaskToBacklog(TEST_WS_ID, created.id);
  expect(toBacklog.status).toBe('backlog');
  await expect(moveTaskToPlan(TEST_WS_ID, created.id)).rejects.toThrow();

  const done = await completeTaskManually(TEST_WS_ID, created.id);
  expect(done.status).toBe('done');
  const backToPlan = await moveTaskToPlan(TEST_WS_ID, created.id);
  expect(backToPlan.status).toBe('plan');

  await executeTask(TEST_WS_ID, created.id);
  const rejected = await rejectTask(TEST_WS_ID, created.id, '打回');
  expect(rejected.status).toBe('rejected');
  const rePlan = await moveTaskToPlan(TEST_WS_ID, created.id);
  expect(rePlan.status).toBe('plan');
});
