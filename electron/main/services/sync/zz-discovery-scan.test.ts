import { test, expect } from 'bun:test';
import path from 'node:path';

/**
 * bun test 合跑时 mock.module 进程级持久（delegation-test-mocks 泄漏的 loadSettings 替换、
 * 本文件组 mock 的 bonjour-service/client）与多 worker 并发的 env 串扰都会污染本组集成用例，
 * 故实际断言放在 discovery-scan.impl.ts（命名不带 .test 避免被全量扫描收集），
 * 这里在干净子进程中运行它并校验退出码。
 */
test('discovery 快照合并/scanNow 主动扫描 集成（子进程隔离）', async () => {
  const projectRoot = path.resolve(import.meta.dir, '..', '..', '..', '..');
  const proc = Bun.spawn([process.execPath, 'test', './electron/main/services/sync/discovery-scan.impl.ts'], {
    cwd: projectRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const timeout = setTimeout(() => proc.kill(), 30_000);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timeout);
  if (exitCode !== 0) {
    console.error(stdout);
    console.error(stderr);
  }
  expect(exitCode).toBe(0);
  expect(stderr).toContain('7 pass');
}, 40_000);
