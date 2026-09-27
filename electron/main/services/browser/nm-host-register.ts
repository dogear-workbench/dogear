import { app } from 'electron';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { nmGatewayAddress } from './nm-protocol.js';

const NM_HOST_NAME = 'com.dogear.nmhost';

/** mac 端 NativeMessagingHosts 注册目录（相对 ~/Library/Application Support），需扩展时在表里加 */
const NM_BROWSER_DIRS = [
  { browser: 'Chrome', dir: 'Google/Chrome' },
  { browser: 'Edge', dir: 'Microsoft/Edge' },
] as const;

export interface NmHostBrowserResult {
  browser: string;
  ok: boolean;
  error?: string;
}

export interface NmHostRegisterResult {
  results: NmHostBrowserResult[];
  hostScriptPath: string;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function nmHostSourceDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'nm-host')
    : join(app.getAppPath(), 'resources', 'nm-host');
}

/** allowed_origins 单一来源：build-nm-manifest.mjs 的生成物（dev 在仓库、prod 在 extraResources） */
function readAllowedOrigins(): string[] {
  const raw = JSON.parse(
    readFileSync(join(nmHostSourceDir(), `${NM_HOST_NAME}.json`), 'utf-8'),
  ) as { allowed_origins?: unknown };
  return Array.isArray(raw.allowed_origins)
    ? raw.allowed_origins.filter((item): item is string => typeof item === 'string')
    : [];
}

function browserManifestPath(dir: string): string {
  return join(
    app.getPath('home'),
    'Library',
    'Application Support',
    dir,
    'NativeMessagingHosts',
    `${NM_HOST_NAME}.json`,
  );
}

function renderHostSh(electronExe: string, workerPath: string, gatewayPath: string): string {
  return [
    '#!/bin/bash',
    'export ELECTRON_RUN_AS_NODE=1',
    `exec "${electronExe}" "${workerPath}" --nm-gateway="${gatewayPath}"`,
    '',
  ].join('\n');
}

/**
 * mac 无 NSIS 安装器环节，NM host 注册由应用运行时完成。
 * mac 的 NM manifest path 必须绝对路径，且 socket 路径依赖本机 userData，
 * 故 nm-host.sh 在注册时渲染到 userData（execPath/worker/socket 路径运行时全部可知），升级后重注册即可。
 */
export function registerNmHost(): NmHostRegisterResult {
  if (process.platform !== 'darwin') throw new Error('NM host 注册仅支持 macOS');
  if (!app.isReady()) throw new Error('应用尚未初始化完成');

  const userDataDir = app.getPath('userData');
  const workerPath = join(nmHostSourceDir(), 'nm-bridge-worker.cjs');
  const gatewayPath = nmGatewayAddress(userDataDir);
  const hostScriptPath = join(userDataDir, 'nm-host.sh');
  writeFileSync(hostScriptPath, renderHostSh(process.execPath, workerPath, gatewayPath), 'utf-8');
  chmodSync(hostScriptPath, 0o755);

  const manifest = {
    name: NM_HOST_NAME,
    description: 'Dogear 浏览器扩展 Native Messaging 宿主',
    path: hostScriptPath,
    type: 'stdio',
    allowed_origins: readAllowedOrigins(),
  };

  const results = NM_BROWSER_DIRS.map(({ browser, dir }): NmHostBrowserResult => {
    try {
      const manifestPath = browserManifestPath(dir);
      mkdirSync(dirname(manifestPath), { recursive: true });
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
      return { browser, ok: true };
    } catch (err) {
      return { browser, ok: false, error: describeError(err) };
    }
  });
  return { results, hostScriptPath };
}

export function unregisterNmHost(): NmHostBrowserResult[] {
  if (process.platform !== 'darwin') throw new Error('NM host 注销仅支持 macOS');
  return NM_BROWSER_DIRS.map(({ browser, dir }): NmHostBrowserResult => {
    try {
      rmSync(browserManifestPath(dir), { force: true });
      return { browser, ok: true };
    } catch (err) {
      return { browser, ok: false, error: describeError(err) };
    }
  });
}
