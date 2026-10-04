import { test, expect } from 'bun:test';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const { slimShadowRepo, dirSizeBytes } = await import('./shadow-slim.js');
const { hasGit } = await import('./exec.js');

const gitAvailable = await hasGit();

const SETTINGS = {
  maxFileSizeBytes: 800 * 1024,
  excludedPaths: { ws: ['dist', 'node_modules'] },
  retention: { recentDays: 7, totalDays: 30 },
  disabledWorkspaces: [],
};

function gitIn(dir: string, args: string[], opts: { input?: string; env?: Record<string, string> } = {}): string {
  return execFileSync('git', args, {
    cwd: dir,
    input: opts.input,
    env: opts.env ? { ...process.env, ...opts.env } : undefined,
  })
    .toString()
    .trim();
}

async function makeRepo(): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dogear-slim-repo-'));
  gitIn(dir, ['init']);
  gitIn(dir, ['config', 'user.name', 'tester']);
  gitIn(dir, ['config', 'user.email', 'tester@local']);
  gitIn(dir, ['config', 'core.autocrlf', 'false']);
  return dir;
}

function daysAgoEnv(days: number): Record<string, string> {
  const epoch = `@${Math.floor(Date.now() / 1000) - days * 86400}`;
  return { GIT_AUTHOR_DATE: epoch, GIT_COMMITTER_DATE: epoch };
}

async function commitAll(dir: string, subject: string, daysAgo = 0): Promise<string> {
  const gitArgs = ['--git-dir', path.join(dir, '.git'), '--work-tree', dir];
  gitIn(dir, [...gitArgs, 'add', '-A', '-f']);
  gitIn(dir, [...gitArgs, 'commit', '-q', '-m', subject], daysAgo > 0 ? { env: daysAgoEnv(daysAgo) } : {});
  return gitIn(dir, ['--git-dir', path.join(dir, '.git'), 'rev-parse', 'HEAD']);
}

function mustBeMissing(dir: string, spec: string): void {
  expect(() => gitIn(dir, ['--git-dir', path.join(dir, '.git'), 'cat-file', '-e', spec])).toThrow();
}

function gitShowRaw(dir: string, spec: string): string {
  return execFileSync('git', ['--git-dir', path.join(dir, '.git'), 'show', spec]).toString();
}

test.skipIf(!gitAvailable)(
  'slimShadowRepo：剔除大 blob 与排除目录、窗口外裁剪、合规文件历史内容可恢复、二次执行 no-op',
  async () => {
    const dir = await makeRepo();
    const gitDir = path.join(dir, '.git');
    const gitArgs = ['--git-dir', gitDir];

    await fsp.writeFile(path.join(dir, 'app.bin'), randomBytes(1_000_000));
    await fsp.mkdir(path.join(dir, 'dist'), { recursive: true });
    await fsp.writeFile(path.join(dir, 'dist', 'out.js'), `dist-v1-${randomBytes(16).toString('hex')}`);
    await fsp.mkdir(path.join(dir, 'sub', 'dist'), { recursive: true });
    await fsp.writeFile(path.join(dir, 'sub', 'dist', 'lib.js'), `nested-${randomBytes(16).toString('hex')}`);
    await fsp.mkdir(path.join(dir, 'src'), { recursive: true });
    await fsp.writeFile(path.join(dir, 'src', 'main.ts'), 'export const v = 1;\n');
    const c1 = await commitAll(dir, '[snapshot] agent-write c1', 40);

    await fsp.writeFile(path.join(dir, 'src', 'main.ts'), 'export const v = 2;\n');
    await fsp.writeFile(path.join(dir, 'keep.dat'), 'keep-v2');
    await commitAll(dir, '[snapshot] agent-write c2', 10);

    await fsp.writeFile(path.join(dir, 'src', 'main.ts'), 'export const v = 3;\n');
    await fsp.rm(path.join(dir, 'dist', 'out.js'));
    await commitAll(dir, '[snapshot] agent-write c3', 0);

    const appBlob = gitIn(dir, [...gitArgs, 'rev-parse', `${c1}:app.bin`]);
    const distBlob = gitIn(dir, [...gitArgs, 'rev-parse', `${c1}:dist/out.js`]);
    const nestedBlob = gitIn(dir, [...gitArgs, 'rev-parse', `${c1}:sub/dist/lib.js`]);
    const sizeBefore = await dirSizeBytes(gitDir);

    const result = await slimShadowRepo('ws', gitDir, dir, SETTINGS);

    expect(result.status).toBe('done');
    expect(result.commitsBefore).toBe(3);
    expect(result.commitsAfter).toBe(2);
    expect(result.sizeBytesAfter).toBeLessThan(sizeBefore);

    expect(gitIn(dir, [...gitArgs, 'log', '--pretty=%s']).split('\n')).toEqual([
      '[snapshot] agent-write c3',
      '[snapshot] agent-write c2',
    ]);
    expect(Number(gitIn(dir, [...gitArgs, 'rev-list', '--count', 'HEAD']))).toBe(2);
    expect(gitIn(dir, [...gitArgs, 'rev-list', '--max-parents=0', 'HEAD']).split('\n')).toHaveLength(1);
    gitIn(dir, [...gitArgs, 'fsck', '--connectivity-only']);

    for (const hash of [appBlob, distBlob]) {
      mustBeMissing(dir, hash);
    }

    const tip = gitIn(dir, [...gitArgs, 'rev-parse', 'HEAD']);
    const tipParent = gitIn(dir, [...gitArgs, 'rev-parse', 'HEAD~1']);
    expect(gitShowRaw(dir, `${tip}:src/main.ts`)).toBe('export const v = 3;\n');
    expect(gitShowRaw(dir, `${tipParent}:src/main.ts`)).toBe('export const v = 2;\n');
    expect(gitShowRaw(dir, `${tipParent}:keep.dat`)).toBe('keep-v2');
    for (const spec of [`${tip}:dist/out.js`, `${tip}:app.bin`]) {
      mustBeMissing(dir, spec);
    }
    // 路径级锚定：排除 dist 只覆盖顶层，sub/dist 不再受牵连，blob 必须原样保留
    expect(gitIn(dir, [...gitArgs, 'rev-parse', `${tip}:sub/dist/lib.js`])).toBe(nestedBlob);

    const rerun = await slimShadowRepo('ws', gitDir, dir, SETTINGS);
    expect(rerun.status).toBe('noop');
    expect(rerun.commitsBefore).toBe(2);
    expect(rerun.commitsAfter).toBe(2);
    expect(gitIn(dir, [...gitArgs, 'rev-parse', 'HEAD'])).toBe(tip);
  },
  60_000,
);

