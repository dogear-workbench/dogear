import { describe, test, expect } from 'bun:test';
// electron/tipc stub 必须最先注册（进程级共享同一份，禁止在本文件再 mock 一份）；真实模块在其后动态加载
import '../delegation-test-mocks.js';
import type { PiSession, PiSessionConfig } from './pi-session.js';
import type { HarnessToolCallEvent, HarnessToolCallResult } from './pi-harness-adapter.js';
import { createDefaultBasicToolPermissions } from '../../services/settings-types.js';

const { PiSession } = await import('./pi-session.js');

function makeSession(overrides: Partial<PiSessionConfig> = {}): PiSession {
  return new PiSession('unattended-test', {
    conversationId: 'conv-unattended',
    modelSelection: null,
    workspacePath: '/tmp/dogear-unattended-ws',
    additionalPaths: [],
    workspaceId: 'ws-unattended',
    harnessSessionId: null,
    enabledToolPacks: [],
    role: 'main',
    permissionMode: 'default',
    basicToolPermissions: createDefaultBasicToolPermissions(),
    ...overrides,
  });
}

type ToolCallHook = (context: HarnessToolCallEvent) => Promise<HarnessToolCallResult | undefined>;

function toolCallHook(session: PiSession): ToolCallHook {
  return (session as unknown as { handleToolCall: ToolCallHook }).handleToolCall.bind(session);
}

// 同步发起不 await（handleToolCall 挂起时返回 pending promise）：先拿引用，放行/拒绝后再 await，
// 否则 await 先挂死、后续 resolve 永远不执行
function raisePending(session: PiSession): Promise<HarnessToolCallResult | undefined> {
  return toolCallHook(session)({ toolName: 'dogear__GitRevert', input: {} } as HarnessToolCallEvent);
}

describe('无人值守接管与恢复', () => {
  test('takeOver 切 autoExecute 并广播 permissionModeChanged，重复接管幂等不覆盖记录', () => {
    const session = makeSession();
    const modes: string[] = [];
    session.on('permissionModeChanged', (data: { mode: string }) => modes.push(data.mode));

    session.takeOverForUnattended();
    session.takeOverForUnattended();
    expect(session.getPermissionMode()).toBe('autoExecute');

    session.restoreFromUnattended();
    expect(session.getPermissionMode()).toBe('default');
    expect(modes).toEqual(['autoExecute', 'default']);
  });

  test('restore：用户在接管期间手动切过模式则不动', async () => {
    const session = makeSession();
    session.takeOverForUnattended();
    await session.setPermissionMode('default');
    session.restoreFromUnattended();
    expect(session.getPermissionMode()).toBe('default');
  });

  test('restore：未被接管时 no-op', () => {
    const session = makeSession();
    session.restoreFromUnattended();
    expect(session.getPermissionMode()).toBe('default');
  });

  test('原模式已是 autoExecute 时接管/恢复短路无副作用', () => {
    const session = makeSession({ permissionMode: 'autoExecute' });
    session.takeOverForUnattended();
    expect(session.getPermissionMode()).toBe('autoExecute');
    session.restoreFromUnattended();
    expect(session.getPermissionMode()).toBe('autoExecute');
  });

  test('sub 会话 setPermissionMode 恒 autoExecute，接管不改语义', () => {
    const session = makeSession({ role: 'sub', parentConversationId: 'conv-parent' });
    session.takeOverForUnattended();
    expect(session.getPermissionMode()).toBe('autoExecute');
    session.restoreFromUnattended();
    expect(session.getPermissionMode()).toBe('autoExecute');
  });
});

describe('无人值守挂起权限请求放行', () => {
  test('无挂起请求时返回 0', () => {
    const session = makeSession();
    expect(session.resolveAllPendingPermissions(true)).toBe(0);
  });

  test('放行：resolve 语义为 undefined（allow），autoExecute 后新调用不再挂起（含 GitRevert）', async () => {
    const session = makeSession();
    const pending = raisePending(session);
    expect(session.resolveAllPendingPermissions(true)).toBe(1);
    expect(session.isIdle()).toBe(true);
    expect(await pending).toBeUndefined();

    session.takeOverForUnattended();
    const hook = toolCallHook(session);
    expect(await hook({ toolName: 'dogear__GitRevert', input: {} } as HarnessToolCallEvent)).toBeUndefined();
  });

  test('拒绝：resolve 语义为 block 结果', async () => {
    const session = makeSession();
    const pending = raisePending(session);
    expect(session.resolveAllPendingPermissions(false)).toBe(1);
    expect(await pending).toEqual({ block: true, reason: '用户拒绝了此操作' });
  });
});
