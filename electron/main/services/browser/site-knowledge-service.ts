import fs from 'fs';
import path from 'path';
import { getConfigDir } from '../settings-service.js';

const MAX_READ_BYTES = 8 * 1024;
const MAX_FINDING_LENGTH = 500;
const DEDUPE_WINDOW_MS = 60_000;
const DEDUPE_MAP_LIMIT = 500;
const DISCOVERY_HEADING = '## 探索发现（未验证，由会话追加）';

export interface SiteKnowledgeReadResult {
  exists: boolean;
  content: string;
}

export interface AppendFindingResult {
  ok: boolean;
  error?: string;
  deduplicated?: boolean;
}

const recentFindings = new Map<string, number>();

export function normalizeDomain(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  let host = trimmed;
  if (host.includes('://')) {
    try {
      host = new URL(host).hostname;
    } catch {
      return null;
    }
  } else {
    host = host.split('/')[0];
  }
  host = host.replace(/^www\./, '');
  if (!host || host.length > 253 || !/^[a-z0-9.-]+$/.test(host)) return null;
  const labels = host.split('.');
  if (labels.some((l) => !l || l.startsWith('-') || l.endsWith('-'))) return null;
  return host;
}

function knowledgeFile(domain: string): string {
  return path.join(getConfigDir(), 'site-knowledge', `${domain}.md`);
}

function todayStamp(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function skeleton(domain: string): string {
  return [
    `# ${domain} 站点档案`,
    '',
    '## 正式地图（已验证）',
    '（暂无，由人工或主会话审核「探索发现」后合并至此）',
    '',
    DISCOVERY_HEADING,
    '',
  ].join('\n');
}

function pruneRecentFindings(now: number): void {
  if (recentFindings.size < DEDUPE_MAP_LIMIT) return;
  for (const [key, at] of recentFindings) {
    if (now - at >= DEDUPE_WINDOW_MS) recentFindings.delete(key);
  }
}

export function readSiteKnowledge(domain: string): SiteKnowledgeReadResult {
  const normalized = normalizeDomain(domain);
  if (!normalized) return { exists: false, content: '' };
  const file = knowledgeFile(normalized);
  if (!fs.existsSync(file)) return { exists: false, content: '' };
  const raw = fs.readFileSync(file, 'utf8');
  const buf = Buffer.from(raw, 'utf8');
  if (buf.length <= MAX_READ_BYTES) return { exists: true, content: raw };
  const head = buf.subarray(0, MAX_READ_BYTES).toString('utf8').replace(/\uFFFD+$/, '');
  return {
    exists: true,
    content: `${head}\n\n---\n（站点档案超过 8KB，以上内容已截断，完整内容请查看档案文件）`,
  };
}

export function hasSiteKnowledge(domain: string): boolean {
  const normalized = normalizeDomain(domain);
  return normalized !== null && fs.existsSync(knowledgeFile(normalized));
}

export function appendSiteFinding(
  domain: string,
  finding: string,
  conversationId: string,
): AppendFindingResult {
  const normalized = normalizeDomain(domain);
  if (!normalized) return { ok: false, error: `域名不合法，无法写入站点档案：${domain}` };
  const text = finding.trim();
  if (!text) return { ok: false, error: '发现内容为空，无法写入站点档案' };
  if ([...text].length > MAX_FINDING_LENGTH) {
    return {
      ok: false,
      error: `发现内容过长（${[...text].length} 字，上限 ${MAX_FINDING_LENGTH} 字），请精炼后重试`,
    };
  }
  const now = Date.now();
  const dedupeKey = `${normalized}::${conversationId}::${text}`;
  const lastAt = recentFindings.get(dedupeKey);
  if (lastAt !== undefined && now - lastAt < DEDUPE_WINDOW_MS) {
    return { ok: true, deduplicated: true };
  }
  const dir = path.dirname(knowledgeFile(normalized));
  fs.mkdirSync(dir, { recursive: true });
  const file = knowledgeFile(normalized);
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, skeleton(normalized), 'utf8');
  } else if (!fs.readFileSync(file, 'utf8').includes(DISCOVERY_HEADING)) {
    fs.appendFileSync(file, `\n${DISCOVERY_HEADING}\n\n`, 'utf8');
  }
  const id8 = (conversationId || 'unknown').slice(0, 8);
  fs.appendFileSync(file, `- [${todayStamp()} · ${id8}] ${text}\n`, 'utf8');
  recentFindings.set(dedupeKey, now);
  pruneRecentFindings(now);
  return { ok: true };
}
