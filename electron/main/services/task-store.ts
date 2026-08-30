/**
 * 任务存储原语层：Task CRUD + 状态机 + .dogear/tasks.json 读写（零 Electron 依赖）
 *
 * - 状态机 queued → running → review → done/rejected；running 可回 queued（重启恢复），rejected 可回 queued（手动重挂）
 * - 写操作统一走 mutateTasks（withFileLock 串行化 + 原子落盘）
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { safeJsonRead, withFileLock } from './safe-json.js';

export type TaskStatus = 'backlog' | 'queued' | 'running' | 'review' | 'done' | 'rejected';

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  planPath: string;
  originSessionId?: string;
  execSessionId?: string;
  result?: string;
  /** 来源笔记卡片 ID */
  noteId?: string;
  createdAt: string;
  updatedAt: string;
  /** 软删除 → 回收站 */
  deletedAt?: string;
}

export interface CreateTaskInput {
  title: string;
  planPath: string;
  originSessionId?: string;
  /** 来源笔记卡片 ID */
  noteId?: string;
  /** 初始状态；done 仅存量迁移用 */
  status?: 'queued' | 'backlog' | 'done';
  /** 跳过 plan 文件存在性检查（存量迁移时 plan 可能已被清理，仍需保留任务记录） */
  skipPlanCheck?: boolean;
}

export type ReviewAction = 'approve' | 'reject';

export interface TaskDetail extends Task {
  planContent: string | null;
  planError?: string;
}

export interface TaskGroups {
  backlog: Task[];
  queued: Task[];
  running: Task[];
  review: Task[];
  done: Task[];
  rejected: Task[];
}

interface TasksFile {
  version: 1;
  tasks: Task[];
}

const TASKS_FILE = 'tasks.json';

const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  backlog: ['queued'],
  queued: ['running', 'rejected'],
  running: ['review', 'queued', 'rejected'],
  review: ['done', 'rejected'],
  done: [],
  rejected: ['queued'],
};

// 缺省值每次新建而非共享常量：mutateTasks 会原地 push，共享常量会被首次读污染并跨工作区泄漏
function emptyTasksFile(): TasksFile {
  return { version: 1, tasks: [] };
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
  if (!input.skipPlanCheck) await fs.access(input.planPath);
  const now = new Date().toISOString();
  const task: Task = {
    id: generateTaskId(),
    title,
    status: input.status ?? 'queued',
    planPath: input.planPath,
    ...(input.originSessionId ? { originSessionId: input.originSessionId } : {}),
    ...(input.noteId ? { noteId: input.noteId } : {}),
    createdAt: now,
    updatedAt: now,
  };
  await mutateTasks(workspacePath, (tasks) => {
    tasks.push(task);
  });
  return { ...task };
}

export async function listTasks(workspacePath: string): Promise<Task[]> {
  const file = await readTasksFile(workspacePath);
  return file.tasks
    .filter((t) => !t.deletedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listTasksGrouped(workspacePath: string): Promise<TaskGroups> {
  const tasks = await listTasks(workspacePath);
  const groups: TaskGroups = { backlog: [], queued: [], running: [], review: [], done: [], rejected: [] };
  for (const task of tasks) groups[task.status].push(task);
  return groups;
}

export async function getTask(workspacePath: string, taskId: string): Promise<Task | null> {
  const file = await readTasksFile(workspacePath);
  const task = file.tasks.find((t) => t.id === taskId);
  return task ? { ...task } : null;
}

export async function getTaskDetail(workspacePath: string, taskId: string): Promise<TaskDetail | null> {
  const task = await getTask(workspacePath, taskId);
  if (!task) return null;
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

export async function rejectTask(workspacePath: string, taskId: string, reason: string): Promise<Task> {
  const task = await getTask(workspacePath, taskId);
  if (!task) throw new Error(`任务 ${taskId} 不存在`);
  return transition(workspacePath, taskId, ['queued', 'running'], 'rejected', { result: reason });
}

export async function executeTask(workspacePath: string, taskId: string): Promise<Task> {
  return transition(workspacePath, taskId, ['backlog'], 'queued');
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

/** 应用启动时把遗留 running 置回 queued，返回恢复数 */
export async function recoverInterruptedTasks(workspacePath: string): Promise<number> {
  return mutateTasks(workspacePath, (tasks) => {
    const now = new Date().toISOString();
    let count = 0;
    for (const task of tasks) {
      if (task.status !== 'running') continue;
      task.status = 'queued';
      task.updatedAt = now;
      count++;
    }
    return count;
  });
}
