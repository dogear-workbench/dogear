import type { BrowserTaskMeta } from './browser-task-meta.js';

export type BrowserActionKind = 'article' | 'agent';

export type BrowserActionType =
  | 'navigate'
  | 'open_tab'
  | 'close_tab'
  | 'list_tabs'
  | 'click'
  | 'observe'
  | 'parse'
  | 'fill'
  | 'read_text'
  | 'read_state'
  | 'scroll'
  | 'wait_for'
  | 'screenshot'
  | 'await_human'
  | 'cleanup';

export interface BrowserActionEvent {
  taskId: string;
  kind: BrowserActionKind;
  /** 单调递增序号（缓冲顺序） */
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

const MAX_EVENTS = 500;

let buffer: BrowserActionEvent[] = [];
let nextSeq = 1;

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
}
