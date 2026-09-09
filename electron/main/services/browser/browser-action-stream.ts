import type { BrowserTaskMeta } from './browser-task-meta.js';

export type BrowserActionKind = 'article' | 'agent';

export type BrowserActionType =
  | 'navigate'
  | 'wait'
  | 'click'
  | 'observe'
  | 'parse'
  | 'fill'
  | 'read_text'
  | 'read_state'
  | 'scroll'
  | 'wait_for'
  | 'screenshot'
  | 'close'
  | 'present'
  | 'await_human';

export interface BrowserActionEvent {
  taskId: string;
  kind: BrowserActionKind;
  /** 单调递增序号（缓冲顺序），渲染层用它做拉取/订阅竞态合并 */
  seq: number;
  ts: number;
  action: BrowserActionType;
  url?: string;
  detail?: string;
  result?: string;
  source?: string;
  conversationId?: string;
  urlBefore?: string;
  urlAfter?: string;
  errorCode?: string;
  durationMs?: number;
}

export interface BrowserActionInput {
  source: string;
  taskMeta: BrowserTaskMeta;
  action: BrowserActionType;
  url?: string;
  detail?: string;
  result?: string;
  urlBefore?: string;
  urlAfter?: string;
  errorCode?: string;
  durationMs?: number;
}

export interface BrowserStreamStatus {
  running: boolean;
  launched: boolean;
  holder: { taskId: string; kind: BrowserActionKind } | null;
}

type ActionBroadcaster = (event: BrowserActionEvent) => void;

const MAX_EVENTS = 500;

const TASK_ACTIVE_WINDOW_MS = 60_000;

let buffer: BrowserActionEvent[] = [];
let nextSeq = 1;
let broadcaster: ActionBroadcaster | null = null;
let launchedProvider: () => boolean = () => false;
const lastActivityByTask = new Map<string, { kind: BrowserActionKind; at: number }>();

/** 注册制广播（对齐 pty-service 模式：服务层零 electron 依赖，tipc 层接线） */
export function setBrowserActionBroadcaster(fn: ActionBroadcaster | null): void {
  broadcaster = fn;
}

/** launched 状态由 tipc 层注入（内嵌浏览器 tab 存在性），保持本模块可在 node 环境 smoke */
export function setBrowserStreamLaunchedProvider(fn: () => boolean): void {
  launchedProvider = fn;
}

export function normalizeTaskId(meta: BrowserTaskMeta): string {
  if (meta.kind === 'article') return `article:${meta.articleId ?? 'adhoc'}`;
  return `agent:${meta.conversationId ?? 'adhoc'}`;
}

export function recordBrowserAction(input: BrowserActionInput): void {
  const event: BrowserActionEvent = {
    taskId: normalizeTaskId(input.taskMeta),
    kind: input.taskMeta.kind,
    seq: nextSeq++,
    ts: Date.now(),
    action: input.action,
    ...(input.taskMeta.kind === 'agent' && input.taskMeta.conversationId
      ? { conversationId: input.taskMeta.conversationId }
      : {}),
    ...(input.url !== undefined ? { url: input.url } : {}),
    ...(input.detail !== undefined ? { detail: input.detail } : {}),
    ...(input.result !== undefined ? { result: input.result } : {}),
    ...(input.source !== undefined ? { source: input.source } : {}),
    ...(input.urlBefore !== undefined ? { urlBefore: input.urlBefore } : {}),
    ...(input.urlAfter !== undefined ? { urlAfter: input.urlAfter } : {}),
    ...(input.errorCode !== undefined ? { errorCode: input.errorCode } : {}),
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
  };
  buffer.push(event);
  if (buffer.length > MAX_EVENTS) buffer.splice(0, buffer.length - MAX_EVENTS);
  lastActivityByTask.set(event.taskId, { kind: event.kind, at: event.ts });
  broadcaster?.(event);
}

export function getBrowserActionHistory(): BrowserActionEvent[] {
  return [...buffer];
}

/** 活动任务从事件流推断（内嵌模式无 lease 队列）：最近一次动作在活跃窗口内视为运行中 */
export function getBrowserStreamStatus(): BrowserStreamStatus {
  const now = Date.now();
  let active: { taskId: string; kind: BrowserActionKind; at: number } | null = null;
  for (const [taskId, info] of lastActivityByTask) {
    if (now - info.at > TASK_ACTIVE_WINDOW_MS) {
      lastActivityByTask.delete(taskId);
      continue;
    }
    if (!active || info.at > active.at) active = { taskId, kind: info.kind, at: info.at };
  }
  return {
    running: active !== null,
    launched: launchedProvider(),
    holder: active ? { taskId: active.taskId, kind: active.kind } : null,
  };
}
