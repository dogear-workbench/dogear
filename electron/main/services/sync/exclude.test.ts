import { test, expect, mock } from 'bun:test';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { buildManifest, diffManifests, isExcluded, type FileEntry, type ManifestExcludes } from './manifest.js';
import type { IncomingApplyItem } from './apply.js';

// apply.ts 静态 import 链（→ settings-service / sync-state）顶层拉进 electron 的命名导入，
// bun test 下 CJS interop 无 'app' 命名导出会炸；先 mock 再动态加载
mock.module('electron', () => ({
  default: { app: { getPath: () => tmpdir() }, nativeTheme: {} },
  app: { getPath: () => tmpdir() },
  nativeTheme: {},
}));
const { applyIncoming } = await import('./apply.js');

const ex = (
  over: Partial<Omit<ManifestExcludes, 'optionalDirs'>> & { optionalDirs?: Partial<ManifestExcludes['optionalDirs']> } = {},
): ManifestExcludes => {
  const { optionalDirs, ...rest } = over;
  return {
    conflictCopies: false,
    shadowGit: false,
    disabledItems: new Set<string>(),
    ...rest,
    optionalDirs: { stocks: false, feishu: false, ...optionalDirs },
  };
};

// ── isExcluded：excludes 缺省 → 全放行（现状行为） ──

test('excludes 缺省 / undefined：任何路径都放行', () => {
  expect(isExcluded('workspaces/ws1/shadow-git/HEAD')).toBe(false);
  expect(isExcluded('memory/a.md.conflict-4cc497')).toBe(false);
  expect(isExcluded('settings.json')).toBe(false);
  expect(isExcluded('plans.json', undefined)).toBe(false);
});

// ── isExcluded：shadowGit=false → 任意路径段 shadow-git 排除 ──

test('shadowGit=false：深层目录段命中、目录自身命中、非完整段不命中', () => {
  expect(isExcluded('workspaces/ws1/shadow-git/HEAD', ex())).toBe(true);
  expect(isExcluded('workspaces/ws1/shadow-git', ex())).toBe(true);
  expect(isExcluded('memory/shadow-git/objects/ab/cd', ex())).toBe(true);
  // 段必须完整相等：前缀相似目录不受影响
  expect(isExcluded('myshadow-git/x', ex())).toBe(false);
  expect(isExcluded('shadow-gitnotreal/x', ex())).toBe(false);
  // 开关为 true → 放行
  expect(isExcluded('workspaces/ws1/shadow-git/HEAD', ex({ shadowGit: true }))).toBe(false);
});

// ── isExcluded：conflictCopies=false → basename 以 .conflict-<尾缀> 结尾排除 ──

test('conflictCopies=false：.conflict-<尾缀> 结尾命中（含 dotfile 与子目录）', () => {
  expect(isExcluded('workspaces/workspaces.json.conflict-4cc497', ex())).toBe(true);
  expect(isExcluded('a.conflict-abc', ex())).toBe(true); // 无 ext 文件整体作 stem
  expect(isExcluded('.gitignore.conflict-x', ex())).toBe(true); // dotfile
  expect(isExcluded('dir/sub/notes.md.conflict-123456', ex())).toBe(true);
  expect(isExcluded('plans.json.conflict-4cc497', ex())).toBe(true);
  // 开关为 true → 放行
  expect(isExcluded('xx.json.conflict-4cc497', ex({ conflictCopies: true }))).toBe(false);
});

test('conflictCopies=false：.conflict- 在 stem 中间 / 尾缀为空 / 非后缀形态不命中', () => {
  expect(isExcluded('a.conflict-b.json', ex())).toBe(false); // 冲突标记在 stem 中间，末点切出 ext=.json
  expect(isExcluded('conflict-4cc497', ex())).toBe(false); // 前缀而非后缀
  expect(isExcluded('x.conflict-', ex())).toBe(false); // 至少 1 位尾缀
  expect(isExcluded('.conflict-x', ex())).toBe(false); // 纯 dot 段无 stem，非法副本名
});

