import { afterAll, beforeEach, expect, test } from 'bun:test';
import {
  installDelegationMocks,
  attachSessionByConv,
  convStore,
  conversationListChangedCalls,
  runtimeDetachCalls,
  sendCalls,
  setMockSettings,
  updateModelSelectionCalls,
  pushDirectCalls,
  sessions,
  sleep,
} from './delegation-test-mocks.js';

await installDelegationMocks();

// mockSettings 是进程级共享单例：用例里注入过 ai.unattended=true，跑完必须清掉，
// 否则后跑的文件（如 human-intervention-unattended）合跑时捕获到污染的设置底座
afterAll(() => {
  setMockSettings({
    profiles: {},
    subAgent: { profiles: [] },
    ai: { defaultModelSelection: null },
    failover: { enabled: false, chain: [] },
  });
});

const failoverMod = await import('./model-failover.js');
const retryMod = await import('./unattended-retry.js');

/** 等指定会话的注入计数从 before 增长（failover 与重试的续跑提示同文本，不能按内容等） */
async function waitSendCount(sessionId: string, before: number, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (sendCalls.filter((c) => c.sessionId === sessionId).length > before) return;
    if (Date.now() > deadline) throw new Error(`等待注入超时: ${sessionId}（before=${before}）`);
    await sleep(10);
  }
}
const { conversationRuntimeService } = await import('../services/conversation-runtime-service.js');

const QUOTA_FAILED = { subtype: 'failed', error: { kind: 'model', message: '429 rate limit exceeded' } } as const;

let convSeq = 0;

function mockProfiles(): Record<string, any> {
  return {
    'prov-a': { id: 'prov-a', name: 'A 家' },
    'prov-b': { id: 'prov-b', name: 'B 家' },
    'prov-c': { id: 'prov-c', name: 'C 家' },
  };
}

async function setupMainConversation(profileId: string, tier: string, role = 'main'): Promise<{ conversationId: string; sessionId: string }> {
  const conversationId = `main-conv-${++convSeq}`;
  convStore.set(conversationId, {
    id: conversationId,
    title: '主会话',
    groupId: 'g1',
    role,
    modelSelection: { profileId, tier },
    createdAt: new Date().toISOString(),
  });
  const attachment = await conversationRuntimeService.attachConversation(conversationId, 'ws-test', 'desktop', {});
  return { conversationId, sessionId: attachment.sessionId };
}

beforeEach(() => {
  setMockSettings({
    profiles: mockProfiles(),
    failover: { enabled: true, chain: [
      { profileId: 'prov-a', tier: 'ta' },
      { profileId: 'prov-b', tier: 'tb' },
      { profileId: 'prov-c', tier: 'tc' },
    ] },
    subAgent: { profiles: [] },
    ai: { defaultModelSelection: null },
  });
  updateModelSelectionCalls.length = 0;
  sendCalls.length = 0;
  runtimeDetachCalls.length = 0;
  conversationListChangedCalls.length = 0;
});

test('findNextFailover 矩阵：顺位 / 不在链走链头 / tried 跳过 / 全 tried / 空链', () => {
  const chain = [
    { profileId: 'a', tier: 't1' },
    { profileId: 'b', tier: 't2' },
    { profileId: 'c', tier: 't3' },
  ];
  expect(failoverMod.findNextFailover(chain, 'b', new Set())).toEqual({ profileId: 'c', tier: 't3' });
  expect(failoverMod.findNextFailover(chain, 'x', new Set())).toEqual({ profileId: 'a', tier: 't1' });
  expect(failoverMod.findNextFailover(chain, 'a', new Set(['b']))).toEqual({ profileId: 'c', tier: 't3' });
  expect(failoverMod.findNextFailover(chain, 'a', new Set(['a', 'b', 'c']))).toBeNull();
  expect(failoverMod.findNextFailover([], 'a', new Set())).toBeNull();
});

