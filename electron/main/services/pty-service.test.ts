import { test, expect, afterEach } from 'bun:test';
import os from 'os';
import { createTerminal, writeTerminal, killTerminal, killConversationTerminals, killAll, getBuffer, listTerminals } from './pty-service.js';

function tmpCwd(): string {
  return os.tmpdir();
}

function waitUntil<T>(fn: () => T | undefined | null | false, timeoutMs = 20000): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      let value: T | undefined | null | false;
      try {
        value = fn();
      } catch (error) {
        reject(error);
        return;
      }
      if (value) {
        resolve(value);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('waitUntil 超时'));
        return;
      }
      setTimeout(tick, 100);
    };
    tick();
  });
}

afterEach(() => {
  killAll();
});

// bun 运行时对 Windows ConPTY 命名管道的 write 有兼容缺陷（ERR_SOCKET_CLOSED，node v25 正常）；
// 生产 Electron 主进程是 node 运行时不受影响，write 回流用例仅在非 bun 环境真跑
const isBun = !!process.versions.bun;

test.skipIf(isBun)('create + write + data 回流（交互 shell 回显）', async () => {
  const id = await createTerminal({ conversationId: null, cwd: tmpCwd(), cols: 100, rows: 30 });
  expect(id).toBeTruthy();
  writeTerminal(id, 'echo hello-pty-$((40+2))\r');
  await waitUntil(() => getBuffer(id)?.includes('hello-pty-42'));
});

test('create 带 command 时执行命令并写入 buffer', async () => {
  const id = await createTerminal({ conversationId: 'conv-cmd', cwd: tmpCwd(), command: 'echo background-output' });
  await waitUntil(() => getBuffer(id)?.includes('background-output'));
});

test('exit 事件记录 exited/exitCode', async () => {
  const id = await createTerminal({ conversationId: 'conv-exit', cwd: tmpCwd(), command: 'exit 7' });
  await waitUntil(() => listTerminals().find((t) => t.terminalId === id)?.exited);
  const info = listTerminals().find((t) => t.terminalId === id);
  expect(info?.exitCode).toBe(7);
});

test('buffer 尾部截断到 100KB', async () => {
  const id = await createTerminal({
    conversationId: 'conv-trunc',
    cwd: tmpCwd(),
    command: "awk 'BEGIN{for(i=0;i<40000;i++)print \"0123456789\"}'",
  });
  await waitUntil(() => listTerminals().find((t) => t.terminalId === id)?.exited);
  const buffer = getBuffer(id);
  expect(buffer).not.toBeNull();
  expect(buffer!.length).toBeLessThanOrEqual(100 * 1024);
  expect(buffer!.length).toBeGreaterThan(0);
  expect(buffer!.trimEnd().endsWith('0123456789')).toBe(true);
});

test('cwd 越出 workspaceRoots 时拒绝创建', async () => {
  expect(createTerminal({ conversationId: null, cwd: os.tmpdir(), workspaceRoots: ['C:/definitely-not-a-root'] })).rejects.toThrow(/路径越权/);
});

test('killConversationTerminals 只杀指定会话名下实例', async () => {
  const a1 = await createTerminal({ conversationId: 'conv-a', cwd: tmpCwd(), command: 'sleep 30' });
  const a2 = await createTerminal({ conversationId: 'conv-a', cwd: tmpCwd(), command: 'sleep 30' });
  const b1 = await createTerminal({ conversationId: 'conv-b', cwd: tmpCwd(), command: 'sleep 30' });
  killConversationTerminals('conv-a');
  const ids = listTerminals().map((t) => t.terminalId);
  expect(ids).not.toContain(a1);
  expect(ids).not.toContain(a2);
  expect(ids).toContain(b1);
});

test('killAll 清空全部实例', async () => {
  await createTerminal({ conversationId: null, cwd: tmpCwd(), command: 'sleep 30' });
  await createTerminal({ conversationId: 'conv-k', cwd: tmpCwd(), command: 'sleep 30' });
  killAll();
  expect(listTerminals()).toHaveLength(0);
});

test('重复 kill 不抛', async () => {
  const id = await createTerminal({ conversationId: null, cwd: tmpCwd(), command: 'sleep 30' });
  killTerminal(id);
  expect(() => killTerminal(id)).not.toThrow();
  expect(() => killTerminal('nonexistent-id')).not.toThrow();
});