// ── isExcluded：disabledItems → 文件项全等、目录项第一段前缀 ──

test('disabledItems：目录项前缀命中、整目录等值命中，workspaces.json 不受 workspaces 影响', () => {
  const all = ex({ disabledItems: new Set(['workspaces', 'memory', 'settings.json', 'plans.json']) });
  expect(isExcluded('memory/a.md', all)).toBe(true);
  expect(isExcluded('memory/sub/a.md', all)).toBe(true);
  expect(isExcluded('workspaces/abc', all)).toBe(true);
  expect(isExcluded('workspaces/ws1/conversations.json', all)).toBe(true);
  expect(isExcluded('workspaces', all)).toBe(true);
  expect(isExcluded('settings.json', all)).toBe(true);
  expect(isExcluded('plans.json', all)).toBe(true);
  // 前缀比较带 '/'：workspaces/abc 命中而 workspaces.json 不命中
  expect(isExcluded('workspaces.json', all)).toBe(false);
  expect(isExcluded('memoryx/a.md', all)).toBe(false);
  expect(isExcluded('settings.json.bak', all)).toBe(false);
  // 未列入 disabledItems 的活目录放行；退役目录 conversations 无条件排除（见退役防线测试块）
  expect(isExcluded('usage/a.json', all)).toBe(false);
});

test('stocks/feishu 走 optionalDirs：关=排除（整树前缀），开=放行；disabledItems 误传不生效（F1）', () => {
  const closed = ex();
  expect(isExcluded('stocks/a.json', closed)).toBe(true);
  expect(isExcluded('feishu/b.json', closed)).toBe(true);
  // 前缀段匹配：相似目录名不受影响
  expect(isExcluded('stocks2/a.json', closed)).toBe(false);
  expect(isExcluded('feishu', closed)).toBe(true);
  // 开启后放行
  const open = ex({ optionalDirs: { stocks: true, feishu: true } });
  expect(isExcluded('stocks/a.json', open)).toBe(false);
  expect(isExcluded('feishu/b.json', open)).toBe(false);
  // disabledItems 里的 stocks/feishu id 依旧不生效（开关走独立布尔键）
  const wrongSet = ex({ disabledItems: new Set(['stocks', 'feishu']) });
  expect(isExcluded('stocks/a.json', wrongSet)).toBe(true);
  expect(isExcluded('feishu/b.json', ex({ disabledItems: new Set(['stocks', 'feishu']), optionalDirs: { stocks: true, feishu: true } }))).toBe(false);
});

// ── buildManifest：排除在清单生成侧生效 ──

async function makeTempData(): Promise<string> {
  const root = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-exclude-'));
  const files = [
    'settings.json',
    'plans.json',
    'memory/a.md',
    'memory/a.md.conflict-abc',
    'conversations/c.json',
    'conversations/c.json.conflict-4cc497',
    'workspaces/ws1/conversations.json',
    'workspaces/ws1/shadow-git/HEAD',
    'workspaces/ws1/shadow-git/objects/ab/cdef',
    'workspaces/ws1/sessions/x.jsonl',
    'workspaces/workspaces.json',
    'workspaces/workspaces.json.conflict-4cc497',
  ];
  for (const rel of files) {
    const abs = path.join(root, rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, `content of ${rel}`);
  }
  return root;
}

test('buildManifest：shadow-git 与 .conflict-* 不进清单，其余条目照常', async () => {
  const root = await makeTempData();
  const entries = await buildManifest(root, {
    enabledWorkspaceIds: ['ws1'],
    excludes: ex(),
  });
  const paths = entries.map((e) => e.relPath);
  expect(paths).toContain('settings.json');
  expect(paths).toContain('plans.json');
  expect(paths).toContain('memory/a.md');
  expect(paths).toContain('workspaces/ws1/conversations.json');
  expect(paths).toContain('workspaces/ws1/sessions/x.jsonl');
  expect(paths).toContain('workspaces/workspaces.json');
  // 退役目录不再收录（哪怕磁盘上仍有残留文件）
  expect(paths.some((p) => p.startsWith('conversations/'))).toBe(false);
  // 排除项一个都不出现
  expect(paths.some((p) => p.split('/').includes('shadow-git'))).toBe(false);
  expect(paths.some((p) => p.endsWith('.conflict-4cc497') || p.endsWith('.conflict-abc'))).toBe(false);
  // 目录剪枝：shadow-git 内部文件绝不因其余规则漏收
  expect(paths).not.toContain('workspaces/ws1/shadow-git/HEAD');
  await fsp.rm(root, { recursive: true, force: true });
});

