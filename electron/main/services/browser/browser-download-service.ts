import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import AdmZip from 'adm-zip';

export type BrowserDownloadSource = 'npmmirror' | 'playwright-cdn';

export interface BrowserDownloadEvent {
  status: 'downloading' | 'done' | 'failed';
  receivedBytes: number;
  totalBytes: number;
  source?: BrowserDownloadSource;
  error?: string;
}

type DownloadBroadcaster = (event: BrowserDownloadEvent) => void;

interface ChromiumExecutableDescriptor {
  name: string;
  directory: string;
  executablePath: () => string;
  downloadURLs: string[];
  revision: string;
  browserVersion: string;
}

interface CoreBundleModule {
  registry: {
    registry: { _executables: ChromiumExecutableDescriptor[] };
    browserDirectoryToMarkerFilePath: (dir: string) => string;
  };
}

interface ChromiumResolution {
  executable: ChromiumExecutableDescriptor;
  markerFileOf: (dir: string) => string;
}

const RETRY_COOLDOWN_MS = 10_000;
const PROGRESS_INTERVAL_MS = 300;
const NPMIRROR_BINARY_BASE = 'https://registry.npmmirror.com/-/binary/playwright';
const EXECUTABLE_RELATIVE = path.join('chrome-win64', 'chrome.exe');

let broadcaster: DownloadBroadcaster | null = null;
let resolution: ChromiumResolution | null = null;
let inflight: Promise<void> | null = null;
let lastFailure: { at: number; error: Error } | null = null;

export function setBrowserDownloadBroadcaster(fn: DownloadBroadcaster | null): void {
  broadcaster = fn;
}

export function chromiumInstallStatus(): { installed: boolean; executablePath: string; error?: string } {
  try {
    const { executable } = resolveChromium();
    const executablePath = executable.executablePath();
    return { installed: fs.existsSync(executablePath), executablePath };
  } catch (err) {
    return { installed: false, executablePath: '', error: errorMessage(err) };
  }
}

export function ensureChromiumInstalled(): Promise<void> {
  if (chromiumInstallStatus().installed) {
    lastFailure = null;
    return Promise.resolve();
  }
  if (inflight) return inflight;
  if (lastFailure && Date.now() - lastFailure.at < RETRY_COOLDOWN_MS) {
    return Promise.reject(lastFailure.error);
  }
  const promise = (async () => {
    try {
      await downloadChromium();
      lastFailure = null;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      lastFailure = { at: Date.now(), error };
      emit({ status: 'failed', receivedBytes: 0, totalBytes: -1, error: error.message });
      throw error;
    }
  })();
  inflight = promise.finally(() => {
    inflight = null;
  });
  return promise;
}

function resolveChromium(): ChromiumResolution {
  if (resolution) return resolution;
  const coreRequire = createRequire(import.meta.url);
  const core = coreRequire('playwright-core/lib/coreBundle') as CoreBundleModule;
  const executable = core.registry.registry._executables.find((item) => item.name === 'chromium');
  if (!executable?.directory || typeof executable.executablePath !== 'function') {
    throw new Error('无法从 playwright-core 解析 Chromium 安装信息，playwright 版本可能不兼容');
  }
  resolution = {
    executable,
    markerFileOf: (dir) => core.registry.browserDirectoryToMarkerFilePath(dir),
  };
  return resolution;
}

async function downloadChromium(): Promise<void> {
  const { executable, markerFileOf } = resolveChromium();
  const browserDir = executable.directory;
  const zipFile = `${browserDir}.zip.part`;
  const sources = buildDownloadSources(executable.downloadURLs);
  if (sources.length === 0) throw new Error('无法确定浏览器组件下载地址');
  const failures: string[] = [];
  let lastReceived = 0;
  let lastTotal = -1;
  for (const { source, url } of sources) {
    try {
      await cleanupPartial(zipFile, browserDir);
      let lastEmitAt = 0;
      await downloadToFile(url, zipFile, (received, total) => {
        lastReceived = received;
        lastTotal = total;
        const now = Date.now();
        if (now - lastEmitAt >= PROGRESS_INTERVAL_MS) {
          lastEmitAt = now;
          emit({ status: 'downloading', receivedBytes: received, totalBytes: total, source });
        }
      });
      await extractToBrowserDir(zipFile, browserDir, markerFileOf(browserDir));
      await fs.promises.rm(zipFile, { force: true }).catch(() => {});
      emit({ status: 'done', receivedBytes: lastReceived, totalBytes: lastTotal, source });
      return;
    } catch (err) {
      failures.push(`${sourceLabel(source)}下载失败: ${errorMessage(err)}`);
      await cleanupPartial(zipFile, browserDir);
    }
  }
  throw new Error(failures.join('；'));
}

function buildDownloadSources(officialUrls: string[]): Array<{ source: BrowserDownloadSource; url: string }> {
  if (process.env.PLAYWRIGHT_DOWNLOAD_HOST) {
    return officialUrls.map((url) => ({ source: 'playwright-cdn' as const, url }));
  }
  const official = officialUrls[0];
  if (!official) return [];
  const suffix = official.replace(/^https?:\/\/[^/]+\//, '');
  return [
    { source: 'npmmirror', url: `${NPMIRROR_BINARY_BASE}/${suffix}` },
    { source: 'playwright-cdn', url: official },
  ];
}

async function downloadToFile(
  url: string,
  destFile: string,
  onChunk: (received: number, total: number) => void,
): Promise<void> {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`);
  }
  const total = Number(response.headers.get('content-length')) || -1;
  let received = 0;
  const body = Readable.fromWeb(response.body as unknown as import('stream/web').ReadableStream);
  body.on('data', (chunk: Buffer) => {
    received += chunk.length;
    onChunk(received, total);
  });
  await pipeline(body, fs.createWriteStream(destFile));
  if (total > 0 && received !== total) {
    throw new Error(`下载数据不完整（${received}/${total} 字节）`);
  }
}

async function extractToBrowserDir(zipFile: string, browserDir: string, markerFile: string): Promise<void> {
  const zip = new AdmZip(zipFile);
  const hasExecutable = zip
    .getEntries()
    .some((entry) => entry.entryName.replace(/\\/g, '/') === `chrome-win64/chrome.exe`);
  if (!hasExecutable) {
    throw new Error('压缩包结构不符合预期（缺少 chrome-win64/chrome.exe）');
  }
  await fs.promises.mkdir(browserDir, { recursive: true });
  await zip.extractAllToAsync(browserDir, true);
  if (!fs.existsSync(path.join(browserDir, EXECUTABLE_RELATIVE))) {
    throw new Error('解压完成后未找到浏览器可执行文件');
  }
  await fs.promises.writeFile(markerFile, '');
}

async function cleanupPartial(zipFile: string, browserDir: string): Promise<void> {
  await fs.promises.rm(zipFile, { force: true }).catch(() => {});
  await fs.promises.rm(browserDir, { recursive: true, force: true }).catch(() => {});
}

function sourceLabel(source: BrowserDownloadSource): string {
  return source === 'npmmirror' ? 'npmmirror 镜像' : 'Playwright 官方 CDN';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function emit(event: BrowserDownloadEvent): void {
  broadcaster?.(event);
}
