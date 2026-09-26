import { describe, expect, test } from 'bun:test';
import type { Message } from '../types';
import {
  appendPendingBlockCore,
  applyEventToCore,
  initialTranscriptCore,
  promoteCore,
  pushLiveAssistantCore,
  pushLocalUserCore,
  resolvePermissionCore,
  settleTailCore,
  isDeltaStreamEvent,
  drainPendingStreamEvents,
  mergeHistorySnapshotCore,
  findHistoryOverlapIndex,
  shouldFinalizeTranscriptInit,
  type PendingStreamEvent,
} from './useTranscriptState';

const assistant = (blocks: Message['contentBlocks'] = []): Message => ({
  role: 'assistant',
  content: '',
  timestamp: 1,
  id: 'a-local',
  isStreaming: true,
  contentBlocks: blocks,
});

const user = (): Message => ({ role: 'user', content: 'hello', timestamp: 1, id: 'u-local' });

function event(type: string, extra: Record<string, unknown> = {}) {
  return { type, timestamp: 1, ...extra };
}

describe('useTranscriptState core', () => {
  test('纯 text delta 不增加 structuralVersion，新 block 和 tool output 会增加', () => {
    let core = initialTranscriptCore();
    core = pushLocalUserCore(core, user());
    core = pushLiveAssistantCore(core, assistant());

    core = applyEventToCore(core, event('text', { content: 'a' }), true);
    const afterFirstText = core.structuralVersion;
    core = applyEventToCore(core, event('text', { content: 'b' }), true);
    expect(core.structuralVersion).toBe(afterFirstText);

    core = applyEventToCore(core, event('tool_use', {
      toolName: 'TaskCreate',
      toolUseId: 'tool-1',
      toolInput: { subject: 'task' },
    }), true);
    const afterTaskCreate = core.structuralVersion;
    expect(afterTaskCreate).toBeGreaterThan(afterFirstText);

    core = applyEventToCore(core, event('tool_result', {
      toolUseId: 'tool-1',
      toolOutput: 'Task #1 created successfully: task',
    }), true);
    expect(core.structuralVersion).toBeGreaterThan(afterTaskCreate);
  });

  test('流事件分流与队列 drain 保持顺序并在事件后执行副作用', () => {
    expect(isDeltaStreamEvent(event('text'))).toBe(true);
    expect(isDeltaStreamEvent(event('thinking'))).toBe(true);
    expect(isDeltaStreamEvent(event('result'))).toBe(false);
    expect(isDeltaStreamEvent(event('permission_request'))).toBe(false);

    const pending: PendingStreamEvent[] = [];
    const order: string[] = [];
    pending.push({ event: event('text'), sideEffect: () => order.push('text-effect') });
    pending.push({ event: event('tool_result'), sideEffect: () => order.push('result-effect') });
    drainPendingStreamEvents(pending, (item) => order.push(item.type));

    expect(order).toEqual(['text', 'text-effect', 'tool_result', 'result-effect']);
    expect(pending).toEqual([]);
  });

  test('按 entryIds 交集从历史尾部截断并重放 snapshot 顺序', () => {
    const history: Message[] = [
      { role: 'user', content: 'old', id: 'u-old' },
      { role: 'assistant', content: 'done', id: 'a-old', entryIds: ['a-old', 'a-turn'] },
      { role: 'user', content: 'next', id: 'u-next' },
    ];
    const snapshot = [
      event('text', { content: 'live-' }),
      event('text', { content: 'tail' }),
      event('message_id', { role: 'assistant', uuid: 'a-live' }),
    ];
    const merged = mergeHistorySnapshotCore(history, snapshot, ['a-turn', 'a-live'], [{
      requestId: 'perm-snapshot',
      toolName: 'Bash',
      toolInput: { command: 'pwd' },
    }], true);

    expect(findHistoryOverlapIndex(history, ['a-turn', 'a-live'])).toBe(1);
    expect(merged.stable.map((message) => message.id)).toEqual(['u-old']);
    expect(merged.live[0].content).toBe('live-tail');
    expect(merged.live[0].entryIds).toEqual(['a-live']);
    expect(merged.pendingActions).toEqual([{ requestId: 'perm-snapshot', kind: 'permission' }]);
    expect(merged.live[0].contentBlocks?.some((block) => block.permissionRequestId === 'perm-snapshot')).toBe(true);
  });

  test('空 turnEntryIds 不截断历史且不重放 snapshot', () => {
    const history: Message[] = [{ role: 'user', content: 'keep', id: 'u-1' }];
    const merged = mergeHistorySnapshotCore(history, [event('text', { content: 'ignored' })], [], [], true);

    expect(merged.stable).toEqual(history);
    expect(merged.live).toEqual([]);
  });

  test('重放捞回磁盘切掉段的 user header 到 live 开头并剥离 isQueued', () => {
    const history: Message[] = [
      { role: 'user', content: 'old-q', id: 'u-old' },
      { role: 'assistant', content: 'old-a', id: 'a-old', entryIds: ['a-old'] },
      { role: 'user', content: 'run-q', id: 'entry-u', entryIds: ['entry-u'], isQueued: true },
    ];
    const snapshot = [
      event('message_id', { role: 'user', uuid: 'entry-u' }),
      event('text', { content: 'live-' }),
      event('text', { content: 'tail' }),
    ];
    const merged = mergeHistorySnapshotCore(history, snapshot, ['entry-u'], [], true);

    expect(merged.stable.map((message) => message.id)).toEqual(['u-old', 'a-old']);
    expect(merged.live).toHaveLength(2);
    expect(merged.live[0].role).toBe('user');
    expect(merged.live[0].id).toBe('entry-u');
    expect(merged.live[0].isQueued).toBeUndefined();
    expect(merged.live[1].content).toBe('live-tail');
  });

  test('交错插话的 user 捞回后锚定在前一条 run assistant 之后', () => {
    const history: Message[] = [
      { role: 'user', content: 'q0', id: 'e-u0' },
      { role: 'assistant', content: 'a0', id: 'e-a0', entryIds: ['e-a0'] },
      { role: 'user', content: 'q1', id: 'e-u1', entryIds: ['e-u1'] },
      { role: 'assistant', content: 'a1', id: 'e-a1', entryIds: ['e-a1'] },
      { role: 'user', content: 'q2', id: 'e-u2', entryIds: ['e-u2'] },
    ];
    const snapshot = [
      event('message_id', { role: 'user', uuid: 'e-u1' }),
      event('text', { content: 'one' }),
      event('message_id', { role: 'assistant', uuid: 'e-a1' }),
      event('message_id', { role: 'user', uuid: 'e-u2' }),
      event('text', { content: 'two' }),
    ];
    const merged = mergeHistorySnapshotCore(history, snapshot, ['e-u1', 'e-a1', 'e-u2'], [], true);

    expect(merged.stable.map((message) => message.id)).toEqual(['e-u0', 'e-a0', 'e-u1', 'e-a1']);
    expect(merged.live).toHaveLength(2);
    expect(merged.live[0].role).toBe('assistant');
    expect(merged.live[0].entryIds).toEqual(['e-a1']);
    expect(merged.live[0].content).toBe('onetwo');
    expect(merged.live[1].role).toBe('user');
    expect(merged.live[1].id).toBe('e-u2');
  });

  test('注入 user 已由重放事件落 live 时捞回按 id 去重跳过', () => {
    const history: Message[] = [
      { role: 'user', content: 'hi', id: 'e-w', entryIds: ['e-w'] },
    ];
    const snapshot = [
      event('user', { content: 'hi', injectedTag: 'task-execution' }),
      event('message_id', { role: 'user', uuid: 'e-w' }),
      event('text', { content: 'reply' }),
    ];
    const merged = mergeHistorySnapshotCore(history, snapshot, ['e-w'], [], true);

    expect(merged.stable).toEqual([]);
    expect(merged.live.filter((message) => message.role === 'user')).toHaveLength(1);
    expect(merged.live[0].id).toBe('e-w');
    expect(merged.live[0].content).toBe('hi');
    expect(merged.live[1].content).toBe('reply');
  });

  test('注入消息快照顺序 injected→message_id 时 live 恰一条且 id 升级为磁盘 id', () => {
    const history: Message[] = [
      { role: 'user', content: 'dispatch text', id: 'e-inj', entryIds: ['e-inj'] },
    ];
    const snapshot = [
      event('user', { content: 'dispatch text', injectedTag: 'dispatch' }),
      event('message_id', { role: 'user', uuid: 'e-inj' }),
      event('text', { content: 'answer' }),
    ];
    const merged = mergeHistorySnapshotCore(history, snapshot, ['e-inj'], [], true);

    expect(merged.live.filter((message) => message.role === 'user')).toHaveLength(1);
    expect(merged.live[0].id).toBe('e-inj');
    expect(merged.live[0].entryIds).toEqual(['e-inj']);
    expect(merged.live[0].content).toBe('dispatch text');
    expect(merged.live[1].content).toBe('answer');
  });

  test('初始化超时或 attach 失败可强制结束门槛', () => {
    const init = {
      key: 'conversation-1',
      startedAt: 100,
      turnEntryIds: [],
      pendingPermissionRequests: [],
      ready: false,
      timedOut: false,
    };
    expect(shouldFinalizeTranscriptInit(init, 2099)).toBe(false);
    expect(shouldFinalizeTranscriptInit(init, 2100)).toBe(true);
    expect(shouldFinalizeTranscriptInit({ ...init, ready: true }, 10000)).toBe(false);
  });

  test('新 user 到达时先提升未完成的旧 live，新消息成为新 live 的 header', () => {
    let core = initialTranscriptCore();
    core = pushLiveAssistantCore(core, assistant());
    core = pushLocalUserCore(core, { role: 'user', content: 'new', id: 'u-new' });

    expect(core.stable.map((message) => message.id)).toEqual(['a-local']);
    expect(core.stable[0].isStreaming).toBe(false);
    expect(core.live.map((message) => message.id)).toEqual(['u-new']);
  });

  test('空闲发送：pushLocalUser 只落 live，stable 不变', () => {
    let core = initialTranscriptCore();
    core = pushLiveAssistantCore(core, assistant());
    core = promoteCore(core);
    const versionBefore = core.structuralVersion;

    core = pushLocalUserCore(core, user());

    expect(core.stable.map((message) => message.id)).toEqual(['a-local']);
    expect(core.live.map((message) => message.id)).toEqual(['u-local']);
    expect(core.structuralVersion).toBe(versionBefore + 1);
  });

  test('插话：旧 live 整体提升进 stable，新 user 落 live', () => {
    let core = initialTranscriptCore();
    core = pushLocalUserCore(core, { role: 'user', content: 'first', id: 'u-1' });
    core = pushLiveAssistantCore(core, assistant());

    core = pushLocalUserCore(core, { role: 'user', content: 'second', id: 'u-2' });

    expect(core.stable.map((message) => message.id)).toEqual(['u-1', 'a-local']);
    expect(core.stable[1].isStreaming).toBe(false);
    expect(core.live.map((message) => message.id)).toEqual(['u-2']);
  });

  test('注入 user 事件落 live 而非 stable', () => {
    let core = initialTranscriptCore();

    core = applyEventToCore(core, event('user', { content: 'hi', injectedTag: 'task-execution' }), true);

    expect(core.stable).toEqual([]);
    expect(core.live).toHaveLength(1);
    expect(core.live[0].role).toBe('user');
    expect(core.live[0].content).toBe('hi');
  });

  test('权限请求登记、解决和 promote 状态一致', () => {
    let core = initialTranscriptCore();
    core = pushLiveAssistantCore(core, assistant());
    core = appendPendingBlockCore(core, {
      type: 'permission_request',
      timestamp: 1,
      permissionRequestId: 'perm-1',
    });

    expect(core.pendingActions).toEqual([{ requestId: 'perm-1', kind: 'permission' }]);
    expect(core.live[0].contentBlocks?.[0].permissionRequestId).toBe('perm-1');

    core = resolvePermissionCore(core, 'perm-1', 'allow');
    expect(core.pendingActions).toEqual([]);
    expect(core.live[0].contentBlocks?.[0].permissionResolved).toBe('allow');

    core = settleTailCore(core);
    core = promoteCore(core);
    expect(core.live).toEqual([]);
    expect(core.stable).toHaveLength(1);
  });
});
