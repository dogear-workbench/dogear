import { test, expect } from 'bun:test';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildRemoteManifestView,
  buildWorkspaceMapContext,
  encodeFlatCwd,
  enabledWorkspaceIdsOf,
  learnReverseWorkspaceMap,
  localSessionsFlatDir,
  toLocalView,
  toRemoteRelPath,
  type WorkspaceMapEntry,
} from './workspace-map.js';
import { buildManifest } from './manifest.js';
import type { SyncState } from './sync-state.js';

const DATA_DIR = '/home/alice/.dogear';
const PEER_DATA_DIR = 'C:\\Users\\bob\\.dogear';

const LOCAL_FLAT = localSessionsFlatDir(DATA_DIR, 'ws-local');
const PEER_FLAT = localSessionsFlatDir(PEER_DATA_DIR, 'ws-remote');

// ── 映射上下文 ──

function ctx(map?: Record<string, WorkspaceMapEntry>, ignored?: string[], peerDataDir?: string) {
  return buildWorkspaceMapContext(map, ignored, DATA_DIR, peerDataDir);
}

test('enabledWorkspaceIdsOf：只收 enabled=true 的本端 wsid', () => {
  expect(enabledWorkspaceIdsOf(undefined)).toEqual([]);
  expect(enabledWorkspaceIdsOf({})).toEqual([]);
  expect(
    enabledWorkspaceIdsOf({
      a: { enabled: true },
      b: { enabled: false },
      c: { remoteWsid: 'x', enabled: true },
    }),
  ).toEqual(['a', 'c']);
});

// ── toLocalView：对端路径 → 本端视角 ──

test('全局数据与 workspaces/ 直接落文件不受映射过滤（workspaces.json 恒同步）', () => {
  const c = ctx();
  expect(toLocalView(c, 'settings.json').kind).toBe('pass');
  expect(toLocalView(c, 'plans.json').kind).toBe('pass');
  expect(toLocalView(c, 'memory/foo.md').kind).toBe('pass');
  // 两段路径 = workspaces/ 下的文件（workspaces.json、其冲突副本），不是工作区目录
  expect(toLocalView(c, 'workspaces/workspaces.json').kind).toBe('pass');
  expect(toLocalView(c, 'workspaces/workspaces.json.conflict-4cc497').kind).toBe('pass');
});

test('未建映射：映射表为空时所有对端工作区目录都进待映射清单（identity 直通必须显式建立）', () => {
  const c = ctx();
  const r = toLocalView(c, 'workspaces/ws-remote/conversations.json');
  expect(r).toEqual({ kind: 'unmapped', remoteWsid: 'ws-remote' });
});

test('显式映射后按映射折算；remoteWsid 缺省 = 同 id 直通', () => {
  const c = ctx({ 'ws-a': { enabled: true } });
  const r = toLocalView(c, 'workspaces/ws-a/conversations.json');
  expect(r).toEqual({ kind: 'map', localRelPath: 'workspaces/ws-a/conversations.json' });
  // 映射表里没有的 wsid 仍进待映射（identity 直通只在建了条目后生效）
  expect(toLocalView(c, 'workspaces/ws-remote/x.json').kind).toBe('unmapped');

  const c2 = ctx({ 'ws-local': { remoteWsid: 'ws-remote', enabled: true } });
  expect(toLocalView(c2, 'workspaces/ws-remote/conversations.json')).toEqual({
    kind: 'map',
    localRelPath: 'workspaces/ws-local/conversations.json',
  });
});

test('sessions flat-cwd 目录名随映射重写为本端编码（读取侧按 flat-cwd 定位，不重写则本机扫不到）', () => {
  const c = ctx({ 'ws-local': { remoteWsid: 'ws-remote', enabled: true } }, undefined, PEER_DATA_DIR);
  const r = toLocalView(c, `workspaces/ws-remote/sessions/${PEER_FLAT}/2026-09-27T00-00-00-000Z_s1.jsonl`);
  expect(r).toEqual({
    kind: 'map',
    localRelPath: `workspaces/ws-local/sessions/${LOCAL_FLAT}/2026-09-27T00-00-00-000Z_s1.jsonl`,
  });
});

