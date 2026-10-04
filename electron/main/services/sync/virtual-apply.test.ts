import { test, expect, mock } from 'bun:test';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync, gunzipSync } from 'node:zlib';
import { Readable } from 'node:stream';
mock.module('electron', () => ({
  default: { app: { getPath: () => tmpdir() }, nativeTheme: {} },
  app: { getPath: () => tmpdir() },
  nativeTheme: {},
}));

const { applyIncoming, pushOutgoing, matchMergePattern } = await import('./apply.js');
const { applyPeerTombstones } = await import('./tombstone.js');
const { hashEntries, sha256File, excludesFromSyncOptions } = await import('./manifest.js');
const { startSyncServer } = await import('./server.js');

const PEER_ID = 'peer-device-9';
const SECRET = 'd'.repeat(64);

async function makeTempData(): Promise<{ configDir: string; wsRoot: string; wsUnregistered: string }> {
  const configDir = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-vapply-cfg-'));
  const wsRoot = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-vapply-ws-'));
  const wsUnregistered = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-vapply-unreg-'));
  await fsp.mkdir(path.join(configDir, 'workspaces'), { recursive: true });
  await fsp.writeFile(
    path.join(configDir, 'workspaces', 'workspaces.json'),
    JSON.stringify({ version: 1, workspaces: [{ id: 'ws-a', name: 'A', path: wsRoot }] }),
  );
  await fsp.mkdir(path.join(wsRoot, '.dogear'), { recursive: true });
  return { configDir, wsRoot, wsUnregistered };
}

async function cleanup(dirs: string[]): Promise<void> {
  await Promise.all(dirs.map((d) => fsp.rm(d, { recursive: true, force: true })));
}

const gzipStreamOf = (text: string): Readable => Readable.from(gzipSync(Buffer.from(text, 'utf-8')));

const TASKS_REL = '__ws-external__/ws-a/.dogear/tasks.json';
const ARTICLE_REL = '__ws-external__/ws-a/.dogear/articles/uuid-9/meta.json';

// ── matchMergePattern：虚拟 tasks.json 路由 ──

test('matchMergePattern：虚拟 tasks.json 命中合并；articles/勾选子树/非虚拟同后缀不命中', () => {
  expect(matchMergePattern(TASKS_REL)).toBe(true);
  expect(matchMergePattern('__ws-external__/other-ws/.dogear/tasks.json')).toBe(true);
  expect(matchMergePattern(ARTICLE_REL)).toBe(false);
  expect(matchMergePattern('__ws-external__/ws-a/README.md')).toBe(false);
  expect(matchMergePattern('workspaces/ws-a/.dogear/tasks.json')).toBe(false);
});

// ── applyIncoming：虚拟 tasks.json 条目级合并 ──

test('applyIncoming：虚拟 tasks.json 条目级合并落工作区真实路径，两端各增任务收敛', async () => {
  const { configDir, wsRoot } = await makeTempData();
  try {
    const local = { version: 3, tasks: [{ id: 't1', title: 'local', updatedAt: '2026-10-04T10:00:00Z' }] };
    await fsp.writeFile(path.join(wsRoot, '.dogear', 'tasks.json'), JSON.stringify(local));
    const remote = { version: 3, tasks: [{ id: 't2', title: 'remote', updatedAt: '2026-10-04T11:00:00Z' }] };
    const requested: string[] = [];
    const report = await applyIncoming(
      configDir,
      [{ entry: { relPath: TASKS_REL, size: 1, mtimeMs: 1 } }],
      (relPath) => {
        requested.push(relPath);
        return Promise.resolve(gzipStreamOf(JSON.stringify(remote)));
      },
    );
    expect(report.mergeFailed).toEqual([]);
    expect(report.skipped).toEqual([]);
    expect(report.mergedFiles).toEqual([TASKS_REL]);
    expect(requested).toEqual([TASKS_REL]);
    const merged = JSON.parse(await fsp.readFile(path.join(wsRoot, '.dogear', 'tasks.json'), 'utf-8')) as {
      version: number;
      tasks: Array<{ id: string }>;
    };
    expect(merged.version).toBe(3);
    expect(merged.tasks.map((t) => t.id).sort()).toEqual(['t1', 't2']);
    await expect(fsp.access(path.join(configDir, '__ws-external__'))).rejects.toThrow();
  } finally {
    await cleanup([configDir, wsRoot]);
  }
});

