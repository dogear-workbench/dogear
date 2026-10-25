/**
 * 任务存储原语层：Task CRUD + 状态机 + workspaces/{wsid}/tasks.json 读写（零 Electron 依赖）
 *
 * - 存储定位用 workspaceId（configDir/workspaces/{wsid}/tasks.json，经 workspace-data-root 解析）；
 *   plan 文档在用户工作区，planPath 相对解析仍需 workspacePath（createTask/getTaskDetail 显式传入）
 * - 状态机 plan → backlog/queued → running → review → done/rejected；done/rejected 可回 plan（移回计划）或 backlog/done（手动处置打回任务）；interrupted = 执行中意外中断（重启/卡死），交用户手动处置；rejected = 执行前确定性拒绝，两者均可被申报回写（→ review）
 * - planPath 存工作区相对路径（posix 分隔符，跨设备可移植）；写侧 toStoredPlanPath 归一化，读侧 resolvePlanPath 还原绝对路径
 * - 写操作统一走 mutateTasks（withFileLock 串行化 + 原子落盘）；读写前 ensureMigrated 链式做 version 1→2（backlog → plan）、2→3（planPath 相对化，工作区外路径保持绝对）存量迁移
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { safeJsonRead, withFileLock } from './safe-json.js';
import { getWorkspaceDataDir } from './workspace-data-root.js';
import type { ExecProfile } from './task-execution-prompt.js';

export type { ExecProfile };

export type TaskStatus = 'plan' | 'backlog' | 'queued' | 'running' | 'review' | 'done' | 'rejected' | 'interrupted';

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  /** 计划文档路径（存工作区相对 posix 路径，读侧 resolvePlanPath 还原）；新建任务必填，仅存量历史任务可能缺省或绝对 */
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
  version: 2 | 3;
  tasks: Task[];
}

const TASKS_FILE = 'tasks.json';
const TASKS_FILE_VERSION = 3;

/** 读侧还原：存量为绝对路径（迁移保留的工作区外条目）原样；相对条目按工作区根 join */
export function resolvePlanPath(workspacePath: string, planPath: string): string {
  if (path.isAbsolute(planPath)) return path.resolve(planPath);
  return path.join(workspacePath, ...planPath.split('/'));
}

/** 写侧归一化：工作区根下的路径转 posix 分隔符相对路径；工作区外（跨盘/上级目录）保持绝对不迁移 */
function toStoredPlanPath(workspacePath: string, planPath: string): string {
  const abs = resolvePlanPath(workspacePath, planPath);
  const rel = path.relative(workspacePath, abs);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return abs;
  return rel.split(path.sep).join('/');
}

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
  return { version: TASKS_FILE_VERSION, tasks: [] };
}

function getTasksFilePath(workspaceId: string): string {
  return path.join(getWorkspaceDataDir(workspaceId), TASKS_FILE);
}

function generateTaskId(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += (bytes[i] % 36).toString(36);
  return out;
}

async function readTasksFile(workspaceId: string): Promise<TasksFile> {
  return safeJsonRead(getTasksFilePath(workspaceId), emptyTasksFile());
}

const migrations = new Map<string, Promise<void>>();

