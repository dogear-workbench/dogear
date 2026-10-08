import { describe, expect, test } from 'bun:test';
import {
  dispatchPtyData,
  registerDataSink,
  selectTerminalGroups,
  useTerminalStore,
  type TerminalMeta,
} from './terminal-store';

function meta(partial: Partial<TerminalMeta> & { terminalId: string }): TerminalMeta {
  return { conversationId: null, command: '', exited: false, ...partial };
}

function resetStore() {
  useTerminalStore.setState({
    terminals: new Map(),
    activeTerminalId: null,
    followMode: 'follow',
    pinnedConversationId: null,
  });
}

function terminals() {
  return useTerminalStore.getState().terminals;
}

describe('terminal-store', () => {
  test('ptyCreated/ptyExit 事件更新元数据，未知 id 的 exit 被忽略', () => {
    resetStore();
    useTerminalStore.getState().handlePtyCreated({ terminalId: 't1', conversationId: 'c1', command: 'bun run dev' });
    let t1 = terminals().get('t1')!;
    expect(t1.conversationId).toBe('c1');
    expect(t1.command).toBe('bun run dev');
    expect(t1.exited).toBe(false);
    expect(t1.exitCode).toBeUndefined();

    useTerminalStore.getState().handlePtyExit({ terminalId: 't1', exitCode: 3 });
    t1 = terminals().get('t1')!;
    expect(t1.exited).toBe(true);
    expect(t1.exitCode).toBe(3);

    useTerminalStore.getState().handlePtyExit({ terminalId: 'ghost', exitCode: 1 });
    expect(terminals().has('ghost')).toBe(false);
  });

  test('registerDataSink 按 terminalId 路由实时流，解绑后不再收到', () => {
    resetStore();
    const got: string[] = [];
    const gotOther: string[] = [];
    const off = registerDataSink('t1', (data) => got.push(data));
    const offOther = registerDataSink('t2', (data) => gotOther.push(data));

    dispatchPtyData('t1', 'hello');
    dispatchPtyData('t1', ' world');
    dispatchPtyData('t2', 'other');
    expect(got).toEqual(['hello', ' world']);
    expect(gotOther).toEqual(['other']);

    off();
    dispatchPtyData('t1', 'dropped');
    expect(got).toEqual(['hello', ' world']);
    offOther();
  });

  test('selectTerminalGroups 分组过滤：我的全显示，会话组只留命中锚点的', () => {
    const map = new Map<string, TerminalMeta>([
      ['shell1', meta({ terminalId: 'shell1' })],
      ['shell2', meta({ terminalId: 'shell2' })],
      ['agentA', meta({ terminalId: 'agentA', conversationId: 'c1', command: 'bun run dev' })],
      ['agentB', meta({ terminalId: 'agentB', conversationId: 'c2', command: 'watch' })],
    ]);

    const groups = selectTerminalGroups(map, 'c1', null);
    expect(groups.mine.map((m) => m.terminalId)).toEqual(['shell1', 'shell2']);
    expect(groups.session.map((m) => m.terminalId)).toEqual(['agentA']);

    const other = selectTerminalGroups(map, 'c2', null);
    expect(other.session.map((m) => m.terminalId)).toEqual(['agentB']);

    const none = selectTerminalGroups(map, null, null);
    expect(none.mine).toHaveLength(2);
    expect(none.session).toHaveLength(0);
  });

  test('activeTerminal 切换：可见时保持，失效时优先「会话」最新，再回退「我的」最新', async () => {
    resetStore();
    useTerminalStore.getState().handlePtyCreated({ terminalId: 'shell1', conversationId: null, command: '' });
    useTerminalStore.getState().handlePtyCreated({ terminalId: 'agentA', conversationId: 'c1', command: 'dev' });
    useTerminalStore.getState().handlePtyCreated({ terminalId: 'agentB', conversationId: 'c1', command: 'watch' });
    useTerminalStore.getState().handlePtyCreated({ terminalId: 'agentC', conversationId: 'c3', command: 'serve' });

    useTerminalStore.getState().setActive('agentA');
    useTerminalStore.getState().reconcileActive('c1');
    expect(useTerminalStore.getState().activeTerminalId).toBe('agentA');

    useTerminalStore.getState().reconcileActive('c3');
    expect(useTerminalStore.getState().activeTerminalId).toBe('agentC');

    useTerminalStore.getState().reconcileActive('c2');
    expect(useTerminalStore.getState().activeTerminalId).toBe('shell1');

    useTerminalStore.getState().reconcileActive('c1');
    expect(useTerminalStore.getState().activeTerminalId).toBe('shell1');

    await useTerminalStore.getState().killTerminal('agentB');
    expect(terminals().has('agentB')).toBe(false);
  });

  test('killTerminal 本地移除元数据', async () => {
    resetStore();
    (globalThis as unknown as { window?: unknown }).window = {
      ipcRenderer: { invoke: async () => undefined },
    };
    useTerminalStore.getState().handlePtyCreated({ terminalId: 'shell1', conversationId: null, command: '' });
    await useTerminalStore.getState().killTerminal('shell1');
    expect(terminals().has('shell1')).toBe(false);
    delete (globalThis as unknown as { window?: unknown }).window;
  });
});