test.skipIf(!gitAvailable)('slimShadowRepo：tree 全合规时仅做保留窗口裁剪', async () => {
  const dir = await makeRepo();
  const gitDir = path.join(dir, '.git');
  const gitArgs = ['--git-dir', gitDir];

  await fsp.writeFile(path.join(dir, 'unique-old.txt'), 'old-unique');
  await fsp.writeFile(path.join(dir, 'common.txt'), 'v1');
  await commitAll(dir, '[snapshot] agent-write old', 45);
  const oldBlob = gitIn(dir, [...gitArgs, 'rev-parse', 'HEAD:unique-old.txt']);
  await fsp.rm(path.join(dir, 'unique-old.txt'));
  await fsp.writeFile(path.join(dir, 'common.txt'), 'v2');
  await commitAll(dir, '[snapshot] agent-write fresh', 0);

  const result = await slimShadowRepo('ws', gitDir, dir, SETTINGS);
  expect(result.status).toBe('done');
  expect(result.commitsBefore).toBe(2);
  expect(result.commitsAfter).toBe(1);
  // 裁剪后 tip 丢失 parent 行、hash 必变，但内容与条目数必须完整
  expect(gitIn(dir, [...gitArgs, 'log', '--pretty=%s'])).toBe('[snapshot] agent-write fresh');
  expect(gitIn(dir, [...gitArgs, 'show', 'HEAD:common.txt'])).toBe('v2');
  mustBeMissing(dir, oldBlob);
});

test.skipIf(!gitAvailable)('slimShadowRepo：历史已合规且全在窗口内时 no-op 且 HEAD 不动', async () => {
  const dir = await makeRepo();
  const gitDir = path.join(dir, '.git');
  const gitArgs = ['--git-dir', gitDir];

  await fsp.writeFile(path.join(dir, 'a.txt'), 'a');
  await commitAll(dir, '[snapshot] agent-write a', 1);
  await fsp.writeFile(path.join(dir, 'b.txt'), 'b');
  const head = await commitAll(dir, '[snapshot] agent-write b', 0);

  const result = await slimShadowRepo('ws', gitDir, dir, SETTINGS);
  expect(result.status).toBe('noop');
  expect(gitIn(dir, [...gitArgs, 'rev-parse', 'HEAD'])).toBe(head);
  expect(Number(gitIn(dir, [...gitArgs, 'rev-list', '--count', 'HEAD']))).toBe(2);
});

test.skipIf(!gitAvailable)('slimShadowRepo：空仓库/unborn HEAD 安全 no-op', async () => {
  const dir = await makeRepo();
  const result = await slimShadowRepo('ws', path.join(dir, '.git'), dir, SETTINGS);
  expect(result.status).toBe('noop');
  expect(result.commitsBefore).toBe(0);
  expect(result.commitsAfter).toBe(0);
});

test.skipIf(!gitAvailable)('slimShadowRepo：链上混入非快照 commit 时保守跳过且历史不动', async () => {
  const dir = await makeRepo();
  const gitDir = path.join(dir, '.git');
  const gitArgs = ['--git-dir', gitDir];

  await fsp.writeFile(path.join(dir, 'app.bin'), randomBytes(1_000_000));
  const head = await commitAll(dir, 'manual work');

  const result = await slimShadowRepo('ws', gitDir, dir, SETTINGS);
  expect(result.status).toBe('skipped');
  expect(gitIn(dir, [...gitArgs, 'rev-parse', 'HEAD'])).toBe(head);
  expect(() => gitIn(dir, [...gitArgs, 'cat-file', '-e', gitIn(dir, [...gitArgs, 'rev-parse', 'HEAD:app.bin'])])).not.toThrow();
});
