import { readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import { app, session, type Cookie } from 'electron';
import { GLOBAL_BROWSER_PARTITION } from './embedded/profile.js';
import { loadLoginAccounts, removeLoginAccountEntry, type LoginEvidence } from './login-observer.js';

export interface BrowserDomainData {
  domain: string;
  cookieCount: number;
}

export interface LoginAccountView {
  domain: string;
  firstLoginAt: number;
  lastLoginAt: number;
  evidence: LoginEvidence;
}

export interface BrowserDataOverview {
  cacheSize: number;
  diskUsage: number;
  totalCookies: number;
  domains: BrowserDomainData[];
  loginAccounts: LoginAccountView[];
}

const MULTI_PART_SUFFIXES = new Set([
  'com.cn',
  'net.cn',
  'org.cn',
  'gov.cn',
  'edu.cn',
  'ac.cn',
  'mil.cn',
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'net.uk',
  'me.uk',
  'co.jp',
  'ne.jp',
  'or.jp',
  'ac.jp',
  'go.jp',
  'co.kr',
  'or.kr',
  'ne.kr',
  'go.kr',
  'ac.kr',
  'com.hk',
  'org.hk',
  'edu.hk',
  'gov.hk',
  'com.tw',
  'org.tw',
  'edu.tw',
  'gov.tw',
  'com.au',
  'net.au',
  'org.au',
  'edu.au',
  'gov.au',
  'com.br',
  'net.br',
  'org.br',
  'com.sg',
  'com.tr',
  'com.mx',
  'co.in',
  'net.in',
  'org.in',
  'co.nz',
  'net.nz',
  'org.nz',
  'co.za',
]);

const LOGIN_HINT_NAMES = new Set([
  'session',
  'sessionid',
  'session_id',
  'sess',
  'sid',
  'phpsessid',
  'jsessionid',
  'token',
  'access_token',
  'auth_token',
  'refresh_token',
  'id_token',
  'jwt',
  'auth',
  'authorization',
  'login',
  'logged_in',
  'loggedin',
  'remember_token',
  'rememberme',
  'ssid',
  'uid',
  'userid',
  'user_id',
]);

export function registeredDomain(rawDomain: string): string {
  const domain = rawDomain.replace(/^\./, '').toLowerCase();
  const labels = domain.split('.');
  if (labels.length <= 2) return domain;
  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_PART_SUFFIXES.has(lastTwo)) return labels.slice(-3).join('.');
  return lastTwo;
}

export async function loginHintDomains(): Promise<string[]> {
  const all = await getSession().cookies.get({});
  const domains = new Set<string>();
  for (const cookie of all) {
    if (!cookie.domain) continue;
    if (looksLikeLoginCookie(cookie.name)) domains.add(registeredDomain(cookie.domain));
  }
  return [...domains];
}

function looksLikeLoginCookie(name: string): boolean {
  const n = name.toLowerCase();
  if (LOGIN_HINT_NAMES.has(n)) return true;
  return (
    n.includes('session') ||
    n.includes('token') ||
    n.includes('auth') ||
    n.includes('login') ||
    n.includes('signin')
  );
}

function getSession(): Electron.Session {
  return session.fromPartition(GLOBAL_BROWSER_PARTITION);
}

function partitionDir(): string {
  return path.join(app.getPath('userData'), 'Partitions', GLOBAL_BROWSER_PARTITION.slice('persist:'.length));
}

async function dirSizeRecursive(dir: string): Promise<number> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  const sizes = await Promise.all(
    entries.map(async (entry) => {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) return dirSizeRecursive(p);
      if (entry.isFile()) {
        try {
          return (await stat(p)).size;
        } catch {
          return 0;
        }
      }
      return 0;
    }),
  );
  return sizes.reduce((sum, n) => sum + n, 0);
}

async function cookiesForRegisteredDomain(domain: string): Promise<Cookie[]> {
  const target = registeredDomain(domain);
  const all = await getSession().cookies.get({});
  return all.filter((c) => c.domain && registeredDomain(c.domain) === target);
}

function cookieHost(cookie: Cookie): string {
  return (cookie.domain ?? '').replace(/^\./, '').toLowerCase();
}

function cookieUrl(cookie: Cookie): string {
  return `${cookie.secure ? 'https' : 'http'}://${cookieHost(cookie)}${cookie.path || '/'}`;
}

function originsOf(cookies: Cookie[]): string[] {
  return [...new Set(cookies.map((c) => `https://${cookieHost(c)}`))];
}

async function removeCookiesOneByOne(cookies: Cookie[]): Promise<void> {
  const ses = getSession();
  for (const cookie of cookies) {
    try {
      await ses.cookies.remove(cookieUrl(cookie), cookie.name);
    } catch (err) {
      console.warn('[browser-data] cookie 移除失败:', cookie.domain, cookie.name, err);
    }
  }
}

export async function listBrowserData(): Promise<BrowserDataOverview> {
  const ses = getSession();
  const [all, cacheSize, diskUsage] = await Promise.all([
    ses.cookies.get({}),
    ses.getCacheSize(),
    dirSizeRecursive(partitionDir()),
  ]);
  const byDomain = new Map<string, BrowserDomainData>();
  for (const cookie of all) {
    if (!cookie.domain) continue;
    const domain = registeredDomain(cookie.domain);
    const entry = byDomain.get(domain) ?? { domain, cookieCount: 0 };
    entry.cookieCount += 1;
    byDomain.set(domain, entry);
  }
  const domains = [...byDomain.values()].sort((a, b) => b.cookieCount - a.cookieCount || a.domain.localeCompare(b.domain));
  const loginAccounts = await listLoginAccounts();
  return { cacheSize, diskUsage, totalCookies: all.length, domains, loginAccounts };
}

async function listLoginAccounts(): Promise<LoginAccountView[]> {
  try {
    const manifest = await loadLoginAccounts();
    return [...manifest.accounts].sort((a, b) => b.lastLoginAt - a.lastLoginAt);
  } catch (err) {
    console.error('[browser-data] 登录清单读取失败:', err);
    return [];
  }
}

// 当前 Electron 版本 clearStorageData 只收单 origin，不支持 origins 数组
async function clearOriginsStorage(origins: string[]): Promise<void> {
  const ses = getSession();
  for (const origin of origins) {
    await ses.clearStorageData({ origin });
  }
}

export async function clearDomainData(domain: string): Promise<{ removedCookies: number; origins: string[] }> {
  const cookies = await cookiesForRegisteredDomain(domain);
  const origins = originsOf(cookies);
  await clearOriginsStorage(origins);
  await removeCookiesOneByOne(cookies);
  return { removedCookies: cookies.length, origins };
}

export async function logoutLoginAccount(domain: string): Promise<{ removedCookies: number; origins: string[] }> {
  const result = await clearDomainData(domain);
  await removeLoginAccountEntry(domain);
  return result;
}

export async function removeLoginAccount(domain: string): Promise<boolean> {
  return removeLoginAccountEntry(domain);
}

export async function clearBrowserCache(): Promise<{ freedBytes: number }> {
  const ses = getSession();
  const before = await ses.getCacheSize();
  await ses.clearCache();
  return { freedBytes: before };
}

export async function clearAllBrowserData(): Promise<{ removedCookies: number }> {
  const ses = getSession();
  const all = await ses.cookies.get({});
  await ses.clearStorageData();
  await ses.clearCache();
  return { removedCookies: all.length };
}
