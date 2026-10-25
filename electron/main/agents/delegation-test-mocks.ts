/**
 * delegation 系列集成测试的共享 mock。
 * bun test 单进程合跑多个测试文件时 mock.module 是进程级全局、不可逆、后注册者覆盖，
 * 所有测试文件必须经由本模块注册同一份实现，避免 bridge 单例绑定到不一致的 mock。
 *
 * 顺序约束（bun 1.3 行为）：
 * - CJS 模块（electron）一旦被真实加载，后续 mock 的 named export 会失效，
 *   因此 electron/tipc stub 必须在本模块顶层（同步、最早）注册，禁止静态 import 任何会拉起真实 electron 的模块；
 * - mock 工厂必须 spread 真实模块的完整导出面只覆盖需要的 key，否则合跑时后加载的测试文件
 *   对 getWorkspaceDataDir / migratePiProfiles / electron default 的导入会链接失败；
 * 真实模块只能在 electron mock 注册之后动态 import。
 */

import { mock } from 'bun:test';
import { EventEmitter } from 'events';
import path from 'node:path';

const dir = import.meta.dir;

// 真实模块引用必须用单一 promise + 快照：mock 注册后 import 会拿到 mock 自身（live binding 也会被替换），
// 并发 install 共享同一次加载，快照在首次 mock.module 注册之前完成
let realCsSpread: Record<string, unknown> = {};
let realSettingsSpread: Record<string, unknown> = {};
let realSharedSpread: Record<string, unknown> = {};
let realGetByIdGlobal: ((id: string) => Promise<unknown>) | null = null;
let realModulesPromise: Promise<void> | null = null;

function loadRealServiceModules(): Promise<void> {
  if (!realModulesPromise) {
    realModulesPromise = (async () => {
      const [cs, ss, gs] = await Promise.all([
        import(path.join(dir, '../services/conversation-service.js')),
        import(path.join(dir, '../services/settings-service.js')),
        import(path.join(dir, '../services/group-shared-service.js')),
      ]);
      realCsSpread = { ...cs };
      realSettingsSpread = { ...ss };
      realSharedSpread = { ...gs };
      realGetByIdGlobal = cs.getByIdGlobal;
    })();
  }
  return realModulesPromise;
}

const browserWindowStub = { getAllWindows: () => [{ isDestroyed: () => false, webContents: {} }] };
const electronStub = {
  BrowserWindow: browserWindowStub,
  WebContentsView: class {},
  session: {},
  nativeImage: {},
  Notification: {},
  Tray: {},
  app: { on: () => {} },
  nativeTheme: {},
  ipcMain: { on: () => {}, handle: () => {}, removeHandler: () => {} },
  ipcRenderer: {},
  dialog: {},
  shell: {},
  Menu: {},
  webContents: {},
};

mock.module('electron', () => ({
  ...electronStub,
  default: electronStub,
}));

// 真实 tipc/main 顶层 named import electron 的 ipcMain，静态加载会链接失败，手工补齐全部运行时导出
mock.module('@egoist/tipc/main', () => ({
  tipc: { create: () => ({ procedure: {} }) },
  registerIpcMain: () => {},
  getRendererHandlers: () => ({
    childStatusChanged: { send: () => {} },
    conversationListChanged: { send: () => {} },
    failoverNotice: { send: () => {} },
  }),
}));

export const sessions = new Map<string, any>();
const sessionRefCounts = new Map<string, number>();
export const attachSessionByConv = new Map<string, string>();
const attachmentMeta = new Map<string, { conversationId: string; sessionId: string }>();
export const sessionOwnerConv = new Map<string, string>();
export const convStore = new Map<string, any>();
export const updateModelSelectionCalls: Array<{ id: string; modelSelection: any }> = [];
export const sendCalls: Array<{ sessionId: string; text: string }> = [];
export const runtimeDetachCalls: Array<{ conversationId: string; holderType: string }> = [];
export const conversationListChangedCalls: string[] = [];
export const closeSessionCalls: string[] = [];
export const pushDirectCalls: Array<{ title: string; summary?: string; conversationId?: string; workspaceId?: string }> = [];

let childSeq = 0;
let parentSeq = 0;
let attachSeq = 0;
let mockSettings: any = {
  subAgent: { profiles: [] },
  ai: { defaultModelSelection: null },
  failover: { enabled: false, chain: [] },
};

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
  s.runningFlag = false;
  s.isRunning = () => s.runningFlag;
  return s;
}

