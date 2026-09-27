import fsp from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { FilePushMeta } from './protocol.js';

const INCOMING_SUFFIX = '.dogear-incoming';

export function resolveWithinDataDir(dataDir: string, relPath: string): string | null {
  if (relPath.includes('\\') || relPath.startsWith('/')) return null;
  if (!relPath.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..')) return null;
  const abs = path.resolve(dataDir, relPath);
  const base = path.resolve(dataDir);
  return abs.startsWith(base + path.sep) ? abs : null;
}

export interface IncomingWriteResult {
  ok: true;
  absPath: string;
  bytesWritten: number;
}

export interface IncomingWriteError {
  ok: false;
  reason: string;
}

export async function writeIncomingFile(
  dataDir: string,
  meta: FilePushMeta,
  source: Readable,
): Promise<IncomingWriteResult | IncomingWriteError> {
  const absPath = resolveWithinDataDir(dataDir, meta.relPath);
  if (!absPath) return { ok: false, reason: 'unsafe path' };
  const tmpPath = `${absPath}.${Date.now().toString(36)}${INCOMING_SUFFIX}`;
  try {
    await fsp.mkdir(path.dirname(absPath), { recursive: true });
    await pipeline(source, createGunzip(), createWriteStream(tmpPath));
    const st = await fsp.stat(tmpPath);
    await fsp.utimes(tmpPath, new Date(meta.mtimeMs), new Date(meta.mtimeMs));
    await fsp.rename(tmpPath, absPath);
    return { ok: true, absPath, bytesWritten: st.size };
  } catch (error) {
    await fsp.unlink(tmpPath).catch(() => {});
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}