test('applyIncoming：本端无 tasks.json 时按对端内容直接落工作区真实路径', async () => {
  const { configDir, wsRoot } = await makeTempData();
  try {
    const remote = { version: 3, tasks: [{ id: 't1', title: 'r' }] };
    const report = await applyIncoming(
      configDir,
      [{ entry: { relPath: TASKS_REL, size: 1, mtimeMs: 1 } }],
      () => Promise.resolve(gzipStreamOf(JSON.stringify(remote))),
    );
    expect(report.applied.map((e) => e.relPath)).toEqual([TASKS_REL]);
    const onDisk = JSON.parse(await fsp.readFile(path.join(wsRoot, '.dogear', 'tasks.json'), 'utf-8')) as typeof remote;
    expect(onDisk.tasks[0]?.id).toBe('t1');
  } finally {
    await cleanup([configDir, wsRoot]);
  }
});

// ── applyIncoming：虚拟文章文件整文件落盘 ──

test('applyIncoming：虚拟文章文件落工作区 articles 目录并保持对端 mtime', async () => {
  const { configDir, wsRoot } = await makeTempData();
  try {
    const report = await applyIncoming(
      configDir,
      [{ entry: { relPath: ARTICLE_REL, size: 6, mtimeMs: 1700000000000 } }],
      () => Promise.resolve(gzipStreamOf('{"t":1}')),
    );
    expect(report.skipped).toEqual([]);
    expect(report.applied.map((e) => e.relPath)).toEqual([ARTICLE_REL]);
    const abs = path.join(wsRoot, '.dogear', 'articles', 'uuid-9', 'meta.json');
    await expect(fsp.readFile(abs, 'utf-8')).resolves.toBe('{"t":1}');
    const st = await fsp.stat(abs);
    expect(st.mtimeMs).toBe(1700000000000);
  } finally {
    await cleanup([configDir, wsRoot]);
  }
});

// ── applyIncoming：未注册 wsid / 穿越路径 ──

test('applyIncoming：未注册 wsid 的虚拟条目 skipped，不落 configDir 垃圾目录', async () => {
  const { configDir, wsUnregistered } = await makeTempData();
  try {
    await fsp.mkdir(path.join(wsUnregistered, '.dogear'), { recursive: true });
    await fsp.writeFile(path.join(wsUnregistered, '.dogear', 'tasks.json'), '{"version":3,"tasks":[]}');
    const report = await applyIncoming(
      configDir,
      [{ entry: { relPath: '__ws-external__/ghost-ws/.dogear/tasks.json', size: 1, mtimeMs: 1 } }],
      () => Promise.resolve(gzipStreamOf('{"version":3,"tasks":[]}')),
    );
    expect(report.applied).toEqual([]);
    expect(report.skipped).toHaveLength(1);
    expect(report.skipped[0]?.reason).toContain('虚拟路径反解失败');
    await expect(fsp.access(path.join(configDir, '__ws-external__'))).rejects.toThrow();
  } finally {
    await cleanup([configDir, wsUnregistered]);
  }
});

test('applyIncoming：穿越段虚拟条目 skipped 不落盘', async () => {
  const { configDir, wsRoot } = await makeTempData();
  try {
    const report = await applyIncoming(
      configDir,
      [{ entry: { relPath: '__ws-external__/ws-a/.dogear/../../escape.txt', size: 1, mtimeMs: 1 } }],
      () => Promise.resolve(gzipStreamOf('evil')),
    );
    expect(report.applied).toEqual([]);
    expect(report.skipped[0]?.reason).toContain('虚拟路径反解失败');
    await expect(fsp.access(path.join(wsRoot, 'escape.txt'))).rejects.toThrow();
    await expect(fsp.access(path.join(configDir, 'escape.txt'))).rejects.toThrow();
  } finally {
    await cleanup([configDir, wsRoot]);
  }
});

