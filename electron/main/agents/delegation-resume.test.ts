import { afterEach, beforeEach, expect, test } from 'bun:test';
import {
  closeSessionCalls,
  convStore,
  installDelegationMocks,
  makeProfile,
  nextParentConversationId,
  registerParentSession,
  sendCalls,
  sessions,
  setMockSettings,
  setSessionRunning,
  sleep,
  startTestChild,
  updateModelSelectionCalls,
  waitForSend,
} from './delegation-test-mocks.js';

await installDelegationMocks();

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
  closeSessionCalls.length = 0;
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
  const max = terminalMod.getDelegationMaxRetry();
  expect(resumeMod.decideResumeOnError('cancelled', 0, [], null)).toEqual({ resume: false });
  expect(resumeMod.decideResumeOnError(undefined, 0, [], null)).toEqual({ resume: false });
  expect(resumeMod.decideResumeOnError('transient', max - 1, [], null)).toEqual({ resume: true });
  expect(resumeMod.decideResumeOnError('transient', max, [], null)).toEqual({ resume: false });
  const fb = { profileId: 'prov-b', tier: 't2' };
  expect(resumeMod.decideResumeOnError('quota', 0, ['prov-a:t1'], fb)).toEqual({ resume: true, modelOverride: fb });
  expect(resumeMod.decideResumeOnError('quota', 0, ['prov-a:t1', 'prov-b:t2'], fb)).toEqual({ resume: false });
  expect(resumeMod.decideResumeOnError('quota', 0, [], null)).toEqual({ resume: false });
  expect(resumeMod.decideResumeOnError('quota', max + 1, [], fb)).toEqual({ resume: false });
});

test('buildResumePrompt 含死因、outputPath 与继续指示', () => {
  const prompt = resumeMod.buildResumePrompt('超时', 'notes.md');
  expect(prompt).toContain('你刚才因超时中断');
  expect(prompt).toContain('notes.md');
  expect(prompt).toContain('从中断处继续完成任务');
  expect(prompt).toContain('不要从头重做');
});

test('buildResumePrompt 空 outputPath 不渲染共享区文件提示', () => {
  const prompt = resumeMod.buildResumePrompt('超时', '');
  expect(prompt).toContain('你刚才因超时中断');
  expect(prompt).toContain('从中断处继续完成任务');
  expect(prompt).not.toContain('共享区文件');
});

test('transient failed 自动复活原会话：状态回 running、父会话不被打扰、发送继续提示', async () => {
  const { snapshot, parentConversationId, sessionId, session } = await startTestChild(bridge, 'p-a');
  const parentSessionId = registerParentSession(parentConversationId);

  session.emit('complete', {
    subtype: 'failed',
    error: { kind: 'model', message: '500 Internal Server Error' },
  });
  await sleep(80);

  const snap = bridge.getChildSnapshot(snapshot.childId)!;
  expect(snap.status).toBe('running');

  expect(sendCalls.some((c) => c.sessionId === parentSessionId)).toBe(false);
  expect(sendCalls.length).toBe(2);
  expect(sendCalls[1].sessionId).toBe(sessionId);
  expect(sendCalls[1].text).toContain('500 Internal Server Error');
  expect(sendCalls[1].text).toContain('从中断处继续完成任务');
  expect(updateModelSelectionCalls.length).toBe(0);
});

test('连续 failed 超过 MAX_RETRY 后通知：注入文案带重试次数', async () => {
  terminalMod.setDelegationMaxRetry(2);
  const { snapshot, parentConversationId, sessionId, session } = await startTestChild(bridge, 'p-a');
  const parentSessionId = registerParentSession(parentConversationId);

  session.emit('complete', { subtype: 'failed', error: { kind: 'model', message: '500 Internal' } });
  await sleep(60);
  expect(bridge.getChildSnapshot(snapshot.childId)!.status).toBe('running');

  session.emit('complete', { subtype: 'failed', error: { kind: 'model', message: '500 Internal' } });
  await sleep(60);
  expect(bridge.getChildSnapshot(snapshot.childId)!.status).toBe('running');

  session.emit('complete', { subtype: 'failed', error: { kind: 'model', message: '500 Internal' } });
  const notice = await waitForSend(parentSessionId, '自动重试 2 次');

  expect(notice.text).toContain(`<sender kind="agent" session_id="${sessionId}"`);
  expect(notice.text).toContain('运行失败');
  expect(notice.text).toContain('500 Internal');
  expect(bridge.getChildSnapshot(snapshot.childId)!.status).toBe('stopped');
});

