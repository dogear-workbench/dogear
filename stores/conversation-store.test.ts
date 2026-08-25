import { describe, expect, test } from 'bun:test';
import { mock } from 'bun:test';

interface FailoverNoticeEvent {
  conversationId: string;
  fromLabel: string;
  toLabel: string;
  at: number;
}

type EventHandler = (data: FailoverNoticeEvent) => void;
const listenersByEvent: Record<string, EventHandler[]> = {};

function emitEvent(event: string, data: FailoverNoticeEvent): void {
  for (const handler of [...(listenersByEvent[event] ?? [])]) {
    handler(data);
  }
}

mock.module('@/lib/events', () => ({
  rendererEvents: new Proxy({} as Record<string, { listen: (h: EventHandler) => () => void }>, {
    get: (_target, prop: string) => ({
      listen: (handler: EventHandler) => {
        (listenersByEvent[prop] ??= []).push(handler);
        return () => {
          listenersByEvent[prop] = (listenersByEvent[prop] ?? []).filter((h) => h !== handler);
        };
      },
    }),
  }),
}));

mock.module('@/lib/client', () => ({
  client: new Proxy({} as Record<string, (...args: unknown[]) => Promise<Record<string, unknown[]>>>, {
    get: (_target, prop: string) => async (...args: unknown[]) => ({ [prop]: args }),
  }),
}));

(globalThis as { window?: unknown }).window = globalThis;

const { useConversationStore } = await import('./conversation-store');
await new Promise((resolve) => setTimeout(resolve, 20));

describe('failoverNotice 渲染层重连', () => {
  test('failoverNotice 事件到达：pushFailoverNotice + sessionRestartTrigger bump', () => {
    expect(useConversationStore.getState().sessionRestartTrigger).toBe(0);

    emitEvent('failoverNotice', {
      conversationId: 'conv-1',
      fromLabel: 'A 家',
      toLabel: 'B 家',
      at: 12345,
    });

    const state = useConversationStore.getState();
    expect(state.sessionRestartTrigger).toBe(1);
    expect(state.failoverNoticesByConversation['conv-1']).toEqual([
      { fromLabel: 'A 家', toLabel: 'B 家', at: 12345 },
    ]);
  });

  test('重复 failover 每次都递增 trigger，横幅按会话隔离', () => {
    emitEvent('failoverNotice', {
      conversationId: 'conv-2',
      fromLabel: 'B 家',
      toLabel: 'C 家',
      at: 67890,
    });

    const state = useConversationStore.getState();
    expect(state.sessionRestartTrigger).toBe(2);
    expect(state.failoverNoticesByConversation['conv-1']).toHaveLength(1);
    expect(state.failoverNoticesByConversation['conv-2']).toEqual([
      { fromLabel: 'B 家', toLabel: 'C 家', at: 67890 },
    ]);
  });

  test('triggerSessionRestart 是纯 bump：不触碰 pendingSendAfterRestart / preAttachedSession', () => {
    emitEvent('failoverNotice', { conversationId: 'conv-1', fromLabel: 'A 家', toLabel: 'B 家', at: 1 });

    const state = useConversationStore.getState();
    expect(state.sessionRestartTrigger).toBe(3);
    expect(state.pendingSendAfterRestart).toBeNull();
    expect(state.preAttachedSession).toBeNull();
  });
});

describe('failover 横幅单条化与生命周期', () => {
  test('同一会话新切换覆盖旧条，只保留最新一条', () => {
    useConversationStore.setState({ failoverNoticeTtlMs: 60_000 });
    emitEvent('failoverNotice', { conversationId: 'conv-banner', fromLabel: 'A 家', toLabel: 'B 家', at: 100 });
    emitEvent('failoverNotice', { conversationId: 'conv-banner', fromLabel: 'B 家', toLabel: 'C 家', at: 200 });

    expect(useConversationStore.getState().failoverNoticesByConversation['conv-banner']).toEqual([
      { fromLabel: 'B 家', toLabel: 'C 家', at: 200 },
    ]);
  });

  test('dismissFailoverNotice 清除当前横幅；at 不匹配时不动（旧计时器不误杀新横幅）', () => {
    useConversationStore.setState({ failoverNoticeTtlMs: 60_000 });
    emitEvent('failoverNotice', { conversationId: 'conv-dismiss', fromLabel: 'A 家', toLabel: 'B 家', at: 300 });

    useConversationStore.getState().dismissFailoverNotice('conv-dismiss', 999);
    expect(useConversationStore.getState().failoverNoticesByConversation['conv-dismiss']).toHaveLength(1);

    useConversationStore.getState().dismissFailoverNotice('conv-dismiss', 300);
    expect(useConversationStore.getState().failoverNoticesByConversation['conv-dismiss']).toBeUndefined();
  });

  test('横幅到达 TTL 后自动过期清除', async () => {
    useConversationStore.setState({ failoverNoticeTtlMs: 20 });
    emitEvent('failoverNotice', { conversationId: 'conv-expire', fromLabel: 'A 家', toLabel: 'B 家', at: 400 });
    expect(useConversationStore.getState().failoverNoticesByConversation['conv-expire']).toHaveLength(1);

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(useConversationStore.getState().failoverNoticesByConversation['conv-expire']).toBeUndefined();
  });
});