// ── applyIncoming：冲突副本落工作区同目录 ──

test('applyIncoming：显式裁决对端胜时虚拟条目冲突副本落工作区同目录', async () => {
  const { configDir, wsRoot } = await makeTempData();
  try {
    await fsp.writeFile(path.join(wsRoot, '.dogear', 'tasks.json'), '{"version":3,"tasks":[{"id":"t1"}]}');
    const report = await applyIncoming(
      configDir,
      [{
        entry: { relPath: TASKS_REL, size: 1, mtimeMs: 1 },
        saveConflictCopyBeforeOverwrite: true,
        conflictWinnerShortId: 'abcdef',
      }],
      () => Promise.resolve(gzipStreamOf('{"version":3,"tasks":[{"id":"t2"}]}')),
    );
    expect(report.skipped).toEqual([]);
    const copyName = (await fsp.readdir(path.join(wsRoot, '.dogear'))).find((n) => n.startsWith('tasks.json.conflict-abcdef-'));
    expect(copyName).toBeTruthy();
    const copy = JSON.parse(await fsp.readFile(path.join(wsRoot, '.dogear', copyName!), 'utf-8')) as { tasks: Array<{ id: string }> };
    expect(copy.tasks.map((t) => t.id)).toEqual(['t1']);
    const main = JSON.parse(await fsp.readFile(path.join(wsRoot, '.dogear', 'tasks.json'), 'utf-8')) as { tasks: Array<{ id: string }> };
    expect(main.tasks.map((t) => t.id)).toEqual(['t2']);
  } finally {
    await cleanup([configDir, wsRoot]);
  }
});

// ── pushOutgoing：虚拟条目读本端工作区真实路径 ──

test('pushOutgoing：虚拟条目从工作区真实路径读取推送', async () => {
  const { configDir, wsRoot } = await makeTempData();
  try {
    await fsp.writeFile(path.join(wsRoot, '.dogear', 'tasks.json'), '{"version":3,"tasks":[{"id":"t9"}]}');
    const pushed: Array<{ relPath: string; body: string }> = [];
    const report = await pushOutgoing(
      configDir,
      [{ entry: { relPath: TASKS_REL, size: 1, mtimeMs: 1 } }],
      (meta, source) =>
        new Promise<void>((resolve, reject) => {
          const chunks: Buffer[] = [];
          source.on('data', (c: Buffer) => chunks.push(c));
          source.on('end', () => {
            pushed.push({ relPath: meta.relPath, body: Buffer.concat(chunks).toString('utf-8') });
            resolve();
          });
          source.on('error', reject);
        }),
    );
    expect(report.skipped).toEqual([]);
    expect(pushed).toEqual([{ relPath: TASKS_REL, body: '{"version":3,"tasks":[{"id":"t9"}]}' }]);
  } finally {
    await cleanup([configDir, wsRoot]);
  }
});

// ── hashEntries：虚拟条目反解 hash ──

