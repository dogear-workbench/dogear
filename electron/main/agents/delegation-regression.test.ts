import { afterEach, beforeEach, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';
import {
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

const statePath = path.join(process.env.DOGEAR_CONFIG_DIR!, 'delegation-state.json');

function readStateChildren(): any[] {
  if (!fs.existsSync(statePath)) return [];
  return (JSON.parse(fs.readFileSync(statePath, 'utf-8')) as { children?: any[] }).children ?? [];
}

async function waitForFileStatus(childId: string, status: string, timeoutMs = 2000): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const entry = readStateChildren().find((c: any) => c.childId === childId);
    if (entry?.status === status) return entry;
    await sleep(20);
  }
  return null;
}

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
  expect(bridge.getChildSnapshot(mine.snapshot.childId)!.status).toBe('cancelled');
  expect(bridge.getChildSnapshot(mine.snapshot.childId)!.errorMessage).toBe('被停止');

  const raced = await Promise.race([otherWait, sleep(150).then(() => 'pending')]);
  expect(raced).toBe('pending');
  expect(bridge.getChildSnapshot(other.snapshot.childId)!.status).toBe('running');
  bridge.abortMessageWaits(other.parentConversationId);
});

test('delegation-state.json 每 child 恒一条：多次状态变化不产生重复条目，终态条目保留', async () => {
  const before = new Set(readStateChildren().map((c: any) => c.childId));

  const a = await startTestChild(bridge, 'p-a');
  const b = await startTestChild(bridge, 'p-a');

  a.session.emit('complete', { subtype: 'failed', error: { kind: 'model', message: '500 Internal Server Error' } });
  expect(await waitForFileStatus(a.snapshot.childId, 'failed')).not.toBeNull();

  await bridge.resumeChild(a.snapshot.childId, { reason: '回归测试调起' });
  expect(await waitForFileStatus(a.snapshot.childId, 'running')).not.toBeNull();

  bridge.markChildDelivered(a.snapshot.childId, '回归交付摘要');
  const doneEntry = await waitForFileStatus(a.snapshot.childId, 'done');
  expect(doneEntry.summary).toBe('回归交付摘要');

  await bridge.stopChild(b.snapshot.childId, 'cancelled');
  expect(await waitForFileStatus(b.snapshot.childId, 'cancelled')).not.toBeNull();

  const children = readStateChildren();
  const ids = children.map((c: any) => c.childId);
  expect(new Set(ids).size).toBe(ids.length);
  expect(children.filter((c: any) => !before.has(c.childId)).length).toBe(2);
});
