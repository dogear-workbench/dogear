import { test, expect, mock } from 'bun:test';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { FileEntry, ManifestExcludes } from './manifest.js';

// manifest/workspace-map/server 经 data-registry 拉起 settings-service → electron 链，先 mock 再动态加载
mock.module('electron', () => ({
  default: { app: { getPath: () => tmpdir() }, nativeTheme: {} },
  app: { getPath: () => tmpdir() },
  nativeTheme: {},
}));

const { buildManifest, isExcluded, tombstoneCandidates } = await import('./manifest.js');
const { buildRemoteManifestView, buildWorkspaceMapContext, isWorkspacePathSyncEnabled, toLocalView, toRemoteRelPath } =
  await import('./workspace-map.js');
const { startSyncServer } = await import('./server.js');

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

/** 临时 configDir + 两个注册工作区（磁盘根在 configDir 外），返回 [configDir, wsARoot, wsBRoot] */
async function makeTempData(): Promise<[string, string, string]> {
  const configDir = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-virtual-cfg-'));
  const wsARoot = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-virtual-wsa-'));
  const wsBRoot = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-virtual-wsb-'));
  const wf = async (p: string, data = 'x') => {
    const abs = path.join(p);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, data);
  };
  await wf(path.join(configDir, 'workspaces', 'workspaces.json'), JSON.stringify({
    version: 1,
    workspaces: [
      { id: 'ws-a', name: 'A', path: wsARoot },
      { id: 'ws-b', name: 'B', path: wsBRoot },
    ],
  }));
  await wf(path.join(configDir, 'workspaces', 'other.json'), 'global data');
  await wf(path.join(wsARoot, '.dogear', 'tasks.json'), '{"version":3,"tasks":[]}');
  await wf(path.join(wsARoot, '.dogear', 'articles', 'uuid-1', 'meta.json'), '{"title":"t"}');
  await wf(path.join(wsARoot, '.dogear', 'articles', 'uuid-1', 'content.md'), 'body');
  await wf(path.join(wsARoot, 'docs', 'plans', 'p.md'), 'plan');
  await wf(path.join(wsARoot, 'README.md'), 'readme');
  return [configDir, wsARoot, wsBRoot];
}

const TASKS_REL = '__ws-external__/ws-a/.dogear/tasks.json';
const ARTICLES_META_REL = '__ws-external__/ws-a/.dogear/articles/uuid-1/meta.json';
const ARTICLES_CONTENT_REL = '__ws-external__/ws-a/.dogear/articles/uuid-1/content.md';

// ── buildManifest：虚拟路径条目收集 ──

test('buildManifest：注册工作区的 tasks.json 与 articles 子树收为 __ws-external__ 虚拟条目', async () => {
  const [configDir, wsARoot, wsBRoot] = await makeTempData();
  try {
    const entries = await buildManifest(configDir, { excludes: ex() });
    const paths = entries.map((e) => e.relPath);
    expect(paths).toContain(TASKS_REL);
    expect(paths).toContain(ARTICLES_META_REL);
    expect(paths).toContain(ARTICLES_CONTENT_REL);
    // ws-b 的 .dogear 下无数据 → 无虚拟条目
    expect(paths.some((p) => p.startsWith('__ws-external__/ws-b/'))).toBe(false);
    // 工作区真实路径不以本名进清单（虚拟形式才是协议形态）
    expect(paths.some((p) => p.startsWith(wsARoot))).toBe(false);
    const tasks = entries.find((e) => e.relPath === TASKS_REL)!;
    expect(tasks.size).toBe('{"version":3,"tasks":[]}'.length);
  } finally {
    await fsp.rm(configDir, { recursive: true, force: true });
    await fsp.rm(wsARoot, { recursive: true, force: true });
    await fsp.rm(wsBRoot, { recursive: true, force: true });
  }
});