/** 终态强杀测试用：把假 session 置为 run 卡死未 settle 的僵尸态 */
export function setSessionRunning(sessionId: string, running: boolean): void {
  const s = sessions.get(sessionId);
  if (s) s.runningFlag = running;
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

/**
 * 给父会话建 conversation→session 绑定（真实环境由 attachConversation 完成），
 * 使 pushToParentSession 的注入路径可达；返回父会话的 sessionId（= `sdk-${conversationId}`）。
 */
export function registerParentSession(parentConversationId: string): string {
  let sessionId = attachSessionByConv.get(parentConversationId);
  if (!sessionId) {
    sessionId = `sdk-${parentConversationId}`;
    sessions.set(sessionId, makeFakeSession(sessionId));
    attachSessionByConv.set(parentConversationId, sessionId);
    sessionOwnerConv.set(sessionId, parentConversationId);
  }
  return sessionId;
}

/** 轮询等待指定会话收到含 substr 的推送（注入是异步 fire-and-forget，固定 sleep 易碎） */
export async function waitForSend(
  sessionId: string,
  substr: string,
  timeoutMs = 2_000,
): Promise<{ sessionId: string; text: string }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const hit = sendCalls.find((c) => c.sessionId === sessionId && c.text.includes(substr));
    if (hit) return hit;
    if (Date.now() > deadline) {
      throw new Error(`等待推送超时: ${sessionId} 未出现「${substr}」，已收 sendCalls=${JSON.stringify(sendCalls.map((c) => c.sessionId))}`);
    }
    await sleep(20);
  }
}

