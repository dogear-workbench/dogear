import http from 'node:http';
import { createGzip } from 'node:zlib';
import { createReadStream } from 'node:fs';
import fsp from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import {
  AuthHeaders,
  FileDeleteRequestSchema,
  FilePushMetaSchema,
  FilePullRequestSchema,
  HandshakeHelloSchema,
  ManifestRequestBodySchema,
  PairRequestBodySchema,
  SYNC_PROTOCOL_VERSION,
  type HandshakeHello,
  type PairRequestBody,
} from './protocol.js';
export { DEFAULT_SYNC_PORT } from './protocol.js';
import { buildManifest, hashEntries, sha256File, tombstoneCandidates, type ManifestOptions } from './manifest.js';
import { EXTERNAL_ANCHOR_PREFIX } from '../data-registry.js';
import {
  resolveIncomingRelPath,
  writeIncomingFile,
  writeIncomingConversationsNormalized,
  isConversationsRelPath,
  mergeIncomingSettings,
} from './apply.js';
import { checkIncomingPushRelPath } from './push-guard.js';
import { isMemorySyncRelPath, scheduleMemoryRepair } from '../memory/memory-maintenance.js';
import { mergeTombstones, readSyncStateFrom, withSyncStateLock, writeSyncStateTo, type TombstoneMap } from './sync-state.js';
import { externalWorkspaceIndex } from '../data-registry.js';
import {
  buildWorkspaceMapContext,
  collectWorkspaceMeta,
  enabledWorkspaceIdsOf,
  learnReverseWorkspaceMap,
  listLocalWorkspaceIds,
  toLocalView,
} from './workspace-map.js';

export type AuthCheck = (req: http.IncomingMessage) => Promise<{ ok: true; deviceId: string } | { ok: false }>;

export interface SyncServerOptions {
  port: number;
  dataDir: string;
  getSelfHello(): HandshakeHello;
  /** per-peer 清单选项：requesterDeviceId 用于按该对端的映射表过滤 workspaces/ 目录 */
  getManifestOptions(requesterDeviceId: string): Promise<ManifestOptions>;
  handlePairRequest(
    hello: HandshakeHello,
    code: string,
    source: { host: string; listenPort?: number },
  ): Promise<{ accepted: boolean; reason?: string; secret?: string }>;
  /** 配对校验；缺省按 settings.syncOptions.pairedDevices 比对请求头（测试可注入替代实现隔离进程级 env） */
  authorizeRequest?: AuthCheck;
}

export interface RunningSyncServer {
  port: number;
  close(): Promise<void>;
}

const MAX_JSON_BODY = 16 * 1024 * 1024;
const MAX_FILE_BODY = 512 * 1024 * 1024;

function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a.toLowerCase(), 'utf-8');
  const bufB = Buffer.from(b.toLowerCase(), 'utf-8');
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