test('buildManifest：tasks.json 不存在时不收；articles 空目录不产条目；注册表不可读时静默无虚拟条目', async () => {
  const configDir = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-virtual-cfg-'));
  const wsRoot = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-virtual-ws-'));
  try {
    await fsp.mkdir(path.join(configDir, 'workspaces'), { recursive: true });
    await fsp.writeFile(path.join(configDir, 'workspaces', 'workspaces.json'), JSON.stringify({
      version: 1,
      workspaces: [{ id: 'ws-a', path: wsRoot }],
    }));
    await fsp.mkdir(path.join(wsRoot, '.dogear'), { recursive: true });
    const entries = await buildManifest(configDir, { excludes: ex() });
    expect(entries.map((e) => e.relPath).some((p) => p.startsWith('__ws-external__/'))).toBe(false);
    // 注册表损坏 → 无虚拟条目，其余收集不受影响
    await fsp.writeFile(path.join(configDir, 'workspaces', 'workspaces.json'), 'not json');
    const entries2 = await buildManifest(configDir, { excludes: ex() });
    expect(entries2.map((e) => e.relPath).some((p) => p.startsWith('__ws-external__/'))).toBe(false);
  } finally {
    await fsp.rm(configDir, { recursive: true, force: true });
    await fsp.rm(wsRoot, { recursive: true, force: true });
  }
});

test('buildManifest：userSyncPaths 勾选子树收虚拟条目（文件与目录均支持）；未勾选不收', async () => {
  const [configDir, wsARoot, wsBRoot] = await makeTempData();
  try {
    const picked = await buildManifest(configDir, {
      excludes: ex(),
      userSyncPaths: { 'ws-a': ['docs', 'README.md'], 'ws-b': ['docs'] },
    });
    const paths = picked.map((e) => e.relPath);
    expect(paths).toContain('__ws-external__/ws-a/docs/plans/p.md');
    expect(paths).toContain('__ws-external__/ws-a/README.md');
    // ws-b 未勾选存在的路径 → 无条目
    expect(paths.some((p) => p.startsWith('__ws-external__/ws-b/'))).toBe(false);
    // 不传 userSyncPaths → 勾选子树不收
    const none = await buildManifest(configDir, { excludes: ex() });
    expect(none.map((e) => e.relPath).some((p) => p.includes('/docs/') || p.endsWith('/README.md'))).toBe(false);
    // 非法相对路径（穿越/绝对/反斜杠）防御性跳过
    const evil = await buildManifest(configDir, {
      excludes: ex(),
      userSyncPaths: { 'ws-a': ['../escape', '/abs', 'a\\b', '.dot/ok'] },
    });
    expect(evil.map((e) => e.relPath).some((p) => p.includes('escape') || p.includes('/abs') || p.includes('a\\b'))).toBe(false);
  } finally {
    await fsp.rm(configDir, { recursive: true, force: true });
    await fsp.rm(wsARoot, { recursive: true, force: true });
    await fsp.rm(wsBRoot, { recursive: true, force: true });
  }
});

test('buildManifest：enabledWorkspaceIds 过滤虚拟条目（未启用映射的注册工作区不收）；undefined = 全量', async () => {
  const [configDir, wsARoot, wsBRoot] = await makeTempData();
  try {
    await fsp.mkdir(path.join(wsBRoot, '.dogear'), { recursive: true });
    await fsp.writeFile(path.join(wsBRoot, '.dogear', 'tasks.json'), '{"version":3,"tasks":[]}');
    const onlyA = await buildManifest(configDir, { enabledWorkspaceIds: ['ws-a'], excludes: ex() });
    const pathsA = onlyA.map((e) => e.relPath);
    expect(pathsA).toContain(TASKS_REL);
    expect(pathsA.some((p) => p.startsWith('__ws-external__/ws-b/'))).toBe(false);
    const all = await buildManifest(configDir, { excludes: ex() });
    expect(all.map((e) => e.relPath)).toContain('__ws-external__/ws-b/.dogear/tasks.json');
  } finally {
    await fsp.rm(configDir, { recursive: true, force: true });
    await fsp.rm(wsARoot, { recursive: true, force: true });
    await fsp.rm(wsBRoot, { recursive: true, force: true });
  }
});