test('buildFailoverContinuePrompt 含哨兵前缀、新供应商与断点续跑指示', () => {
  const prompt = failoverMod.buildFailoverContinuePrompt('B 家');
  expect(prompt.startsWith(failoverMod.FAILOVER_CONTINUE_SENTINEL)).toBeTrue();
  expect(prompt).toContain('B 家');
  expect(prompt).toContain('从中断处继续');
  expect(prompt).toContain('不要重跑');
});

test('哨兵与渲染层镜像 lib/failover-markers 保持一致（防静默漂移）', async () => {
  const markers = await import('../../../lib/failover-markers.js');
  expect(markers.FAILOVER_CONTINUE_SENTINEL).toBe(failoverMod.FAILOVER_CONTINUE_SENTINEL);
  expect(markers.isFailoverContinueMessage(failoverMod.buildFailoverContinuePrompt('X'))).toBeTrue();
  expect(markers.stripFailoverContinueSentinel(failoverMod.buildFailoverContinuePrompt('X'))).not.toContain(
    failoverMod.FAILOVER_CONTINUE_SENTINEL,
  );
});

test('quota 失败切换链下一家：updateModelSelection + detach desktop + 重建 session + 续跑提示', async () => {
  const { conversationId, sessionId } = await setupMainConversation('prov-a', 'ta');

  const switched = await failoverMod.maybeFailoverMainSession(sessionId, QUOTA_FAILED);
  expect(switched).toBeTrue();

  expect(updateModelSelectionCalls).toEqual([
    { id: conversationId, modelSelection: { profileId: 'prov-b', tier: 'tb' } },
  ]);
  expect(conversationListChangedCalls).toEqual(['ws-test']);
  expect(runtimeDetachCalls).toEqual([{ conversationId, holderType: 'desktop' }]);
  expect(attachSessionByConv.get(conversationId)).not.toBe(sessionId);

  expect(sendCalls.length).toBe(1);
  expect(sendCalls[0].text).toContain('B 家');
  expect(sendCalls[0].text).toContain('从中断处继续');
});

test('transient / cancelled / 开关关闭 / 链耗尽 / 子会话：不触发且零副作用', async () => {
  const transient = await setupMainConversation('prov-a', 'ta');
  expect(await failoverMod.maybeFailoverMainSession(transient.sessionId, {
    subtype: 'failed', error: { kind: 'model', message: '500 Internal Server Error' },
  })).toBeFalse();

  const cancelled = await setupMainConversation('prov-a', 'ta');
  expect(await failoverMod.maybeFailoverMainSession(cancelled.sessionId, {
    subtype: 'cancelled', error: { kind: 'cancelled', message: '用户停止' },
  })).toBeFalse();

  setMockSettings({
    profiles: mockProfiles(),
    failover: { enabled: false, chain: [{ profileId: 'prov-a', tier: 'ta' }, { profileId: 'prov-b', tier: 'tb' }] },
    subAgent: { profiles: [] },
    ai: { defaultModelSelection: null },
  });
  const disabled = await setupMainConversation('prov-a', 'ta');
  expect(await failoverMod.maybeFailoverMainSession(disabled.sessionId, QUOTA_FAILED)).toBeFalse();

  setMockSettings({
    profiles: mockProfiles(),
    failover: { enabled: true, chain: [{ profileId: 'prov-a', tier: 'ta' }] },
    subAgent: { profiles: [] },
    ai: { defaultModelSelection: null },
  });
  const exhausted = await setupMainConversation('prov-a', 'ta');
  expect(await failoverMod.maybeFailoverMainSession(exhausted.sessionId, QUOTA_FAILED)).toBeFalse();

  setMockSettings({
    profiles: mockProfiles(),
    failover: { enabled: true, chain: [{ profileId: 'prov-a', tier: 'ta' }, { profileId: 'prov-b', tier: 'tb' }] },
    subAgent: { profiles: [] },
    ai: { defaultModelSelection: null },
  });
  const sub = await setupMainConversation('prov-a', 'ta', 'sub');
  expect(await failoverMod.maybeFailoverMainSession(sub.sessionId, QUOTA_FAILED)).toBeFalse();

  expect(updateModelSelectionCalls).toEqual([]);
  expect(conversationListChangedCalls).toEqual([]);
  expect(runtimeDetachCalls).toEqual([]);
  expect(sendCalls).toEqual([]);
});

