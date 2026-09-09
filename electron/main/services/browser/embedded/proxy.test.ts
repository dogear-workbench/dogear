import { describe, expect, test } from 'bun:test';
import { applySessionProxy, buildProxyPacUrl, proxyPacEntry } from './proxy.js';

function mockSession(): { calls: unknown[]; session: never } {
  const calls: unknown[] = [];
  const session = {
    setProxy: (config: unknown) => {
      calls.push(config);
      return Promise.resolve();
    },
  };
  return { calls, session: session as never };
}

describe('proxyPacEntry', () => {
  test('socks 系前缀映射为 SOCKS 条目', () => {
    expect(proxyPacEntry('socks5://127.0.0.1:1080')).toBe('SOCKS 127.0.0.1:1080');
    expect(proxyPacEntry('SOCKS5://proxy.local:1080')).toBe('SOCKS proxy.local:1080');
    expect(proxyPacEntry('socks4://127.0.0.1:1080')).toBe('SOCKS 127.0.0.1:1080');
    expect(proxyPacEntry('socks://127.0.0.1:1080')).toBe('SOCKS 127.0.0.1:1080');
  });

  test('http(s):// 与裸 host:port 映射为 PROXY 条目', () => {
    expect(proxyPacEntry('http://127.0.0.1:8080')).toBe('PROXY 127.0.0.1:8080');
    expect(proxyPacEntry('https://127.0.0.1:8443')).toBe('PROXY 127.0.0.1:8443');
    expect(proxyPacEntry('127.0.0.1:8080')).toBe('PROXY 127.0.0.1:8080');
    expect(proxyPacEntry(' proxy.local:9090 ')).toBe('PROXY proxy.local:9090');
  });

  test('空输入与无端点前缀返回 null', () => {
    expect(proxyPacEntry(undefined)).toBeNull();
    expect(proxyPacEntry('')).toBeNull();
    expect(proxyPacEntry('   ')).toBeNull();
    expect(proxyPacEntry('socks5://')).toBeNull();
    expect(proxyPacEntry('http://')).toBeNull();
  });

  test('剥除引号与反斜杠（PAC 字符串注入防护）', () => {
    expect(proxyPacEntry('"127.0.0.1:8080"')).toBe('PROXY 127.0.0.1:8080');
  });
});

describe('buildProxyPacUrl', () => {
  test('PAC 脚本按域名匹配返回代理条目', () => {
    const url = buildProxyPacUrl('socks5://127.0.0.1:1080');
    expect(url).toStartWith('data:text/plain,');
    const script = decodeURIComponent(url!.slice('data:text/plain,'.length));
    expect(script).toContain('return "SOCKS 127.0.0.1:1080"');
    expect(script).toContain('dnsDomainIs(host,".google.com")||host==="google.com"');
    expect(script).toContain('return "DIRECT"');
  });

  test('裸 host:port 生成 PROXY 条目', () => {
    const script = decodeURIComponent(buildProxyPacUrl('127.0.0.1:8080')!.slice(17));
    expect(script).toContain('return "PROXY 127.0.0.1:8080"');
  });

  test('空配置返回 null', () => {
    expect(buildProxyPacUrl('')).toBeNull();
    expect(buildProxyPacUrl(undefined)).toBeNull();
  });
});

describe('applySessionProxy', () => {
  test('空配置显式回直连（清除 session 残留的 pac_script）', async () => {
    const { calls, session } = mockSession();
    await applySessionProxy(session, '');
    expect(calls).toEqual([{ mode: 'direct' }]);
  });

  test('有配置时设置 pac_script', async () => {
    const { calls, session } = mockSession();
    await applySessionProxy(session, 'socks5://127.0.0.1:1080');
    expect(calls).toHaveLength(1);
    const config = calls[0] as { mode: string; pacScript: string };
    expect(config.mode).toBe('pac_script');
    expect(config.pacScript).toStartWith('data:text/plain,');
    expect(decodeURIComponent(config.pacScript.slice(17))).toContain('SOCKS 127.0.0.1:1080');
  });
});
