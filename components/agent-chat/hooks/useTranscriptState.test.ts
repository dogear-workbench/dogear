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
