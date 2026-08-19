import { afterEach, beforeEach, expect, test } from 'bun:test';
import {
  installDelegationMocks,
  makeProfile,
  sendCalls,
  setMockSettings,
  sleep,
  startTestChild,
  updateModelSelectionCalls,
} from './delegation-test-mocks.js';

installDelegationMocks();

const bridge = await import('./delegation-bridge.js');
const resumeMod = await import('./delegation-resume.js');
const terminalMod = await import('./delegation-terminal.js');

beforeEach(() => {
  setMockSettings({
    subAgent: { profiles: [makeProfile('p-a', 'prov-a', 't1'), makeProfile('p-b', 'prov-b', 't2')] },
    ai: { defaultModelSelection: null },
    failover: { enabled: true, chain: [
      { profileId: 'prov-a', tier: 't1' },
      { profileId: 'prov-b', tier: 't2' },
    ] },
  });
  updateModelSelectionCalls.length = 0;
  sendCalls.length = 0;
});

afterEach(() => {
  terminalMod.setDelegationMaxRetry(terminalMod.MAX_RETRY);
});

test('classifyDelegationError：cancelled 优先，quota 关键词命中，其余 transient', () => {
  expect(terminalMod.classifyDelegationError({ subtype: 'cancelled', error: { kind: 'cancelled', message: '用户中断' } })).toBe('cancelled');
  expect(terminalMod.classifyDelegationError({ subtype: 'failed', error: { kind: 'model', message: '429 Too Many Requests' } })).toBe('quota');
  expect(terminalMod.classifyDelegationError({ subtype: 'failed', error: { kind: 'model', message: 'Rate Limit hit' } })).toBe('quota');
  expect(terminalMod.classifyDelegationError({ subtype: 'failed', error: { kind: 'model', message: '账户余额不足' } })).toBe('quota');
  expect(terminalMod.classifyDelegationError({ subtype: 'failed', error: { kind: 'model', message: '500 Internal' } })).toBe('transient');
  expect(terminalMod.classifyDelegationError({ subtype: 'success' })).toBe('transient');
});

test('decideResumeOnError 决策矩阵', () => {
  expect(resumeMod.decideResumeOnError('cancelled', 0, [], null)).toEqual({ resume: false });
  expect(resumeMod.decideResumeOnError(undefined, 0, [], null)).toEqual({ resume: false });
  expect(resumeMod.decideResumeOnError('transient', 1, [], null)).toEqual({ resume: true });
  expect(resumeMod.decideResumeOnError('transient', 2, [], null)).toEqual({ resume: false });
  const fb = { profileId: 'prov-b', tier: 't2' };
  expect(resumeMod.decideResumeOnError('quota', 0, ['prov-a:t1'], fb)).toEqual({ resume: true, modelOverride: fb });
  expect(resumeMod.decideResumeOnError('quota', 0, ['prov-a:t1', 'prov-b:t2'], fb)).toEqual({ resume: false });
  expect(resumeMod.decideResumeOnError('quota', 0, [], null)).toEqual({ resume: false });
  expect(resumeMod.decideResumeOnError('quota', 3, [], fb)).toEqual({ resume: false });
});

test('buildResumePrompt 含死因、outputPath 与继续指示', () => {
  const prompt = resumeMod.buildResumePrompt('超时', 'notes.md');
  expect(prompt).toContain('你刚才因超时中断');
  expect(prompt).toContain('notes.md');
  expect(prompt).toContain('从中断处继续完成任务');
  expect(prompt).toContain('不要从头重做');
});

test('transient failed 自动复活原会话：状态回 running、waiter 不被 resolve、发送继续提示', async () => {
  const { snapshot, parentConversationId, sessionId, session } = await startTestChild(bridge, 'p-a');
  const waitPromise = bridge.waitForMessage(parentConversationId, [sessionId], 30_000);

  session.emit('complete', {
    subtype: 'failed',
    error: { kind: 'model', message: '500 Internal Server Error' },
  });
  await sleep(80);

  const snap = bridge.getChildSnapshot(snapshot.childId)!;
  expect(snap.status).toBe('running');
  expect(snap.retryCount).toBe(1);
  expect(snap.modelTried).toEqual(['prov-a:t1']);

  const raced = await Promise.race([waitPromise, sleep(150).then(() => 'pending')]);
  expect(raced).toBe('pending');

  expect(sendCalls.length).toBe(2);
  expect(sendCalls[1].text).toContain('500 Internal Server Error');
  expect(sendCalls[1].text).toContain('从中断处继续完成任务');
  expect(updateModelSelectionCalls.length).toBe(0);
  bridge.abortMessageWaits(parentConversationId);
});

test('连续 failed 超过 MAX_RETRY 后通知：terminal.attempts 等于重试上限', async () => {
  const { snapshot, parentConversationId, sessionId, session } = await startTestChild(bridge, 'p-a');
  const waitPromise = bridge.waitForMessage(parentConversationId, [sessionId], 30_000);

  session.emit('complete', { subtype: 'failed', error: { kind: 'model', message: '500 Internal' } });
  await sleep(60);
  expect(bridge.getChildSnapshot(snapshot.childId)!.status).toBe('running');

  session.emit('complete', { subtype: 'failed', error: { kind: 'model', message: '500 Internal' } });
  await sleep(60);
  expect(bridge.getChildSnapshot(snapshot.childId)!.retryCount).toBe(2);

  session.emit('complete', { subtype: 'failed', error: { kind: 'model', message: '500 Internal' } });
  const result = await waitPromise;

  expect(result!.terminal?.status).toBe('failed');
  expect(result!.terminal?.attempts).toBe(2);
  expect(result!.terminal?.errorClass).toBe('transient');
  expect(result!.message).toContain('自动重试 2 次');
  expect(bridge.getChildSnapshot(snapshot.childId)!.status).toBe('failed');
});