test('buildManifest：excludes 缺省 → 排除路径照常进清单（现状行为）；退役目录除外', async () => {
  const root = await makeTempData();
  const entries = await buildManifest(root, { enabledWorkspaceIds: ['ws1'] });
  const paths = entries.map((e) => e.relPath);
  expect(paths).toContain('workspaces/ws1/shadow-git/HEAD');
  expect(paths).toContain('workspaces/ws1/shadow-git/objects/ab/cdef');
  expect(paths).toContain('memory/a.md.conflict-abc');
  expect(paths).toContain('workspaces/workspaces.json.conflict-4cc497');
  expect(paths.some((p) => p.startsWith('conversations/'))).toBe(false);
  await fsp.rm(root, { recursive: true, force: true });
});

test('buildManifest：disabledItems 关闭目录项与文件项', async () => {
  const root = await makeTempData();
  const entries = await buildManifest(root, {
    enabledWorkspaceIds: ['ws1'],
    excludes: ex({ disabledItems: new Set(['memory', 'plans.json']) }),
  });
  const paths = entries.map((e) => e.relPath);
  expect(paths.some((p) => p === 'memory/a.md' || p.startsWith('memory/'))).toBe(false);
  expect(paths).not.toContain('plans.json');
  expect(paths).toContain('settings.json');
  expect(paths).toContain('workspaces/ws1/sessions/x.jsonl');
  await fsp.rm(root, { recursive: true, force: true });
});

// ── diffManifests：拉取侧对称过滤（防 remote-only 判定架空排除） ──

test('diffManifests：对端清单中被排除的路径不进 pull/冲突集合，进 skipped', async () => {
  const root = await makeTempData();
  const local: FileEntry[] = [
    { relPath: 'memory/a.md', size: 1, mtimeMs: 1 },
    { relPath: 'usage/old.json', size: 1, mtimeMs: 1 },
  ];
  const remote: FileEntry[] = [
    { relPath: 'memory/a.md', size: 2, mtimeMs: 2 }, // 双变无基线 → conflict
    { relPath: 'usage/new.json', size: 2, mtimeMs: 2 }, // remote-only → pull
    { relPath: 'workspaces/ws1/shadow-git/HEAD', size: 2, mtimeMs: 2 }, // 排除
    { relPath: 'memory/a.md.conflict-abc', size: 2, mtimeMs: 2 }, // 排除
    { relPath: 'plans.json.conflict-4cc497', size: 2, mtimeMs: 2 }, // 排除
  ];
  const r = await diffManifests({ root, local, remote, excludes: ex() });
  expect(r.pull.map((e) => e.relPath)).toEqual(['usage/new.json']);
  expect(r.conflict.map((c) => c.remote.relPath)).toEqual(['memory/a.md']);
  const excludedSkipped = r.skipped.filter((s) => s.reason === 'excluded by local sync scope').map((s) => s.relPath).sort();
  expect(excludedSkipped).toEqual(['memory/a.md.conflict-abc', 'plans.json.conflict-4cc497', 'workspaces/ws1/shadow-git/HEAD']);

  // 本端清单已由 buildManifest 排除，push 侧不受影响：本端有而对端无的正常条目仍推
  const r2 = await diffManifests({ root, local, remote: [], excludes: ex() });
  expect(r2.push.map((e) => e.relPath).sort()).toEqual(['memory/a.md', 'usage/old.json']);
  await fsp.rm(root, { recursive: true, force: true });
});