test('buildManifest：disabledItems 关 tasks/articles 时对应虚拟条目不进清单；勾选子树不受影响', async () => {
  const [configDir, wsARoot, wsBRoot] = await makeTempData();
  try {
    const entries = await buildManifest(configDir, {
      excludes: ex({ disabledItems: new Set(['tasks']) }),
      userSyncPaths: { 'ws-a': ['README.md'] },
    });
    const paths = entries.map((e) => e.relPath);
    expect(paths).not.toContain(TASKS_REL);
    expect(paths).toContain(ARTICLES_META_REL);
    expect(paths).toContain('__ws-external__/ws-a/README.md');

    const entries2 = await buildManifest(configDir, {
      excludes: ex({ disabledItems: new Set(['articles']) }),
    });
    expect(entries2.map((e) => e.relPath).some((p) => p.includes('/.dogear/articles/'))).toBe(false);
    expect(entries2.map((e) => e.relPath)).toContain(TASKS_REL);
  } finally {
    await fsp.rm(configDir, { recursive: true, force: true });
    await fsp.rm(wsARoot, { recursive: true, force: true });
    await fsp.rm(wsBRoot, { recursive: true, force: true });
  }
});

// ── isExcluded：虚拟路径新规则 ──

test('isExcluded：disabledItems 含 tasks/articles 时分别匹配虚拟条目；勾选子树与 .dogear 其他路径不受牵连', () => {
  const both = ex({ disabledItems: new Set(['tasks', 'articles']) });
  expect(isExcluded('__ws-external__/ws-a/.dogear/tasks.json', both)).toBe(true);
  expect(isExcluded('__ws-external__/any-wsid/.dogear/tasks.json', both)).toBe(true);
  expect(isExcluded('__ws-external__/ws-a/.dogear/articles/x/meta.json', both)).toBe(true);
  expect(isExcluded('__ws-external__/ws-a/.dogear/articles', both)).toBe(true);
  // tasks 精确匹配：articles 开关不影响 tasks.json，反之亦然
  expect(isExcluded('__ws-external__/ws-a/.dogear/tasks.json', ex({ disabledItems: new Set(['articles']) }))).toBe(false);
  expect(isExcluded('__ws-external__/ws-a/.dogear/articles/x/m.json', ex({ disabledItems: new Set(['tasks']) }))).toBe(false);
  // .dogear 下其他内容 / 勾选子树 / 非 .dogear 段不在 disabledSyncItems 体系
  expect(isExcluded('__ws-external__/ws-a/.dogear/other.json', both)).toBe(false);
  expect(isExcluded('__ws-external__/ws-a/README.md', both)).toBe(false);
  expect(isExcluded('__ws-external__/ws-a/docs/p.md', both)).toBe(false);
  // 形态相近但非虚拟条目的路径不误伤
  expect(isExcluded('workspaces/ws-a/.dogear/tasks.json', both)).toBe(false);
  expect(isExcluded('__ws-external__/ws-a/tasks.json', both)).toBe(false);
});

// ── tombstoneCandidates：虚拟条目的 enabled 守卫 ──