test('quota 错误沿 failover 链降级到异供应商，降级后仍 quota 即链耗尽注入终态通知', async () => {
  const { snapshot, parentConversationId, sessionId, session } = await startTestChild(bridge, 'p-a');
  const parentSessionId = registerParentSession(parentConversationId);

  session.emit('complete', {
    subtype: 'failed',
    error: { kind: 'model', message: '429 rate limit exceeded' },
  });
  await sleep(80);

  expect(updateModelSelectionCalls.length).toBe(1);
  expect(updateModelSelectionCalls[0].modelSelection).toEqual({ profileId: 'prov-b', tier: 't2' });
  const snap = bridge.getChildSnapshot(snapshot.childId)!;
  expect(snap.status).toBe('running');
  expect(snap.profileName).toBe('p-b 档');
  expect(sendCalls[1].text).toContain('从中断处继续完成任务');

  // 降级复活重建了 session（旧 attachment 已销毁），后续 complete 从新 session 发出
  const resumedSession = sessions.get(snap.sessionId!);
  resumedSession.emit('complete', {
    subtype: 'failed',
    error: { kind: 'model', message: 'quota exceeded for this key' },
  });
  const notice = await waitForSend(parentSessionId, '已降级尝试 prov-a:t1 → prov-b:t2');

  expect(notice.text).toContain('疑似供应商费率上限');
  expect(notice.text).toContain('dogear__ResumeSession');
  expect(updateModelSelectionCalls.length).toBe(1);
  expect(bridge.getChildSnapshot(snapshot.childId)!.status).toBe('stopped');
});

test('quota 但降级链无可切换供应商：立即注入通知且文案提示链无可用', async () => {
  setMockSettings({
    subAgent: { profiles: [makeProfile('p-a', 'prov-a', 't1'), makeProfile('p-b', 'prov-b', 't2')] },
    ai: { defaultModelSelection: null },
    failover: { enabled: true, chain: [{ profileId: 'prov-a', tier: 't1' }] },
  });
  const { snapshot, parentConversationId, sessionId, session } = await startTestChild(bridge, 'p-a');
  const parentSessionId = registerParentSession(parentConversationId);

  session.emit('complete', {
    subtype: 'failed',
    error: { kind: 'model', message: 'insufficient balance 余额不足' },
  });
  const notice = await waitForSend(parentSessionId, '降级链无可用供应商');

  expect(notice.text).toContain(`<sender kind="agent" session_id="${sessionId}"`);
  expect(updateModelSelectionCalls.length).toBe(0);
  expect(sendCalls.length).toBe(2);
  expect(bridge.getChildSnapshot(snapshot.childId)!.status).toBe('stopped');
});

test('failover 开关关闭：quota 直接注入终态通知不降级', async () => {
  setMockSettings({
    subAgent: { profiles: [makeProfile('p-a', 'prov-a', 't1'), makeProfile('p-b', 'prov-b', 't2')] },
    ai: { defaultModelSelection: null },
    failover: { enabled: false, chain: [
      { profileId: 'prov-a', tier: 't1' },
      { profileId: 'prov-b', tier: 't2' },
    ] },
  });
  const { snapshot, parentConversationId, sessionId, session } = await startTestChild(bridge, 'p-a');
  const parentSessionId = registerParentSession(parentConversationId);

  session.emit('complete', {
    subtype: 'failed',
    error: { kind: 'model', message: '429 rate limit exceeded' },
  });
  const notice = await waitForSend(parentSessionId, '降级链无可用供应商');

  expect(notice.text).toContain(`<sender kind="agent" session_id="${sessionId}"`);
  expect(updateModelSelectionCalls.length).toBe(0);
  expect(sendCalls.length).toBe(2);
  expect(bridge.getChildSnapshot(snapshot.childId)!.status).toBe('stopped');
});

test('stopChild(cancelled) 不自动复活，父会话收到 cancelled 终态通知', async () => {
  const { snapshot, parentConversationId, sessionId } = await startTestChild(bridge, 'p-a');
  const parentSessionId = registerParentSession(parentConversationId);

  await bridge.stopChild(snapshot.childId, 'cancelled');
  const notice = await waitForSend(parentSessionId, '被停止');

  expect(notice.text).toContain(`<sender kind="agent" session_id="${sessionId}"`);
  expect(notice.text).toContain('已取消');
  expect(notice.text).toContain('自动重试 0 次');
  expect(bridge.getChildSnapshot(snapshot.childId)!.status).toBe('stopped');
  expect(sendCalls.length).toBe(2);
});

