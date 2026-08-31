import { describe, expect, test } from 'bun:test';
import type { TerminalStreamEvent } from '../electron/main/services/terminal-stream-service';
import { useTerminalStore } from './terminal-store';

const ev = (e: { conversationId?: string } & Record<string, unknown>) =>
  ({ conversationId: 'c1', ...e }) as TerminalStreamEvent;

function dispatch(e: TerminalStreamEvent) {
  useTerminalStore.getState().handleStreamEvent(e);
}

function buffer(id = 'c1') {
  return useTerminalStore.getState().buffers.get(id);
}

function mockWindow(invoke: () => Promise<unknown>) {
  (globalThis as unknown as { window: unknown }).window = { ipcRenderer: { invoke } };
}

function unmockWindow() {
  delete (globalThis as unknown as { window?: unknown }).window;
}

describe('terminal-store', () => {
  test('start/append/replace/end 全流程', () => {
    dispatch(ev({ type: 'start', toolCallId: 't1', command: 'bun test', startedAt: 1000 }));
    dispatch(ev({ type: 'append', toolCallId: 't1', suffix: 'hello ' }));
    dispatch(ev({ type: 'append', toolCallId: 't1', suffix: 'world' }));
    let entries = buffer()!;
    expect(entries).toHaveLength(1);
    expect(entries[0].text).toBe('hello world');
    expect(entries[0].exitCode).toBeUndefined();
    expect(useTerminalStore.getState().runningIds.get('c1')?.has('t1')).toBe(true);

    dispatch(ev({ type: 'replace', toolCallId: 't1', text: 'replaced' }));
    entries = buffer()!;
    expect(entries[0].text).toBe('replaced');

    dispatch(ev({ type: 'end', toolCallId: 't1', exitCode: 0 }));
    entries = buffer()!;
    expect(entries[0].exitCode).toBe(0);
    expect(useTerminalStore.getState().runningIds.get('c1')?.has('t1')).toBe(false);
  });

  test('未知 toolCallId 的 append/replace/end 被忽略', () => {
    const before = useTerminalStore.getState().buffers.get('c1');
    dispatch(ev({ type: 'append', toolCallId: 'ghost', suffix: 'x' }));
    dispatch(ev({ type: 'end', toolCallId: 'ghost', exitCode: 1 }));
    expect(useTerminalStore.getState().buffers.get('c1')).toBe(before);
  });

  test('多会话隔离', () => {
    dispatch(ev({ conversationId: 'c2', type: 'start', toolCallId: 't2', command: 'ls', startedAt: 1 }));
    expect(buffer('c2')![0].command).toBe('ls');
    expect(buffer('c1')!.some((e) => e.toolCallId === 't2')).toBe(false);
  });

  test('clearBuffer 清空条目与运行态', () => {
    dispatch(ev({ type: 'start', toolCallId: 't3', command: 'top', startedAt: 1 }));
    useTerminalStore.getState().clearBuffer('c1');
    expect(buffer()).toHaveLength(0);
    expect(useTerminalStore.getState().runningIds.get('c1')?.size).toBe(0);
  });

  test('ensureBuffer 拉历史且已有 buffer 时跳过', async () => {
    mockWindow(async () => [
      { toolCallId: 'h1', command: 'history-cmd', startedAt: 42, exitCode: 0, text: 'old output' },
    ]);
    useTerminalStore.getState().buffers.delete('c9');
    await useTerminalStore.getState().ensureBuffer('c9');
    expect(buffer('c9')![0].command).toBe('history-cmd');
    await useTerminalStore.getState().ensureBuffer('c9');
    expect(buffer('c9')).toHaveLength(1);
    unmockWindow();
    useTerminalStore.getState().buffers.delete('c9');
  });

  test('ensureBuffer 并发去重', async () => {
    let calls = 0;
    mockWindow(async () => {
      calls++;
      return [];
    });
    useTerminalStore.getState().buffers.delete('c8');
    await Promise.all([
      useTerminalStore.getState().ensureBuffer('c8'),
      useTerminalStore.getState().ensureBuffer('c8'),
    ]);
    expect(calls).toBe(1);
    unmockWindow();
    useTerminalStore.getState().buffers.delete('c8');
  });
});
