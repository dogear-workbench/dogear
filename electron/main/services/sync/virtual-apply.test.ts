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

const { applyIncoming, pushOutgoing, matchMergePattern, resolveIncomingRelPath } = await import('./apply.js');
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
  return { configDir, wsRoot, wsUnregistered };
}

async function cleanup(dirs: string[]): Promise<void> {
  await Promise.all(dirs.map((d) => fsp.rm(d, { recursive: true, force: true })));
}

const gzipStreamOf = (text: string): Readable => Readable.from(gzipSync(Buffer.from(text, 'utf-8')));

const TASKS_REL = 'workspaces/ws-a/tasks.json';
const VDOC_REL = '__ws-external__/ws-a/docs/notes.json';
const RETIRED_TASKS_REL = '__ws-external__/ws-a/.dogear/tasks.json';
const RETIRED_ARTICLE_REL = '__ws-external__/ws-a/.dogear/articles/uuid-9/meta.json';

// ── matchMergePattern：tasks.json 实路径路由 ──

test('matchMergePattern：工作区 tasks.json 实路径命中合并；其余子树/退役声明/勾选子树不命中', () => {
  expect(matchMergePattern(TASKS_REL)).toBe(true);
  expect(matchMergePattern('workspaces/other-ws/tasks.json')).toBe(true);
  expect(matchMergePattern('workspaces/ws-a/notes/tasks.json')).toBe(false);
  expect(matchMergePattern('workspaces/ws-a/tasks.json.conflict-abc')).toBe(false);
  expect(matchMergePattern(RETIRED_TASKS_REL)).toBe(false);
  expect(matchMergePattern('__ws-external__/ws-a/docs/tasks.json')).toBe(false);
});

// ── applyIncoming：tasks.json 实路径条目级合并 ──

test('applyIncoming：工作区 tasks.json 条目级合并落 configDir 实路径，两端各增任务收敛', async () => {
  const { configDir } = await makeTempData();
  try {
    const local = { version: 3, tasks: [{ id: 't1', title: 'local', updatedAt: '2026-10-04T10:00:00Z' }] };
    const tasksAbs = path.join(configDir, 'workspaces', 'ws-a', 'tasks.json');
    await fsp.mkdir(path.dirname(tasksAbs), { recursive: true });
    await fsp.writeFile(tasksAbs, JSON.stringify(local));
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
    const merged = JSON.parse(await fsp.readFile(tasksAbs, 'utf-8')) as {
      version: number;
      tasks: Array<{ id: string }>;
    };
    expect(merged.version).toBe(3);
    expect(merged.tasks.map((t) => t.id).sort()).toEqual(['t1', 't2']);
    await expect(fsp.access(path.join(configDir, '__ws-external__'))).rejects.toThrow();
  } finally {
    await cleanup([configDir]);
  }
});

test('applyIncoming：本端无 tasks.json 时按对端内容直接落 configDir 实路径', async () => {
  const { configDir } = await makeTempData();
  try {
    const remote = { version: 3, tasks: [{ id: 't1', title: 'r' }] };
    const report = await applyIncoming(
      configDir,
      [{ entry: { relPath: TASKS_REL, size: 1, mtimeMs: 1 } }],
      () => Promise.resolve(gzipStreamOf(JSON.stringify(remote))),
    );
    expect(report.applied.map((e) => e.relPath)).toEqual([TASKS_REL]);
    const onDisk = JSON.parse(
      await fsp.readFile(path.join(configDir, 'workspaces', 'ws-a', 'tasks.json'), 'utf-8'),
    ) as typeof remote;
    expect(onDisk.tasks[0]?.id).toBe('t1');
  } finally {
    await cleanup([configDir]);
  }
});

// ── applyIncoming：虚拟条目（userSyncPaths 勾选子树）整文件落盘 ──

test('applyIncoming：虚拟条目落工作区真实路径并保持对端 mtime', async () => {
  const { configDir, wsRoot } = await makeTempData();
  try {
    const report = await applyIncoming(
      configDir,
      [{ entry: { relPath: VDOC_REL, size: 6, mtimeMs: 1700000000000 } }],
      () => Promise.resolve(gzipStreamOf('{"t":1}')),
    );
    expect(report.skipped).toEqual([]);
    expect(report.applied.map((e) => e.relPath)).toEqual([VDOC_REL]);
    const abs = path.join(wsRoot, 'docs', 'notes.json');
    await expect(fsp.readFile(abs, 'utf-8')).resolves.toBe('{"t":1}');
    const st = await fsp.stat(abs);
    expect(st.mtimeMs).toBe(1700000000000);
  } finally {
    await cleanup([configDir, wsRoot]);
  }
});

// ── applyIncoming：退役虚拟声明路径丢弃（过渡防线，不落旧位置孤儿）──