test('tombstoneCandidates：未 enabled 的虚拟条目消失是映射状态非删除事实；enabled 时消失产墓碑', () => {
  const prev: FileEntry[] = [
    { relPath: TASKS_REL, size: 1, mtimeMs: 1 },
    { relPath: '__ws-external__/ws-x/.dogear/tasks.json', size: 1, mtimeMs: 1 },
    { relPath: 'memory/gone.md', size: 1, mtimeMs: 1 },
  ];
  const out = tombstoneCandidates(prev, [], { enabledWorkspaceIds: ['ws-a'] });
  expect(out).toContain('memory/gone.md');
  expect(out).toContain(TASKS_REL);
  expect(out).not.toContain('__ws-external__/ws-x/.dogear/tasks.json');
  const out2 = tombstoneCandidates(prev, [], { enabledWorkspaceIds: ['ws-a', 'ws-x'] });
  expect(out2).toContain(TASKS_REL);
  expect(out2).toContain('__ws-external__/ws-x/.dogear/tasks.json');
});

// ── workspace-map：虚拟路径 wsid 翻译 ──

const VIRTUAL_REMOTE = '__ws-external__/ws-remote/.dogear/tasks.json';
const VIRTUAL_LOCAL = '__ws-external__/ws-local/.dogear/tasks.json';

test('toLocalView：虚拟路径按映射折算 wsid；未映射进待映射；忽略列表静默', () => {
  const c = buildWorkspaceMapContext({ 'ws-local': { remoteWsid: 'ws-remote', enabled: true } }, ['ws-ign'], '/d');
  expect(toLocalView(c, VIRTUAL_REMOTE)).toEqual({ kind: 'map', localRelPath: VIRTUAL_LOCAL });
  expect(toLocalView(c, '__ws-remote-id/articles/a/m.json')).toEqual({ kind: 'pass', localRelPath: '__ws-remote-id/articles/a/m.json' });
  expect(toLocalView(c, '__ws-external__/unknown/x.json')).toEqual({ kind: 'unmapped', remoteWsid: 'unknown' });
  expect(toLocalView(c, '__ws-external__/ws-ign/.dogear/tasks.json')).toEqual({ kind: 'ignored', remoteWsid: 'ws-ign' });
});

test('toRemoteRelPath：虚拟路径推送方向反向折算；未映射 → null', () => {
  const c = buildWorkspaceMapContext({ 'ws-local': { remoteWsid: 'ws-remote', enabled: true } }, undefined, '/d');
  expect(toRemoteRelPath(c, VIRTUAL_LOCAL)).toBe(VIRTUAL_REMOTE);
  expect(toRemoteRelPath(c, '__ws-external__/ws-local/user/pick/a.md')).toBe('__ws-external__/ws-remote/user/pick/a.md');
  expect(toRemoteRelPath(c, '__ws-external__/unmapped/.dogear/tasks.json')).toBeNull();
});

test('buildRemoteManifestView：虚拟条目折算进 views，未映射虚拟条目进待映射清单（wsid 与 workspaces/ 条目合并去重）', () => {
  const c = buildWorkspaceMapContext({ 'ws-local': { remoteWsid: 'ws-remote', enabled: true } }, [], '/d');
  const { views, unmappedWorkspaces } = buildRemoteManifestView(
    c,
    [
      { relPath: VIRTUAL_REMOTE, size: 1, mtimeMs: 1 },
      { relPath: 'workspaces/ws-remote/notes/a.md', size: 2, mtimeMs: 2 },
      { relPath: '__ws-external__/ws-new/.dogear/tasks.json', size: 3, mtimeMs: 3 },
      { relPath: 'workspaces/ws-new/notes/b.md', size: 4, mtimeMs: 4 },
    ],
    [{ wsid: 'ws-new', name: '新' }],
  );
  expect(views.map((v) => v.entry.relPath).sort()).toEqual([VIRTUAL_LOCAL, 'workspaces/ws-local/notes/a.md']);
  expect(views.find((v) => v.entry.relPath === VIRTUAL_LOCAL)?.remoteRelPath).toBe(VIRTUAL_REMOTE);
  expect(unmappedWorkspaces.map((m) => m.wsid)).toEqual(['ws-new']);
});

