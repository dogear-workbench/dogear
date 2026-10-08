import type { RunHistorySource, SchedulerRunningPlan } from './scheduler/types.js';

interface RunningEntry {
  source: RunHistorySource;
  name: string;
  startedAt: number;
}

const running = new Map<string, RunningEntry>();

export function reportRunning(key: string, meta: { source: RunHistorySource; name: string }): void {
  running.set(key, { source: meta.source, name: meta.name, startedAt: Date.now() });
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
  }));
}
