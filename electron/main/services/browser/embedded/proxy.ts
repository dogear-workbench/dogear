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

export function buildProxyPacUrl(proxyServer: string | undefined): string | null {
  const proxy = (proxyServer ?? '').trim().replace(/["\\]/g, '');
  if (!proxy) return null;
  const rules = PAC_PROXY_DOMAINS.map((d) => `dnsDomainIs(host,".${d}")||host==="${d}"`).join('||');
  const script = `function FindProxyForURL(url,host){if(${rules})return "PROXY ${proxy}";return "DIRECT";}`;
  return `data:text/plain,${encodeURIComponent(script)}`;
}

export async function applySessionProxy(electronSession: Session, proxyServer: string | undefined): Promise<void> {
  const pacUrl = buildProxyPacUrl(proxyServer);
  if (!pacUrl) return;
  await electronSession.setProxy({ mode: 'pac_script', pacScript: pacUrl });
}
