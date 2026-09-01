import { beforeEach, expect, mock, test } from 'bun:test';

type TerminalFixture = {
  terminalId: string;
  conversationId: string | null;
  command: string;
  cwd: string;
  shell: string;
  cols: number;
  rows: number;
  exited: boolean;
  exitCode?: number;
};

let createTerminalImpl: (options: Record<string, unknown>) => Promise<string> = async () => 'tid-default';
let screenTextFixture: string = '';
let terminalsFixture: TerminalFixture[] = [];

const createTerminalCalls: Record<string, unknown>[] = [];
const killTerminalCalls: string[] = [];

mock.module('../../services/pty-service.js', () => ({
  createTerminal: (options: Record<string, unknown>) => {
    createTerminalCalls.push(options);
    return createTerminalImpl(options);
  },
  getScreenText: () => screenTextFixture,
  killTerminal: (id: string) => {
    killTerminalCalls.push(id);
  },
  listTerminals: (conversationId?: string) =>
    terminalsFixture.filter((t) => conversationId === undefined || t.conversationId === conversationId),
}));

const { createBuiltinFileTools } = await import('./builtin-tools.js');

function makeTerminal(partial: Partial<TerminalFixture>): TerminalFixture {
  return {
    terminalId: 'tid-1',
    conversationId: 'conv-1',
    command: 'bun run dev',
    cwd: 'C:\\ws',
    shell: 'bash',
    cols: 80,
    rows: 24,
    exited: false,
    ...partial,
  };
}

function getTools() {
  const tools = createBuiltinFileTools({ conversationId: 'conv-1', workspaceRoots: ['C:\\ws'] });
  return {
    bash: tools.find((t) => t.name === 'bash')!,
    readTerminal: tools.find((t) => t.name === 'read_terminal')!,
    killTerminal: tools.find((t) => t.name === 'kill_terminal')!,
  };
}

const { WorkspaceExecutionEnv } = await import('./workspace-execution-env.js');
const noopContext = { env: new WorkspaceExecutionEnv([process.cwd()]) } as never;

beforeEach(() => {
  createTerminalCalls.length = 0;
  killTerminalCalls.length = 0;
  createTerminalImpl = async () => 'tid-new';
  screenTextFixture = '';
  terminalsFixture = [];
});

test('bash 工具同名替换：schema 含 run_in_background，read/kill 工具已挂载', () => {
  const { bash, readTerminal, killTerminal } = getTools();
  expect(bash.name).toBe('bash');
  const props = (bash.parameters as { properties: Record<string, unknown> }).properties;
  expect(Object.keys(props).sort()).toEqual(['command', 'run_in_background', 'timeout']);
  expect(readTerminal.name).toBe('read_terminal');
  expect(killTerminal.name).toBe('kill_terminal');
});

test('同步路径（缺省 run_in_background）委托原版执行且不碰 pty-service', async () => {
  const { bash } = getTools();
  const result = await bash.execute('call-1', { command: 'echo sync-ok' }, undefined, undefined, noopContext);
  expect(createTerminalCalls.length).toBe(0);
  expect(result.content[0]).toMatchObject({ type: 'text', text: expect.stringContaining('sync-ok') });
});

test('后台路径：createTerminal 收到会话归属与工作区边界，返回文本含 terminalId', async () => {
  createTerminalImpl = async () => 'tid-bg-42';
  const { bash } = getTools();
  const result = await bash.execute(
    'call-2',
    { command: 'bun run dev', run_in_background: true },
    undefined,
    undefined,
    noopContext,
  );
  expect(createTerminalCalls.length).toBe(1);
  expect(createTerminalCalls[0]).toMatchObject({
    conversationId: 'conv-1',
    command: 'bun run dev',
    cwd: process.cwd(),
    workspaceRoots: ['C:\\ws'],
  });
  const text = (result.content[0] as { text: string }).text;
  expect(text).toContain('tid-bg-42');
  expect(text).toContain('read_terminal');
});