test('二次 quota 切到第三家（tried 防回摆）', async () => {
  const { conversationId, sessionId } = await setupMainConversation('prov-a', 'ta');

  expect(await failoverMod.maybeFailoverMainSession(sessionId, QUOTA_FAILED)).toBeTrue();
  const secondSessionId = attachSessionByConv.get(conversationId)!;

  expect(await failoverMod.maybeFailoverMainSession(secondSessionId, QUOTA_FAILED)).toBeTrue();

  expect(updateModelSelectionCalls.map((c) => c.modelSelection.profileId)).toEqual(['prov-b', 'prov-c']);
  expect(sendCalls.length).toBe(2);
  expect(sendCalls[1].text).toContain('C 家');
});

test('整链耗尽返回 false；complete(success) 后 tried 清空，用户切回原供应商可再次切换', async () => {
  setMockSettings({
    profiles: mockProfiles(),
    failover: { enabled: true, chain: [{ profileId: 'prov-a', tier: 'ta' }, { profileId: 'prov-b', tier: 'tb' }] },
    subAgent: { profiles: [] },
    ai: { defaultModelSelection: null },
  });
  const { conversationId, sessionId } = await setupMainConversation('prov-a', 'ta');

  expect(await failoverMod.maybeFailoverMainSession(sessionId, QUOTA_FAILED)).toBeTrue();
  const secondSessionId = attachSessionByConv.get(conversationId)!;
  expect(await failoverMod.maybeFailoverMainSession(secondSessionId, QUOTA_FAILED)).toBeFalse();
  expect(updateModelSelectionCalls.length).toBe(1);

  await failoverMod.clearFailoverTriedBySession(secondSessionId);

  const conv = convStore.get(conversationId);
  conv.modelSelection = { profileId: 'prov-a', tier: 'ta' };
  expect(await failoverMod.maybeFailoverMainSession(secondSessionId, QUOTA_FAILED)).toBeTrue();
  expect(updateModelSelectionCalls[updateModelSelectionCalls.length - 1].modelSelection.profileId).toBe('prov-b');
});

test('无人值守链耗尽：退避后重置 tried 注入续跑，failover 重新接管', async () => {
  retryMod.setUnattendedRetryBackoffForTest([30, 30, 30]);
  setMockSettings({
    profiles: mockProfiles(),
    failover: { enabled: true, chain: [
      { profileId: 'prov-a', tier: 'ta' },
      { profileId: 'prov-b', tier: 'tb' },
      { profileId: 'prov-c', tier: 'tc' },
    ] },
    subAgent: { profiles: [] },
    ai: { defaultModelSelection: null, unattended: true },
  });
  const { conversationId, sessionId } = await setupMainConversation('prov-a', 'ta');
  expect(await failoverMod.maybeFailoverMainSession(sessionId, QUOTA_FAILED)).toBeTrue();
  const sid2 = attachSessionByConv.get(conversationId)!;
  expect(await failoverMod.maybeFailoverMainSession(sid2, QUOTA_FAILED)).toBeTrue();
  const sid3 = attachSessionByConv.get(conversationId)!;
  expect(await failoverMod.maybeFailoverMainSession(sid3, QUOTA_FAILED)).toBeFalse();

  expect(await retryMod.maybeRetryUnattendedFailover(sid3, QUOTA_FAILED)).toBeTrue();
  await waitSendCount(sid3, sendCalls.filter((c) => c.sessionId === sid3).length);
  const lastSend = sendCalls.filter((c) => c.sessionId === sid3).at(-1)!;
  expect(lastSend.text).toContain('C 家');

  // 重试后再失败：tried 已重置，failover 重新接管（环形链回到 prov-a）
  expect(await failoverMod.maybeFailoverMainSession(sid3, QUOTA_FAILED)).toBeTrue();
  expect(updateModelSelectionCalls.at(-1)!.modelSelection.profileId).toBe('prov-a');
  await sleep(120);
});

