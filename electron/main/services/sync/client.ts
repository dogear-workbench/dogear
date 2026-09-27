import { createGzip } from 'node:zlib';
import { Readable } from 'node:stream';
import {
  AuthHeaders,
  FilePullRequestSchema,
  HandshakeHelloSchema,
  ManifestResponseBodySchema,
  PairResponseBodySchema,
  type FilePushMeta,
  type HandshakeHello,
  type ManifestResponseBody,
} from './protocol.js';

export interface PeerEndpoint {
  host: string;
  port: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const FILE_TIMEOUT_MS = 300_000;

function peerUrl(peer: PeerEndpoint, pathname: string, query?: string): string {
  const host = peer.host.includes(':') ? `[${peer.host}]` : peer.host;
  return `http://${host}:${peer.port}${pathname}${query ? `?${query}` : ''}`;
}

function authHeaders(deviceId: string, secret: string): Record<string, string> {
  return { [AuthHeaders.deviceId]: deviceId, [AuthHeaders.secret]: secret };
}

export async function fetchPeerInfo(peer: PeerEndpoint): Promise<HandshakeHello> {
  const res = await fetch(peerUrl(peer, '/info'), { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`GET /info HTTP ${res.status}`);
  return HandshakeHelloSchema.parse(await res.json());
}

export async function sendPairRequest(
  peer: PeerEndpoint,
  hello: HandshakeHello,
  code: string,
  timeoutMs = 150_000,
): Promise<{ accepted: boolean; secret?: string; reason?: string; peerHello?: HandshakeHello }> {
  const res = await fetch(peerUrl(peer, '/pair-request'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hello, code }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = PairResponseBodySchema.safeParse(await res.json().catch(() => null));
  if (!body.success) throw new Error(`POST /pair-request HTTP ${res.status} 响应不合法`);
  return {
    accepted: body.data.accepted && res.ok,
    secret: body.data.secret,
    reason: body.data.reason,
    peerHello: body.data.hello,
  };
}

export async function fetchManifest(
  peer: PeerEndpoint,
  auth: { deviceId: string; secret: string },
  hello: HandshakeHello,
  entries: { relPath: string; size: number; mtimeMs: number }[],
  timeoutMs = 120_000,
): Promise<ManifestResponseBody> {
  const res = await fetch(peerUrl(peer, '/manifest'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeaders(auth.deviceId, auth.secret) },
    body: JSON.stringify({ hello, entries }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST /manifest HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
  return ManifestResponseBodySchema.parse(await res.json());
}

export async function pullFile(
  peer: PeerEndpoint,
  auth: { deviceId: string; secret: string },
  relPath: string,
): Promise<Readable> {
  const parsed = FilePullRequestSchema.safeParse({ relPath });
  if (!parsed.success) throw new Error(`unsafe relPath: ${relPath}`);
  const res = await fetch(peerUrl(peer, '/file', `path=${encodeURIComponent(relPath)}`), {
    headers: authHeaders(auth.deviceId, auth.secret),
    signal: AbortSignal.timeout(FILE_TIMEOUT_MS),
  });
  if (!res.ok || !res.body) {
    const text = res.body ? await res.text().catch(() => '') : '';
    throw new Error(`GET /file HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
  // 线上协议恒为 gzip，解压统一在落盘边界（writeIncomingFile）
  return Readable.fromWeb(res.body as import('stream/web').ReadableStream);
}

export async function pushFile(
  peer: PeerEndpoint,
  auth: { deviceId: string; secret: string },
  meta: FilePushMeta,
  source: Readable,
): Promise<void> {
  const gzip = createGzip();
  source.on('error', (error) => gzip.destroy(error));
  const body = Readable.toWeb(source.pipe(gzip)) as import('stream/web').ReadableStream;
  const res = await fetch(peerUrl(peer, '/file'), {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'x-dogear-content-encoding': 'gzip',
      [AuthHeaders.fileMeta]: Buffer.from(JSON.stringify(meta)).toString('base64'),
      ...authHeaders(auth.deviceId, auth.secret),
    },
    body: body as unknown as NonNullable<RequestInit['body']>,
    duplex: 'half',
    signal: AbortSignal.timeout(FILE_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST /file HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
}
