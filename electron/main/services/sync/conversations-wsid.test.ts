import { test, expect, mock } from 'bun:test';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';

// server.ts 静态 import 链（→ apply/settings-service/sync-state）顶层拉进 electron 的命名导入，
// bun test 下 CJS interop 无 'app' 命名导出会炸；先 mock 再动态加载（同 exclude.test.ts）
mock.module('electron', () => ({
  default: { app: { getPath: () => tmpdir() }, nativeTheme: {} },
  app: { getPath: () => tmpdir() },
  nativeTheme: {},
}));

const { applyIncoming, writeIncomingConversationsNormalized } = await import('./apply.js');
import type { IncomingApplyItem } from './apply.js';

const HOST_WS = 'ws-host-572b';
const PEER_WS = 'ws-peer-db29';

function conversationsFile(entries: Record<string, unknown>): string {
  return JSON.stringify({ version: 2, conversations: entries });
}

async function readConversations(root: string, relPath: string): Promise<Record<string, { workspaceId?: string }>> {
  const raw = await fsp.readFile(path.join(root, relPath), 'utf-8');
  return (JSON.parse(raw) as { conversations: Record<string, { workspaceId?: string }> }).conversations;
}

test('applyIncoming 直落路径（本端无文件）：对端 wsid 全部重写为宿主 wsid', async () => {
  const root = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-wsid-'));
  const relPath = `workspaces/${HOST_WS}/conversations.json`;
  const body = conversationsFile({
    a: { id: 'a', workspaceId: PEER_WS, updatedAt: '2026-10-04T10:00:00.000Z' },
    b: { id: 'b', workspaceId: PEER_WS, updatedAt: '2026-10-04T11:00:00.000Z' },
  });
  const items: IncomingApplyItem[] = [{ entry: { relPath, size: body.length, mtimeMs: 123 } }];
  const r = await applyIncoming(root, items, async () => Readable.from(gzipSync(Buffer.from(body))));
  // 直落路径（本端无文件）计入 applied 而非 mergedFiles（与既有语义一致）
  expect(r.applied.map((e) => e.relPath)).toEqual([relPath]);
  expect(r.mergedFiles).toEqual([]);
  const convs = await readConversations(root, relPath);
  expect(convs.a.workspaceId).toBe(HOST_WS);
  expect(convs.b.workspaceId).toBe(HOST_WS);
  await fsp.rm(root, { recursive: true, force: true });
});

test('applyIncoming 合并路径：远端与本地条目（含存量脏 wsid）统一重写为宿主 wsid', async () => {
  const root = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-wsid-'));
  const relPath = `workspaces/${HOST_WS}/conversations.json`;
  const abs = path.join(root, relPath);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  // 本端文件：既有宿主 wsid 条目，也有历史同步污染的存量脏条目（对端视角 wsid）
  await fsp.writeFile(abs, conversationsFile({
    localClean: { id: 'localClean', workspaceId: HOST_WS, updatedAt: '2026-10-04T08:00:00.000Z' },
    localDirty: { id: 'localDirty', workspaceId: PEER_WS, updatedAt: '2026-10-04T08:00:00.000Z' },
    shared: { id: 'shared', workspaceId: PEER_WS, title: 'old', updatedAt: '2026-10-04T08:00:00.000Z' },
  }));
  const body = conversationsFile({
    remoteNew: { id: 'remoteNew', workspaceId: PEER_WS, updatedAt: '2026-10-04T12:00:00.000Z' },
    shared: { id: 'shared', workspaceId: PEER_WS, title: 'new', updatedAt: '2026-10-04T09:00:00.000Z' },
  });
  const items: IncomingApplyItem[] = [{ entry: { relPath, size: body.length, mtimeMs: 123 } }];
  const r = await applyIncoming(root, items, async () => Readable.from(gzipSync(Buffer.from(body))));
  expect(r.mergedFiles).toEqual([relPath]);
  const convs = await readConversations(root, relPath);
  // 并集保两侧条目 + 新者胜
  expect(Object.keys(convs).sort()).toEqual(['localClean', 'localDirty', 'remoteNew', 'shared']);
  expect(convs.shared.title).toBe('new');
  // 全部条目（含本端存量脏值）落地重写为宿主 wsid
  for (const conv of Object.values(convs)) {
    expect(conv.workspaceId).toBe(HOST_WS);
  }
  await fsp.rm(root, { recursive: true, force: true });
});

test('writeIncomingConversationsNormalized（push 直写路径）：gzip 解析重写落盘，损坏输入拒绝', async () => {
  const root = await fsp.mkdtemp(path.join(tmpdir(), 'dogear-wsid-'));
  const relPath = `workspaces/${HOST_WS}/conversations.json`;
  const body = conversationsFile({ a: { id: 'a', workspaceId: PEER_WS } });
  const ok = await writeIncomingConversationsNormalized(
    root,
    { relPath, size: body.length, mtimeMs: 456 },
    Readable.from(gzipSync(Buffer.from(body))),
  );
  expect(ok.ok).toBe(true);
  const convs = await readConversations(root, relPath);
  expect(convs.a.workspaceId).toBe(HOST_WS);

  const bad = await writeIncomingConversationsNormalized(
    root,
    { relPath: `workspaces/${HOST_WS}/conversations.json`, size: 5, mtimeMs: 1 },
    Readable.from(gzipSync(Buffer.from('not-json'))),
  );
  expect(bad.ok).toBe(false);
  // 损坏输入不落盘：文件内容保持上一轮归一结果
  expect((await readConversations(root, relPath)).a.workspaceId).toBe(HOST_WS);
  await fsp.rm(root, { recursive: true, force: true });
});
