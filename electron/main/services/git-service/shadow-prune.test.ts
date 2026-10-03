import { test, expect, mock } from 'bun:test';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

process.env.DOGEAR_CONFIG_DIR = await fsp.mkdtemp(path.join(os.tmpdir(), 'dogear-shadow-prune-'));

mock.module('electron', () => ({
  default: { app: { getPath: () => os.tmpdir() }, nativeTheme: {} },
  app: { getPath: () => os.tmpdir() },
  nativeTheme: {},
}));

const { hasGit } = await import('./exec.js');
const { pruneSnapshotHistory, selectKeptHashes, localDayKey } = await import('./shadow-prune.js');

const gitAvailable = await hasGit();
const RETENTION = { recentDays: 7, totalDays: 30 };

function gitIn(dir: string, args: string[], opts: { input?: string | Buffer; env?: Record<string, string> } = {}): string {
  return execFileSync('git', args, {
    cwd: dir,
    input: opts.input,
    env: opts.env ? { ...process.env, ...opts.env } : undefined,
  })
    .toString()
    .trim();
}

async function makeRepo(): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dogear-prune-repo-'));
  gitIn(dir, ['init']);
  gitIn(dir, ['config', 'user.name', 'tester']);
  gitIn(dir, ['config', 'user.email', 'tester@local']);
  gitIn(dir, ['config', 'core.autocrlf', 'false']);
  return dir;
}