export async function startSyncServer(opts: SyncServerOptions): Promise<RunningSyncServer> {
  const server = http.createServer((req, res) => {
    handleRequest(req, res, opts).catch((error) => {
      console.error('[lan-sync] 请求处理异常:', error);
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
      else res.destroy();
    });
  });

  server.on('error', (error) => {
    console.error('[lan-sync] HTTP 服务错误:', error);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, '0.0.0.0', () => resolve());
  });

  const address = server.address() as AddressInfo;

  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve) => {
        // 先断 keep-alive 连接再 close（Bun 下 closeIdleConnections 不生效，客户端连接池持连接时 close 永不完成）
        server.closeIdleConnections?.();
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

async function authorize(req: http.IncomingMessage): Promise<{ ok: true; deviceId: string } | { ok: false }> {
  const deviceId = req.headers[AuthHeaders.deviceId];
  const secret = req.headers[AuthHeaders.secret];
  if (typeof deviceId !== 'string' || typeof secret !== 'string') return { ok: false };
  const { loadSettings } = await import('../settings-service.js');
  const settings = await loadSettings();
  const paired = settings.syncOptions?.pairedDevices.find((d) => d.deviceId === deviceId);
  if (!paired) return { ok: false };
  return secretsMatch(paired.secret, secret) ? { ok: true, deviceId } : { ok: false };
}
/** /info、/pair-request 等未授权端点返回的 hello 剥离本机路径 */
function publicHello(hello: HandshakeHello): HandshakeHello {
  if (hello.dataDirPath === undefined) return hello;
  const { dataDirPath: _strip, ...rest } = hello;
  return rest;
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: SyncServerOptions,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const route = `${req.method} ${url.pathname}`;

  if (route === `GET /info`) {
    // 未授权端点：剥离 dataDirPath（本机路径不向未配对探测泄露）
    sendJson(res, 200, publicHello(opts.getSelfHello()));
    return;
  }

  if (route === `POST /pair-request`) {
    await handlePairRequest(req, res, opts);
    return;
  }

  if (!(await (opts.authorizeRequest ?? authorize)(req)).ok) {
    sendJson(res, 401, { error: 'unpaired device' });
    return;
  }

  switch (route) {
    case 'POST /manifest':
      await handleManifest(req, res, opts);
      return;
    case 'GET /file':
      await handleFilePull(url, res, opts);
      return;
    case 'POST /file':
      await handleFilePush(req, res, opts);
      return;
    case 'DELETE /file':
      await handleFileDelete(req, res, opts);
      return;
    default:
      sendJson(res, 404, { error: 'not found' });
  }
}

async function handlePairRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: SyncServerOptions,
): Promise<void> {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'method not allowed' });
    return;
  }
  let raw: PairRequestBody;
  try {
    raw = PairRequestBodySchema.parse(JSON.parse((await readBody(req, 64 * 1024)).toString('utf-8')));
  } catch (error) {
    sendJson(res, 400, { error: `invalid pair request: ${error instanceof Error ? error.message : String(error)}` });
    return;
  }
  const result = await opts.handlePairRequest(raw.hello, raw.code, {
    host: (req.socket.remoteAddress ?? '').replace(/^::ffff:/, ''),
    listenPort: raw.listenPort,
  });
  if (!result.accepted) {
    sendJson(res, 403, { accepted: false, reason: result.reason ?? 'rejected', hello: publicHello(opts.getSelfHello()) });
    return;
  }
  sendJson(res, 200, { accepted: true, secret: result.secret, hello: publicHello(opts.getSelfHello()) });
}