// ── 已退役目录 conversations/：对称防线（防旧版本对端推回复活）──

test('isExcluded：退役目录无条件排除（含 excludes 缺省），非完整段不误伤', () => {
  expect(isExcluded('conversations/c.json')).toBe(true);
  expect(isExcluded('conversations/sessions/17344.json', undefined)).toBe(true);
  expect(isExcluded('conversations/c.json', ex())).toBe(true);
  expect(isExcluded('conversations', ex())).toBe(true);
  expect(isExcluded('conversations-x/a.json', ex())).toBe(false);
  expect(isExcluded('workspaces/ws1/conversations.json', ex())).toBe(false);
});

test('diffManifests：对端清单退役目录条目进 skipped 不进 pull（防 remote-only 复活）', async () => {
  const local: FileEntry[] = [{ relPath: 'memory/a.md', size: 1, mtimeMs: 1 }];
  const remote: FileEntry[] = [
    { relPath: 'conversations/c.json', size: 2, mtimeMs: 2 },
    { relPath: 'conversations/sessions/17344.json', size: 2, mtimeMs: 2 },
  ];
  const r = await diffManifests({ root: tmpdir(), local, remote });
  expect(r.pull).toEqual([]);
  expect(r.skipped.filter((s) => s.reason === 'excluded by local sync scope').map((s) => s.relPath).sort())
    .toEqual(['conversations/c.json', 'conversations/sessions/17344.json']);
});

test('diffManifests：退役目录条目命中本端墓碑 → deletePropagation 驱动对端删除（不被防线拦住）', async () => {
  const remote: FileEntry[] = [{ relPath: 'conversations/c.json', size: 1, mtimeMs: 1 }];
  const r = await diffManifests({
    root: tmpdir(),
    local: [],
    remote,
    localTombstones: new Set(['conversations/c.json']),
  });
  expect(r.pull).toEqual([]);
  expect(r.deletePropagation.map((e) => e.relPath)).toEqual(['conversations/c.json']);
});

// ── 退役虚拟声明（tasks/articles 固定声明摘除的过渡防线）：与退役目录同路数 ──

const RETIRED_DECL = [
  '__ws-external__/ws-a/.dogear/tasks.json',
  '__ws-external__/ws-a/.dogear/tasks.json.conflict-abcdef-20261004-120000-ab12',
  '__ws-external__/ws-a/.dogear/articles/uuid/meta.json',
];

test('isExcluded：退役虚拟声明无条件排除（excludes 缺省也拦），非声明路径不误伤', () => {
  for (const rel of RETIRED_DECL) {
    expect(isExcluded(rel)).toBe(true);
    expect(isExcluded(rel, ex())).toBe(true);
  }
  expect(isExcluded('__ws-external__/ws-a/docs/p.md', ex())).toBe(false);
  expect(isExcluded('workspaces/ws-a/tasks.json', ex())).toBe(false);
  expect(isExcluded('__ws-external__/ws-a/.dogear/other.json', ex())).toBe(false);
});

test('diffManifests：对端清单退役声明条目进 skipped 不进 pull；命中墓碑 → deletePropagation', async () => {
  const remote: FileEntry[] = RETIRED_DECL.map((relPath) => ({ relPath, size: 2, mtimeMs: 2 }));
  const r = await diffManifests({ root: tmpdir(), local: [], remote });
  expect(r.pull).toEqual([]);
  expect(r.skipped.filter((s) => s.reason === 'excluded by local sync scope').map((s) => s.relPath).sort()).toEqual([...RETIRED_DECL].sort());
  const r2 = await diffManifests({
    root: tmpdir(),
    local: [],
    remote: [{ relPath: RETIRED_DECL[0], size: 2, mtimeMs: 2 }],
    localTombstones: new Set([RETIRED_DECL[0]]),
  });
  expect(r2.deletePropagation.map((e) => e.relPath)).toEqual([RETIRED_DECL[0]]);
});

