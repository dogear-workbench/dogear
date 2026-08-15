import type { ModelSelection } from './settings.js';

export type BuiltinTaskId = 'group_digest' | 'review' | 'categorize' | 'categorize_organize';

export interface BuiltinPlanTask {
  id: string;
  kind: 'builtin';
  builtinId: BuiltinTaskId;
  workspaceId?: string;
}

export interface CustomPlanTask {
  id: string;
  kind: 'custom';
  name: string;
  prompt: string;
  modelSelection?: ModelSelection;
  workspaceId?: string;
}

export type PlanTask = BuiltinPlanTask | CustomPlanTask;

export interface WindowSpec {
  start: string;
  end: string;
  weekdays?: number[];
}

interface TriggerBase {
  id: string;
  lastFiredAt?: number;
}

export type Trigger =
  | (TriggerBase & { type: 'daily_at'; at: string; weekdays?: number[] })
  | (TriggerBase & { type: 'interval'; minutes: number })
  | (TriggerBase & { type: 'window'; start: string; end: string; weekdays?: number[] })
  | (TriggerBase & { type: 'once'; at: number; fired?: boolean })
  | (TriggerBase & { type: 'on_window_close'; window: WindowSpec })
  | (TriggerBase & { type: 'on_app_start' })
  | (TriggerBase & { type: 'on_session_close' })
  | (TriggerBase & { type: 'on_plan_done'; planId: string });

export interface PlanRunState {
  pendingTasks: string[];
  cursor?: string;
  cursorStartedAt?: number;
}

export interface Plan {
  id: string;
  name: string;
  enabled: boolean;
  tasks: PlanTask[];
  triggers: Trigger[];
  runState?: PlanRunState;
  createdAt: number;
  updatedAt: number;
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
  planId: string;
  planName: string;
  currentTaskId?: string;
  currentTaskName?: string;
  startedAt: number;
}

export interface SchedulerActivity {
  running: SchedulerRunningPlan[];
  lastTickAt: number;
}
