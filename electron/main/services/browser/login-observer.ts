import path from 'node:path';
import { readdir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { app, session } from 'electron';
import { GLOBAL_BROWSER_PARTITION } from './embedded/profile.js';
import { listBrowserData, registeredDomain } from './browser-data-service.js';
import { getConfigDir, loadSettings } from '../settings-service.js';
import { safeJsonRead, safeJsonWrite } from '../safe-json.js';

export type LoginEvidence = 'oauth-callback' | 'login-post' | 'init-heuristic' | 'init-webai-storage';

export interface LoginAccountEntry {
  domain: string;
  firstLoginAt: number;
  lastLoginAt: number;
  evidence: LoginEvidence;
}

export interface LoginAccountsManifest {
  version: 1;
  initialized: boolean;
  accounts: LoginAccountEntry[];
}

const EMPTY_MANIFEST: LoginAccountsManifest = { version: 1, initialized: false, accounts: [] };

const DEDUPE_WINDOW_MS = 60_000;
const SAVE_DEBOUNCE_MS = 3_000;

const LOGIN_PATH_RE = /login|signin|oauth|\/auth\b/i;
const CALLBACK_PATH_RE = /callback|oauth/i;

let manifest: LoginAccountsManifest | null = null;
let manifestPromise: Promise<LoginAccountsManifest> | null = null;
let saveTimer: NodeJS.Timeout | null = null;
const lastEventAt = new Map<string, number>();

function manifestPath(): string {
  return path.join(getConfigDir(), 'login-accounts.json');
}

export async function loadLoginAccounts(): Promise<LoginAccountsManifest> {
  const loaded = await safeJsonRead<LoginAccountsManifest>(manifestPath(), EMPTY_MANIFEST);
  if (loaded.version !== 1 || !Array.isArray(loaded.accounts)) {
    return structuredClone(EMPTY_MANIFEST);
  }
  return loaded;
}

export async function saveLoginAccounts(data: LoginAccountsManifest): Promise<void> {
  manifest = data;
  await safeJsonWrite(manifestPath(), data);
}

function ensureLoaded(): Promise<LoginAccountsManifest> {
  if (!manifestPromise) {
    manifestPromise = loadLoginAccounts().then((loaded) => {
      manifest = loaded;
      return loaded;
    });
  }
  return manifestPromise;
}

function scheduleSave(): void {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (!manifest) return;
    saveLoginAccounts(manifest).catch((err) => console.error('[login-observer] 清单写入失败:', err));
  }, SAVE_DEBOUNCE_MS);
}

export function recordLoginEvent(domain: string, evidence: LoginEvidence): void {
  try {
    if (!manifest) return;
    const now = Date.now();
    const last = lastEventAt.get(domain);
    const duplicated = last !== undefined && now - last < DEDUPE_WINDOW_MS;
    lastEventAt.set(domain, now);
    const entry = manifest.accounts.find((a) => a.domain === domain);
    if (entry) {
      entry.lastLoginAt = now;
    } else {
      manifest.accounts.push({ domain, firstLoginAt: now, lastLoginAt: now, evidence });
    }
    if (!duplicated) scheduleSave();
  } catch (err) {
    console.error('[login-observer] 记录登录事件失败:', err);
  }
}

function classifyLoginRequest(method: string, url: string): LoginEvidence | null {
  const u = new URL(url);
  if (u.searchParams.has('code') && CALLBACK_PATH_RE.test(u.pathname)) return 'oauth-callback';
  if (method.toUpperCase() === 'POST' && LOGIN_PATH_RE.test(u.pathname)) return 'login-post';
  return null;
}

export function initLoginObserver(): void {
  void ensureLoaded().catch((err) => console.error('[login-observer] 清单加载失败:', err));

  const ses = session.fromPartition(GLOBAL_BROWSER_PARTITION);
  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    callback({});
    try {
      const evidence = classifyLoginRequest(details.method, details.url);
      if (!evidence) return;
      const domain = registeredDomain(new URL(details.url).hostname);
      if (!domain) return;
      recordLoginEvent(domain, evidence);
    } catch (err) {
      console.error('[login-observer] 请求观测失败:', err);
    }
  });
}

async function scanIndexedDbHosts(): Promise<string[]> {
  const dir = path.join(
    app.getPath('userData'),
    'Partitions',
    GLOBAL_BROWSER_PARTITION.slice('persist:'.length),
    'IndexedDB',
  );
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const hosts = new Set<string>();
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const host = parseIndexedDbDirHost(entry.name);
    if (host) hosts.add(host);
  }
  return [...hosts];
}

function parseIndexedDbDirHost(name: string): string | null {
  const m = name.match(/^(https?)_(.+?)_(\d+)\.indexeddb\./i);
  return m ? m[2].toLowerCase() : null;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export async function migrateInitialLoginAccounts(): Promise<void> {
  try {
    const data = await ensureLoaded();
    if (data.initialized) return;

    const domains = new Map<string, LoginEvidence>();
    try {
      const overview = await listBrowserData();
      for (const d of overview.domains) {
        if (d.hasLoginHint) domains.set(d.domain, 'init-heuristic');
      }
    } catch (err) {
      console.error('[login-observer] cookie 启发式扫描失败:', err);
    }

    try {
      const settings = await loadSettings();
      const webAiDomains = new Set(
        (settings.webAiSites ?? [])
          .map((s) => hostOf(s.url))
          .filter((h): h is string => !!h)
          .map((h) => registeredDomain(h)),
      );
      for (const host of await scanIndexedDbHosts()) {
        const domain = registeredDomain(host);
        if (webAiDomains.has(domain)) domains.set(domain, 'init-webai-storage');
      }
    } catch (err) {
      console.error('[login-observer] IndexedDB 扫描失败:', err);
    }

    const now = Date.now();
    for (const [domain, evidence] of domains) {
      if (data.accounts.some((a) => a.domain === domain)) continue;
      data.accounts.push({ domain, firstLoginAt: now, lastLoginAt: now, evidence });
    }
    await saveLoginAccounts(data);
    data.initialized = true;
    await saveLoginAccounts(data);
  } catch (err) {
    console.error('[login-observer] 初始化迁移失败:', err);
  }
}