// ── 已退役 configDir 实路径（文章迁工作区 dogear/articles 后的过渡防线）：与退役目录同路数 ──

const RETIRED_CONFIG_ARTICLES = [
  'workspaces/ws-a/articles',
  'workspaces/ws-a/articles/uuid-1/meta.json',
  'workspaces/ws-a/articles/folder/a.md',
];

test('isExcluded：退役实路径 workspaces/{wsid}/articles 无条件排除（含 excludes 缺省），非完整段不误伤', () => {
  for (const rel of RETIRED_CONFIG_ARTICLES) {
    expect(isExcluded(rel)).toBe(true);
    expect(isExcluded(rel, ex())).toBe(true);
    // 存量 disabledSyncItems 残值不再影响防线（退役恒排除）
    expect(isExcluded(rel, ex({ disabledItems: new Set(['articles']) }))).toBe(true);
  }
  // 非完整段不误伤：相似名目录/文件、其他工作区数据
  expect(isExcluded('workspaces/ws-a/articles.json', ex())).toBe(false);
  expect(isExcluded('workspaces/ws-a/articles-backup/x', ex())).toBe(false);
  expect(isExcluded('workspaces/ws-a/notes/a.md', ex())).toBe(false);
  expect(isExcluded('workspaces/ws-a/tasks.json', ex())).toBe(false);
});

test('buildManifest：configDir 留档的 workspaces/{wsid}/articles 不再进清单（目录剪枝）', async () => {
  const root = await makeTempData();
  await fsp.mkdir(path.join(root, 'workspaces/ws1/articles/uuid-1'), { recursive: true });
  await fsp.writeFile(path.join(root, 'workspaces/ws1/articles/uuid-1/meta.json'), '{}');
  await fsp.writeFile(path.join(root, 'workspaces/ws1/articles/uuid-1/content.md'), 'old article');
  const entries = await buildManifest(root, { enabledWorkspaceIds: ['ws1'], excludes: ex() });
  const paths = entries.map((e) => e.relPath);
  expect(paths.some((p) => p.startsWith('workspaces/ws1/articles'))).toBe(false);
  // 同目录其他子树照常收集
  expect(paths).toContain('workspaces/ws1/sessions/x.jsonl');
  await fsp.rm(root, { recursive: true, force: true });
});

test('diffManifests：对端清单退役实路径条目进 skipped 不进 pull；命中墓碑 → deletePropagation 驱动旧对端删旧位置', async () => {
  const remote: FileEntry[] = RETIRED_CONFIG_ARTICLES.map((relPath) => ({ relPath, size: 2, mtimeMs: 2 }));
  const r = await diffManifests({ root: tmpdir(), local: [], remote });
  expect(r.pull).toEqual([]);
  expect(r.skipped.filter((s) => s.reason === 'excluded by local sync scope').map((s) => s.relPath).sort())
    .toEqual([...RETIRED_CONFIG_ARTICLES].sort());
  const r2 = await diffManifests({
    root: tmpdir(),
    local: [],
    remote: [{ relPath: RETIRED_CONFIG_ARTICLES[1], size: 2, mtimeMs: 2 }],
    localTombstones: new Set([RETIRED_CONFIG_ARTICLES[1]]),
  });
  expect(r2.deletePropagation.map((e) => e.relPath)).toEqual([RETIRED_CONFIG_ARTICLES[1]]);
});

// ── applyIncoming：应用侧入口丢弃（挡旧版本对端推来的文件） ──