test('applyIncoming：退役 tasks/articles 声明条目直接丢弃，不写工作区旧位置', async () => {
  const { configDir, wsRoot } = await makeTempData();
  try {
    await fsp.mkdir(path.join(wsRoot, '.dogear'), { recursive: true });
    const report = await applyIncoming(
      configDir,
      [
        { entry: { relPath: RETIRED_TASKS_REL, size: 1, mtimeMs: 1 } },
        { entry: { relPath: RETIRED_ARTICLE_REL, size: 1, mtimeMs: 1 } },
      ],
      () => Promise.resolve(gzipStreamOf('{"version":3,"tasks":[]}')),
    );
    expect(report.applied).toEqual([]);
    expect(report.mergedFiles).toEqual([]);
    expect(report.skipped.map((s) => s.relPath).sort()).toEqual([RETIRED_ARTICLE_REL, RETIRED_TASKS_REL]);
    expect(report.skipped.every((s) => s.reason.includes('已排除'))).toBe(true);
    // sourceFactory 未被消费（无拉取请求），旧位置也不落任何文件
    await expect(fsp.access(path.join(wsRoot, '.dogear', 'tasks.json'))).rejects.toThrow();
    await expect(fsp.access(path.join(wsRoot, '.dogear', 'articles'))).rejects.toThrow();
  } finally {
    await cleanup([configDir, wsRoot]);
  }
});

// ── applyIncoming：未注册 wsid / 穿越路径 ──