export async function installDelegationMocks(): Promise<void> {
  // 真实模块只能在 electron mock（本模块顶层已注册）之后动态加载：
  // 1) 避免真实 electron CJS 进入模块图导致后续 named mock 失效；
  // 2) spread 完整导出面，只覆盖 delegation 需要的 key，保住合跑时其他测试文件的 named import。
  await loadRealServiceModules();

  mock.module('@egoist/tipc/main', () => ({
    tipc: { create: () => ({ procedure: {} }) },
    registerIpcMain: () => {},
    getRendererHandlers: () => ({
      childStatusChanged: { send: () => {} },
      conversationListChanged: { send: (data: { workspaceId: string }) => { conversationListChangedCalls.push(data.workspaceId); } },
      failoverNotice: { send: () => {} },
    }),
  }));

  mock.module(path.join(dir, '../services/conversation-service.js'), () => ({
    ...realCsSpread,
    create: async (
      _workspaceId: string,
      _groupId: string,
      _title: string,
      modelSel: any,
      options?: { role?: string; parentConversationId?: string; contractMetadata?: any },
    ) => {
      const id = `child-${++childSeq}`;
      const now = new Date().toISOString();
      convStore.set(id, {
        id,
        title: _title,
        groupId: 'g1',
        modelSelection: modelSel ?? null,
        role: options?.role ?? 'main',
        parentConversationId: options?.parentConversationId ?? null,
        contractMetadata: options?.contractMetadata,
        createdAt: now,
        updatedAt: now,
      });
      return id;
    },
    getById: async (_workspaceId: string, id: string) => {
      if (id.startsWith('parent-')) {
        return { id, title: '父会话', groupId: 'g1', sessionId: `sdk-${id}`, modelSelection: null };
      }
      return convStore.get(id) ?? null;
    },
    getByIdGlobal: async (id: string) => {
      if (id.startsWith('parent-')) {
        return { conv: { id, groupId: 'g1', sessionId: `sdk-${id}`, modelSelection: null }, workspaceId: 'ws-test' };
      }
      const conv = convStore.get(id);
      if (conv) return { conv, workspaceId: 'ws-test' };
      // delegation 内存数据 miss 时回落真实实现：合跑时 usage-service 等测试靠真实磁盘读写验证 applyUsageSummary
      return realGetByIdGlobal!(id);
    },
    getBySessionId: async (sessionId: string) => {
      if (sessionId.startsWith('sdk-parent-')) {
        const id = sessionId.slice('sdk-'.length);
        return { conv: { id, title: '父会话', groupId: 'g1', sessionId, modelSelection: null }, workspaceId: 'ws-test' };
      }
      for (const conv of convStore.values()) {
        if (conv.sessionId === sessionId) return { conv, workspaceId: 'ws-test' };
      }
      return null;
    },
    listByParent: async (_workspaceId: string, parentConversationId: string) =>
      Array.from(convStore.values()).filter(
        (c: any) => c.role === 'sub' && c.parentConversationId === parentConversationId,
      ),
    deleteConversation: async (_workspaceId: string, id: string) => {
      convStore.delete(id);
    },
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
    ...realSharedSpread,
    claimOutputPath: async () => ({ ok: true }),
    releaseOutputPath: () => {},
    previewClaim: async () => ({ ok: true }),
  }));

  mock.module(path.join(dir, '../services/settings-service.js'), () => ({
    ...realSettingsSpread,
    loadSettings: async () => mockSettings,
  }));

  mock.module(path.join(dir, '../services/conversation-runtime-service.js'), () => ({
    conversationRuntimeService: {
      attachConversation: async (conversationId: string) => {
        let sessionId = attachSessionByConv.get(conversationId);
        if (sessionId && sessions.has(sessionId)) {
          // 对齐真实 attach：复用存活 session 时 manager.retain（refCount +1），attachment 每次新建
          sessionRefCounts.set(sessionId, (sessionRefCounts.get(sessionId) ?? 0) + 1);
        } else {
          sessionId = `sdk-${conversationId}-${Math.random().toString(36).slice(2, 6)}`;
          sessions.set(sessionId, makeFakeSession(sessionId));
          sessionRefCounts.set(sessionId, 1);
          attachSessionByConv.set(conversationId, sessionId);
          sessionOwnerConv.set(sessionId, conversationId);
          // 对齐真实 attach：sessionId 回写 conversation，getBySessionId 才能反查到子会话
          const conv = convStore.get(conversationId);
          if (conv) conv.sessionId = sessionId;
        }
        const attachmentId = `att-${++attachSeq}`;
        attachmentMeta.set(attachmentId, { conversationId, sessionId });
        return { sessionId, attachmentId };
      },
      detachAttachment: (attachmentId: string) => {
        // 对齐真实 detach→release：refCount 归零即销毁 session 并摘除绑定；
        // 复用场景（transient 复活）旧 attachment detach 后 refCount 仍 >0，绑定保留；
        // session 仍 running 时对齐真实 manager 的 orphan 保活语义，不销毁（终态强杀测试依赖）
        const meta = attachmentMeta.get(attachmentId);
        if (!meta) return;
        attachmentMeta.delete(attachmentId);
        const next = (sessionRefCounts.get(meta.sessionId) ?? 1) - 1;
        sessionRefCounts.set(meta.sessionId, next);
        if (next > 0) return;
        sessionRefCounts.delete(meta.sessionId);
        if (sessions.get(meta.sessionId)?.isRunning?.()) return;
        sessions.delete(meta.sessionId);
        if (attachSessionByConv.get(meta.conversationId) === meta.sessionId) {
          attachSessionByConv.delete(meta.conversationId);
        }
      },
      detachByConversationHolder: (conversationId: string, holderType: string) => {
        runtimeDetachCalls.push({ conversationId, holderType });
        const existed = attachSessionByConv.delete(conversationId);
        return { count: existed ? 1 : 0, webContentsId: undefined };
      },
    },
  }));

  mock.module(path.join(dir, './pi-session/pi-session-manager.js'), () => ({
    getPiSessionManager: () => ({
      getSession: (sessionId: string) => sessions.get(sessionId),
      getSessionIdByConversation: (conversationId: string) => {
        const sessionId = attachSessionByConv.get(conversationId);
        return sessionId && sessions.has(sessionId) ? sessionId : undefined;
      },
      getConversationIdBySession: (sessionId: string) => sessionOwnerConv.get(sessionId),
      acquireHold: (sessionId: string) => sessions.has(sessionId),
      releaseHold: async () => {},
      // 对齐真实 closeSession：强制销毁并摘除 conversation 绑定
      closeSession: async (sessionId: string) => {
        closeSessionCalls.push(sessionId);
        sessions.delete(sessionId);
        const convId = sessionOwnerConv.get(sessionId);
        if (convId && attachSessionByConv.get(convId) === sessionId) attachSessionByConv.delete(convId);
      },
    }),
  }));

  // 无人值守直连推送 mock：记录调用供断言，避免测试进程触碰真实飞书配置/网络
  mock.module(path.join(dir, '../services/feishu/feishu-notify-outlet.js'), () => ({
    feishuNotifyOutlet: {
      pushDirect: async (input: { title: string; summary?: string; conversationId?: string; workspaceId?: string }) => {
        pushDirectCalls.push(input);
      },
    },
  }));
}