test('applyIncoming：被排除的条目直接丢弃进 skipped，不落盘、不进合并', async () => {
  const root = await makeTempData();
  // writeIncomingFile 期望 gzip 流（对端传输格式）
  const sourceFactory = async () => Readable.from(gzipSync(Buffer.from('remote-content')));
  const items: IncomingApplyItem[] = [
    { entry: { relPath: 'memory/new.md', size: 14, mtimeMs: 123 } },
    { entry: { relPath: 'workspaces/ws1/shadow-git/HEAD', size: 7, mtimeMs: 123 } },
    { entry: { relPath: 'plans.json.conflict-4cc497', size: 5, mtimeMs: 123 } },
    // disabledItems 关闭的记录文件也不进条目级合并
    { entry: { relPath: 'plans.json', size: 5, mtimeMs: 123 } },
  ];
  const r = await applyIncoming(root, items, sourceFactory, ex({ disabledItems: new Set(['plans.json']) }));
  expect(r.applied.map((e) => e.relPath)).toEqual(['memory/new.md']);
  expect(r.skipped.map((s) => s.relPath).sort()).toEqual(['plans.json', 'plans.json.conflict-4cc497', 'workspaces/ws1/shadow-git/HEAD']);
  expect(r.mergedFiles).toEqual([]);
  expect(r.mergeFailed).toEqual([]);
  // 被丢弃条目未落盘：plans.json.conflict-4cc497 在样例中不存在，被丢弃后也不应被创建
  await expect(fsp.access(path.join(root, 'plans.json.conflict-4cc497'))).rejects.toThrow();
  // excludes 缺省 → 全部照常写入
  const r2 = await applyIncoming(root, [items[1]], sourceFactory);
  expect(r2.applied).toHaveLength(1);
  await expect(fsp.stat(path.join(root, 'workspaces/ws1/shadow-git/HEAD'))).resolves.toBeTruthy();
  await fsp.rm(root, { recursive: true, force: true });
});

// ── F1：stocks/feishu 接入 excludes 体系 ──

test('buildManifest：optionalDirs.stocks=true 时 stocks 进清单，false 时整树排除', async () => {
  const root = await makeTempData();
  await fsp.mkdir(path.join(root, 'stocks'), { recursive: true });
  await fsp.writeFile(path.join(root, 'stocks/quote.json'), 'quote');
  await fsp.mkdir(path.join(root, 'feishu'), { recursive: true });
  await fsp.writeFile(path.join(root, 'feishu/doc.json'), 'doc');
  const on = await buildManifest(root, { enabledWorkspaceIds: ['ws1'], excludes: ex({ optionalDirs: { stocks: true, feishu: true } }) });
  expect(on.map((e) => e.relPath)).toContain('stocks/quote.json');
  expect(on.map((e) => e.relPath)).toContain('feishu/doc.json');
  const off = await buildManifest(root, { enabledWorkspaceIds: ['ws1'], excludes: ex() });
  expect(off.map((e) => e.relPath)).not.toContain('stocks/quote.json');
  expect(off.map((e) => e.relPath)).not.toContain('feishu/doc.json');
  await fsp.rm(root, { recursive: true, force: true });
});

test('diffManifests：本端关 stocks 时对端清单 stocks 条目进 skipped 不进 pull（消除每轮全量重拉）', async () => {
  const root = await makeTempData();
  const local: FileEntry[] = [{ relPath: 'memory/a.md', size: 1, mtimeMs: 1 }];
  const remote: FileEntry[] = [
    { relPath: 'stocks/quote.json', size: 2, mtimeMs: 2 },
    { relPath: 'feishu/doc.json', size: 2, mtimeMs: 2 },
    { relPath: 'memory/new.md', size: 2, mtimeMs: 2 },
  ];
  const r = await diffManifests({ root, local, remote, excludes: ex() });
  expect(r.pull.map((e) => e.relPath)).toEqual(['memory/new.md']);
  expect(r.skipped.filter((s) => s.reason === 'excluded by local sync scope').map((s) => s.relPath).sort())
    .toEqual(['feishu/doc.json', 'stocks/quote.json']);
  // 开启后照常 pull
  const r2 = await diffManifests({ root, local, remote, excludes: ex({ optionalDirs: { stocks: true, feishu: true } }) });
  expect(r2.pull.map((e) => e.relPath).sort()).toEqual(['feishu/doc.json', 'memory/new.md', 'stocks/quote.json']);
  await fsp.rm(root, { recursive: true, force: true });
});