test('stopChild(timeout) 按 transient 自动复活', async () => {
  const { snapshot, sessionId } = await startTestChild(bridge, 'p-a');

  await bridge.stopChild(snapshot.childId, 'timeout');
  await sleep(60);

  const snap = bridge.getChildSnapshot(snapshot.childId)!;
  expect(snap.status).toBe('running');
  expect(sendCalls.length).toBe(2);
  expect(sendCalls[1].text).toContain('你刚才因超时中断');
  expect(snap.sessionId).toBe(sessionId);
});

test('complete success 清零 consecutiveFails：后续失败从 0 重新计数', async () => {
  terminalMod.setDelegationMaxRetry(1);
  const { snapshot, parentConversationId, sessionId, session } = await startTestChild(bridge, 'p-a');
  const parentSessionId = registerParentSession(parentConversationId);

  session.emit('complete', { subtype: 'failed', error: { kind: 'model', message: '500 Internal' } });
  await sleep(60);
  expect(bridge.getChildSnapshot(snapshot.childId)!.status).toBe('running');

  session.emit('complete', { subtype: 'success' });
  const noDelivery = await waitForSend(parentSessionId, '结束但未交付');
  expect(noDelivery.text).toContain(`<sender kind="agent" session_id="${sessionId}"`);
  expect(bridge.getChildSnapshot(snapshot.childId)!.status).toBe('stopped');

  await bridge.resumeChild(snapshot.childId, { reason: '测试调起' });
  expect(bridge.getChildSnapshot(snapshot.childId)!.status).toBe('running');

  // no_delivery 终态已释放 attachment，复活重建了新 session，后续 complete 从新 session 发出
  const resumedSession = sessions.get(bridge.getChildSnapshot(snapshot.childId)!.sessionId!);
  resumedSession.emit('complete', { subtype: 'failed', error: { kind: 'model', message: '500 Internal' } });
  const final = await waitForSend(parentSessionId, '自动重试 1 次');

  expect(final.text).toContain('运行失败');
  expect(bridge.getChildSnapshot(snapshot.childId)!.status).toBe('stopped');
});

test('no_delivery 终态后补交付：markChildDelivered 在 stopped 状态下落上交付事实', async () => {
  const { snapshot, parentConversationId, sessionId, session } = await startTestChild(bridge, 'p-a');
  const parentSessionId = registerParentSession(parentConversationId);

  session.emit('complete', { subtype: 'success' });
  const noDelivery = await waitForSend(parentSessionId, '结束但未交付');
  expect(noDelivery.text).toContain('dogear__ReadReferenceSession');
  expect(bridge.getChildSnapshot(snapshot.childId)!.delivered).toBe(false);

  bridge.markChildDelivered(snapshot.childId);
  const snap = bridge.getChildSnapshot(snapshot.childId)!;
  expect(snap.status).toBe('stopped');
  expect(snap.delivered).toBe(true);

  bridge.markChildDelivered(snapshot.childId);
  expect(bridge.getChildSnapshot(snapshot.childId)!.delivered).toBe(true);
});

test('SendMessage 打停机已交付子会话：自动调起复活，唤醒消息为追问原文而非中断模板', async () => {
  const tools = await import('./tools/delegation-tools.js');
  const { snapshot, parentConversationId, sessionId } = await startTestChild(bridge, 'p-a');

  bridge.markChildDelivered(snapshot.childId);
  await bridge.stopChild(snapshot.childId, 'cancelled');
  expect(bridge.getChildSnapshot(snapshot.childId)!.status).toBe('stopped');
  expect(bridge.getChildSnapshot(snapshot.childId)!.delivered).toBe(true);

  const send = tools.createDelegationToolDefs({ role: 'main', workspaceId: 'ws-test', groupId: 'g1', conversationId: parentConversationId })
    .find((d) => d.name === 'dogear__SendMessage')!;
  const result = await send.handler({ toSessionId: sessionId, message: '追问：请把结论按表格重排', options: { delivery: false } });

  expect(result.isError).toBeUndefined();
  expect(result.content[0].text).toContain('已自动调起');
  const snap = bridge.getChildSnapshot(snapshot.childId)!;
  expect(snap.status).toBe('running');
  expect(snap.delivered).toBe(true);
  expect(sendCalls.length).toBe(3);
  expect(sendCalls[1].sessionId).toContain(`sdk-${parentConversationId}`);
  expect(sendCalls[1].text).toContain('子会话「');
  expect(sendCalls[2].text).toContain('追问：请把结论按表格重排');
  expect(sendCalls[2].text).toContain('<sender kind="agent"');
  expect(sendCalls[2].text).not.toContain('你刚才因');
  expect(sendCalls[2].text).not.toContain('从中断处继续完成任务');
});