test('isWorkspacePathSyncEnabled：虚拟路径按本端 wsid 查映射 enabled，畸形两段拒绝', () => {
  const map = { 'ws-local': { enabled: true }, 'ws-paused': { enabled: false } };
  expect(isWorkspacePathSyncEnabled(map, VIRTUAL_LOCAL)).toBe(true);
  expect(isWorkspacePathSyncEnabled(map, '__ws-external__/ws-paused/.dogear/tasks.json')).toBe(false);
  expect(isWorkspacePathSyncEnabled(map, '__ws-external__/unknown/x.json')).toBe(false);
  expect(isWorkspacePathSyncEnabled(map, '__ws-external__/ws-local')).toBe(false);
  expect(isWorkspacePathSyncEnabled(undefined, VIRTUAL_LOCAL)).toBe(false);
  expect(isWorkspacePathSyncEnabled(undefined, 'settings.json')).toBe(true);
});

// ── server 响应侧版本 gating ──

async function makeServerDataDir(): Promise<string> {
  const dataDir = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-virtual-srv-'));
  const wsRoot = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-virtual-srvws-'));
  await fsp.mkdir(path.join(dataDir, 'workspaces'), { recursive: true });
  await fsp.writeFile(
    path.join(dataDir, 'workspaces', 'workspaces.json'),
    JSON.stringify({ version: 1, workspaces: [{ id: 'ws-a', name: 'A', path: wsRoot }] }),
  );
  // 预置对端映射（enabledWorkspaceIdsOf 空表 = 全部不同步），否则清单连虚拟条目都收不到
  await fsp.writeFile(
    path.join(dataDir, 'sync-state.json'),
    JSON.stringify({
      version: 1,
      deviceId: 'self-device-1',
      peers: { [PEER_ID]: { deviceId: PEER_ID, lastSyncAt: 0, workspaceMap: { 'ws-a': { enabled: true } } } },
    }),
  );
  await fsp.mkdir(path.join(wsRoot, '.dogear'), { recursive: true });
  await fsp.writeFile(path.join(wsRoot, '.dogear', 'tasks.json'), '{"version":3,"tasks":[]}');
  return dataDir;
}

const PEER_ID = 'peer-device-abc';
const SECRET = 'c'.repeat(64);

async function gatedServerResponse(requesterVersion: number): Promise<string[]> {
  const dataDir = await makeServerDataDir();
  try {
    const server = await startSyncServer({
      port: 0,
      dataDir,
      getSelfHello: () => ({ appId: 'dogear', protocolVersion: 4, appVersion: 'test', deviceId: 'self-device-1' }),
      getManifestOptions: async () => ({ excludes: ex() }),
      handlePairRequest: async () => ({ accepted: false }),
      authorizeRequest: async (req) => {
        const deviceId = req.headers['x-dogear-device-id'];
        const secret = req.headers['x-dogear-secret'];
        if (deviceId === PEER_ID && secret === SECRET) return { ok: true, deviceId: PEER_ID };
        return { ok: false };
      },
    });
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/manifest`, {
        method: 'POST',
        headers: { 'x-dogear-device-id': PEER_ID, 'x-dogear-secret': SECRET, 'content-type': 'application/json' },
        body: JSON.stringify({
          hello: { appId: 'dogear', protocolVersion: requesterVersion, appVersion: 'test', deviceId: PEER_ID, deviceName: 'p' },
          entries: [],
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { entries: Array<{ relPath: string }> };
      return body.entries.map((e) => e.relPath);
    } finally {
      await server.close();
    }
  } finally {
    await fsp.rm(dataDir, { recursive: true, force: true });
  }
}

test('server /manifest：旧版本请求方的响应不含虚拟条目；新版本请求方收到', async () => {
  const v3Paths = await gatedServerResponse(3);
  expect(v3Paths.some((p) => p.startsWith('__ws-external__/'))).toBe(false);
  const v4Paths = await gatedServerResponse(4);
  expect(v4Paths).toContain('__ws-external__/ws-a/.dogear/tasks.json');
});
