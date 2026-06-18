export type PendingState = 'idle' | 'running' | 'flushing';

export function derivePendingState(input: { isRunning: boolean; pendingCount: number }): PendingState {
  if (input.isRunning) return 'running';
  if (input.pendingCount > 0) return 'flushing';
  return 'idle';
}
