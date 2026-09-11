import type { ModelSelection } from './settings';

export interface WindowSpec {
  start: string;
  end: string;
  /** 0=周日..6=周六，缺省每天 */
  weekdays?: number[];
}

interface TriggerBase {
  id: string;
  lastFiredAt?: number;
}

export type Trigger =
  | (TriggerBase & { type: 'daily_at'; at: string; weekdays?: number[] })
  | (TriggerBase & { type: 'monthly_at'; at: string; daysOfMonth: (number | 'last')[] })
  | (TriggerBase & { type: 'interval'; minutes: number; weekdays?: number[] })
  | (TriggerBase & { type: 'window'; start: string; end: string; weekdays?: number[] })
  | (TriggerBase & { type: 'once'; at: number; fired?: boolean })
  | (TriggerBase & { type: 'on_window_close'; window: WindowSpec })
  | (TriggerBase & { type: 'on_app_start' })
  | (TriggerBase & { type: 'on_session_close' })
  | (TriggerBase & { type: 'on_task_done'; taskId: string });

export interface TaskRunState {
  /** 正在执行的任务开始时间（存在 = 上次被中断，下次触发先补记 interrupted 历史） */
  cursorStartedAt?: number;
}

export interface CustomScheduledTask {
  id: string;
  name: string;
  kind: 'custom';
  enabled: boolean;
  triggers: Trigger[];
  workspaceId?: string;
  runState?: TaskRunState;
  createdAt: number;
  updatedAt: number;
  prompt: string;
  modelSelection?: ModelSelection;
  /** undefined = 跟随工作区 enabledToolPacks */
  toolPacksOverride?: string[];
}

// 内置任务已全量下线；存量磁盘 kind:'builtin' 条目由主进程 isRetiredBuiltinTask 过滤隐藏（数据保留）
export type ScheduledTask = CustomScheduledTask;

export type ScheduledTaskWithNextRun = ScheduledTask & { nextRunAt?: number };

export interface HistoryPage {
  entries: RunHistoryEntry[];
  nextCursor?: number;
}

export type RunHistoryStatus = 'completed' | 'failed' | 'cancelled' | 'missed' | 'interrupted';
export type RunTriggerReason = 'time' | 'condition' | 'manual';

export interface RunTokens {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

export interface RunHistoryEntry {
  id: string;
  ts: number;
  planId: string;
  planName: string;
  taskId?: string;
  taskName?: string;
  kind: 'task' | 'missed';
  status: RunHistoryStatus;
  triggerReason: RunTriggerReason;
  triggerDesc?: string;
  startedAt?: number;
  endedAt?: number;
  summary?: string;
  error?: string;
  tokens?: RunTokens;
}

export interface SchedulerRunningPlan {
  taskId: string;
  taskName: string;
  startedAt: number;
}

export interface SchedulerActivity {
  running: SchedulerRunningPlan[];
  lastTickAt: number;
}
