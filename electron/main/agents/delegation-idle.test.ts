import { afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { EventEmitter } from 'events';
import path from 'node:path';

const dir = import.meta.dir;

const sessions = new Map<string, any>();
let childSeq = 0;
let parentSeq = 0;

function makeFakeSession(sessionId: string): any {
  const s: any = new EventEmitter();
  s.getHarnessSessionId = () => sessionId;
  s.sendMessage = () => Promise.resolve();
  s.interrupt = () => Promise.resolve();
  return s;
}

mock.module('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
}));

mock.module('@egoist/tipc/main', () => ({
  getRendererHandlers: () => ({
    childStatusChanged: { send: () => {} },
    conversationListChanged: { send: () => {} },
    deliveriesAwaitChanged: { send: () => {} },
  }),
}));

mock.module(path.join(dir, '../services/conversation-service.js'), () => ({
  create: async () => `child-${++childSeq}`,
  getById: async (_workspaceId: string, id: string) => {
    if (id.startsWith('parent-')) {
      return { id, groupId: 'g1', sessionId: `sdk-${id}`, modelSelection: null };
    }
    return null;
  },
  deleteConversation: async () => {},
}));

mock.module(path.join(dir, '../services/group-service.js'), () => ({
  requireActiveGroup: async () => {},
}));

mock.module(path.join(dir, '../services/group-shared-service.js'), () => ({
  claimOutputPath: async () => ({ ok: true }),
  releaseOutputPath: () => {},
  previewClaim: async () => ({ ok: true }),
}));

mock.module(path.join(dir, '../services/settings-service.js'), () => ({
  loadSettings: async () => ({
    subAgent: { profiles: [] },
    ai: { defaultModelSelection: null },
  }),
}));

mock.module(path.join(dir, '../services/conversation-runtime-service.js'), () => ({
  conversationRuntimeService: {
    attachConversation: async (childId: string) => {
      const sessionId = `sdk-${childId}-${Math.random().toString(36).slice(2, 6)}`;
      sessions.set(sessionId, makeFakeSession(sessionId));
      return { sessionId, attachmentId: `att-${childId}` };
    },
    detachAttachment: () => {},
  },
}));

mock.module(path.join(dir, './pi-session/pi-session-manager.js'), () => ({
  getPiSessionManager: () => ({
    getSession: (sessionId: string) => sessions.get(sessionId),
    getSessionIdByConversation: () => undefined,
  }),
}));

const bridge = await import('./delegation-bridge.js');
const idle = await import('./delegation-idle.js');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function startTestChild() {
  const parentConversationId = `parent-${++parentSeq}`;
  const snapshot = await bridge.startChild({
    parentConversationId,
    workspaceId: 'ws-test',
    groupId: 'g1',
    spec: { task: '测试任务', outputPath: `out-${parentSeq}.md` },
  });
  const sessionId = (await bridge.waitForChildSessionId(snapshot.childId)) as string;
  return { parentConversationId, snapshot, sessionId, session: sessions.get(sessionId) };
}

beforeEach(() => {
  idle.setDelegationIdleTimeoutMs(60);
});

afterEach(() => {
  idle.setDelegationIdleTimeoutMs(idle.IDLE_TIMEOUT_MS);
});

test('message 流事件持续重置 idleTimer，活跃会话不判 hang', async () => {
  idle.setDelegationIdleTimeoutMs(80);
  const { snapshot, sessionId, session } = await startTestChild();
  const before = bridge.getChildSnapshot(snapshot.childId)!.lastActivityAt;

  for (let i = 0; i < 4; i++) {
    await sleep(40);
    session.emit('message', { type: 'text', content: 'x', timestamp: Date.now() });
  }
  expect(bridge.getChildSnapshot(snapshot.childId)!.status).toBe('running');
  expect(bridge.getChildSnapshot(snapshot.childId)!.lastActivityAt!).toBeGreaterThan(before!);

  await sleep(250);
  expect(bridge.getChildSnapshot(snapshot.childId)!.status).toBe('hang');
  expect(sessions.get(sessionId)).toBeDefined();
});

test('无流事件到期触发 hang 终态并唤醒 waiter 带 terminal', async () => {
  const { snapshot, parentConversationId, sessionId } = await startTestChild();
  const waitPromise = bridge.waitForMessage(parentConversationId, [sessionId], 30_000);

  await sleep(180);
  const result = await waitPromise;

  expect(result).not.toBeNull();
  expect(result!.terminal?.status).toBe('hang');
  expect(result!.terminal?.errorClass).toBe('transient');
  expect(result!.terminal?.attempts).toBe(0);
  expect(result!.terminal?.modelTried).toEqual([]);
  expect(result!.delivery).toBe(false);
  expect(result!.message).toContain('无进展中断');
  expect(result!.fromSessionId).toBe(sessionId);
  expect(bridge.getChildSnapshot(snapshot.childId)!.status).toBe('hang');
  expect(bridge.getChildSnapshot(snapshot.childId)!.errorMessage).toBe('无进展中断');
});

test('complete(failed) 终态秒级唤醒 waiter 带 terminal', async () => {
  const { snapshot, parentConversationId, sessionId, session } = await startTestChild();
  const waitPromise = bridge.waitForMessage(parentConversationId, [sessionId], 30_000);

  session.emit('complete', {
    subtype: 'failed',
    error: { kind: 'model', message: '模型请求失败' },
  });
  const result = await waitPromise;

  expect(result!.terminal?.status).toBe('failed');
  expect(result!.terminal?.errorMessage).toBe('模型请求失败');
  expect(result!.message).toContain('模型请求失败');
  expect(result!.message).toContain('子会话');
  expect(bridge.getChildSnapshot(snapshot.childId)!.status).toBe('failed');
});

test('等待其他子会话的 waiter 不被终态通知误伤', async () => {
  idle.setDelegationIdleTimeoutMs(5_000);
  const a = await startTestChild();
  const b = await startTestChild();
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
