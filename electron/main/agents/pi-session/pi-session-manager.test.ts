import { expect, test } from 'bun:test';
import path from 'node:path';

// 合跑进程内 delegation-test-mocks 已全局 mock.module 掉 pi-session-manager.js（不可逆），
// 真实 manager 只能在子进程内直实例化验证；断言细节见 pi-session-manager-orphan-probe.ts
const probePath = path.join(import.meta.dir, 'pi-session-manager-orphan-probe.ts');

test('孤儿超龄回收布防/撤防/强杀路径（子进程直实例化自检）', async () => {
  const proc = Bun.spawn([process.execPath, 'run', probePath], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const killSwitch = setTimeout(() => proc.kill(), 30_000);
  const [stdout, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  clearTimeout(killSwitch);

  expect(exitCode).toBe(0);
  expect(stdout).toContain('[orphan-probe] all paths OK');
}, 60_000);
