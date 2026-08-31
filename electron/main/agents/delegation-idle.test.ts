import { afterEach, beforeEach, expect, test } from 'bun:test';
import { installDelegationMocks, sessions, sleep, startTestChild } from './delegation-test-mocks.js';

await installDelegationMocks();

const bridge = await import('./delegation-bridge.js');
const idle = await import('./delegation-idle.js');
const terminal = await import('./delegation-terminal.js');

beforeEach(() => {
  idle.setDelegationIdleTimeoutMs(60);
  terminal.setDelegationMaxRetry(0);
});

afterEach(() => {
  idle.setDelegationIdleTimeoutMs(idle.IDLE_TIMEOUT_MS);
  terminal.setDelegationMaxRetry(terminal.MAX_RETRY);
});

test('message 流事件持续重置 idleTimer，活跃会话不判 hang', async () => {
  idle.setDelegationIdleTimeoutMs(80);
  const { snapshot, sessionId, session } = await startTestChild(bridge);
  const before = bridge.getChildSnapshot(snapshot.childId)!.lastActivityAt;

  for (let i = 0; i < 4; i++) {
    await sleep(40);
    session.emit('message', { type: 'text', content: 'x', timestamp: Date.now() });
  }
  expect(bridge.getChildSnapshot(snapshot.childId)!.status).toBe('running');
  expect(bridge.getChildSnapshot(snapshot.childId)!.lastActivityAt!).toBeGreaterThan(before!);

  await sleep(250);
  expect(bridge.getChildSnapshot(snapshot.childId)!.status).toBe('stopped');
  expect(bridge.getChildSnapshot(snapshot.childId)!.lastError).toBe('无进展中断');
  expect(sessions.get(sessionId)).toBeDefined();
});

test('无流事件到期触发 hang 终态并唤醒 waiter 带 terminal', async () => {
  const { snapshot, parentConversationId, sessionId } = await startTestChild(bridge);
  const waitPromise = bridge.waitForMessage(parentConversationId, [sessionId], 30_000);

  await sleep(180);
  const result = await waitPromise;

  expect(result).not.toBeNull();
  expect(result!.terminal?.terminalReason).toBe('hang');
  expect(result!.terminal?.errorClass).toBe('transient');
  expect(result!.terminal?.attempts).toBe(0);
  expect(result!.delivery).toBe(false);
  expect(result!.message).toContain('无进展中断');
  expect(result!.fromSessionId).toBe(sessionId);
  expect(bridge.getChildSnapshot(snapshot.childId)!.status).toBe('stopped');
  expect(bridge.getChildSnapshot(snapshot.childId)!.lastError).toBe('无进展中断');
});

test('complete(failed) 终态秒级唤醒 waiter 带 terminal', async () => {
  const { snapshot, parentConversationId, sessionId, session } = await startTestChild(bridge);
  const waitPromise = bridge.waitForMessage(parentConversationId, [sessionId], 30_000);

  session.emit('complete', {
    subtype: 'failed',
    error: { kind: 'model', message: '模型请求失败' },
  });
  const result = await waitPromise;

  expect(result!.terminal?.terminalReason).toBe('failed');
  expect(result!.terminal?.lastError).toBe('模型请求失败');
  expect(result!.message).toContain('模型请求失败');
  expect(result!.message).toContain('子会话');
  expect(bridge.getChildSnapshot(snapshot.childId)!.status).toBe('stopped');
});

test('等待其他子会话的 waiter 不被终态通知误伤', async () => {
  idle.setDelegationIdleTimeoutMs(5_000);
  const a = await startTestChild(bridge);
  const b = await startTestChild(bridge);
  const waitB = bridge.waitForMessage(b.parentConversationId, [b.sessionId], 250);

  a.session.emit('complete', {
    subtype: 'failed',
    error: { kind: 'model', message: 'a 挂了' },
  });
  await sleep(60);
  expect(bridge.getChildSnapshot(b.snapshot.childId)!.status).toBe('running');

  const resultB = await waitB;
  expect(resultB).toBeNull();
  expect(bridge.getChildSnapshot(b.snapshot.childId)!.status).toBe('running');
});