test('无人值守重试预算耗尽：放弃并推飞书，不再接管', async () => {
  retryMod.setUnattendedRetryBackoffForTest([20, 20, 20]);
  setMockSettings({
    profiles: mockProfiles(),
    failover: { enabled: true, chain: [
      { profileId: 'prov-a', tier: 'ta' },
      { profileId: 'prov-b', tier: 'tb' },
    ] },
    subAgent: { profiles: [] },
    ai: { defaultModelSelection: null, unattended: true },
  });
  const { conversationId, sessionId } = await setupMainConversation('prov-a', 'ta');
  pushDirectCalls.length = 0;

  // 忠实模拟 broadcaster 顺序（failover 优先、重试兜底）：3 轮「耗尽→重试→切链」后第 4 次耗尽放弃
  let cur = sessionId;
  for (let i = 0; i < 12; i++) {
    if (await failoverMod.maybeFailoverMainSession(cur, QUOTA_FAILED)) {
      cur = attachSessionByConv.get(conversationId)!;
      continue;
    }
    if (!(await retryMod.maybeRetryUnattendedFailover(cur, QUOTA_FAILED))) {
      expect(i).toBe(7);
      break;
    }
    await waitSendCount(cur, sendCalls.filter((c) => c.sessionId === cur).length);
  }
  expect(pushDirectCalls).toHaveLength(1);
  expect(pushDirectCalls[0].title).toBe('主会话');
  expect(pushDirectCalls[0].summary).toContain('3 次');
  await sleep(80);
});

test('无人值守关闭 / 非 main / 链未耗尽 / 会话已销毁：不进入重试', async () => {
  retryMod.setUnattendedRetryBackoffForTest([20, 20, 20]);
  setMockSettings({
    profiles: mockProfiles(),
    failover: { enabled: true, chain: [
      { profileId: 'prov-a', tier: 'ta' },
      { profileId: 'prov-b', tier: 'tb' },
    ] },
    subAgent: { profiles: [] },
    ai: { defaultModelSelection: null, unattended: true },
  });

  // 链未耗尽（从未切换，tried 为空）：fresh failure 不归重试域
  const fresh = await setupMainConversation('prov-a', 'ta');
  expect(await retryMod.maybeRetryUnattendedFailover(fresh.sessionId, QUOTA_FAILED)).toBeFalse();

  // 链耗尽但开关关闭：不接管
  expect(await failoverMod.maybeFailoverMainSession(fresh.sessionId, QUOTA_FAILED)).toBeTrue();
  const sid2 = attachSessionByConv.get(fresh.conversationId)!;
  expect(await failoverMod.maybeFailoverMainSession(sid2, QUOTA_FAILED)).toBeFalse();
  setMockSettings({
    profiles: mockProfiles(),
    failover: { enabled: true, chain: [
      { profileId: 'prov-a', tier: 'ta' },
      { profileId: 'prov-b', tier: 'tb' },
    ] },
    subAgent: { profiles: [] },
    ai: { defaultModelSelection: null, unattended: false },
  });
  expect(await retryMod.maybeRetryUnattendedFailover(sid2, QUOTA_FAILED)).toBeFalse();

  // 会话已销毁（acquireHold 拿不到）：不接管
  setMockSettings({
    profiles: mockProfiles(),
    failover: { enabled: true, chain: [
      { profileId: 'prov-a', tier: 'ta' },
      { profileId: 'prov-b', tier: 'tb' },
    ] },
    subAgent: { profiles: [] },
    ai: { defaultModelSelection: null, unattended: true },
  });
  sessions.delete(sid2);
  expect(await retryMod.maybeRetryUnattendedFailover(sid2, QUOTA_FAILED)).toBeFalse();
});