test('hashEntries：虚拟条目 hash 等于真实文件内容 hash；未注册 wsid 跳过', async () => {
  const { configDir, wsRoot } = await makeTempData();
  try {
    const body = '{"version":3,"tasks":[{"id":"t1"}]}';
    await fsp.writeFile(path.join(wsRoot, '.dogear', 'tasks.json'), body);
    const out = await hashEntries(configDir, [
      { relPath: TASKS_REL, size: body.length, mtimeMs: 1 },
      { relPath: '__ws-external__/ghost-ws/.dogear/tasks.json', size: 1, mtimeMs: 1 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.relPath).toBe(TASKS_REL);
    expect(out[0]?.hash).toBe(await sha256File(path.join(wsRoot, '.dogear', 'tasks.json')));
  } finally {
    await cleanup([configDir, wsRoot]);
  }
});

// ── applyPeerTombstones：虚拟条目跟随删除工作区真实文件 ──

test('applyPeerTombstones：虚拟条目 hash 与基线一致时删除工作区真实文件', async () => {
  const { configDir, wsRoot } = await makeTempData();
  try {
    const tasksAbs = path.join(wsRoot, '.dogear', 'tasks.json');
    await fsp.writeFile(tasksAbs, '{"version":3,"tasks":[]}');
    const hash = await sha256File(tasksAbs);
    const outcome = await applyPeerTombstones(
      configDir,
      [{ relPath: TASKS_REL, size: 1, mtimeMs: 1 }],
      new Map([[TASKS_REL, hash]]),
    );
    expect(outcome.deleted).toEqual([TASKS_REL]);
    await expect(fsp.access(tasksAbs)).rejects.toThrow();
  } finally {
    await cleanup([configDir, wsRoot]);
  }
});

// ── server 端到端：GET/POST/DELETE /file 的虚拟路径反解 ──

async function startTestServer(configDir: string, userSyncPaths?: Record<string, string[]>) {
  await fsp.writeFile(
    path.join(configDir, 'sync-state.json'),
    JSON.stringify({
      version: 1,
      deviceId: 'self-device-1',
      peers: { [PEER_ID]: { deviceId: PEER_ID, lastSyncAt: 0, workspaceMap: { 'ws-a': { enabled: true } } } },
    }),
  );
  return startSyncServer({
    port: 0,
    dataDir: configDir,
    getSelfHello: () => ({ appId: 'dogear', protocolVersion: 4, appVersion: 'test', deviceId: 'self-device-1' }),
    getManifestOptions: async () => ({
      excludes: excludesFromSyncOptions(),
      ...(userSyncPaths ? { userSyncPaths } : {}),
    }),
    handlePairRequest: async () => ({ accepted: false }),
    authorizeRequest: async (req) => {
      const deviceId = req.headers['x-dogear-device-id'];
      const secret = req.headers['x-dogear-secret'];
      if (deviceId === PEER_ID && secret === SECRET) return { ok: true, deviceId: PEER_ID };
      return { ok: false };
    },
  });
}

// fetch 未消费的响应体不释放 keep-alive 连接，close 会挂住；race 兑底（同 push-receive）
async function closeServer(server: { close(): Promise<void> }): Promise<void> {
  await Promise.race([server.close(), new Promise((resolve) => setTimeout(resolve, 3000))]);
}

async function pushFile(server: { port: number }, relPath: string, body: string): Promise<Response> {
  const meta = Buffer.from(JSON.stringify({ relPath, size: body.length, mtimeMs: 123 })).toString('base64');
  const res = await fetch(`http://127.0.0.1:${server.port}/file`, {
    method: 'POST',
    headers: { ...authHeaders, 'x-dogear-file-meta': meta, 'content-type': 'application/octet-stream' },
    body: gzipSync(Buffer.from(body)),
  });
  await res.arrayBuffer();
  return res;
}

const authHeaders = {
  'x-dogear-device-id': PEER_ID,
  'x-dogear-secret': SECRET,
};

test('server GET /file：虚拟路径反解读工作区真实文件', async () => {
  const { configDir, wsRoot } = await makeTempData();
  try {
    await fsp.writeFile(path.join(wsRoot, '.dogear', 'tasks.json'), '{"version":3,"tasks":[]}');
    const server = await startTestServer(configDir);
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/file?path=${encodeURIComponent(TASKS_REL)}`, { headers: authHeaders });
      expect(res.status).toBe(200);
      const body = gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf-8');
      expect(body).toBe('{"version":3,"tasks":[]}');
    } finally {
      await closeServer(server);
    }
  } finally {
    await cleanup([configDir, wsRoot]);
  }
});

test('server POST /file：虚拟条目经 guard 白名单反解落工作区；未注册 wsid 403', async () => {
  const { configDir, wsRoot } = await makeTempData();
  try {
    const server = await startTestServer(configDir);
    try {
      expect((await pushFile(server, TASKS_REL, '{"version":3,"tasks":[{"id":"a"}]}')).status).toBe(200);
      await expect(fsp.readFile(path.join(wsRoot, '.dogear', 'tasks.json'), 'utf-8')).resolves.toBe('{"version":3,"tasks":[{"id":"a"}]}');
      expect((await pushFile(server, '__ws-external__/ghost-ws/.dogear/tasks.json', '{}')).status).toBe(403);
      expect((await pushFile(server, '__ws-external__/ws-a/.dogear/../../evil.txt', 'evil')).status).toBe(403);
      await expect(fsp.access(path.join(configDir, '__ws-external__'))).rejects.toThrow();
    } finally {
      await closeServer(server);
    }
  } finally {
    await cleanup([configDir, wsRoot]);
  }
});

test('server POST /file：userSyncPaths 勾选子树放行，勾选树外拒绝', async () => {
  const { configDir, wsRoot } = await makeTempData();
  try {
    await fsp.mkdir(path.join(wsRoot, 'docs'), { recursive: true });
    const server = await startTestServer(configDir, { 'ws-a': ['docs'] });
    try {
      expect((await pushFile(server, '__ws-external__/ws-a/docs/p.md', 'plan')).status).toBe(200);
      await expect(fsp.readFile(path.join(wsRoot, 'docs', 'p.md'), 'utf-8')).resolves.toBe('plan');
      expect((await pushFile(server, '__ws-external__/ws-a/secret.txt', 's')).status).toBe(403);
    } finally {
      await closeServer(server);
    }
  } finally {
    await cleanup([configDir, wsRoot]);
  }
});

test('server DELETE /file：虚拟条目反解删除工作区真实文件（hash 未改才删）', async () => {
  const { configDir, wsRoot } = await makeTempData();
  try {
    const tasksAbs = path.join(wsRoot, '.dogear', 'tasks.json');
    await fsp.writeFile(tasksAbs, '{"version":3,"tasks":[]}');
    const hash = await sha256File(tasksAbs);
    const server = await startTestServer(configDir);
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/file`, {
        method: 'DELETE',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ relPath: TASKS_REL, expectedHash: hash }),
      });
      expect(res.status).toBe(200);
      await expect(fsp.access(tasksAbs)).rejects.toThrow();
    } finally {
      await closeServer(server);
    }
  } finally {
    await cleanup([configDir, wsRoot]);
  }
});

