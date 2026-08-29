import { afterEach, beforeEach, expect, test } from 'bun:test';
import {
  convStore,
  installDelegationMocks,
  makeProfile,
  nextParentConversationId,
  setMockSettings,
  sleep,
  startTestChild,
} from './delegation-test-mocks.js';

installDelegationMocks();

const bridge = await import('./delegation-bridge.js');
const terminal = await import('./delegation-terminal.js');
const convService = await import('../services/conversation-service.js');

beforeEach(() => {
  setMockSettings({
    subAgent: { profiles: [makeProfile('p-a', 'prov-a', 't1')] },
    ai: { defaultModelSelection: null },
  });
  terminal.setDelegationMaxRetry(0);
});

afterEach(() => {
  terminal.setDelegationMaxRetry(terminal.MAX_RETRY);
});

test('CreateSessionBatch 老链路：同父会话批量创建两个子会话，previewClaim 通过后互不干扰', async () => {
  const parentConversationId = nextParentConversationId();

  const preview = await bridge.previewClaim('ws-test', 'g1', ['batch-a.md', 'batch-b.md']);
  expect(preview.ok).toBe(true);

  const first = await bridge.startChild({
    parentConversationId,
    workspaceId: 'ws-test',
    groupId: 'g1',
    spec: { task: '批量任务A', outputPath: 'batch-a.md' },
  });
  const second = await bridge.startChild({
    parentConversationId,
    workspaceId: 'ws-test',
    groupId: 'g1',
    spec: { task: '批量任务B', outputPath: 'batch-b.md' },
  });

  expect(first.childId).not.toBe(second.childId);
  expect(first.sessionId).toBeTruthy();
  expect(second.sessionId).toBeTruthy();
  expect(first.sessionId).not.toBe(second.sessionId);
  expect(first.outputPath).toBe('batch-a.md');
  expect(second.outputPath).toBe('batch-b.md');

  const children = await bridge.getChildrenByParent(parentConversationId);
  expect(children.length).toBe(2);
  expect(children.every((c: any) => c.status === 'running' && c.parentConversationId === parentConversationId)).toBe(true);
});

test('abortWaitsForParent 老链路：等待 resolve null、运行中子会话取消、其他父会话不受影响', async () => {
  const mine = await startTestChild(bridge, 'p-a');
  const other = await startTestChild(bridge, 'p-a');

  const myWait = bridge.waitForMessage(mine.parentConversationId, [mine.sessionId], 30_000);
  const otherWait = bridge.waitForMessage(other.parentConversationId, [other.sessionId], 30_000);

  const result = bridge.abortWaitsForParent(mine.parentConversationId);
  expect(result.abortedWaits).toBe(1);
  expect(result.cancelledChildren).toBe(1);

  expect(await myWait).toBeNull();
  await sleep(100);
  expect(bridge.getChildSnapshot(mine.snapshot.childId)!.status).toBe('stopped');
  expect(bridge.getChildSnapshot(mine.snapshot.childId)!.lastError).toBe('被停止');

  const raced = await Promise.race([otherWait, sleep(150).then(() => 'pending')]);
  expect(raced).toBe('pending');
  expect(bridge.getChildSnapshot(other.snapshot.childId)!.status).toBe('running');
  bridge.abortMessageWaits(other.parentConversationId);
});

test('通讯型交付（无 outputPath）：创建、交付、停止后复活全流程空路径不误判', async () => {
  const parentConversationId = nextParentConversationId();

  const snapshot = await bridge.startChild({
    parentConversationId,
    workspaceId: 'ws-test',
    groupId: 'g1',
    spec: { task: '问答任务', profile: 'p-a' },
  });
  expect(snapshot.outputPath).toBe('');
  expect(snapshot.sessionId).toBeTruthy();

  bridge.markChildDelivered(snapshot.childId);
  expect(bridge.getChildSnapshot(snapshot.childId)!.delivered).toBe(true);

  await bridge.stopChild(snapshot.childId, 'cancelled');
  await bridge.resumeChild(snapshot.childId, { reason: '测试调起' });
  const resumed = bridge.getChildSnapshot(snapshot.childId)!;
  expect(resumed.status).toBe('running');
  expect(resumed.outputPath).toBe('');

  const children = await bridge.getChildrenByParent(parentConversationId);
  expect(children.length).toBe(1);
  expect(children[0].outputPath).toBe('');

  bridge.abortMessageWaits(parentConversationId);
});

test('getChildrenByParent 补集截断：内存不跟踪的历史子会话超过 10 条时只返回最近 10 条', async () => {
  const parentConversationId = nextParentConversationId();
  const ids: string[] = [];
  for (let i = 0; i < 12; i++) {
    const id = await convService.create('ws-test', 'g1', `历史子会话 ${i}`, null, {
      role: 'sub',
      parentConversationId,
      contractMetadata: {
        parentSessionId: `sdk-${parentConversationId}`,
        task: `历史任务 ${i}`,
        expectedOutputPath: `hist-${i}.md`,
        createdBy: 'agent',
        subAgentProfileId: 'p-a',
      },
    });
    convStore.get(id).updatedAt = new Date(Date.now() + i * 60_000).toISOString();
    ids.push(id);
  }

  const children = await bridge.getChildrenByParent(parentConversationId);
  expect(children.length).toBe(10);
  expect(children.every((c: any) => c.status === 'stopped' && c.delivered === false)).toBe(true);
  expect(children.map((c: any) => c.task)).toEqual([
    '历史任务 11', '历史任务 10', '历史任务 9', '历史任务 8', '历史任务 7',
    '历史任务 6', '历史任务 5', '历史任务 4', '历史任务 3', '历史任务 2',
  ]);
  expect(children.find((c: any) => c.childId === ids[0])).toBeUndefined();
  expect(children.find((c: any) => c.childId === ids[1])).toBeUndefined();
});