test('后台路径失败：execute reject（harness 转 isError），错误含原因', async () => {
  createTerminalImpl = async () => {
    throw new Error('cwd 不存在: C:\\nope');
  };
  const { bash } = getTools();
  try {
    await bash.execute('call-3', { command: 'x', run_in_background: true }, undefined, undefined, noopContext);
    expect.unreachable();
  } catch (error) {
    expect((error as Error).message).toContain('后台终端启动失败');
    expect((error as Error).message).toContain('cwd 不存在');
  }
});

test('read_terminal 无参：仅列出当前会话名下的终端概览', async () => {
  terminalsFixture = [
    makeTerminal({ terminalId: 'tid-a', conversationId: 'conv-1', command: 'bun run dev', exited: false }),
    makeTerminal({ terminalId: 'tid-b', conversationId: 'conv-other', command: 'other', exited: true, exitCode: 3 }),
  ];
  const { readTerminal } = getTools();
  const result = await readTerminal.execute('call-4', {}, undefined, undefined, noopContext);
  const text = (result.content[0] as { text: string }).text;
  expect(text).toContain('tid-a');
  expect(text).toContain('bun run dev');
  expect(text).toContain('运行中');
  expect(text).not.toContain('tid-b');
});

test('read_terminal 带 id：屏幕模型文本直读 + 状态行', async () => {
  terminalsFixture = [makeTerminal({ terminalId: 'tid-a', command: 'vite', exited: true, exitCode: 0 })];
  screenTextFixture = '60%\ndone bold\nnext line\n';
  const { readTerminal } = getTools();
  const result = await readTerminal.execute('call-5', { terminalId: 'tid-a' }, undefined, undefined, noopContext);
  const text = (result.content[0] as { text: string }).text;
  expect(text).not.toContain('\x1b');
  expect(text).toContain('60%');
  expect(text).toContain('done bold');
  expect(text).toContain('next line');
  expect(text).toContain('vite');
  expect(text).toContain('已退出 (exit 0)');
});

test('read_terminal 超长输出截断到上限并保留尾部', async () => {
  terminalsFixture = [makeTerminal({ terminalId: 'tid-a' })];
  screenTextFixture = `head-${'x'.repeat(20 * 1024)}-tail-marker`;
  const { readTerminal } = getTools();
  const result = await readTerminal.execute('call-6', { terminalId: 'tid-a' }, undefined, undefined, noopContext);
  const text = (result.content[0] as { text: string }).text;
  expect(text.length).toBeLessThan(20 * 1024);
  expect(text).toContain('tail-marker');
});

test('read_terminal 未知 id：reject', async () => {
  const { readTerminal } = getTools();
  try {
    await readTerminal.execute('call-7', { terminalId: 'nope' }, undefined, undefined, noopContext);
    expect.unreachable();
  } catch (error) {
    expect((error as Error).message).toContain('终端不存在');
  }
});

test('kill_terminal：本会话名下的 id 放行并调 killTerminal', async () => {
  terminalsFixture = [makeTerminal({ terminalId: 'tid-a', conversationId: 'conv-1' })];
  const { killTerminal } = getTools();
  const result = await killTerminal.execute('call-8', { terminalId: 'tid-a' }, undefined, undefined, noopContext);
  expect(killTerminalCalls).toEqual(['tid-a']);
  expect((result.content[0] as { text: string }).text).toContain('已终止');
});

test('kill_terminal：他人会话的 id reject 且不触发 kill', async () => {
  terminalsFixture = [makeTerminal({ terminalId: 'tid-user', conversationId: null })];
  const { killTerminal } = getTools();
  try {
    await killTerminal.execute('call-9', { terminalId: 'tid-user' }, undefined, undefined, noopContext);
    expect.unreachable();
  } catch (error) {
    expect((error as Error).message).toContain('不属于当前会话');
  }
  expect(killTerminalCalls.length).toBe(0);
});
