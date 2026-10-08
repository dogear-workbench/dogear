import { afterEach, beforeEach, expect, test } from 'bun:test';
import {
  installDelegationMocks,
  registerParentSession,
  sendCalls,
  sleep,
  startTestChild,
  waitForSend,
} from './delegation-test-mocks.js';

await installDelegationMocks();

const bridge = await import('./delegation-bridge.js');
const idle = await import('./delegation-idle.js');
const terminal = await import('./delegation-terminal.js');

beforeEach(() => {
  idle.setDelegationIdleTimeoutMs(60);
  terminal.setDelegationMaxRetry(0);
  sendCalls.length = 0;
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
});

test('无流事件到期触发 hang 终态，通知注入父会话', async () => {
  const { snapshot, parentConversationId, sessionId } = await startTestChild(bridge);
  const parentSessionId = registerParentSession(parentConversationId);

  await sleep(180);
  const notice = await waitForSend(parentSessionId, '无进展中断');

  expect(notice.text).toContain('无进展中断');
  expect(notice.text).toContain(`<sender kind="agent" session_id="${sessionId}"`);
  expect(notice.text).toContain('delivery="false"');
  expect(bridge.getChildSnapshot(snapshot.childId)!.status).toBe('stopped');
  expect(bridge.getChildSnapshot(snapshot.childId)!.lastError).toBe('无进展中断');
});

test('complete(failed) 终态秒级注入父会话', async () => {
  const { parentConversationId, session } = await startTestChild(bridge);
  const parentSessionId = registerParentSession(parentConversationId);

  session.emit('complete', {
    subtype: 'failed',
    error: { kind: 'model', message: '模型请求失败' },
  });
  const notice = await waitForSend(parentSessionId, '模型请求失败');

  expect(notice.text).toContain('子会话');
  expect(notice.text).toContain('运行失败');
});

test('终态通知只注入失败子会话的父会话，其他父会话的子会话不受影响', async () => {
  idle.setDelegationIdleTimeoutMs(5_000);
  const a = await startTestChild(bridge);
  const b = await startTestChild(bridge);
  const parentA = registerParentSession(a.parentConversationId);
  const parentB = registerParentSession(b.parentConversationId);

  a.session.emit('complete', {
    subtype: 'failed',
    error: { kind: 'model', message: 'a 挂了' },
  });
  const noticeA = await waitForSend(parentA, 'a 挂了');

  expect(noticeA.text).toContain('a 挂了');
  expect(sendCalls.some((c) => c.sessionId === parentB)).toBe(false);
  expect(bridge.getChildSnapshot(b.snapshot.childId)!.status).toBe('running');
});