async function handleManifest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: SyncServerOptions,
): Promise<void> {
  const auth = await (opts.authorizeRequest ?? authorize)(req);
  if (!auth.ok) {
    sendJson(res, 401, { error: 'unpaired device' });
    return;
  }
  let body;
  try {
    body = ManifestRequestBodySchema.parse(JSON.parse((await readBody(req, MAX_JSON_BODY)).toString('utf-8')));
  } catch (error) {
    sendJson(res, 400, { error: `invalid manifest request: ${error instanceof Error ? error.message : String(error)}` });
    return;
  }
  // 按请求者的映射表过滤 workspaces/：未映射（未启用）的本端工作区目录不出现在清单里。
  // 同时用请求方携带的 workspaceMap 做反向学习（映射只在一端配一次；已存在不覆盖，学到的映射下轮生效）。
  // state 读改写入锁（F5）：与主动同步收尾写、UI 映射写互斥；锁内快照经返回值出锁后使用
  const { peerMap, ignoredRemoteWorkspaces, peerLastManifest, historyTombstones, selfDeviceId } =
    await withSyncStateLock(opts.dataDir, async () => {
      const state = await readSyncStateFrom(opts.dataDir);
      const peerEntry = state.peers[auth.deviceId] ?? { deviceId: auth.deviceId, lastSyncAt: 0 };
      state.peers[auth.deviceId] = peerEntry;
      if (body.workspaceMap) {
        const learned = learnReverseWorkspaceMap(
          state,
          auth.deviceId,
          body.workspaceMap,
          await listLocalWorkspaceIds(opts.dataDir),
        );
        if (learned > 0) await writeSyncStateTo(opts.dataDir, state);
      }
      return {
        peerMap: peerEntry.workspaceMap,
        ignoredRemoteWorkspaces: peerEntry.ignoredRemoteWorkspaces,
        peerLastManifest: peerEntry.lastManifest,
        historyTombstones: state.tombstones,
        selfDeviceId: state.deviceId,
      };
    });
  const manifestOptions = {
    ...(await opts.getManifestOptions(auth.deviceId)),
    enabledWorkspaceIds: enabledWorkspaceIdsOf(peerMap),
  };
  let local = await buildManifest(opts.dataDir, manifestOptions);
  // 响应侧版本 gating：旧版本请求方不认识 __ws-external__ 语义，若收进清单会把它当普通路径
  // 落到 configDir 下成垃圾目录，故按请求方 hello.protocolVersion 过滤虚拟路径条目
  if (body.hello.protocolVersion < SYNC_PROTOCOL_VERSION) {
    const virtualPrefix = `${EXTERNAL_ANCHOR_PREFIX}/`;
    local = local.filter((e) => !e.relPath.startsWith(virtualPrefix));
  }
  // 被动端墓碑生成：本端实时清单 vs 对该请求方的基线——基线有、现无 = 本端（被动期间）发生过删除。
  // 被动端不跑 orchestrator 收尾，这是删除事实落盘的唯一时机；与历史墓碑合并后随响应携回请求方
  const freshDeletes = tombstoneCandidates(peerLastManifest ?? [], local, {
    excludes: manifestOptions.excludes,
    enabledWorkspaceIds: manifestOptions.enabledWorkspaceIds,
  });
  let responseTombstones: TombstoneMap = historyTombstones ?? {};
  if (freshDeletes.length > 0) {
    responseTombstones = await withSyncStateLock(opts.dataDir, async () => {
      const state = await readSyncStateFrom(opts.dataDir);
      const merged = mergeTombstones(
        state.tombstones,
        freshDeletes.map((relPath) => ({ relPath, deviceId: selfDeviceId ?? 'unknown' })),
      );
      state.tombstones = merged;
      await writeSyncStateTo(opts.dataDir, state);
      return merged;
    });
  }
  const localMap = new Map(local.map((e) => [e.relPath, e]));
  // 请求条目是请求方视角路径（请求方已按它自己的映射折算过），需按本端映射折算回本端路径才能匹配：
  // 双方各自用同一映射对（本端 wsid ↔ 请求方 wsid）的本地视角，同一路径两段名不同。
  // candidateHashes 仍按本端路径为键（与本端 entries 一致，请求方按对端原路径回查）
  const bodyCtx = buildWorkspaceMapContext(
    peerMap,
    ignoredRemoteWorkspaces,
    opts.dataDir,
    body.hello.dataDirPath,
  );
  const candidates = body.entries
    .map((e) => {
      const v = toLocalView(bodyCtx, e.relPath);
      return localMap.get(v.kind === 'map' ? v.localRelPath : e.relPath);
    })
    .filter((e): e is NonNullable<typeof e> => !!e);
  const candidateHashes = (await hashEntries(opts.dataDir, candidates)).map((e) => ({
    relPath: e.relPath,
    hash: e.hash,
  }));
  sendJson(res, 200, {
    hello: opts.getSelfHello(),
    entries: local,
    candidateHashes,
    workspaceMap: peerMap,
    workspaceMeta: await collectWorkspaceMeta(opts.dataDir),
    ...(Object.keys(responseTombstones).length > 0 ? { tombstones: responseTombstones } : {}),
  });
}