test('SendMessage 打停机的父会话：自动调起并注入', async () => {
  const tools = await import('./tools/delegation-tools.js');
  const { snapshot, parentConversationId, sessionId: childSessionId } = await startTestChild(bridge, 'p-a');

  const send = tools.createDelegationToolDefs({ role: 'sub', workspaceId: 'ws-test', groupId: 'g1', conversationId: snapshot.childId, parentConversationId })
    .find((d) => d.name === 'dogear__SendMessage')!;
  const result = await send.handler({ toSessionId: `sdk-${parentConversationId}`, message: '向父会话追问', options: { delivery: false } });

  expect(result.isError).toBeUndefined();
  expect(result.content[0].text).toContain('已自动调起');
  expect(bridge.getChildSnapshot(snapshot.childId)!.status).toBe('running');
  const hit = sendCalls.find((c) => c.text.includes('向父会话追问'));
  expect(hit).toBeDefined();
  expect(hit!.sessionId).toContain(`sdk-${parentConversationId}`);
  expect(hit!.text).toContain('<sender kind="agent"');
  expect(hit!.text).toContain(`session_id="${childSessionId}"`);
});

test('终态强杀：重试耗尽后 run 仍卡死（isRunning true）则 closeSession 强制销毁，复活路径不触发', async () => {
  terminalMod.setDelegationMaxRetry(2);
  const { snapshot, parentConversationId, sessionId, session } = await startTestChild(bridge, 'p-a');
  const parentSessionId = registerParentSession(parentConversationId);

  // 僵户态贯穿全程：complete 已结算但 harness run 未 settle
  setSessionRunning(sessionId, true);

  session.emit('complete', { subtype: 'failed', error: { kind: 'model', message: '500 Internal' } });
  await sleep(60);
  expect(bridge.getChildSnapshot(snapshot.childId)!.status).toBe('running');
  expect(closeSessionCalls).not.toContain(sessionId);

  session.emit('complete', { subtype: 'failed', error: { kind: 'model', message: '500 Internal' } });
  await sleep(60);
  expect(bridge.getChildSnapshot(snapshot.childId)!.status).toBe('running');
  expect(closeSessionCalls).not.toContain(sessionId);

  session.emit('complete', { subtype: 'failed', error: { kind: 'model', message: '500 Internal' } });
  await waitForSend(parentSessionId, '自动重试 2 次');

  expect(bridge.getChildSnapshot(snapshot.childId)!.status).toBe('stopped');
  expect(closeSessionCalls).toContain(sessionId);
  expect(sessions.has(sessionId)).toBe(false);
});

test('自然完成不强杀：isRunning false 的空闲会话不触发 closeSession', async () => {
  const { snapshot, parentConversationId, sessionId, session } = await startTestChild(bridge, 'p-a');
  const parentSessionId = registerParentSession(parentConversationId);

  session.emit('complete', { subtype: 'success' });
  await waitForSend(parentSessionId, '结束但未交付');

  expect(bridge.getChildSnapshot(snapshot.childId)!.status).toBe('stopped');
  expect(closeSessionCalls).not.toContain(sessionId);
});

