import type { Session } from 'electron';

const PAC_PROXY_DOMAINS = [
  'google.com',
  'googleusercontent.com',
  'gstatic.com',
  'googleapis.com',
  'ggpht.com',
  'duckduckgo.com',
  'reddit.com',
  'redditstatic.com',
  'redd.it',
];

const PROXY_SCHEME_RE = /^([a-z][a-z0-9+.-]*):\/\//i;

/** 用户输入归一为 PAC 条目：socks*:// → SOCKS，http(s):// 或裸 host:port → PROXY；空/无法解析返回 null（直连） */
export function proxyPacEntry(proxyServer: string | undefined): string | null {
  const raw = (proxyServer ?? '').trim().replace(/["\\]/g, '');
  if (!raw) return null;
  const match = PROXY_SCHEME_RE.exec(raw);
  if (!match) return `PROXY ${raw}`;
  const endpoint = raw.slice(match[0].length);
  if (!endpoint) return null;
  return `${match[1].toLowerCase().startsWith('socks') ? 'SOCKS' : 'PROXY'} ${endpoint}`;
}

export function buildProxyPacUrl(proxyServer: string | undefined): string | null {
  const entry = proxyPacEntry(proxyServer);
  if (!entry) return null;
  const rules = PAC_PROXY_DOMAINS.map((d) => `dnsDomainIs(host,".${d}")||host==="${d}"`).join('||');
  const script = `function FindProxyForURL(url,host){if(${rules})return "${entry}";return "DIRECT";}`;
  return `data:text/plain,${encodeURIComponent(script)}`;
}

export async function applySessionProxy(electronSession: Session, proxyServer: string | undefined): Promise<void> {
  const pacUrl = buildProxyPacUrl(proxyServer);
  if (!pacUrl) {
    // 空配置必须显式回直连：session 会保留上一次设置的 pac_script
    await electronSession.setProxy({ mode: 'direct' });
    return;
  }
  await electronSession.setProxy({ mode: 'pac_script', pacScript: pacUrl });
}
