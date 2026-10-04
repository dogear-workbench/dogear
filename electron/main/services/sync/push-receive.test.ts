import { test, expect, mock, afterAll } from 'bun:test';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';

// server.ts 静态 import 链（→ apply/settings-service/sync-state）顶层拉进 electron 的命名导入，
// bun test 下 CJS interop 无 'app' 命名导出会炸；先 mock 再动态加载（同 exclude.test.ts）
mock.module('electron', () => ({
  default: { app: { getPath: () => tmpdir() }, nativeTheme: {} },
  app: { getPath: () => tmpdir() },
  nativeTheme: {},
}));

const PEER_ID = 'peer-device-1';
const SECRET = 'b'.repeat(64);

const dataDir = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-push-data-'));
await fsp.writeFile(
  path.join(dataDir, 'sync-state.json'),
  JSON.stringify({
    version: 1,
    peers: {
      [PEER_ID]: {
        deviceId: PEER_ID,
        lastSyncAt: 0,
        workspaceMap: {
          'ws-open': { enabled: true },
          'ws-paused': { enabled: false },
        },
      },
    },
  }),
);

const { startSyncServer } = await import('./server.js');
const { excludesFromSyncOptions } = await import('./manifest.js');

// authorize 与 state 读写全部走注入（bun test 全套并发时其他文件会临时改 DOGEAR_CONFIG_DIR，
// 进程级 env 不可依赖），本文件对 env 零依赖
const server = await startSyncServer({
  port: 0,
  dataDir,
  getSelfHello: () => ({ appId: 'dogear', protocolVersion: 2, appVersion: 'test', deviceId: 'self-device-1' }),
  getManifestOptions: async () => ({
    excludes: excludesFromSyncOptions({
      deviceName: 'receiver',
      syncStocksData: false,
      syncFeishu: false,
      pairedDevices: [],
      disabledSyncItems: ['usage'],
      syncConflictCopies: false,
      syncShadowGit: false,
      syncOptionsRev: 0,
    }),
  }),
  handlePairRequest: async () => ({ accepted: false }),
  authorizeRequest: async (req) => {
    const deviceId = req.headers['x-dogear-device-id'];
    const secret = req.headers['x-dogear-secret'];
    if (deviceId === PEER_ID && secret === SECRET) return { ok: true, deviceId: PEER_ID };
    return { ok: false };
  },
});
const base = `http://127.0.0.1:${server.port}`;

function push(relPath: string): Promise<Response> {
  const meta = Buffer.from(JSON.stringify({ relPath, size: 7, mtimeMs: 123 })).toString('base64');
  return fetch(`${base}/file`, {
    method: 'POST',
    headers: {
      'x-dogear-device-id': PEER_ID,
      'x-dogear-secret': SECRET,
      'x-dogear-file-meta': meta,
      'content-type': 'application/octet-stream',
    },
    body: gzipSync(Buffer.from('content')),
  });
}

test('enabled 映射的工作区推送正常落盘', async () => {
  const res = await push('workspaces/ws-open/notes/a.md');
  expect(res.status).toBe(200);
  await expect(fsp.readFile(path.join(dataDir, 'workspaces/ws-open/notes/a.md'), 'utf-8')).resolves.toBe('content');
});

test('conversations.json 推送 → 落盘重写记录内 wsid 为本机（宿主）wsid', async () => {
  const relPath = 'workspaces/ws-open/conversations.json';
  const body = JSON.stringify({
    version: 2,
    conversations: {
      c1: { id: 'c1', workspaceId: 'ws-peer-machine', updatedAt: '2026-10-04T10:00:00.000Z' },
    },
  });
  const meta = Buffer.from(JSON.stringify({ relPath, size: body.length, mtimeMs: 123 })).toString('base64');
  const res = await fetch(`${base}/file`, {
    method: 'POST',
    headers: {
      'x-dogear-device-id': PEER_ID,
      'x-dogear-secret': SECRET,
      'x-dogear-file-meta': meta,
      'content-type': 'application/octet-stream',
    },
    body: gzipSync(Buffer.from(body)),
  });
  expect(res.status).toBe(200);
  const parsed = JSON.parse(await fsp.readFile(path.join(dataDir, relPath), 'utf-8')) as {
    conversations: Record<string, { workspaceId?: string }>;
  };
  expect(parsed.conversations.c1.workspaceId).toBe('ws-open');
});

test('全局数据推送正常落盘', async () => {
  const res = await push('plans.json');
  expect(res.status).toBe(200);
  await expect(fsp.readFile(path.join(dataDir, 'plans.json'), 'utf-8')).resolves.toBe('content');
});

test('暂停（disabled）工作区被推 → 403 拒绝且不落盘', async () => {
  const res = await push('workspaces/ws-paused/notes/a.md');
  expect(res.status).toBe(403);
  const body = (await res.json()) as { error?: string };
  expect(body.error).toContain('未启用同步');
  await expect(fsp.access(path.join(dataDir, 'workspaces/ws-paused'))).rejects.toThrow();
});

test('未映射工作区被推 → 403 拒绝', async () => {
  const res = await push('workspaces/ws-unknown/notes/a.md');
  expect(res.status).toBe(403);
});

test('禁写路径被推 → 403 拒绝（sync-state.json / login-accounts.json / backups/）', async () => {
  const stateBefore = await fsp.readFile(path.join(dataDir, 'sync-state.json'), 'utf-8');
  for (const rel of ['sync-state.json', 'login-accounts.json', 'backups/app-config/zip-1.zip']) {
    const res = await push(rel);
    expect(res.status).toBe(403);
  }
  // sync-state.json 是引擎自身状态文件（本就存在），断言内容未被对端覆盖而非不存在
  await expect(fsp.readFile(path.join(dataDir, 'sync-state.json'), 'utf-8')).resolves.toBe(stateBefore);
  await expect(fsp.access(path.join(dataDir, 'login-accounts.json'))).rejects.toThrow();
  await expect(fsp.access(path.join(dataDir, 'backups'))).rejects.toThrow();
});

test('本端范围排除的路径被推 → 403 拒绝（disabledSyncItems / 默认排除副本）', async () => {
  expect((await push('usage/stats.json')).status).toBe(403);
  expect((await push('plans.json.conflict-4cc497-20261001-120000-ab12')).status).toBe(403);
});

afterAll(async () => {
  // keep-alive 空闲连接会让 close 挂住（server.close 内部已断空闲连接，race 兜底防 hang）
  await Promise.race([server.close(), new Promise((resolve) => setTimeout(resolve, 3000))]);
  await fsp.rm(dataDir, { recursive: true, force: true });
});
