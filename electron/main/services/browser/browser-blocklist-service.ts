import path from 'node:path';
import { registeredDomain } from './browser-data-service.js';
import { normalizeDomain } from './site-knowledge-service.js';
import { getConfigDir } from '../settings-service.js';
import { safeJsonRead, safeJsonWrite } from '../safe-json.js';

export interface BlockedDomainEntry {
  domain: string;
  reason: string;
  blockedAt: number;
}

interface BlocklistFile {
  version: 1;
  domains: BlockedDomainEntry[];
}

const EMPTY_BLOCKLIST: BlocklistFile = { version: 1, domains: [] };

function blocklistPath(): string {
  return path.join(getConfigDir(), 'browser-blocklist.json');
}

async function loadBlocklist(): Promise<BlocklistFile> {
  const loaded = await safeJsonRead<BlocklistFile>(blocklistPath(), EMPTY_BLOCKLIST);
  if (loaded.version !== 1 || !Array.isArray(loaded.domains)) return { version: 1, domains: [] };
  return { version: 1, domains: loaded.domains.filter((d) => !!d && typeof d.domain === 'string') };
}

/** URL 或裸域名 → 注册域（eTLD+1）；无法解析返回 null */
export function toRegisteredDomain(raw: string): string | null {
  const host = normalizeDomain(raw);
  return host ? registeredDomain(host) : null;
}

/** 登记被屏蔽站点（幂等：已存在时不覆盖原登记时间）；成功返回归一后的注册域 */
export async function addBlockedDomain(domainOrUrl: string, reason: string): Promise<string | null> {
  const domain = toRegisteredDomain(domainOrUrl);
  if (!domain) return null;
  const list = await loadBlocklist();
  if (list.domains.some((d) => d.domain === domain)) return domain;
  list.domains.push({ domain, reason, blockedAt: Date.now() });
  await safeJsonWrite(blocklistPath(), list);
  return domain;
}

export async function isBlocked(url: string): Promise<boolean> {
  const domain = toRegisteredDomain(url);
  if (!domain) return false;
  const list = await loadBlocklist();
  return list.domains.some((d) => d.domain === domain);
}

/** 入口拦截用：URL 命中屏蔽时返回登记条目（含 blockedAt 供文案日期），未命中返回 null */
export async function findBlockedEntry(url: string): Promise<BlockedDomainEntry | null> {
  const domain = toRegisteredDomain(url);
  if (!domain) return null;
  const list = await loadBlocklist();
  return list.domains.find((d) => d.domain === domain) ?? null;
}

/** 解除屏蔽（幂等）；实际删除返回 true，条目不存在返回 false */
export async function removeBlockedDomain(domain: string): Promise<boolean> {
  const normalized = toRegisteredDomain(domain);
  if (!normalized) return false;
  const list = await loadBlocklist();
  const next = list.domains.filter((d) => d.domain !== normalized);
  if (next.length === list.domains.length) return false;
  await safeJsonWrite(blocklistPath(), { version: 1, domains: next });
  return true;
}

export function blockedDomainMessage(entry: BlockedDomainEntry): string {
  const d = new Date(entry.blockedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return `该站点已被你屏蔽（${date}），可在 数据中心 → 浏览器数据 解除`;
}

export async function listBlocked(): Promise<BlockedDomainEntry[]> {
  const list = await loadBlocklist();
  return list.domains.sort((a, b) => a.domain.localeCompare(b.domain));
}
