/**
 * 任务存储原语层：Task CRUD + 状态机 + .dogear/tasks.json 读写（零 Electron 依赖）
 *
 * - 状态机 plan → backlog/queued → running → review → done/rejected；done/rejected 可回 plan（移回计划）或 backlog/done（手动处置打回任务）；interrupted = 执行中意外中断（重启/卡死），交用户手动处置；rejected = 执行前确定性拒绝，两者均可被申报回写（→ review）
 * - 写操作统一走 mutateTasks（withFileLock 串行化 + 原子落盘）；读写前 ensureMigrated 做 version 1 → 2 存量迁移（backlog → plan）
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { safeJsonRead, withFileLock } from './safe-json.js';
import type { ExecProfile } from './task-execution-prompt.js';

export type { ExecProfile };

export type TaskStatus = 'plan' | 'backlog' | 'queued' | 'running' | 'review' | 'done' | 'rejected' | 'interrupted';

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  /** 计划文档路径；新建任务必填，仅存量历史任务可能缺省 */
  planPath?: string;
  /** 执行类型；缺省 default（存量任务无字段等价 default），读侧用 ?? 'default' 兜底 */
  execProfile?: ExecProfile;
  originSessionId?: string;
  execSessionId?: string;
  /** 已废弃，读时忽略 */
  lastActiveAt?: string;
  result?: string;
  createdAt: string;
  updatedAt: string;
  /** 软删除 → 回收站 */
  deletedAt?: string;
}

export interface CreateTaskInput {
  title: string;
  planPath: string;
  originSessionId?: string;
  execProfile?: ExecProfile;
  /** 初始状态；done 仅存量迁移用 */
  status?: 'queued' | 'backlog' | 'plan' | 'done';
  /** 跳过 plan 文件存在性检查（存量迁移时 plan 可能已被清理，仍需保留任务记录） */
  skipPlanCheck?: boolean;
}

export type ReviewAction = 'approve' | 'reject';

export interface TaskDetail extends Task {
  planContent: string | null;
  planError?: string;
}

export interface TaskGroups {
  plan: Task[];
  backlog: Task[];
  queued: Task[];
  running: Task[];
  review: Task[];
  done: Task[];
  rejected: Task[];
  interrupted: Task[];
}

interface TasksFile {
  version: 2;
  tasks: Task[];
}

const TASKS_FILE = 'tasks.json';

const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  plan: ['backlog', 'queued', 'done'],
  backlog: ['queued', 'done'],
  queued: ['running', 'rejected', 'backlog'],
  running: ['review', 'interrupted', 'rejected', 'backlog'],
  review: ['done', 'rejected'],
  done: ['plan'],
  rejected: ['plan', 'backlog', 'done', 'review'],
  interrupted: ['review', 'queued', 'plan', 'done'],
};

// 缺省值每次新建而非共享常量：mutateTasks 会原地 push，共享常量会被首次读污染并跨工作区泄漏
function emptyTasksFile(): TasksFile {
  return { version: 2, tasks: [] };
}

function getTasksFilePath(workspacePath: string): string {
  return path.join(workspacePath, '.dogear', TASKS_FILE);
}

function generateTaskId(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += (bytes[i] % 36).toString(36);
  return out;
}

async function readTasksFile(workspacePath: string): Promise<TasksFile> {
  return safeJsonRead(getTasksFilePath(workspacePath), emptyTasksFile());
}

const migrations = new Map<string, Promise<void>>();

async function ensureMigrated(workspacePath: string): Promise<void> {
  const pending = migrations.get(workspacePath);
  if (pending) return pending;
  const run = (async () => {
    const filePath = getTasksFilePath(workspacePath);
    await withFileLock(filePath, async () => {
      const file = await readTasksFile(workspacePath);
      if (file.version >= 2) return;
      const now = new Date().toISOString();
      for (const task of file.tasks) {
        if (task.status !== 'backlog') continue;
        task.status = 'plan';
        task.updatedAt = now;
      }
      file.version = 2;
      await writeTasksFileLocked(filePath, file);
    });
  })().catch((err) => {
    migrations.delete(workspacePath);
    throw err;
  });
  migrations.set(workspacePath, run);
  return run;
}

// safeJsonWrite 内部会对同一路径 withFileLock，在 mutateTasks 持锁期间调用会重入死锁，
// 故这里复制同款原子写（tmp 验证 + bak 备份 + rename）但不重复加锁
async function writeTasksFileLocked(filePath: string, file: TasksFile): Promise<void> {
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

async function mutateTasks<T>(workspacePath: string, fn: (tasks: Task[]) => T): Promise<T> {
  await ensureMigrated(workspacePath);
  const filePath = getTasksFilePath(workspacePath);
  return withFileLock(filePath, async () => {
    const file = await readTasksFile(workspacePath);
    const result = fn(file.tasks);
    await writeTasksFileLocked(filePath, file);
    return result;
  });
}

function requireTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) throw new Error('任务标题不能为空');
  return trimmed;
}