function daysAgoEpoch(days: number, hour: number): number {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

interface ChainSpec {
  days: number;
  hour: number;
  subject: string;
  big?: boolean;
}

async function buildChain(
  dir: string,
  specs: ChainSpec[],
): Promise<{ commits: Array<{ hash: string; epoch: number; subject: string }>; bigBlob?: string }> {
  const smallBlob = gitIn(dir, ['hash-object', '-w', '--stdin'], { input: 'seed content' });
  const smallTree = gitIn(dir, ['mktree'], { input: `100644 blob ${smallBlob}\tseed.txt\n` });
  const bigBlob = gitIn(dir, ['hash-object', '-w', '--stdin'], { input: randomBytes(1_000_000) });
  const bigTree = gitIn(dir, ['mktree'], { input: `100644 blob ${bigBlob}\tbig.bin\n100644 blob ${smallBlob}\tseed.txt\n` });
  const sorted = [...specs].sort((a, b) => daysAgoEpoch(a.days, a.hour) - daysAgoEpoch(b.days, b.hour));
  let parent: string | undefined;
  const commits: Array<{ hash: string; epoch: number; subject: string }> = [];
  for (const s of sorted) {
    const epoch = daysAgoEpoch(s.days, s.hour);
    const args = ['commit-tree', s.big ? bigTree : smallTree, '-m', s.subject];
    if (parent) args.push('-p', parent);
    const hash = gitIn(dir, args, { env: { GIT_AUTHOR_DATE: `@${epoch}`, GIT_COMMITTER_DATE: `@${epoch}` } });
    commits.push({ hash, epoch, subject: s.subject });
    parent = hash;
  }
  gitIn(dir, ['update-ref', 'HEAD', parent!]);
  return { commits, bigBlob: specs.some((s) => s.big) ? bigBlob : undefined };
}

function readLog(dir: string): Array<{ hash: string; authorTs: number; subject: string }> {
  const out = gitIn(dir, ['log', '--pretty=%H%x1f%at%x1f%s%x1e']);
  return out
    .split('\x1e')
    .map((c) => c.replace(/^\n+/, '').trim())
    .filter(Boolean)
    .map((c) => {
      const [hash = '', at = '', subject = ''] = c.split('\x1f');
      return { hash, authorTs: Number(at), subject };
    });
}

function expectObjectMissing(dir: string, hash: string): void {
  expect(() => gitIn(dir, ['cat-file', '-e', hash])).toThrow();
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  const walk = async (d: string): Promise<void> => {
    for (const e of await fsp.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else total += (await fsp.stat(p)).size;
    }
  };
  await walk(dir);
  return total;
}

test('localDayKey：本地日历日', () => {
  expect(localDayKey(new Date(2026, 9, 3, 23, 59).getTime())).toBe('2026-10-03');
});

test('selectKeptHashes：近 7 天全留、7~30 天每天留最新一条、30 天外丢弃', () => {
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  const at = (days: number, hour: number) => daysAgoEpoch(days, hour);
  const mk = (id: string, days: number, hour: number) => ({ hash: id, authorTs: at(days, hour), subject: `[snapshot] ${id}` });
  const commits = [
    mk('today-late', 0, 15),
    mk('today-early', 0, 9),
    mk('d1', 1, 10),
    mk('d6', 6, 10),
    mk('d7-late', 7, 20),
    mk('d7-early', 7, 8),
    mk('d29-late', 29, 9),
    mk('d29-early', 29, 7),
    mk('d30', 30, 10),
    mk('d40', 40, 10),
  ];
  const keep = selectKeptHashes(commits, RETENTION, now.getTime());
  expect([...keep].sort()).toEqual(['today-late', 'today-early', 'd1', 'd6', 'd7-late', 'd29-late'].sort());
});

test('selectKeptHashes：全部超窗时最新一条仍作锚点保留', () => {
  const now = Date.now();
  const commits = [
    { hash: 'old-newest', authorTs: daysAgoEpoch(45, 12), subject: '[snapshot] a' },
    { hash: 'old-oldest', authorTs: daysAgoEpoch(50, 12), subject: '[snapshot] b' },
  ];
  expect(selectKeptHashes(commits, RETENTION, now)).toEqual(new Set(['old-newest']));
});

test.skipIf(!gitAvailable)(
  'pruneSnapshotHistory：18 条多天链裁到 10 条，链连续、时间保留、gc 后旧对象清除、体积下降、二次执行 no-op',
  async () => {
    const dir = await makeRepo();
    const day = (days: number, hours: number[]) => hours.map((h) => ({ days, hour: h, subject: `[snapshot] agent-write d${days}h${h}` }));
    const specs: ChainSpec[] = [
      ...day(0, [9, 11, 13]),
      ...day(1, [10, 14]),
      ...day(6, [8]),
      ...day(7, [9, 15]),
      ...day(8, [12]),
      ...day(10, [8, 12, 16]),
      ...day(29, [10, 18]),
      ...day(30, [10, 12]),
      { days: 35, hour: 12, subject: '[snapshot] agent-write big', big: true },
      ...day(60, [12]),
    ];
    const { commits } = await buildChain(dir, specs);
    expect(commits).toHaveLength(18);
    const sizeBefore = await dirSize(path.join(dir, '.git'));

    const result = await pruneSnapshotHistory(path.join(dir, '.git'), dir, RETENTION);
    expect(result).toEqual({ before: 18, after: 10 });

    const after = readLog(dir);
    expect(after).toHaveLength(10);
    const keptByEpoch = new Map(after.map((c) => [c.authorTs, c]));
    const expectedAges = new Map<number, number>();
    for (const s of specs) expectedAges.set(daysAgoEpoch(s.days, s.hour), s.days);
    const seenAges = new Map<number, number>();
    for (const c of after) {
      const age = expectedAges.get(c.authorTs);
      expect(age).toBeDefined();
      if (age! < RETENTION.recentDays) {
        seenAges.set(age, (seenAges.get(age) ?? 0) + 1);
      } else {
        expect(age).toBeLessThan(RETENTION.totalDays);
        expect(seenAges.has(age)).toBe(false);
        seenAges.set(age, 1);
        expect(c.authorTs).toBe(Math.max(...specs.filter((s) => s.days === age).map((s) => daysAgoEpoch(s.days, s.hour))));
      }
    }
    expect(seenAges.get(0)).toBe(3);
    expect(seenAges.get(1)).toBe(2);
    expect(seenAges.get(6)).toBe(1);
    for (const age of [7, 8, 10, 29]) expect(seenAges.get(age)).toBe(1);
    expect(seenAges.size).toBe(7);
    expect(keptByEpoch.size).toBe(10);

    expect(Number(gitIn(dir, ['rev-list', '--count', 'HEAD']))).toBe(10);
    expect(gitIn(dir, ['rev-list', '--max-parents=0', 'HEAD']).split('\n')).toHaveLength(1);
    expect(gitIn(dir, ['fsck', '--connectivity-only'])).toBeDefined();

    for (const c of commits) {
      const age = expectedAges.get(c.epoch);
      if (age !== undefined && age < RETENTION.totalDays) continue;
      expectObjectMissing(dir, c.hash);
    }
    expect(Number(gitIn(dir, ['rev-list', '--count', 'HEAD']))).toBe(10);

    const sizeAfter = await dirSize(path.join(dir, '.git'));
    expect(sizeAfter).toBeLessThan(sizeBefore / 2);

    const rerun = await pruneSnapshotHistory(path.join(dir, '.git'), dir, RETENTION);
    expect(rerun).toEqual({ before: 10, after: 10 });
    expect(readLog(dir)).toHaveLength(10);
  },
);

test.skipIf(!gitAvailable)('pruneSnapshotHistory：gc 后 1MB 大 blob 确实从对象库消失', async () => {
  const dir = await makeRepo();
  const { bigBlob } = await buildChain(dir, [
    { days: 0, hour: 12, subject: '[snapshot] agent-write fresh' },
    { days: 40, hour: 12, subject: '[snapshot] agent-write big', big: true },
  ]);
  const result = await pruneSnapshotHistory(path.join(dir, '.git'), dir, RETENTION);
  expect(result).toEqual({ before: 2, after: 1 });
  expect(bigBlob).toBeDefined();
  expectObjectMissing(dir, bigBlob!);
});

test.skipIf(!gitAvailable)('pruneSnapshotHistory：空仓库安全 no-op', async () => {
  const dir = await makeRepo();
  const result = await pruneSnapshotHistory(path.join(dir, '.git'), dir, RETENTION);
  expect(result).toEqual({ before: 0, after: 0 });
});

test.skipIf(!gitAvailable)('pruneSnapshotHistory：保留集合覆盖全部 commit 时 no-op', async () => {
  const dir = await makeRepo();
  await buildChain(dir, [
    { days: 0, hour: 9, subject: '[snapshot] agent-write a' },
    { days: 1, hour: 10, subject: '[snapshot] agent-write b' },
  ]);
  const result = await pruneSnapshotHistory(path.join(dir, '.git'), dir, RETENTION);
  expect(result).toEqual({ before: 2, after: 2 });
  expect(readLog(dir)).toHaveLength(2);
});

test.skipIf(!gitAvailable)('pruneSnapshotHistory：链上混入非快照 commit 时保守跳过', async () => {
  const dir = await makeRepo();
  const { commits } = await buildChain(dir, [
    { days: 0, hour: 9, subject: '[snapshot] agent-write newest' },
    { days: 40, hour: 10, subject: 'manual work' },
  ]);
  const result = await pruneSnapshotHistory(path.join(dir, '.git'), dir, RETENTION);
  expect(result).toEqual({ before: 2, after: 2 });
  const log = readLog(dir);
  expect(log).toHaveLength(2);
  expect(log.map((c) => c.hash).sort()).toEqual(commits.map((c) => c.hash).sort());
});
