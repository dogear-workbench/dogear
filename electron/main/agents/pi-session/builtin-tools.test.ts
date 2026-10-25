import { beforeEach, expect, mock, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';

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

const { createBashTool: realCreateBashTool } = await import('@earendil-works/pi-durable/tools');
const piDurableTools = await import('@earendil-works/pi-durable/tools');
const { BACKGROUND_CONTEXT: testContext } = await import('@earendil-works/chord/context');
const syncBashArgsLog: unknown[] = [];

mock.module('@earendil-works/pi-durable/tools', () => ({
  ...piDurableTools,
  createBashTool: (options?: Parameters<typeof realCreateBashTool>[0]) => {
    const tool = realCreateBashTool(options);
    const execute = tool.execute as (...callArgs: unknown[]) => Promise<unknown>;
    return {
      ...tool,
      async execute(...callArgs: unknown[]) {
        syncBashArgsLog.push(callArgs[0]);
        return execute(...callArgs);
      },
    };
  },
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

/** mock ToolExecutionApi：env + output 收集（bash 工具经 api.output 流式产出，结果从 retainedOutput/structuredOutput 断言） */
function makeApi(env: InstanceType<typeof WorkspaceExecutionEnv>) {
  const chunks: string[] = [];
  const api = {
    env,
    output(chunk: string | Uint8Array) {
      chunks.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
    },
    outputWindow: undefined,
    retainedOutput: () => ({ text: chunks.join(''), truncated: false }),
    diagnostic: () => {},
  };
  return { api, chunks };
}

const noopEnv = new WorkspaceExecutionEnv([process.cwd()]);

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

test('read 工具挂了图片处理器：官方 description 含 bmp（无处理器时只列 jpg/png/gif/webp）', () => {
  const read = createBuiltinFileTools().find((t) => t.name === 'read');
  expect(read?.description).toContain('bmp');
});

function makeTestPng(): Buffer {
  const png = new PNG({ width: 8, height: 8 });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = 210;
    png.data[i + 1] = 40;
    png.data[i + 2] = 40;
    png.data[i + 3] = 255;
  }
  return PNG.sync.write(png);
}

function makeReadImageApi(root: string, model?: { input: string[] }) {
  const env = new WorkspaceExecutionEnv([root]);
  return {
    env,
    diagnostic: () => {},
    agent: async () => ({ model: model ? { provider: 'test', modelId: 'test-model' } : undefined }),
    models: { getModel: () => model },
  };
}

test('read 图片：photon 处理后返回 image 块（diagnostics 记录 image 事件）', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dogear-read-image-'));
  try {
    writeFileSync(join(root, 'test.png'), makeTestPng());
    const read = createBuiltinFileTools().find((t) => t.name === 'read')!;
    const result = await read.execute({ path: 'test.png' }, makeReadImageApi(root) as never, testContext);
    const image = result.output?.[0] as { type: string; mimeType: string; data: string };
    expect(image.type).toBe('image');
    expect(image.mimeType).toBe('image/png');
    expect(image.data.length).toBeGreaterThan(0);
    const diagnostics = (result.diagnostics ?? []) as { code: string }[];
    expect(diagnostics.some((d) => d.code === 'image')).toBe(true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('read 图片：无视觉模型仍返回 image 块，附官方 placeholder 诊断（pi-ai 层替换）', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dogear-read-image-'));
  try {
    writeFileSync(join(root, 'test.png'), makeTestPng());
    const read = createBuiltinFileTools().find((t) => t.name === 'read')!;
    const result = await read.execute({ path: 'test.png' }, makeReadImageApi(root, { input: ['text'] }) as never, testContext);
    const image = result.output?.[0] as { type: string };
    expect(image.type).toBe('image');
    const diagnostics = JSON.stringify(result.diagnostics ?? []);
    expect(diagnostics).toContain('does not support images');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('同步路径（缺省 run_in_background）委托原版执行且不碰 pty-service', async () => {
  const { bash } = getTools();
  const { api, chunks } = makeApi(noopEnv);
  const result = await bash.execute({ command: 'echo sync-ok' }, api as never, testContext);
  expect(createTerminalCalls.length).toBe(0);
  expect(chunks.join('')).toContain('sync-ok');
  expect(result.structuredOutput).toMatchObject({ exitCode: 0 });
});

test('同步路径缺省 timeout 时注入默认 600s 再委托原版', async () => {
  const { bash } = getTools();
  const { api } = makeApi(noopEnv);
  await bash.execute({ command: 'echo default-timeout' }, api as never, testContext);
  expect(syncBashArgsLog.at(-1)).toMatchObject({ command: 'echo default-timeout', timeout: 600 });
});

test('同步路径显式 timeout 透传，不被默认值覆盖', async () => {
  const { bash } = getTools();
  const { api } = makeApi(noopEnv);
  await bash.execute({ command: 'echo explicit-timeout', timeout: 30 }, api as never, testContext);
  expect(syncBashArgsLog.at(-1)).toMatchObject({ command: 'echo explicit-timeout', timeout: 30 });
});

test('后台路径：createTerminal 收到会话归属与工作区边界，返回文本含 terminalId', async () => {
  createTerminalImpl = async () => 'tid-bg-42';
  const { bash } = getTools();
  const { api } = makeApi(noopEnv);
  const result = await bash.execute(
    { command: 'bun run dev', run_in_background: true },
    api as never,
    testContext,
  );
  expect(createTerminalCalls.length).toBe(1);
  expect(createTerminalCalls[0]).toMatchObject({
    conversationId: 'conv-1',
    command: 'bun run dev',
    cwd: process.cwd(),
    workspaceRoots: ['C:\\ws'],
  });
  const text = (result.output?.[0] as { text: string }).text;
  expect(text).toContain('tid-bg-42');
  expect(text).toContain('read_terminal');
});

test('后台路径失败：execute reject（harness 转 isError），错误含原因', async () => {
  createTerminalImpl = async () => {
    throw new Error('cwd 不存在: C:\\nope');
  };
  const { bash } = getTools();
  const { api } = makeApi(noopEnv);
  try {
    await bash.execute({ command: 'x', run_in_background: true }, api as never, testContext);
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
  const result = await readTerminal.execute({}, noopEnv as never, testContext);
  const text = (result.output?.[0] as { text: string }).text;
  expect(text).toContain('tid-a');
  expect(text).toContain('bun run dev');
  expect(text).toContain('运行中');
  expect(text).not.toContain('tid-b');
});

test('read_terminal 带 id：屏幕模型文本直读 + 状态行', async () => {
  terminalsFixture = [makeTerminal({ terminalId: 'tid-a', command: 'vite', exited: true, exitCode: 0 })];
  screenTextFixture = '60%\ndone bold\nnext line\n';
  const { readTerminal } = getTools();
  const result = await readTerminal.execute({ terminalId: 'tid-a' }, noopEnv as never, testContext);
  const text = (result.output?.[0] as { text: string }).text;
  expect(text).not.toContain('\x1b');
  expect(text).toContain('60%');
  expect(text).toContain('done bold');
  expect(text).toContain('next line');
  expect(text).toContain('vite');
  expect(text).toContain('已退出 (exit 0)');
});

test('read_terminal 注册声明：replay safe + 输出上限保留尾部 8KB（截断由 harness outputLimits 执行）', () => {
  const { readTerminal } = getTools();
  expect(readTerminal.replay).toBe('safe');
  expect(readTerminal.outputLimits).toEqual({ maxBytes: 8 * 1024, retain: 'tail' });
});

test('read_terminal 带 id：超长屏幕文本不截断直传（截断在 harness 层），换行压缩保留', async () => {
  terminalsFixture = [makeTerminal({ terminalId: 'tid-a' })];
  screenTextFixture = `head-${'x'.repeat(20 * 1024)}-tail-marker\n\n\n\nend`;
  const { readTerminal } = getTools();
  const result = await readTerminal.execute({ terminalId: 'tid-a' }, noopEnv as never, testContext);
  const text = (result.output?.[0] as { text: string }).text;
  expect(text).toContain('tail-marker');
  expect(text.endsWith('end')).toBe(true);
  expect(text).not.toMatch(/\n{3,}/);
});

test('read_terminal 未知 id：reject', async () => {
  const { readTerminal } = getTools();
  try {
    await readTerminal.execute({ terminalId: 'nope' }, noopEnv as never, testContext);
    expect.unreachable();
  } catch (error) {
    expect((error as Error).message).toContain('终端不存在');
  }
});

test('kill_terminal：本会话名下的 id 放行并调 killTerminal', async () => {
  terminalsFixture = [makeTerminal({ terminalId: 'tid-a', conversationId: 'conv-1' })];
  const { killTerminal } = getTools();
  const result = await killTerminal.execute({ terminalId: 'tid-a' }, noopEnv as never, testContext);
  expect(killTerminalCalls).toEqual(['tid-a']);
  expect((result.output?.[0] as { text: string }).text).toContain('已终止');
});

test('kill_terminal：他人会话的 id reject 且不触发 kill', async () => {
  terminalsFixture = [makeTerminal({ terminalId: 'tid-user', conversationId: null })];
  const { killTerminal } = getTools();
  try {
    await killTerminal.execute({ terminalId: 'tid-user' }, noopEnv as never, testContext);
    expect.unreachable();
  } catch (error) {
    expect((error as Error).message).toContain('不属于当前会话');
  }
  expect(killTerminalCalls.length).toBe(0);
});
