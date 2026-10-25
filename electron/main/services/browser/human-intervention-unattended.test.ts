import { describe, test, expect } from 'bun:test';
import path from 'node:path';
// electron/tipc stub 必须最先注册（进程级共享同一份，禁止在本文件再 mock 一份）；真实模块在其后动态加载
import '../../agents/delegation-test-mocks.js';
import { mock } from 'bun:test';

const dir = import.meta.dir;
const settingsPath = path.join(dir, '../settings-service.js');
const hiPath = path.join(dir, './human-intervention.js');

// settings-service mock：默认委托真实实现（不污染合跑进程其他测试），仅注入 unattended 开关
let unattendedFlag = false;
const realSettings: Record<string, unknown> = { ...(await import(settingsPath)) };
// unattended 开关完全由本文件 unattendedFlag 决定：合跑时 settings 槽位可能已被其他测试文件的
// mock 覆盖（delegation-test-mocks 的 mockSettings 单例），不能信任底座 loadSettings 的 ai 段
mock.module(settingsPath, () => ({
  ...realSettings,
  loadSettings: async () => {
    let settings: Record<string, any> = {};
    try {
      settings = (await (realSettings.loadSettings as () => Promise<Record<string, any>>)()) ?? {};
    } catch { /* 底座不可用时用空设置兜底 */ }
    return { ...settings, ai: { ...settings.ai, unattended: unattendedFlag } };
  },
}));

const hi = await import(hiPath);

type PendingListener = (pending: unknown[], resolved?: { outcome?: string }) => void;

function withBroadcaster(fn: PendingListener | null): void {
  hi.setHumanInterventionBroadcaster(fn as never);
}

function raise(reason: string, tabId: string): Promise<{ id: string; outcome?: string }> {
  return hi.raiseHumanIntervention({
    tabId,
    reason,
    message: '测试介入',
    url: 'https://example.com',
    conversationId: 'conv-unattended-hi',
    actions: [{ key: 'done', label: '完成' }],
  });
}

describe('无人值守介入跳过', () => {
  test('关闭开关：raise 正常挂起并广播 pending，用户解除后等待方收到结果', async () => {
    unattendedFlag = false;
    const events: string[] = [];
    withBroadcaster((pending, resolved) => events.push(resolved ? `resolved:${resolved.outcome}` : `pending:${pending.length}`));
    const request = await raise('login_required', 'ext-u1');
    expect(request.outcome).toBeUndefined();
    expect(hi.listPendingHumanInterventions()).toHaveLength(1);

    const waitPromise = hi.waitForInterventionResult(request.id, 60_000);
    hi.resolveHumanIntervention(request.id, 'user', 'approved');
    expect((await waitPromise).outcome).toBe('approved');
    expect(events).toEqual(['pending:1', 'resolved:approved']);
    withBroadcaster(null);
  });

  test('开启开关：raise 即跳过（不挂卡不广播），等待方立即拿到 unattended', async () => {
    unattendedFlag = true;
    let broadcastCount = 0;
    withBroadcaster(() => {
      broadcastCount++;
    });
    const request = await raise('guard_submit', 'ext-u2');
    expect(request.outcome).toBe('unattended');
    expect(broadcastCount).toBe(0);
    expect(hi.listPendingHumanInterventions()).toHaveLength(0);

    const result = await hi.waitForInterventionResult(request.id, 60_000);
    expect(result.outcome).toBe('unattended');
    expect(result.request?.id).toBe(request.id);
    withBroadcaster(null);
  });

  test('开启瞬间批量跳过：全部挂起介入解除并广播 unattended，等待方同步收到，返回处理数', async () => {
    unattendedFlag = false;
    const resolvedOutcomes: Array<string | undefined> = [];
    withBroadcaster((_pending, resolved) => {
      if (resolved) resolvedOutcomes.push(resolved.outcome);
    });
    const r1 = await raise('login_required', 'ext-u3');
    const r2 = await raise('extension_wait', 'extension-wait');
    const w1 = hi.waitForInterventionResult(r1.id, 60_000);
    const w2 = hi.waitForInterventionResult(r2.id, 60_000);

    expect(hi.resolveAllPendingInterventionsUnattended()).toBe(2);
    expect(hi.listPendingHumanInterventions()).toHaveLength(0);
    expect((await w1).outcome).toBe('unattended');
    expect((await w2).outcome).toBe('unattended');
    expect(resolvedOutcomes).toEqual(['unattended', 'unattended']);
    withBroadcaster(null);
  });

  test('无挂起时批量跳过返回 0；关闭开关后新 raise 恢复正常挂起', async () => {
    unattendedFlag = false;
    withBroadcaster(null);
    expect(hi.resolveAllPendingInterventionsUnattended()).toBe(0);

    const request = await raise('verification_required', 'ext-u4');
    expect(request.outcome).toBeUndefined();
    expect(hi.listPendingHumanInterventions()).toHaveLength(1);
    hi.resolveHumanIntervention(request.id, 'auto');
    expect(hi.listPendingHumanInterventions()).toHaveLength(0);
  });
});