export async function createTask(workspacePath: string, input: CreateTaskInput): Promise<Task> {
  const title = requireTitle(input.title);
  if (!input.planPath) throw new Error('planPath 必传：任务须挂载已落盘的 plan 文档');
  if (!input.skipPlanCheck) await fs.access(input.planPath);
  const now = new Date().toISOString();
  return mutateTasks(workspacePath, (tasks) => {
    const existing = tasks.find((t) => t.status === 'plan' && !t.deletedAt && t.title === title);
    if (existing) throw new Error(`任务《${title}》已存在（ID: ${existing.id}），勿重复挂载`);
    const task: Task = {
      id: generateTaskId(),
      title,
      status: input.status ?? 'queued',
      planPath: input.planPath,
      ...(input.originSessionId ? { originSessionId: input.originSessionId } : {}),
      ...(input.execProfile ? { execProfile: input.execProfile } : {}),
      createdAt: now,
      updatedAt: now,
    };
    tasks.push(task);
    return { ...task };
  });
}

export async function listTasks(workspacePath: string): Promise<Task[]> {
  await ensureMigrated(workspacePath);
  const file = await readTasksFile(workspacePath);
  return file.tasks
    .filter((t) => !t.deletedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** 回收站：已删除任务，最近删除在前 */
export async function listDeletedTasks(workspacePath: string): Promise<Task[]> {
  await ensureMigrated(workspacePath);
  const file = await readTasksFile(workspacePath);
  return file.tasks
    .filter((t) => t.deletedAt)
    .sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''));
}

export async function listTasksGrouped(workspacePath: string): Promise<TaskGroups> {
  const tasks = await listTasks(workspacePath);
  const groups: TaskGroups = { plan: [], backlog: [], queued: [], running: [], review: [], done: [], rejected: [], interrupted: [] };
  for (const task of tasks) groups[task.status].push(task);
  return groups;
}

export async function getTask(workspacePath: string, taskId: string): Promise<Task | null> {
  await ensureMigrated(workspacePath);
  const file = await readTasksFile(workspacePath);
  const task = file.tasks.find((t) => t.id === taskId);
  return task ? { ...task } : null;
}

export async function getTaskDetail(workspacePath: string, taskId: string): Promise<TaskDetail | null> {
  const task = await getTask(workspacePath, taskId);
  if (!task) return null;
  if (!task.planPath) return { ...task, planContent: null };
  try {
    const planContent = await fs.readFile(task.planPath, 'utf-8');
    return { ...task, planContent };
  } catch (err) {
    return { ...task, planContent: null, planError: `plan 文件读取失败: ${err instanceof Error ? err.message : String(err)}` };
  }
}

interface TransitionPatch {
  execSessionId?: string;
  result?: string;
}

async function transition(
  workspacePath: string,
  taskId: string,
  from: TaskStatus[],
  to: TaskStatus,
  patch?: TransitionPatch,
): Promise<Task> {
  return mutateTasks(workspacePath, (tasks) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`任务 ${taskId} 不存在`);
    if (!from.includes(task.status)) {
      throw new Error(`任务 ${taskId} 当前状态为 ${task.status}，不允许迁移到 ${to}（合法迁移自：${ALLOWED_TRANSITIONS[task.status].join('/')}）`);
    }
    task.status = to;
    task.updatedAt = new Date().toISOString();
    if (patch?.execSessionId !== undefined) task.execSessionId = patch.execSessionId;
    if (patch?.result !== undefined) task.result = patch.result;
    return { ...task };
  });
}

export async function reviewTask(workspacePath: string, taskId: string, action: ReviewAction): Promise<Task> {
  return transition(workspacePath, taskId, ['review'], action === 'approve' ? 'done' : 'rejected');
}

export async function markTaskRunning(workspacePath: string, taskId: string, execSessionId: string): Promise<Task> {
  return transition(workspacePath, taskId, ['queued'], 'running', { execSessionId });
}

export async function completeTask(workspacePath: string, taskId: string, result: string): Promise<Task> {
  return transition(workspacePath, taskId, ['running'], 'review', {
    result: result || '（执行会话未输出结果摘要，请打开执行会话查看过程）',
  });
}

export async function interruptTask(workspacePath: string, taskId: string, reason: string): Promise<Task> {
  return transition(workspacePath, taskId, ['running'], 'interrupted', { result: reason });
}

