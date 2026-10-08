/**
 * 任务浏览器拉起服务：探测 Chrome/Edge 安装、解析本机账户（profile）列表、按配置启动浏览器进程。
 * 纯 node API，无 electron 依赖。
 */
import { execFile, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { TaskBrowserConfig, TaskBrowserId } from '../settings-types.js';

const execFileP = promisify(execFile);

export interface BrowserProfileInfo {
  /** User Data 下的账户目录名（--profile-directory 参数值） */
  directory: string;
  /** 账户显示名（Local State profile.info_cache） */
  name: string;
}

export interface DetectedBrowser {
  browser: TaskBrowserId;
  name: string;
  exePath: string;
  /** 本机账户数据目录（User Data），profile 列表解析自其中的 Local State */
  userDataDir: string;
  profiles: BrowserProfileInfo[];
}

export type LaunchTaskBrowserResult = { ok: true; exePath: string } | { ok: false; error: string };

export const TASK_BROWSER_LABELS: Record<TaskBrowserId, string> = { chrome: 'Chrome', edge: 'Edge' };

interface BrowserLayout {
  /** Win 注册表 App Paths 键名 */
  registryExeName: string;
  /** 常见安装路径候选，按优先级排列 */
  winExeCandidates: string[];
  winUserDataDir: () => string;
  macExePath: string;
  macUserDataDir: () => string;
}

function envJoin(envKey: string, ...segments: string[]): string {
  const base = process.env[envKey];
  return base ? join(base, ...segments) : '';
}

const LAYOUTS: Record<TaskBrowserId, BrowserLayout> = {
  chrome: {
    registryExeName: 'chrome.exe',
    winExeCandidates: [
      envJoin('ProgramFiles', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      envJoin('ProgramFiles(x86)', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      envJoin('LOCALAPPDATA', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ],
    winUserDataDir: () => envJoin('LOCALAPPDATA', 'Google', 'Chrome', 'User Data'),
    macExePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    macUserDataDir: () => join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome'),
  },
  edge: {
    registryExeName: 'msedge.exe',
    winExeCandidates: [
      envJoin('ProgramFiles(x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      envJoin('ProgramFiles', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ],
    winUserDataDir: () => envJoin('LOCALAPPDATA', 'Microsoft', 'Edge', 'User Data'),
    macExePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    macUserDataDir: () => join(homedir(), 'Library', 'Application Support', 'Microsoft Edge'),
  },
};

/** Win 注册表 App Paths 兜底（便携/自定义目录安装时常见路径全部落空） */
async function findWindowsExeViaRegistry(registryExeName: string): Promise<string | null> {
  const keyPaths = ['HKLM', 'HKCU'].map((hive) =>
    [hive, 'SOFTWARE', 'Microsoft', 'Windows', 'CurrentVersion', 'App Paths', registryExeName].join('\\'),
  );
  for (const keyPath of keyPaths) {
    try {
      const { stdout } = await execFileP('reg', ['query', keyPath, '/ve'], { windowsHide: true, timeout: 5000 });
      const exe = /REG_SZ\s+(\S.*)$/.exec(stdout)?.[1]?.trim();
      if (exe && existsSync(exe)) return exe;
    } catch {
      // 键不存在或查询失败，继续下一个
    }
  }
  return null;
}

/** Local State → profile.info_cache；目录已被删除的条目过滤掉，显示名回退 gaia_name → shortcut_name → 目录名 */
function listProfiles(userDataDir: string): BrowserProfileInfo[] {
  const localStatePath = join(userDataDir, 'Local State');
  if (userDataDir === '' || !existsSync(localStatePath)) return [];
  try {
    const parsed = JSON.parse(readFileSync(localStatePath, 'utf-8')) as {
      profile?: { info_cache?: Record<string, { name?: unknown; gaia_name?: unknown; shortcut_name?: unknown }> };
    };
    const infoCache = parsed.profile?.info_cache;
    if (!infoCache || typeof infoCache !== 'object') return [];
    const out: BrowserProfileInfo[] = [];
    for (const [directory, info] of Object.entries(infoCache)) {
      if (directory === '' || !existsSync(join(userDataDir, directory))) continue;
      const name =
      [info.name, info.gaia_name, info.shortcut_name].find(
        (v): v is string => typeof v === 'string' && v !== '',
      ) ?? directory;
      out.push({ directory, name });
    }
    return out;
  } catch {
    return [];
  }
}

export async function detectBrowser(browser: TaskBrowserId): Promise<DetectedBrowser | null> {
  if (platform() !== 'win32' && platform() !== 'darwin') return null;
  const layout = LAYOUTS[browser];
  let exePath: string | null = null;
  let userDataDir = '';
  if (platform() === 'win32') {
    exePath = layout.winExeCandidates.find((p) => p !== '' && existsSync(p)) ?? null;
    exePath ??= await findWindowsExeViaRegistry(layout.registryExeName);
    userDataDir = layout.winUserDataDir();
  } else {
    exePath = existsSync(layout.macExePath) ? layout.macExePath : null;
    userDataDir = layout.macUserDataDir();
  }
  if (!exePath) return null;
  return { browser, name: TASK_BROWSER_LABELS[browser], exePath, userDataDir, profiles: listProfiles(userDataDir) };
}

export async function detectBrowsers(): Promise<DetectedBrowser[]> {
  const results = await Promise.all((['chrome', 'edge'] as const).map((id) => detectBrowser(id)));
  return results.filter((b): b is DetectedBrowser => b !== null);
}

/**
 * 按 taskBrowser 配置拉起浏览器（--profile-directory 不带 URL；扩展 SW 启动即自动连接）。
 * detached + unref：参数转发给已运行实例后立即退出，不阻塞主进程；Chrome 单进程多账户模型下
 * 在指定账户开新窗口，不影响用户当前窗口。
 */
export async function launchTaskBrowser(config: TaskBrowserConfig): Promise<LaunchTaskBrowserResult> {
  const detection = await detectBrowser(config.browser);
  if (!detection) {
    return { ok: false, error: `未检测到已安装的 ${TASK_BROWSER_LABELS[config.browser]}，请在设置中重新选择任务浏览器` };
  }
  if (!detection.profiles.some((p) => p.directory === config.profileDirectory)) {
    return { ok: false, error: `任务浏览器账户「${config.profileName}」不存在，请在设置中重新选择` };
  }
  try {
    const child = spawn(detection.exePath, [`--profile-directory=${config.profileDirectory}`], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `启动 ${TASK_BROWSER_LABELS[config.browser]} 失败：${message}` };
  }
  return { ok: true, exePath: detection.exePath };
}

const MAC_PROCESS_NAMES: Record<TaskBrowserId, string> = { chrome: 'Google Chrome', edge: 'Microsoft Edge' };

/** 任务浏览器可执行文件进程是否存活（扩展 SW 休眠断连场景下决定「等待重连」还是「拉起」） */
export async function isBrowserProcessAlive(browser: TaskBrowserId): Promise<boolean> {
  try {
    if (platform() === 'win32') {
      const { stdout } = await execFileP(
        'tasklist',
        ['/FI', `IMAGENAME eq ${LAYOUTS[browser].registryExeName}`, '/FO', 'CSV', '/NH'],
        { windowsHide: true, timeout: 5000 },
      );
      return stdout.toLowerCase().includes(LAYOUTS[browser].registryExeName);
    }
    if (platform() === 'darwin') {
      await execFileP('pgrep', ['-x', MAC_PROCESS_NAMES[browser]], { timeout: 5000 });
      return true;
    }
  } catch {
    return false;
  }
  return false;
}
