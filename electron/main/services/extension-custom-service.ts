/**
 * 浏览器扩展自定义副本：custom/browser-extensions/extension 为用户资产（随 custom 同步），
 * 内置 resources/extension 只读分发；恢复默认 = 删副本，更新副本 = 内置覆盖复制。
 * 版本比对读两侧 manifest.json 的 version，判断副本是否落后于应用内置版。
 */
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

export type ExtensionSource = 'custom' | 'builtin';

export interface ExtensionTargetInfo {
  /** 当前生效的扩展目录（浏览器「加载已解压的扩展程序」应指向它）；内置目录也缺失时为 null */
  path: string | null;
  source: ExtensionSource;
  /** 副本 manifest version 落后于内置（或副本 manifest 不可读） */
  outdated: boolean;
}

export function customExtensionDir(configDir: string): string {
  return path.join(configDir, 'custom', 'browser-extensions', 'extension');
}

export function builtinExtensionDir(app: { isPackaged: boolean; getAppPath: () => string }, resourcesPath: string): string {
  return app.isPackaged ? path.join(resourcesPath, 'extension') : path.join(app.getAppPath(), 'extension');
}

async function readManifestVersion(dir: string): Promise<string | null> {
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf-8')) as { version?: string };
    return typeof manifest.version === 'string' ? manifest.version : null;
  } catch {
    return null;
  }
}

export async function getExtensionTarget(configDir: string, builtinDir: string): Promise<ExtensionTargetInfo> {
  const customDir = customExtensionDir(configDir);
  if (existsSync(customDir)) {
    const [customVersion, builtinVersion] = await Promise.all([readManifestVersion(customDir), readManifestVersion(builtinDir)]);
    return { path: customDir, source: 'custom', outdated: customVersion === null || (builtinVersion !== null && customVersion !== builtinVersion) };
  }
  return { path: existsSync(builtinDir) ? builtinDir : null, source: 'builtin', outdated: false };
}

/** 复制内置 → custom 副本；副本已存在时整体覆盖（即「更新副本到当前内置版」的动线） */
export async function copyExtensionToCustom(configDir: string, builtinDir: string): Promise<ExtensionTargetInfo> {
  if (!existsSync(builtinDir)) throw new Error('内置扩展目录不存在，请重新安装应用');
  const customDir = customExtensionDir(configDir);
  await fs.rm(customDir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(customDir), { recursive: true });
  await fs.cp(builtinDir, customDir, { recursive: true });
  return getExtensionTarget(configDir, builtinDir);
}

export async function resetExtensionCustom(configDir: string, builtinDir: string): Promise<ExtensionTargetInfo> {
  await fs.rm(customExtensionDir(configDir), { recursive: true, force: true });
  return getExtensionTarget(configDir, builtinDir);
}