export async function reportTaskResult(workspacePath: string, execSessionId: string, result: string): Promise<Task | null> {
  return mutateTasks(workspacePath, (tasks) => {
    const task = tasks.find(
      (t) => !t.deletedAt && t.execSessionId === execSessionId && ['running', 'interrupted', 'rejected'].includes(t.status),
    );
    if (!task) return null;
    task.status = 'review';
    task.updatedAt = new Date().toISOString();
    task.result = result || '（执行会话未输出结果摘要，请打开执行会话查看过程）';
    return { ...task };
  });
}

/** 留痕原语：把执行结果摘要附加到 result（任务已不在 running 时的丢弃路径，不改状态） */
export async function appendResultNote(workspacePath: string, taskId: string, note: string): Promise<Task | null> {
  return mutateTasks(workspacePath, (tasks) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return null;
    const stamp = `[执行结果留痕 ${new Date().toISOString()}] ${note || '（执行会话未输出结果摘要，请打开执行会话查看过程）'}`;
    task.result = task.result ? `${task.result}\n\n${stamp}` : stamp;
    task.updatedAt = new Date().toISOString();
    return { ...task };
  });
}

export async function rejectTask(workspacePath: string, taskId: string, reason: string): Promise<Task> {
  const task = await getTask(workspacePath, taskId);
  if (!task) throw new Error(`任务 ${taskId} 不存在`);
  return transition(workspacePath, taskId, ['queued', 'running'], 'rejected', { result: reason });
}

export async function executeTask(workspacePath: string, taskId: string): Promise<Task> {
  return transition(workspacePath, taskId, ['plan', 'backlog', 'interrupted'], 'queued');
}

export async function completeTaskManually(workspacePath: string, taskId: string): Promise<Task> {
  return transition(workspacePath, taskId, ['plan', 'backlog', 'rejected', 'interrupted'], 'done', { result: '手动标记完成' });
}

export async function moveTaskToBacklog(workspacePath: string, taskId: string): Promise<Task> {
  return transition(workspacePath, taskId, ['plan', 'rejected'], 'backlog');
}

export async function moveTaskToPlan(workspacePath: string, taskId: string): Promise<Task> {
  return transition(workspacePath, taskId, ['done', 'rejected', 'interrupted'], 'plan');
}

export async function updateTaskExecProfile(workspacePath: string, taskId: string, execProfile: ExecProfile): Promise<Task> {
  return mutateTasks(workspacePath, (tasks) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`任务 ${taskId} 不存在`);
    if (task.status !== 'plan' && task.status !== 'backlog') {
      throw new Error(`仅计划/积压任务可切换执行类型（queued 后执行会话已按原类型创建），当前状态为 ${task.status}`);
    }
    task.execProfile = execProfile;
    task.updatedAt = new Date().toISOString();
    return { ...task };
  });
}

export async function cancelTask(workspacePath: string, taskId: string): Promise<Task> {
  return transition(workspacePath, taskId, ['queued', 'running'], 'backlog');
}

export async function softDeleteTask(workspacePath: string, taskId: string): Promise<Task> {
  return mutateTasks(workspacePath, (tasks) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`任务 ${taskId} 不存在`);
    if (!task.deletedAt) task.deletedAt = new Date().toISOString();
    return { ...task };
  });
}

export async function restoreTask(workspacePath: string, taskId: string): Promise<Task> {
  return mutateTasks(workspacePath, (tasks) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`任务 ${taskId} 不存在`);
    if (!task.deletedAt) throw new Error(`任务 ${taskId} 不在回收站`);
    delete task.deletedAt;
    task.updatedAt = new Date().toISOString();
    return { ...task };
  });
}

export async function purgeTask(workspacePath: string, taskId: string): Promise<boolean> {
  return mutateTasks(workspacePath, (tasks) => {
    const idx = tasks.findIndex((t) => t.id === taskId);
    if (idx < 0) return false;
    tasks.splice(idx, 1);
    return true;
  });
}

/** 应用启动恢复：遗留 running 无条件置 interrupted（交用户手动处置，不自动重跑），中断原因写入 result */
export async function recoverInterruptedTasks(
  workspacePath: string,
): Promise<{ recovered: number; recoveredTasks: Task[] }> {
  return mutateTasks(workspacePath, (tasks) => {
    const recoveredTasks: Task[] = [];
    for (const task of tasks) {
      if (task.status !== 'running' || task.deletedAt) continue;
      task.status = 'interrupted';
      task.result = `应用重启时任务执行中断（${new Date().toISOString()}）`;
      task.updatedAt = new Date().toISOString();
      recoveredTasks.push({ ...task });
    }
    return { recovered: recoveredTasks.length, recoveredTasks };
  });
}
