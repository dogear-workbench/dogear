import { app } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import AdmZip from 'adm-zip';
import { closeBrowserGateway } from './browser/browser-gateway.js';
import {
  compareVersions,
  pickPlatformRelease,
} from './update-manifest.js';
import type {
  CheckResult,
  ManifestInfo,
  ReleaseInfo,
} from './update-manifest.js';

export {
  compareVersions,
  pickPlatformRelease,
} from './update-manifest.js';
export type {
  CheckResult,
  ManifestInfo,
  ReleaseInfo,
} from './update-manifest.js';

export type ProgressCallback = (percent: number, transferred: number, total: number) => void;

const execFileP = promisify(execFile);

export async function checkForUpdates(serverUrl: string): Promise<CheckResult> {
  const url = `${serverUrl.replace(/\/$/, '')}/manifest.json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`获取 manifest 失败: ${res.status} ${res.statusText}`);
  }
  const manifest = (await res.json()) as ManifestInfo;
  const release = pickPlatformRelease(manifest);
  if (!release) {
    return { hasUpdate: false };
  }
  const currentVersion = app.getVersion();
  const hasUpdate = compareVersions(release.version, currentVersion) > 0;
  return {
    hasUpdate,
    type: hasUpdate ? release.type : undefined,
    info: hasUpdate ? release : undefined,
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

function urlExtension(url: string): string {
  try {
    return path.extname(new URL(url).pathname);
  } catch {
    return '';
  }
}

export async function downloadFullUpdate(
  url: string,
  onProgress?: ProgressCallback,
): Promise<string> {
  const suffix = process.platform === 'win32' ? '.exe' : urlExtension(url);
  const tmpPath = path.join(os.tmpdir(), `dogear-update-${Date.now()}${suffix}`);
  await downloadFile(url, tmpPath, onProgress);
  return tmpPath;
}

// v1 不做自动 .app 替换（权限+签名复杂度）：dmg 直接挂载、zip 解压后开 Finder，引导用户手动拖拽
async function openDarwinUpdatePackage(pkgPath: string): Promise<void> {
  if (path.extname(pkgPath).toLowerCase() === '.zip') {
    const zip = new AdmZip(pkgPath);
    const extractDir = path.join(os.tmpdir(), `dogear-mac-update-${Date.now()}`);
    await fs.mkdir(extractDir, { recursive: true });
    zip.extractAllTo(extractDir, true);
    await execFileP('open', [extractDir]);
    return;
  }
  await execFileP('open', [pkgPath]);
}

export async function runInstaller(installerPath: string): Promise<void> {
  try {
    await closeBrowserGateway();
  } catch (error) {
    console.error('[updater] 关闭浏览器扩展网关失败:', error);
  }
  if (process.platform === 'darwin') {
    await openDarwinUpdatePackage(installerPath);
    app.quit();
    return;
  }
  spawn(installerPath, [], { detached: true, stdio: 'ignore' }).unref();
  app.quit();
}