async function handleFilePull(
  url: URL,
  res: http.ServerResponse,
  opts: SyncServerOptions,
): Promise<void> {
  const parsed = FilePullRequestSchema.safeParse({ relPath: url.searchParams.get('path') ?? '' });
  if (!parsed.success) {
    sendJson(res, 400, { error: 'invalid path' });
    return;
  }
  const absPath = await resolveIncomingRelPath(opts.dataDir, parsed.data.relPath);
  if (!absPath) {
    sendJson(res, 403, { error: 'unsafe path' });
    return;
  }
  let stat;
  try {
    stat = await fsp.stat(absPath);
  } catch {
    sendJson(res, 404, { error: 'file not found' });
    return;
  }
  if (!stat.isFile()) {
    sendJson(res, 400, { error: 'not a regular file' });
    return;
  }
  res.writeHead(200, {
    'content-type': 'application/octet-stream',
    // 自定义头而非标准 content-encoding：undici 等 fetch 实现会对后者自动解压，破坏客户端侧手动 gunzip
    'x-dogear-content-encoding': 'gzip',
    [AuthHeaders.fileMeta]: Buffer.from(
      JSON.stringify({ relPath: parsed.data.relPath, size: stat.size, mtimeMs: stat.mtimeMs }),
    ).toString('base64'),
  });
  const stream = createReadStream(absPath);
  const gzip = createGzip();
  stream.on('error', (error) => {
    console.error('[lan-sync] 读文件失败:', error);
    res.destroy();
  });
  gzip.on('error', (error) => {
    console.error('[lan-sync] gzip 失败:', error);
    res.destroy();
  });
  stream.pipe(gzip).pipe(res);
}

