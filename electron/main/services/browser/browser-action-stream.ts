import type { BrowserTaskMeta } from './browser-manager.js';
import { getBrowserManager } from './browser-manager.js';

export type BrowserActionKind = 'article' | 'agent';

export type BrowserActionType =
  | 'navigate'
  | 'wait'
  | 'click'
  | 'observe'
  | 'parse'
  | 'fill'
  | 'read_text'
  | 'wait_for'
  | 'screenshot'
  | 'close';

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
}

export interface BrowserActionInput {
  source: string;
  taskMeta: BrowserTaskMeta;
  action: BrowserActionType;
  url?: string;
  detail?: string;
  result?: string;
}

export interface BrowserStreamStatus {
  running: boolean;
  launched: boolean;
  queued: number;
  holder: { taskId: string; kind: BrowserActionKind } | null;
}

type ActionBroadcaster = (event: BrowserActionEvent) => void;

const MAX_EVENTS = 500;

let buffer: BrowserActionEvent[] = [];
let nextSeq = 1;
let broadcaster: ActionBroadcaster | null = null;

/** 注册制广播（对齐 pty-service 模式：服务层零 electron 依赖，tipc 层接线） */
export function setBrowserActionBroadcaster(fn: ActionBroadcaster | null): void {
  broadcaster = fn;
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
    ...(input.url !== undefined ? { url: input.url } : {}),
    ...(input.detail !== undefined ? { detail: input.detail } : {}),
    ...(input.result !== undefined ? { result: input.result } : {}),
    ...(input.source !== undefined ? { source: input.source } : {}),
  };
  buffer.push(event);
  if (buffer.length > MAX_EVENTS) buffer.splice(0, buffer.length - MAX_EVENTS);
  broadcaster?.(event);
}

export function getBrowserActionHistory(): BrowserActionEvent[] {
  return [...buffer];
}

export function getBrowserStreamStatus(): BrowserStreamStatus {
  const snap = getBrowserManager().getSnapshot();
  return {
    running: snap.running,
    launched: snap.launched,
    queued: snap.queued,
    holder: snap.holder ? { taskId: normalizeTaskId(snap.holder), kind: snap.holder.kind } : null,
  };
}