test('忽略列表：未映射且在忽略列表 → 静默跳过；已建映射优先于忽略', () => {
  const c = ctx(undefined, ['ws-ignored']);
  expect(toLocalView(c, 'workspaces/ws-ignored/conversations.json')).toEqual({
    kind: 'ignored',
    remoteWsid: 'ws-ignored',
  });

  const c2 = ctx({ 'ws-local': { remoteWsid: 'ws-ignored', enabled: true } }, ['ws-ignored']);
  expect(toLocalView(c2, 'workspaces/ws-ignored/conversations.json').kind).toBe('map');
});

// ── toRemoteRelPath：推送方向反向折算 ──

test('推送反向折算：wsid 与 sessions flat-cwd 目录名都用对端 dataDir 编码', () => {
  const c = ctx({ 'ws-local': { remoteWsid: 'ws-remote', enabled: true } }, undefined, PEER_DATA_DIR);
  expect(toRemoteRelPath(c, 'workspaces/ws-local/conversations.json')).toBe(
    'workspaces/ws-remote/conversations.json',
  );
  expect(
    toRemoteRelPath(c, `workspaces/ws-local/sessions/${LOCAL_FLAT}/2026-09-27T00-00-00-000Z_s1.jsonl`),
  ).toBe(`workspaces/ws-remote/sessions/${PEER_FLAT}/2026-09-27T00-00-00-000Z_s1.jsonl`);
  expect(PEER_FLAT.startsWith('--C--Users-bob--')).toBe(false);
  expect(PEER_FLAT).toBe(encodeFlatCwd('C:\\Users\\bob\\.dogear\\workspaces\\ws-remote'));
});

test('推送：旧版对端无 dataDirPath → sessions 目录名保持原样（退化为旧行为）；未映射 → null', () => {
  const c = ctx({ 'ws-local': { remoteWsid: 'ws-remote', enabled: true } });
  expect(
    toRemoteRelPath(c, `workspaces/ws-local/sessions/${LOCAL_FLAT}/s1.jsonl`),
  ).toBe(`workspaces/ws-remote/sessions/${LOCAL_FLAT}/s1.jsonl`);

  const c2 = ctx({ 'other': { enabled: true } });
  expect(toRemoteRelPath(c2, 'workspaces/ws-local/conversations.json')).toBeNull();
});

// ── 反向映射自动学习 ──

function stateWith(peerId: string, existing?: Record<string, WorkspaceMapEntry>): SyncState {
  return {
    version: 1,
    peers: {
      [peerId]: { deviceId: peerId, lastSyncAt: 0, ...(existing ? { workspaceMap: existing } : {}) },
    },
  };
}

test('反向学习：对端条目 [对端X → 本端Y] 补 workspaceMap[Y] = {remoteWsid: X, enabled: true}', () => {
  const state = stateWith('peer1');
  const learned = learnReverseWorkspaceMap(
    state,
    'peer1',
    { 'ws-remote': { enabled: true }, 'ws-b': { remoteWsid: 'ws-local2', enabled: true } },
    new Set(['ws-local2', 'ws-y']),
  );
  expect(learned).toBe(1); // ws-y 不在本端工作区列表，跳过
  expect(state.peers['peer1'].workspaceMap).toEqual({
    'ws-local2': { remoteWsid: 'ws-b', enabled: true },
  });
});

test('反向学习：identity 条目（对端未填 remoteWsid）→ 本端同 id 直通条目', () => {
  const state = stateWith('peer1');
  learnReverseWorkspaceMap(state, 'peer1', { 'same-id': { enabled: true } }, new Set(['same-id']));
  expect(state.peers['peer1'].workspaceMap).toEqual({ 'same-id': { remoteWsid: 'same-id', enabled: true } });
});