async function handleFilePush(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: SyncServerOptions,
): Promise<void> {
  const auth = await (opts.authorizeRequest ?? authorize)(req);
  if (!auth.ok) {
    sendJson(res, 401, { error: 'unpaired device' });
    return;
  }
  const metaRaw = req.headers[AuthHeaders.fileMeta];
  if (typeof metaRaw !== 'string') {
    sendJson(res, 400, { error: 'missing file meta header' });
    return;
  }
  let meta;
  try {
    meta = FilePushMetaSchema.parse(JSON.parse(Buffer.from(metaRaw, 'base64').toString('utf-8')));
  } catch (error) {
    sendJson(res, 400, { error: `invalid file meta: ${error instanceof Error ? error.message : String(error)}` });
    return;
  }
  // 落盘前过与 pull 侧 applyIncoming 对称的校验（D1/S1）：禁写清单 + 本端范围排除 + 工作区映射 enabled，
  // 挡住对端推入被暂停/未映射工作区、已排除路径与 sync-state 等引擎状态
  const [manifestOptions, state, registeredIds] = await Promise.all([
    opts.getManifestOptions(auth.deviceId),
    readSyncStateFrom(opts.dataDir),
    externalWorkspaceIndex(opts.dataDir).then((m) => new Set(m.keys())),
  ]);
  const verdict = checkIncomingPushRelPath(meta.relPath, {
    excludes: manifestOptions.excludes,
    workspaceMap: state.peers[auth.deviceId]?.workspaceMap,
    registeredWorkspaceIds: registeredIds,
    userSyncPaths: manifestOptions.userSyncPaths,
  });
  if (!verdict.ok) {
    sendJson(res, verdict.status, { error: verdict.reason });
    return;
  }
  // settings.json 双端都是字段级合并落盘（拉取端在 applyIncoming，推送端在此），否则配对信息随整文件覆盖互丢；
  // push 端基线读/写回在 mergeIncomingSettings 内部锁内完成
  if (meta.relPath === 'settings.json') {
    try {
      await mergeIncomingSettings(req, { dataDir: opts.dataDir, peerDeviceId: auth.deviceId });
    } catch (error) {
      sendJson(res, 400, { error: `merge settings failed: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }
    sendJson(res, 200, { ok: true, merged: true });
    return;
  }
  // conversations.json 直写前落地归一 wsid（与 pull 侧 applyMergedIncoming 同规则）：记录内 workspaceId
  // 是发送端机器视角，整文件落盘不重写会把本机所有会话绑到对端 wsid（Conversation not found 镜像面）
  const result = isConversationsRelPath(meta.relPath)
    ? await writeIncomingConversationsNormalized(opts.dataDir, meta, req)
    : await writeIncomingFile(opts.dataDir, meta, req);
  if (!result.ok) {
    sendJson(res, 400, { error: result.reason });
    return;
  }
  // memory 目录落盘后防抖对账修复（孤儿索引/垃圾文件，多文件连推合并一次）
  if (isMemorySyncRelPath(meta.relPath)) scheduleMemoryRepair(meta.relPath);
  sendJson(res, 200, { ok: true, bytesWritten: result.bytesWritten });
}

/**
 * 删除传播端点（v3）：请求方已删该文件（墓碑为证），本端文件 hash 与请求方基线一致（本端未改）才执行删除；
 * 改过 → 409 拒绝（请求方记删改冲突）；不存在 → 404（请求方视传播目标已达成）。
 * 校验链与 push 接收端对称（push-guard：禁写/敏感/排除/工作区开关）+ hash 二次校验防误删。
 * 删除后记本端墓碑（删除事实供其他对端传播）并从该请求方基线中移除条目（已收敛）。
 */
async function handleFileDelete(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: SyncServerOptions,
): Promise<void> {
  const auth = await (opts.authorizeRequest ?? authorize)(req);
  if (!auth.ok) {
    sendJson(res, 401, { error: 'unpaired device' });
    return;
  }
  let body;
  try {
    body = FileDeleteRequestSchema.parse(JSON.parse((await readBody(req, 64 * 1024)).toString('utf-8')));
  } catch (error) {
    sendJson(res, 400, { error: `invalid delete request: ${error instanceof Error ? error.message : String(error)}` });
    return;
  }
  const absPath = await resolveIncomingRelPath(opts.dataDir, body.relPath);
  if (!absPath) {
    sendJson(res, 403, { error: 'unsafe path' });
    return;
  }
  const [manifestOptions, state, registeredIds] = await Promise.all([
    opts.getManifestOptions(auth.deviceId),
    readSyncStateFrom(opts.dataDir),
    externalWorkspaceIndex(opts.dataDir).then((m) => new Set(m.keys())),
  ]);
  const verdict = checkIncomingPushRelPath(body.relPath, {
    excludes: manifestOptions.excludes,
    workspaceMap: state.peers[auth.deviceId]?.workspaceMap,
    registeredWorkspaceIds: registeredIds,
    userSyncPaths: manifestOptions.userSyncPaths,
  });
  if (!verdict.ok) {
    sendJson(res, verdict.status, { error: verdict.reason });
    return;
  }
  let st;
  try {
    st = await fsp.stat(absPath);
  } catch {
    sendJson(res, 404, { error: 'file not found' });
    return;
  }
  if (!st.isFile()) {
    sendJson(res, 400, { error: 'not a regular file' });
    return;
  }
  const actualHash = await sha256File(absPath);
  if (actualHash !== body.expectedHash) {
    sendJson(res, 409, { error: 'file modified on this device, delete rejected' });
    return;
  }
  try {
    await fsp.unlink(absPath);
  } catch (error) {
    sendJson(res, 500, { error: `delete failed: ${error instanceof Error ? error.message : String(error)}` });
    return;
  }
  await withSyncStateLock(opts.dataDir, async () => {
    const next = await readSyncStateFrom(opts.dataDir);
    next.tombstones = mergeTombstones(next.tombstones, [
      { relPath: body.relPath, deviceId: next.deviceId ?? 'unknown' },
    ]);
    const peer = next.peers[auth.deviceId];
    if (peer?.lastManifest) {
      peer.lastManifest = peer.lastManifest.filter((e) => e.relPath !== body.relPath);
    }
    await writeSyncStateTo(opts.dataDir, next);
  });
  sendJson(res, 200, { ok: true, deleted: true });
}