test('server POST /file：disabledSyncItems 关闭 tasks 时虚拟 tasks 条目 403', async () => {
  const { configDir, wsRoot } = await makeTempData();
  try {
    const server = await startSyncServer({
      port: 0,
      dataDir: configDir,
      getSelfHello: () => ({ appId: 'dogear', protocolVersion: 4, appVersion: 'test', deviceId: 'self-device-1' }),
      getManifestOptions: async () => ({
        excludes: excludesFromSyncOptions({ disabledSyncItems: ['tasks'] }),
      }),
      handlePairRequest: async () => ({ accepted: false }),
      authorizeRequest: async (req) => {
        const deviceId = req.headers['x-dogear-device-id'];
        const secret = req.headers['x-dogear-secret'];
        if (deviceId === PEER_ID && secret === SECRET) return { ok: true, deviceId: PEER_ID };
        return { ok: false };
      },
    });
    try {
      const meta = Buffer.from(JSON.stringify({ relPath: TASKS_REL, size: 2, mtimeMs: 1 })).toString('base64');
      const res = await fetch(`http://127.0.0.1:${server.port}/file`, {
        method: 'POST',
        headers: { ...authHeaders, 'x-dogear-file-meta': meta, 'content-type': 'application/octet-stream' },
        body: gzipSync(Buffer.from('{}')),
      });
      expect(res.status).toBe(403);
      expect(((await res.json()) as { error?: string }).error).toContain('已排除');
    } finally {
      await closeServer(server);
    }
  } finally {
    await cleanup([configDir, wsRoot]);
  }
});
