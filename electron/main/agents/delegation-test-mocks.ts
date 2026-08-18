/**
 * delegation 系列集成测试的共享 mock。
 * bun test 单进程合跑多个测试文件时，同一模块的 mock.module 先注册者生效——
 * 所有测试文件必须经由本模块注册同一份实现，避免 bridge 单例绑定到不一致的 mock。
 */

import { mock } from 'bun:test';
import { EventEmitter } from 'events';
import path from 'node:path';

const dir = import.meta.dir;

export const sessions = new Map<string, any>();
export const attachSessionByConv = new Map<string, string>();
export const convStore = new Map<string, any>();
export const updateModelSelectionCalls: Array<{ id: string; modelSelection: any }> = [];
export const sendCalls: Array<{ sessionId: string; text: string }> = [];

let childSeq = 0;
let parentSeq = 0;
let attachSeq = 0;
let mockSettings: any = { subAgent: { profiles: [] }, ai: { defaultModelSelection: null } };

export function setMockSettings(settings: any): void {
  mockSettings = settings;
}

export function nextParentConversationId(): string {
  return `parent-${++parentSeq}`;
}

export function makeProfile(id: string, profileId: string, tier: string): any {
  return {
    id,
    name: `${id} 档`,
    modelSelection: { profileId, tier },
    timeoutMinutes: 30,
    enabledBasicTools: [],
    enabledAbilities: {},
  };
}

function makeFakeSession(sessionId: string): any {
  const s: any = new EventEmitter();
  s.getHarnessSessionId = () => sessionId;
  s.sendMessage = (text: string) => { sendCalls.push({ sessionId, text }); return Promise.resolve(); };
  s.interrupt = () => Promise.resolve();
  return s;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startTestChild(bridge: any, profile?: string) {
  const parentConversationId = nextParentConversationId();
  const snapshot = await bridge.startChild({
    parentConversationId,
    workspaceId: 'ws-test',
    groupId: 'g1',
    spec: { task: '测试任务', outputPath: `out-${parentSeq}.md`, profile },
  });
  const sessionId = (await bridge.waitForChildSessionId(snapshot.childId)) as string;
  return { parentConversationId, snapshot, sessionId, session: sessions.get(sessionId) };
}

export function installDelegationMocks(): void {
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
    create: async (_workspaceId: string, _groupId: string, _title: string, modelSel: any) => {
      const id = `child-${++childSeq}`;
      convStore.set(id, { id, groupId: 'g1', modelSelection: modelSel ?? null });
      return id;
    },
    getById: async (_workspaceId: string, id: string) => {
      if (id.startsWith('parent-')) {
        return { id, groupId: 'g1', sessionId: `sdk-${id}`, modelSelection: null };
      }
      return convStore.get(id) ?? null;
    },
    deleteConversation: async () => {},
    updateModelSelection: async (_workspaceId: string, id: string, modelSelection: any) => {
      updateModelSelectionCalls.push({ id, modelSelection });
      const conv = convStore.get(id);
      if (conv) conv.modelSelection = modelSelection ? { ...modelSelection } : null;
    },
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
    loadSettings: async () => mockSettings,
  }));

  mock.module(path.join(dir, '../services/conversation-runtime-service.js'), () => ({
    conversationRuntimeService: {
      attachConversation: async (childId: string) => {
        let sessionId = attachSessionByConv.get(childId);
        if (!sessionId) {
          sessionId = `sdk-${childId}-${Math.random().toString(36).slice(2, 6)}`;
          sessions.set(sessionId, makeFakeSession(sessionId));
          attachSessionByConv.set(childId, sessionId);
        }
        return { sessionId, attachmentId: `att-${++attachSeq}` };
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
}