test('反向学习：已存在的映射不覆盖（enabled=false 保持），disabled 条目不学习', () => {
  const state = stateWith('peer1', { 'ws-x': { remoteWsid: 'ws-remote', enabled: false } });
  const learned = learnReverseWorkspaceMap(
    state,
    'peer1',
    { 'ws-remote': { enabled: true }, 'ws-z': { enabled: false } },
    new Set(['ws-x', 'ws-z']),
  );
  expect(learned).toBe(0);
  expect(state.peers['peer1'].workspaceMap).toEqual({
    'ws-x': { remoteWsid: 'ws-remote', enabled: false },
  });
});

// ── 对端清单整体折算与待映射清单 ──

test('buildRemoteManifestView：折算条目 + 待映射清单带元信息 + 忽略静默', () => {
  const c = ctx({ 'ws-local': { remoteWsid: 'ws-remote', enabled: true } }, ['ws-nope']);
  const { views, unmappedWorkspaces } = buildRemoteManifestView(
    c,
    [
      { relPath: 'workspaces/ws-remote/conversations.json', size: 1, mtimeMs: 1 },
      { relPath: 'workspaces/ws-new/plans.json', size: 2, mtimeMs: 2 },
      { relPath: 'workspaces/ws-nope/x.json', size: 3, mtimeMs: 3 },
      { relPath: 'settings.json', size: 4, mtimeMs: 4 },
    ],
    [{ wsid: 'ws-new', name: '新工作区', conversationCount: 7, lastUpdated: 100 }],
  );
  expect(views.map((v) => v.entry.relPath).sort()).toEqual([
    'settings.json',
    'workspaces/ws-local/conversations.json',
  ]);
  expect(views.find((v) => v.entry.relPath === 'workspaces/ws-local/conversations.json')?.remoteRelPath).toBe(
    'workspaces/ws-remote/conversations.json',
  );
  expect(unmappedWorkspaces).toEqual([{ wsid: 'ws-new', name: '新工作区', conversationCount: 7, lastUpdated: 100 }]);
});

test('buildRemoteManifestView：无元信息时待映射清单仅有 wsid', () => {
  const { unmappedWorkspaces } = buildRemoteManifestView(ctx(), [
    { relPath: 'workspaces/unknown-id/a.json', size: 1, mtimeMs: 1 },
  ], undefined);
  expect(unmappedWorkspaces).toEqual([{ wsid: 'unknown-id' }]);
});

// ── buildManifest 映射过滤（真实临时目录）──

test('buildManifest enabledWorkspaceIds：只收启用 wsid 子树，workspaces.json 恒收', async () => {
  const root = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-wsmap-'));
  try {
    const mk = (p: string) => fsp.mkdir(path.join(root, p), { recursive: true });
    const wf = (p: string, data = 'x') => fsp.writeFile(path.join(root, p), data);
    await mk('workspaces/enabled-ws/sessions/--test--');
    await mk('workspaces/disabled-ws');
    await mk('conversations');
    await wf('workspaces/workspaces.json', '{"version":1,"workspaces":[]}');
    await wf('workspaces/enabled-ws/conversations.json');
    await wf('workspaces/enabled-ws/sessions/--test--/s1.jsonl');
    await wf('workspaces/disabled-ws/conversations.json');
    await wf('settings.json');

    const filtered = await buildManifest(root, { enabledWorkspaceIds: ['enabled-ws'] });
    const paths = filtered.map((e) => e.relPath);
    expect(paths).toContain('workspaces/workspaces.json');
    expect(paths).toContain('workspaces/enabled-ws/conversations.json');
    expect(paths).toContain('workspaces/enabled-ws/sessions/--test--/s1.jsonl');
    expect(paths).toContain('settings.json');
    expect(paths.some((p) => p.startsWith('workspaces/disabled-ws/'))).toBe(false);

    // 无过滤参数 = 旧行为全量
    const all = await buildManifest(root, {});
    expect(all.map((e) => e.relPath)).toContain('workspaces/disabled-ws/conversations.json');

    // 空数组 = 全部工作区目录不同步（全局数据仍收）
    const none = await buildManifest(root, { enabledWorkspaceIds: [] });
    const nonePaths = none.map((e) => e.relPath);
    expect(nonePaths).toContain('workspaces/workspaces.json');
    expect(nonePaths.some((p) => p.startsWith('workspaces/enabled-ws/'))).toBe(false);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});
