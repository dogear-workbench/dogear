import { beforeEach, expect, test } from 'bun:test';
import {
  installDelegationMocks,
  attachSessionByConv,
  convStore,
  conversationListChangedCalls,
  runtimeDetachCalls,
  sendCalls,
  setMockSettings,
  updateModelSelectionCalls,
} from './delegation-test-mocks.js';

installDelegationMocks();

const failoverMod = await import('./model-failover.js');
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

test('buildFailoverContinuePrompt 含新供应商与断点续跑指示', () => {
  const prompt = failoverMod.buildFailoverContinuePrompt('B 家');
  expect(prompt).toContain('B 家');
  expect(prompt).toContain('从中断处继续');
  expect(prompt).toContain('不要重跑');
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
