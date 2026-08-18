import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, expect, test } from 'bun:test';
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
const convService = await import('../services/conversation-service.js');

const statePath = path.join(process.env.DOGEAR_CONFIG_DIR!, 'delegation-state.json');

function readStateFile(): { version: number; children: any[] } {
  return JSON.parse(fs.readFileSync(statePath, 'utf-8'));
}

async function waitForEntry(childId: string, timeoutMs = 2000): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(statePath)) {
      const entry = readStateFile().children.find((c: any) => c.childId === childId);
      if (entry) return entry;
    }
    await sleep(20);
  }
  return null;
}

beforeEach(() => {
  setMockSettings({
    subAgent: { profiles: [makeProfile('p-a', 'prov-a', 't1')] },
    ai: { defaultModelSelection: null },
  });
});

test('startChild 后 delegation-state.json 落盘且字段完整', async () => {
  const { snapshot, sessionId } = await startTestChild(bridge, 'p-a');

  const entry = await waitForEntry(snapshot.childId);
  expect(entry).not.toBeNull();
  expect(entry.workspaceId).toBe('ws-test');
  expect(entry.parentConversationId).toBe(snapshot.parentConversationId);
  expect(entry.groupId).toBe('g1');
  expect(entry.outputPath).toBe(snapshot.outputPath);
  expect(entry.task).toBe('测试任务');
  expect(entry.title).toBe(snapshot.title);
  expect(entry.status).toBe('running');
  expect(entry.profileName).toBe('p-a 档');
  expect(entry.sessionId).toBe(sessionId);
  expect(entry.retryCount).toBe(0);
  expect(entry.modelTried).toEqual(['prov-a:t1']);
  expect(typeof entry.startedAt).toBe('number');
});

test('loadChildStates 把 running 恢复为 interrupted 并回写文件', async () => {
  const { snapshot } = await startTestChild(bridge, 'p-a');
  await waitForEntry(snapshot.childId);

  await bridge.loadChildStates();

  const snap = bridge.getChildSnapshot(snapshot.childId)!;
  expect(snap.status).toBe('interrupted');
  expect(snap.errorMessage).toBe('应用重启中断');
  expect(snap.task).toBe('测试任务');
  expect(snap.outputPath).toBe(snapshot.outputPath);
  expect(snap.sessionId).toBe(snapshot.sessionId);
  expect(readStateFile().children.find((c: any) => c.childId === snapshot.childId)?.status).toBe('interrupted');
});

test('conversation 已删除的条目恢复时被过滤', async () => {
  const { snapshot } = await startTestChild(bridge, 'p-a');
  await waitForEntry(snapshot.childId);
  convStore.delete(snapshot.childId);

  await bridge.loadChildStates();

  expect(bridge.getChildSnapshot(snapshot.childId)).toBeNull();
  expect(readStateFile().children.find((c: any) => c.childId === snapshot.childId)).toBeUndefined();
});

test('getChildrenByParent 合并持久层补集，内存条目优先去重', async () => {
  const parentConversationId = nextParentConversationId();
  const diskConvId = await convService.create('ws-test', 'g1', '持久层补集会话', null, {
    role: 'sub',
    parentConversationId,
    contractMetadata: {
      parentSessionId: `sdk-${parentConversationId}`,
      task: '持久层任务',
      expectedOutputPath: 'disk-out.md',
      createdBy: 'agent',
      subAgentProfileId: 'p-a',
    },
  });
  convStore.get(diskConvId).sessionId = 'sdk-disk-only-1';

  const memSnapshot = await bridge.startChild({
    parentConversationId,
    workspaceId: 'ws-test',
    groupId: 'g1',
    spec: { task: '内存任务', outputPath: 'mem-out.md' },
  });

  const children = await bridge.getChildrenByParent(parentConversationId);
  expect(children.length).toBe(2);

  const mem = children.find((c) => c.childId === memSnapshot.childId)!;
  expect(mem.status).toBe('running');
  expect(mem.task).toBe('内存任务');

  const disk = children.find((c) => c.childId === diskConvId)!;
  expect(disk.status).toBe('interrupted');
  expect(disk.task).toBe('持久层任务');
  expect(disk.outputPath).toBe('disk-out.md');
  expect(disk.profileName).toBe('p-a 档');
  expect(disk.sessionId).toBe('sdk-disk-only-1');
  expect(disk.title).toBe('持久层补集会话');
});
