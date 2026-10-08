/**
 * 任务系统类型定义（前端共享真源）
 *
 * 主进程侧真源在 electron/main/services/task-store.ts（tsconfig rootDir 限制），
 * 修改时两边同步。
 */

export type TaskStatus = 'plan' | 'backlog' | 'queued' | 'running' | 'review' | 'done' | 'rejected' | 'interrupted';

export type ExecProfile = 'default' | 'code-impl';

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  /** 计划文档路径；占位任务尚无文档时缺省 */
  planPath?: string;
  /** 执行类型；缺省 default（存量任务无字段等价 default），读侧用 ?? 'default' 兼容 */
  execProfile?: ExecProfile;
  originSessionId?: string;
  execSessionId?: string;
  result?: string;
  createdAt: string;
  updatedAt: string;
  /** 软删除 → 回收站 */
  deletedAt?: string;
}

/** 任务详情 = Task + plan 文件内容聚合 */
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

export type ReviewAction = 'approve' | 'reject';