async function ensureMigrated(workspaceId: string): Promise<void> {
  // 缓存 key 用文件完整路径而非 wsid：迁移状态本质是“这个文件”的属性，也避免测试/多环境换 configDir 后缓存误命中
  const filePath = getTasksFilePath(workspaceId);
  const pending = migrations.get(filePath);
  if (pending) return pending;
  const run = (async () => {
    await withFileLock(filePath, async () => {
      const file = await readTasksFile(workspaceId);
      if (file.version >= TASKS_FILE_VERSION) return;
      if (file.version < 2) {
        const now = new Date().toISOString();
        for (const task of file.tasks) {
          if (task.status !== 'backlog') continue;
          task.status = 'plan';
          task.updatedAt = now;
        }
        file.version = 2;
      }
      if (file.version < 3) {
        // 存储层只有 workspaceId 拿不到工作区根，存量绝对 planPath 不再读时补相对化
        // （读侧 resolvePlanPath 对绝对路径原样支持，本机语义不变）；新建路径由 createTask 写侧归一化
        file.version = 3;
      }
      await writeTasksFileLocked(filePath, file);
    });
  })().catch((err) => {
    migrations.delete(filePath);
    throw err;
  });
  migrations.set(filePath, run);
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

async function mutateTasks<T>(workspaceId: string, fn: (tasks: Task[]) => T): Promise<T> {
  await ensureMigrated(workspaceId);
  const filePath = getTasksFilePath(workspaceId);
  return withFileLock(filePath, async () => {
    const file = await readTasksFile(workspaceId);
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

export async function createTask(
  workspaceId: string,
  workspacePath: string,
  input: CreateTaskInput,
): Promise<Task> {
  const title = requireTitle(input.title);
  if (!input.planPath) throw new Error('planPath 必传：任务须挂载已落盘的 plan 文档');
  if (!input.skipPlanCheck) await fs.access(resolvePlanPath(workspacePath, input.planPath));
  const now = new Date().toISOString();
  return mutateTasks(workspaceId, (tasks) => {
    const existing = tasks.find((t) => t.status === 'plan' && !t.deletedAt && t.title === title);
    if (existing) throw new Error(`任务《${title}》已存在（ID: ${existing.id}），勿重复挂载`);
    const task: Task = {
      id: generateTaskId(),
      title,
      status: input.status ?? 'queued',
      planPath: toStoredPlanPath(workspacePath, input.planPath),
      ...(input.originSessionId ? { originSessionId: input.originSessionId } : {}),
      ...(input.execProfile ? { execProfile: input.execProfile } : {}),
      createdAt: now,
      updatedAt: now,
    };
    tasks.push(task);
    return { ...task };
  });
}

export async function listTasks(workspaceId: string): Promise<Task[]> {
  await ensureMigrated(workspaceId);
  const file = await readTasksFile(workspaceId);
  return file.tasks
    .filter((t) => !t.deletedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** 回收站：已删除任务，最近删除在前 */
export async function listDeletedTasks(workspaceId: string): Promise<Task[]> {
  await ensureMigrated(workspaceId);
  const file = await readTasksFile(workspaceId);
  return file.tasks
    .filter((t) => t.deletedAt)
    .sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''));
}

export async function listTasksGrouped(workspaceId: string): Promise<TaskGroups> {
  const tasks = await listTasks(workspaceId);
  const groups: TaskGroups = { plan: [], backlog: [], queued: [], running: [], review: [], done: [], rejected: [], interrupted: [] };
  for (const task of tasks) groups[task.status].push(task);
  return groups;
}

export async function getTask(workspaceId: string, taskId: string): Promise<Task | null> {
  await ensureMigrated(workspaceId);
  const file = await readTasksFile(workspaceId);
  const task = file.tasks.find((t) => t.id === taskId);
  return task ? { ...task } : null;
}

export async function getTaskDetail(
  workspaceId: string,
  workspacePath: string,
  taskId: string,
): Promise<TaskDetail | null> {
  const task = await getTask(workspaceId, taskId);
  if (!task) return null;
  if (!task.planPath) return { ...task, planContent: null };
  const planPath = resolvePlanPath(workspacePath, task.planPath);
  try {
    const planContent = await fs.readFile(planPath, 'utf-8');
    return { ...task, planPath, planContent };
  } catch (err) {
    return { ...task, planContent: null, planError: `plan 文件读取失败: ${err instanceof Error ? err.message : String(err)}` };
  }
}

interface TransitionPatch {
  execSessionId?: string;
  result?: string;
}

async function transition(
  workspaceId: string,
  taskId: string,
  from: TaskStatus[],
  to: TaskStatus,
  patch?: TransitionPatch,
): Promise<Task> {
  return mutateTasks(workspaceId, (tasks) => {
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

export async function reviewTask(workspaceId: string, taskId: string, action: ReviewAction): Promise<Task> {
  return transition(workspaceId, taskId, ['review'], action === 'approve' ? 'done' : 'rejected');
}

export async function markTaskRunning(workspaceId: string, taskId: string, execSessionId: string): Promise<Task> {
  return transition(workspaceId, taskId, ['queued'], 'running', { execSessionId });
}

export async function interruptTask(workspaceId: string, taskId: string, reason: string): Promise<Task> {
  return transition(workspaceId, taskId, ['running'], 'interrupted', { result: reason });
}

export async function reportTaskResult(workspaceId: string, execSessionId: string): Promise<Task | null> {
  return mutateTasks(workspaceId, (tasks) => {
    const task = tasks.find(
      (t) => !t.deletedAt && t.execSessionId === execSessionId && ['running', 'interrupted', 'rejected'].includes(t.status),
    );
    if (!task) return null;
    task.status = 'review';
    task.updatedAt = new Date().toISOString();
    return { ...task };
  });
}

export async function rejectTask(workspaceId: string, taskId: string, reason: string): Promise<Task> {
  const task = await getTask(workspaceId, taskId);
  if (!task) throw new Error(`任务 ${taskId} 不存在`);
  return transition(workspaceId, taskId, ['queued', 'running'], 'rejected', { result: reason });
}

export async function executeTask(workspaceId: string, taskId: string): Promise<Task> {
  return transition(workspaceId, taskId, ['plan', 'backlog', 'interrupted'], 'queued');
}

export async function completeTaskManually(workspaceId: string, taskId: string): Promise<Task> {
  return transition(workspaceId, taskId, ['plan', 'backlog', 'rejected', 'interrupted'], 'done');
}

export async function moveTaskToBacklog(workspaceId: string, taskId: string): Promise<Task> {
  return transition(workspaceId, taskId, ['plan', 'rejected'], 'backlog');
}

export async function moveTaskToPlan(workspaceId: string, taskId: string): Promise<Task> {
  return transition(workspaceId, taskId, ['done', 'rejected', 'interrupted'], 'plan');
}

export interface UpdateTaskPatch {
  title?: string;
  planPath?: string;
  execProfile?: ExecProfile;
}

export async function updateTask(
  workspaceId: string,
  workspacePath: string,
  taskId: string,
  patch: UpdateTaskPatch,
): Promise<Task> {
  const title = patch.title !== undefined ? requireTitle(patch.title) : undefined;
  if (patch.planPath !== undefined) await fs.access(resolvePlanPath(workspacePath, patch.planPath));
  return mutateTasks(workspaceId, (tasks) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`任务 ${taskId} 不存在`);
    if (task.status !== 'plan' && task.status !== 'backlog') {
      throw new Error(`仅计划/积压任务可编辑（queued 后执行会话已按原配置创建），当前状态为 ${task.status}`);
    }
    if (title !== undefined) {
      const existing = tasks.find((t) => !t.deletedAt && t.status === 'plan' && t.title === title && t.id !== taskId);
      if (existing) throw new Error(`任务《${title}》已存在（ID: ${existing.id}），改名冲突`);
      task.title = title;
    }
    if (patch.planPath !== undefined) task.planPath = toStoredPlanPath(workspacePath, patch.planPath);
    if (patch.execProfile !== undefined) task.execProfile = patch.execProfile;
    task.updatedAt = new Date().toISOString();
    return { ...task };
  });
}

export async function cancelTask(workspaceId: string, taskId: string): Promise<Task> {
  return transition(workspaceId, taskId, ['queued', 'running'], 'backlog');
}

export async function softDeleteTask(workspaceId: string, taskId: string): Promise<Task> {
  return mutateTasks(workspaceId, (tasks) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`任务 ${taskId} 不存在`);
    if (!task.deletedAt) task.deletedAt = new Date().toISOString();
    return { ...task };
  });
}

export async function restoreTask(workspaceId: string, taskId: string): Promise<Task> {
  return mutateTasks(workspaceId, (tasks) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`任务 ${taskId} 不存在`);
    if (!task.deletedAt) throw new Error(`任务 ${taskId} 不在回收站`);
    delete task.deletedAt;
    task.updatedAt = new Date().toISOString();
    return { ...task };
  });
}

export async function purgeTask(workspaceId: string, taskId: string): Promise<boolean> {
  return mutateTasks(workspaceId, (tasks) => {
    const idx = tasks.findIndex((t) => t.id === taskId);
    if (idx < 0) return false;
    tasks.splice(idx, 1);
    return true;
  });
}

/** 应用启动恢复：遗留 running 无条件置 interrupted（交用户手动处置，不自动重跑），中断原因写入 result */
export async function recoverInterruptedTasks(
  workspaceId: string,
): Promise<{ recovered: number; recoveredTasks: Task[] }> {
  return mutateTasks(workspaceId, (tasks) => {
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
