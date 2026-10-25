import type { RunHistorySource, SchedulerRunningPlan } from './scheduler/types.js';

interface RunningEntry {
  source: RunHistorySource;
  name: string;
  startedAt: number;
  conversationId?: string;
}

const running = new Map<string, RunningEntry>();

export function reportRunning(key: string, meta: { source: RunHistorySource; name: string }): void {
  running.set(key, { source: meta.source, name: meta.name, startedAt: Date.now() });
}

/** 会话化执行链拿到 conversationId 后回填（任务面板点开运行中会话实时视图用） */
export function reportRunningConversation(key: string, conversationId: string): void {
  const entry = running.get(key);
  if (entry && entry.conversationId !== conversationId) {
    entry.conversationId = conversationId;
  }
}

export function reportDone(key: string): void {
  running.delete(key);
}

export function getRunning(): SchedulerRunningPlan[] {
  return [...running.entries()].map(([taskId, e]) => ({
    taskId,
    taskName: e.name,
    source: e.source,
    startedAt: e.startedAt,
    ...(e.conversationId ? { conversationId: e.conversationId } : {}),
  }));
}
