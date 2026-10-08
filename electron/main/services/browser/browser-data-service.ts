import { session, type Cookie } from 'electron';
import { GLOBAL_BROWSER_PARTITION } from './embedded/profile.js';

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