test('applyIncoming：未注册 wsid 的虚拟条目 skipped，不落 configDir 垃圾目录', async () => {
  const { configDir, wsUnregistered } = await makeTempData();
  try {
    await fsp.mkdir(path.join(wsUnregistered, 'docs'), { recursive: true });
    await fsp.writeFile(path.join(wsUnregistered, 'docs', 'tasks.json'), '{"version":3,"tasks":[]}');
    const report = await applyIncoming(
      configDir,
      [{ entry: { relPath: '__ws-external__/ghost-ws/docs/tasks.json', size: 1, mtimeMs: 1 } }],
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
      [{ entry: { relPath: '__ws-external__/ws-a/docs/../../escape.txt', size: 1, mtimeMs: 1 } }],
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

// ── applyIncoming：冲突副本落同目录 ──

test('applyIncoming：显式裁决对端胜时 tasks.json 冲突副本落 configDir 同目录', async () => {
  const { configDir } = await makeTempData();
  try {
    const wsDir = path.join(configDir, 'workspaces', 'ws-a');
    await fsp.mkdir(wsDir, { recursive: true });
    await fsp.writeFile(path.join(wsDir, 'tasks.json'), '{"version":3,"tasks":[{"id":"t1"}]}');
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
    const copyName = (await fsp.readdir(wsDir)).find((n) => n.startsWith('tasks.json.conflict-abcdef-'));
    expect(copyName).toBeTruthy();
    const copy = JSON.parse(await fsp.readFile(path.join(wsDir, copyName!), 'utf-8')) as { tasks: Array<{ id: string }> };
    expect(copy.tasks.map((t) => t.id)).toEqual(['t1']);
    const main = JSON.parse(await fsp.readFile(path.join(wsDir, 'tasks.json'), 'utf-8')) as { tasks: Array<{ id: string }> };
    expect(main.tasks.map((t) => t.id)).toEqual(['t2']);
  } finally {
    await cleanup([configDir]);
  }
});

// ── pushOutgoing / hashEntries：虚拟条目读本端工作区真实路径 ──

test('pushOutgoing：虚拟条目从工作区真实路径读取推送', async () => {
  const { configDir, wsRoot } = await makeTempData();
  try {
    await fsp.mkdir(path.join(wsRoot, 'docs'), { recursive: true });
    await fsp.writeFile(path.join(wsRoot, 'docs', 'notes.json'), '{"id":"t9"}');
    const pushed: Array<{ relPath: string; body: string }> = [];
    const report = await pushOutgoing(
      configDir,
      [{ entry: { relPath: VDOC_REL, size: 1, mtimeMs: 1 } }],
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
    expect(pushed).toEqual([{ relPath: VDOC_REL, body: '{"id":"t9"}' }]);
  } finally {
    await cleanup([configDir, wsRoot]);
  }
});

test('hashEntries：虚拟条目 hash 等于真实文件内容 hash；未注册 wsid 跳过', async () => {
  const { configDir, wsRoot } = await makeTempData();
  try {
    await fsp.mkdir(path.join(wsRoot, 'docs'), { recursive: true });
    const body = '{"version":3,"tasks":[{"id":"t1"}]}';
    await fsp.writeFile(path.join(wsRoot, 'docs', 'notes.json'), body);
    const out = await hashEntries(configDir, [
      { relPath: VDOC_REL, size: body.length, mtimeMs: 1 },
      { relPath: '__ws-external__/ghost-ws/docs/notes.json', size: 1, mtimeMs: 1 },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.relPath).toBe(VDOC_REL);
    expect(out[0]?.hash).toBe(await sha256File(path.join(wsRoot, 'docs', 'notes.json')));
  } finally {
    await cleanup([configDir, wsRoot]);
  }
});

// ── applyPeerTombstones：实路径跟随删除 ──

test('applyPeerTombstones：tasks.json hash 与基线一致时删除实路径文件', async () => {
  const { configDir } = await makeTempData();
  try {
    const tasksAbs = path.join(configDir, 'workspaces', 'ws-a', 'tasks.json');
    await fsp.mkdir(path.dirname(tasksAbs), { recursive: true });
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
    await cleanup([configDir]);
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
    await fsp.mkdir(path.join(wsRoot, 'docs'), { recursive: true });
    await fsp.writeFile(path.join(wsRoot, 'docs', 'notes.json'), '{"ok":1}');
    const server = await startTestServer(configDir);
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/file?path=${encodeURIComponent(VDOC_REL)}`, { headers: authHeaders });
      expect(res.status).toBe(200);
      const body = gunzipSync(Buffer.from(await res.arrayBuffer())).toString('utf-8');
      expect(body).toBe('{"ok":1}');
    } finally {
      await closeServer(server);
    }
  } finally {
    await cleanup([configDir, wsRoot]);
  }
});

test('server POST /file：勾选子树经白名单反解落工作区；退役声明与未注册 wsid 403', async () => {
  const { configDir, wsRoot } = await makeTempData();
  try {
    const server = await startTestServer(configDir, { 'ws-a': ['docs'] });
    try {
      expect((await pushFile(server, VDOC_REL, '{"picked":true}')).status).toBe(200);
      await expect(fsp.readFile(path.join(wsRoot, 'docs', 'notes.json'), 'utf-8')).resolves.toBe('{"picked":true}');
      expect((await pushFile(server, RETIRED_TASKS_REL, '{"version":3,"tasks":[]}')).status).toBe(403);
      expect((await pushFile(server, '__ws-external__/ghost-ws/docs/notes.json', '{}')).status).toBe(403);
      expect((await pushFile(server, '__ws-external__/ws-a/docs/../../evil.txt', 'evil')).status).toBe(403);
      await expect(fsp.access(path.join(wsRoot, '.dogear', 'tasks.json'))).rejects.toThrow();
      await expect(fsp.access(path.join(configDir, '__ws-external__'))).rejects.toThrow();
    } finally {
      await closeServer(server);
    }
  } finally {
    await cleanup([configDir, wsRoot]);
  }
});

test('server POST /file：tasks.json 实路径落 configDir workspaces 子树', async () => {
  const { configDir } = await makeTempData();
  try {
    const server = await startTestServer(configDir);
    try {
      expect((await pushFile(server, TASKS_REL, '{"version":3,"tasks":[{"id":"a"}]}')).status).toBe(200);
      await expect(
        fsp.readFile(path.join(configDir, 'workspaces', 'ws-a', 'tasks.json'), 'utf-8'),
      ).resolves.toBe('{"version":3,"tasks":[{"id":"a"}]}');
    } finally {
      await closeServer(server);
    }
  } finally {
    await cleanup([configDir]);
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

test('server DELETE /file：勾选子树反解删除工作区真实文件（hash 未改才删）；退役声明 403', async () => {
  const { configDir, wsRoot } = await makeTempData();
  try {
    const docAbs = path.join(wsRoot, 'docs', 'notes.json');
    await fsp.mkdir(path.dirname(docAbs), { recursive: true });
    await fsp.writeFile(docAbs, '{"version":3,"tasks":[]}');
    const hash = await sha256File(docAbs);
    const server = await startTestServer(configDir, { 'ws-a': ['docs'] });
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/file`, {
        method: 'DELETE',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ relPath: VDOC_REL, expectedHash: hash }),
      });
      expect(res.status).toBe(200);
      await expect(fsp.access(docAbs)).rejects.toThrow();
      const retired = await fetch(`http://127.0.0.1:${server.port}/file`, {
        method: 'DELETE',
        headers: { ...authHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ relPath: RETIRED_TASKS_REL, expectedHash: 'a'.repeat(64) }),
      });
      expect(retired.status).toBe(403);
    } finally {
      await closeServer(server);
    }
  } finally {
    await cleanup([configDir, wsRoot]);
  }
});

test('server POST /file：disabledSyncItems 关闭 tasks 时工作区 tasks.json 403', async () => {
  const { configDir } = await makeTempData();
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
    await cleanup([configDir]);
  }
});

// ── resolveIncomingRelPath：revealSyncFile 定位语义（虚拟反解 / 未注册降级 / 普通限界）──

test('resolveIncomingRelPath：虚拟已注册反解真实路径；未注册 null；普通路径限 configDir；穿越拒绝', async () => {
  const { configDir, wsRoot, wsUnregistered } = await makeTempData();
  try {
    expect(await resolveIncomingRelPath(configDir, VDOC_REL)).toBe(path.join(wsRoot, 'docs', 'notes.json'));
    expect(await resolveIncomingRelPath(configDir, '__ws-external__/ghost-ws/docs/notes.json')).toBeNull();
    expect(await resolveIncomingRelPath(configDir, 'workspaces/ws-a/f.txt')).toBe(path.join(configDir, 'workspaces', 'ws-a', 'f.txt'));
    expect(await resolveIncomingRelPath(configDir, '../escape.json')).toBeNull();
    expect(await resolveIncomingRelPath(configDir, '__ws-external__/ws-a/docs/../../evil.txt')).toBeNull();
  } finally {
    await cleanup([configDir, wsRoot, wsUnregistered]);
  }
});