test('quota 错误沿 failover 链降级到异供应商，降级后仍 quota 即链耗尽通知', async () => {
  const { snapshot, parentConversationId, sessionId, session } = await startTestChild(bridge, 'p-a');

  session.emit('complete', {
    subtype: 'failed',
    error: { kind: 'model', message: '429 rate limit exceeded' },
  });
  await sleep(80);

  expect(updateModelSelectionCalls.length).toBe(1);
  expect(updateModelSelectionCalls[0].modelSelection).toEqual({ profileId: 'prov-b', tier: 't2' });
  const snap = bridge.getChildSnapshot(snapshot.childId)!;
  expect(snap.status).toBe('running');
  expect(snap.modelTried).toEqual(['prov-a:t1', 'prov-b:t2']);
  expect(snap.profileName).toBe('p-b 档');
  expect(sendCalls[1].text).toContain('从中断处继续完成任务');

  const waitPromise = bridge.waitForMessage(parentConversationId, [sessionId], 30_000);
  session.emit('complete', {
    subtype: 'failed',
    error: { kind: 'model', message: 'quota exceeded for this key' },
  });
  const result = await waitPromise;

  expect(result!.terminal?.errorClass).toBe('quota');
  expect(result!.terminal?.attempts).toBe(1);
  expect(result!.message).toContain('已降级尝试 prov-a:t1 → prov-b:t2');
  expect(result!.message).toContain('dogear__ResumeSession');
  expect(updateModelSelectionCalls.length).toBe(1);
  expect(bridge.getChildSnapshot(snapshot.childId)!.status).toBe('failed');
});

test('quota 但降级链无可切换供应商：立即通知且文案提示链无可用', async () => {
  setMockSettings({
    subAgent: { profiles: [makeProfile('p-a', 'prov-a', 't1'), makeProfile('p-b', 'prov-b', 't2')] },
    ai: { defaultModelSelection: null },
    failover: { enabled: true, chain: [{ profileId: 'prov-a', tier: 't1' }] },
  });
  const { snapshot, parentConversationId, sessionId, session } = await startTestChild(bridge, 'p-a');
  const waitPromise = bridge.waitForMessage(parentConversationId, [sessionId], 30_000);

  session.emit('complete', {
    subtype: 'failed',
    error: { kind: 'model', message: 'insufficient balance 余额不足' },
  });
  const result = await waitPromise;

  expect(result!.terminal?.errorClass).toBe('quota');
  expect(result!.message).toContain('降级链无可用供应商');
  expect(updateModelSelectionCalls.length).toBe(0);
  expect(sendCalls.length).toBe(1);
  expect(bridge.getChildSnapshot(snapshot.childId)!.status).toBe('failed');
});

test('failover 开关关闭：quota 直接终态通知不降级', async () => {
  setMockSettings({
    subAgent: { profiles: [makeProfile('p-a', 'prov-a', 't1'), makeProfile('p-b', 'prov-b', 't2')] },
    ai: { defaultModelSelection: null },
    failover: { enabled: false, chain: [
      { profileId: 'prov-a', tier: 't1' },
      { profileId: 'prov-b', tier: 't2' },
    ] },
  });
  const { snapshot, parentConversationId, sessionId, session } = await startTestChild(bridge, 'p-a');
  const waitPromise = bridge.waitForMessage(parentConversationId, [sessionId], 30_000);

  session.emit('complete', {
    subtype: 'failed',
    error: { kind: 'model', message: '429 rate limit exceeded' },
  });
  const result = await waitPromise;

  expect(result!.terminal?.errorClass).toBe('quota');
  expect(result!.message).toContain('降级链无可用供应商');
  expect(updateModelSelectionCalls.length).toBe(0);
  expect(sendCalls.length).toBe(1);
  expect(bridge.getChildSnapshot(snapshot.childId)!.status).toBe('failed');
});

test('stopChild(cancelled) 不自动复活，waiter 收到 cancelled 通知', async () => {
  const { snapshot, parentConversationId, sessionId } = await startTestChild(bridge, 'p-a');
  const waitPromise = bridge.waitForMessage(parentConversationId, [sessionId], 30_000);

  await bridge.stopChild(snapshot.childId, 'cancelled');
  const result = await waitPromise;

  expect(result!.terminal?.status).toBe('cancelled');
  expect(result!.terminal?.errorClass).toBe('cancelled');
  expect(result!.terminal?.attempts).toBe(0);
  expect(result!.message).toContain('被停止');
  expect(bridge.getChildSnapshot(snapshot.childId)!.status).toBe('cancelled');
  expect(sendCalls.length).toBe(1);
});

test('stopChild(timeout) 按 transient 自动复活', async () => {
  const { snapshot, sessionId } = await startTestChild(bridge, 'p-a');

  await bridge.stopChild(snapshot.childId, 'timeout');
  await sleep(60);

  const snap = bridge.getChildSnapshot(snapshot.childId)!;
  expect(snap.status).toBe('running');
  expect(snap.retryCount).toBe(1);
  expect(sendCalls.length).toBe(2);
  expect(sendCalls[1].text).toContain('你刚才因超时中断');
  expect(snap.sessionId).toBe(sessionId);
});
