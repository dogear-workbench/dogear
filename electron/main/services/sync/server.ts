import http from 'node:http';
import { createGzip } from 'node:zlib';
import { createReadStream } from 'node:fs';
import fsp from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import {
  AuthHeaders,
  FilePushMetaSchema,
  FilePullRequestSchema,
  HandshakeHelloSchema,
  ManifestRequestBodySchema,
  PairRequestBodySchema,
  type HandshakeHello,
  type PairRequestBody,
} from './protocol.js';
import { buildManifest, hashEntries, type ManifestOptions } from './manifest.js';
import { resolveWithinDataDir, writeIncomingFile } from './apply.js';

export interface SyncServerOptions {
  port: number;
  dataDir: string;
  getSelfHello(): HandshakeHello;
  getManifestOptions(): Promise<ManifestOptions>;
  handlePairRequest(hello: HandshakeHello, code: string): Promise<{ accepted: boolean; reason?: string; secret?: string }>;
}

/** 默认服务端口；占用时由启动方退避随机端口，实际端口以 mDNS 广播为准 */
export const DEFAULT_SYNC_PORT = 47210;

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
        server.close(() => resolve());
      }),
  };
}

async function authorize(req: http.IncomingMessage): Promise<boolean> {
  const deviceId = req.headers[AuthHeaders.deviceId];
  const secret = req.headers[AuthHeaders.secret];
  if (typeof deviceId !== 'string' || typeof secret !== 'string') return false;
  const { loadSettings } = await import('../settings-service.js');
  const settings = await loadSettings();
  const paired = settings.syncOptions?.pairedDevices.find((d) => d.deviceId === deviceId);
  if (!paired) return false;
  return secretsMatch(paired.secret, secret);
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: SyncServerOptions,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const route = `${req.method} ${url.pathname}`;

  if (route === `GET /info`) {
    sendJson(res, 200, opts.getSelfHello());
    return;
  }

  if (route === `POST /pair-request`) {
    await handlePairRequest(req, res, opts);
    return;
  }

  if (!(await authorize(req))) {
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
  const result = await opts.handlePairRequest(raw.hello, raw.code);
  if (!result.accepted) {
    sendJson(res, 403, { accepted: false, reason: result.reason ?? 'rejected', hello: opts.getSelfHello() });
    return;
  }
  sendJson(res, 200, { accepted: true, secret: result.secret, hello: opts.getSelfHello() });
}

async function handleManifest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  opts: SyncServerOptions,
): Promise<void> {
  let body;
  try {
    body = ManifestRequestBodySchema.parse(JSON.parse((await readBody(req, MAX_JSON_BODY)).toString('utf-8')));
  } catch (error) {
    sendJson(res, 400, { error: `invalid manifest request: ${error instanceof Error ? error.message : String(error)}` });
    return;
  }
  const manifestOptions = await opts.getManifestOptions();
  const local = await buildManifest(opts.dataDir, manifestOptions);
  const localMap = new Map(local.map((e) => [e.relPath, e]));
  const candidates = body.entries
    .map((e) => localMap.get(e.relPath))
    .filter((e): e is NonNullable<typeof e> => !!e);
  const candidateHashes = (await hashEntries(opts.dataDir, candidates)).map((e) => ({
    relPath: e.relPath,
    hash: e.hash,
  }));
  sendJson(res, 200, {
    hello: opts.getSelfHello(),
    entries: local,
    candidateHashes,
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
  const absPath = resolveWithinDataDir(opts.dataDir, parsed.data.relPath);
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
  const result = await writeIncomingFile(opts.dataDir, meta, req);
  if (!result.ok) {
    sendJson(res, 400, { error: result.reason });
    return;
  }
  sendJson(res, 200, { ok: true, bytesWritten: result.bytesWritten });
}
