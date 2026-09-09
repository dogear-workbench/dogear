import { app } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import AdmZip from 'adm-zip';
import { closeBrowserGateway } from './browser/browser-gateway.js';

export interface ManifestInfo {
  version: string;
  type: 'hotfix' | 'full';
  pubDate: string;
  hotfix?: {
    url: string;
    size: number;
    sha256: string;
  };
  full?: {
    url: string;
    size: number;
    sha256: string;
    blockmapUrl?: string;
  };
}

export interface CheckResult {
  hasUpdate: boolean;
  type?: 'hotfix' | 'full';
  info?: ManifestInfo;
  error?: string;
}

export type ProgressCallback = (percent: number, transferred: number, total: number) => void;

export function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const a = parts1[i] || 0;
    const b = parts2[i] || 0;
    if (a > b) return 1;
    if (a < b) return -1;
  }
  return 0;
}

export async function checkForUpdates(serverUrl: string): Promise<CheckResult> {
  const url = `${serverUrl.replace(/\/$/, '')}/manifest.json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`获取 manifest 失败: ${res.status} ${res.statusText}`);
  }
  const manifest = (await res.json()) as ManifestInfo;
  const currentVersion = app.getVersion();
  const hasUpdate = compareVersions(manifest.version, currentVersion) > 0;
  return {
    hasUpdate,
    type: hasUpdate ? manifest.type : undefined,
    info: hasUpdate ? manifest : undefined,
  };
}

async function downloadFile(
  url: string,
  destPath: string,
  onProgress?: ProgressCallback,
): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`下载失败: ${res.status} ${res.statusText}`);
  }

  const total = Number(res.headers.get('content-length') || 0);
  let transferred = 0;

  const webStream = Readable.fromWeb(res.body as any);
  const progressStream = new Transform({
    transform(chunk, _encoding, callback) {
      transferred += chunk.length;
      if (onProgress && total > 0) {
        onProgress(Math.round((transferred / total) * 100), transferred, total);
      }
      callback(null, chunk);
    },
  });

  await pipeline(webStream, progressStream, createWriteStream(destPath));
}

export async function downloadHotfix(
  url: string,
  expectedSha256: string,
  onProgress?: ProgressCallback,
): Promise<string> {
  const tmpPath = path.join(os.tmpdir(), `dogear-hotfix-${Date.now()}.zip`);
  await downloadFile(url, tmpPath, onProgress);

  const fileBuffer = await fs.readFile(tmpPath);
  const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
  if (hash !== expectedSha256.toLowerCase()) {
    await fs.unlink(tmpPath).catch(() => {});
    throw new Error(`sha256 校验失败: 期望 ${expectedSha256}, 实际 ${hash}`);
  }

  return tmpPath;
}

export async function applyHotfix(zipPath: string, targetDir: string): Promise<void> {
  const zip = new AdmZip(zipPath);
  const tmpExtractDir = path.join(os.tmpdir(), `dogear-out-${Date.now()}`);

  await fs.rm(tmpExtractDir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(tmpExtractDir, { recursive: true });

  zip.extractAllTo(tmpExtractDir, true);

  const backupDir = `${targetDir}.bak`;
  await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {});

  try {
    await fs.rename(targetDir, backupDir);
  } catch {
    // targetDir might not exist on first install
  }

  try {
    await fs.rename(tmpExtractDir, targetDir);
  } catch {
    // cross-device fallback
    await fs.cp(tmpExtractDir, targetDir, { recursive: true });
    await fs.rm(tmpExtractDir, { recursive: true, force: true });
  }

  await fs.unlink(zipPath).catch(() => {});
  await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {});
}

export async function downloadFullUpdate(
  url: string,
  onProgress?: ProgressCallback,
): Promise<string> {
  const tmpPath = path.join(
    os.tmpdir(),
    `dogear-update-${Date.now()}${process.platform === 'win32' ? '.exe' : ''}`,
  );
  await downloadFile(url, tmpPath, onProgress);
  return tmpPath;
}

export async function runInstaller(installerPath: string): Promise<void> {
  try {
    await closeBrowserGateway();
  } catch (error) {
    console.error('[updater] 关闭浏览器扩展网关失败:', error);
  }
  spawn(installerPath, [], { detached: true, stdio: 'ignore' }).unref();
  app.quit();
}