// 模拟重启：不经 startChild，直接往磁盘 conversation 存储塞一条带契约的历史记录（内存 childStates 天然无条目）
function seedHydratedChild(childId: string, sessionId: string, overrides?: { outputPath?: string | null; profileId?: string }) {
  const parentConversationId = nextParentConversationId();
  const conv: any = {
    id: childId,
    title: '重启前派出的子会话',
    groupId: 'g1',
    role: 'sub',
    parentConversationId,
    sessionId,
    contractMetadata: {
      parentSessionId: `sdk-${parentConversationId}`,
      task: '重启前的任务',
      expectedOutputPath: 'out-hydrated.md',
      createdBy: 'agent',
      subAgentProfileId: 'p-a',
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  if (overrides?.outputPath !== undefined) {
    if (overrides.outputPath === null) delete conv.contractMetadata.expectedOutputPath;
    else conv.contractMetadata.expectedOutputPath = overrides.outputPath;
  }
  if (overrides?.profileId) conv.contractMetadata.subAgentProfileId = overrides.profileId;
  convStore.set(childId, conv);
  return parentConversationId;
}

test('应用重启后 ResumeSession：内存跟踪丢失，从磁盘 conversation 重建并调起成功', async () => {
  const tools = await import('./tools/delegation-tools.js');
  const childId = 'child-rehydrated-resume';
  const parentConversationId = seedHydratedChild(childId, 'sdk-hydrated-resume');
  expect(bridge.getChildSnapshot(childId)).toBeNull();

  const resume = tools.createDelegationToolDefs({ role: 'main', workspaceId: 'ws-test', groupId: 'g1', conversationId: parentConversationId })
    .find((d) => d.name === 'dogear__ResumeSession')!;
  const result = await resume.handler({ sessionId: 'sdk-hydrated-resume' });

  expect(result.isError).toBeUndefined();
  expect(result.content[0].text).toContain('已调起');
  const snap = bridge.getChildSnapshot(childId)!;
  expect(snap.status).toBe('running');
  expect(snap.delivered).toBe(false);
  expect(snap.task).toBe('重启前的任务');
  expect(snap.outputPath).toBe('out-hydrated.md');
  expect(snap.profileName).toBe('p-a 档');
  expect(sendCalls.length).toBe(1);
  expect(sendCalls[0].text).toContain('从中断处继续完成任务');

  // 复活后 harness sessionId 会更新（attach 回写 conv），与进程内行为一致；用新 sessionId 再调应提示运行中
  const again = await resume.handler({ sessionId: snap.sessionId! });
  expect(again.content[0].text).toContain('正在运行中，无需调起');
  convStore.delete(childId);
});

test('应用重启后 ResumeSession：conversation 记录也不存在 → 报「不存在」', async () => {
  const tools = await import('./tools/delegation-tools.js');
  const parentConversationId = nextParentConversationId();

  const resume = tools.createDelegationToolDefs({ role: 'main', workspaceId: 'ws-test', groupId: 'g1', conversationId: parentConversationId })
    .find((d) => d.name === 'dogear__ResumeSession')!;
  const result = await resume.handler({ sessionId: 'sdk-never-existed' });

  expect(result.isError).toBe(true);
  expect(result.content[0].text).toContain('不存在');
});

test('rehydrateChildState：非 agent 派出的会话记录不可重建，返回 null', async () => {
  const conv: any = { id: 'child-manual-main', title: '手动会话', groupId: 'g1', role: 'main', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  expect(await bridge.rehydrateChildState('ws-test', conv)).toBeNull();
  expect(bridge.getChildSnapshot('child-manual-main')).toBeNull();
});

test('应用重启后 SendMessage 打停机子会话：rehydrate 后自动调起生效', async () => {
  const tools = await import('./tools/delegation-tools.js');
  const childId = 'child-rehydrated-send';
  const parentConversationId = seedHydratedChild(childId, 'sdk-hydrated-send', { outputPath: null, profileId: 'p-b' });

  const send = tools.createDelegationToolDefs({ role: 'main', workspaceId: 'ws-test', groupId: 'g1', conversationId: parentConversationId })
    .find((d) => d.name === 'dogear__SendMessage')!;
  const result = await send.handler({ toSessionId: 'sdk-hydrated-send', message: '重启后的追问', options: { delivery: false } });

  expect(result.isError).toBeUndefined();
  expect(result.content[0].text).toContain('已自动调起');
  const snap = bridge.getChildSnapshot(childId)!;
  expect(snap.status).toBe('running');
  expect(snap.outputPath).toBe('');
  expect(sendCalls.length).toBe(1);
  expect(sendCalls[0].text).toContain('重启后的追问');
  expect(sendCalls[0].text).not.toContain('从中断处继续完成任务');
  convStore.delete(childId);
});

test('应用重启后 StopSession 打已停子会话：rehydrate 后提示无需停止', async () => {
  const tools = await import('./tools/delegation-tools.js');
  const childId = 'child-rehydrated-stop';
  const parentConversationId = seedHydratedChild(childId, 'sdk-hydrated-stop');

  const stop = tools.createDelegationToolDefs({ role: 'main', workspaceId: 'ws-test', groupId: 'g1', conversationId: parentConversationId })
    .find((d) => d.name === 'dogear__StopSession')!;
  const result = await stop.handler({ sessionId: 'sdk-hydrated-stop' });

  expect(result.isError).toBeUndefined();
  expect(result.content[0].text).toContain('无需停止');
  expect(bridge.getChildSnapshot(childId)!.status).toBe('stopped');
  convStore.delete(childId);
});
