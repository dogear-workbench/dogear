import { test, expect, mock, beforeAll, afterAll } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';

// embedded-browser-manager 顶层 named import electron（WebContentsView 等），bun test 无法解析；
// 测试只关心「无 tab → currentUrl 为 undefined」的路径，mock 成恒空 manager 断开 electron 依赖
mock.module('../../services/browser/embedded/embedded-browser-manager.js', () => ({
  getEmbeddedBrowserManager: () => ({
    getAgentTabId: () => null,
    getTabRecord: () => null,
  }),
}));

const { createBrowserSiteToolDefs } = await import('./browser-site-tools.js');
const { siteKnowledgePointer, sitePolicyPointer } = await import('./extension-site-tools.js');

let configDir: string;

beforeAll(() => {
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dogear-browser-site-tools-'));
  process.env.DOGEAR_CONFIG_DIR = configDir;
});

afterAll(() => {
  delete process.env.DOGEAR_CONFIG_DIR;
  fs.rmSync(configDir, { recursive: true, force: true });
});

function makeDefs(currentUrl?: () => string | undefined) {
  return createBrowserSiteToolDefs({ conversationId: 'conv-test', currentUrl });
}

function text(r: { content: Array<{ type: string; text: string }>; isError?: boolean }): string {
  return r.content.map((c) => c.text).join('\n');
}

test('工具名遵循 dogear__browser 前缀，描述无扩展通道独占表述', () => {
  const defs = makeDefs(() => 'https://example.com/a');
  expect(defs).toHaveLength(3);
  expect(defs[0]!.name).toBe('dogear__browser__site_knowledge');
  expect(defs[1]!.name).toBe('dogear__browser__site_finding');
  expect(defs[2]!.name).toBe('dogear__browser__site_policy');
  expect(defs[0]!.description).toContain('存储与扩展通道共用同一份档案');
  expect(defs[0]!.description).not.toContain('dogear__extension');
  expect(defs[1]!.description).not.toContain('dogear__extension');
  expect(defs[2]!.description).not.toContain('dogear__extension');
});

test('无 tab 时报错并引导先 navigate', async () => {
  const defs = makeDefs();
  const r = await defs[0]!.handler({});
  expect(r.isError).toBe(true);
  expect(text(r)).toContain('请先 dogear__browser__navigate 到目标站点');
});

test('无档案时正常返回冷启动引导（非错误），沉淀引导带内嵌前缀', async () => {
  const defs = makeDefs(() => 'https://no-archive-example.com/page');
  const r = await defs[0]!.handler({});
  expect(r.isError).toBeFalsy();
  const t = text(r);
  expect(t).toContain('暂无站点档案');
  expect(t).toContain('dogear__browser__site_finding');
  expect(t).not.toContain('read_state');
});

test('site_finding 追加成功，site_knowledge 返回档案内容（含探索发现）', async () => {
  const defs = makeDefs(() => 'https://append-example.com/page');
  const finding = '列表页直链拼法：/list?page=N 分页可用';
  const r1 = await defs[1]!.handler({ finding });
  expect(r1.isError).toBeFalsy();
  expect(text(r1)).toContain('已追加');
  const r2 = await defs[0]!.handler({});
  expect(r2.isError).toBeFalsy();
  const t = text(r2);
  expect(t).toContain('append-example.com 的站点档案');
  expect(t).toContain(finding);
});

test('超过 500 字的 finding 报错不写入', async () => {
  const defs = makeDefs(() => 'https://toolong-example.com/page');
  const r = await defs[1]!.handler({ finding: 'x'.repeat(501) });
  expect(r.isError).toBe(true);
  expect(text(r)).toContain('过长');
});

test('site_policy 命中策略返回指引与摘要，无策略域名正常返回非错误', async () => {
  const defs = makeDefs(() => 'https://www.xiaohongshu.com/explore/abc');
  const r = await defs[2]!.handler({});
  expect(r.isError).toBeFalsy();
  const t = text(r);
  expect(t).toContain('访问策略');
  expect(t).toContain('推荐步骤');
  expect(t).toContain('20 篇笔记');
  expect(t).toContain('5 次搜索');
  expect(t).toContain('15s-45s');
  expect(t).toContain('30s-90s');
  expect(t).toContain('危险信号');

  const noPolicy = makeDefs(() => 'https://plain-policy-example.com/a');
  const r2 = await noPolicy[2]!.handler({});
  expect(r2.isError).toBeFalsy();
  expect(text(r2)).toContain('无特殊访问策略');
});

test('siteKnowledgePointer 按前缀生成引导：无档案提示沉淀，有档案引导先读', async () => {
  const url = 'https://pointer-example.com/a';
  expect(siteKnowledgePointer(undefined)).toBeNull();
  expect(siteKnowledgePointer(url)).toContain('dogear__extension__site_finding');
  const browserPointer = siteKnowledgePointer(url, 'dogear__browser');
  expect(browserPointer).toContain('dogear__browser__site_finding');
  expect(browserPointer).not.toContain('dogear__extension');

  const defs = makeDefs(() => url);
  await defs[1]!.handler({ finding: 'pointer 域名建档' });

  const after = siteKnowledgePointer(url, 'dogear__browser');
  expect(after).toContain('dogear__browser__site_knowledge');
});

test('sitePolicyPointer 按前缀生成策略指针：无策略 null，有策略带工具名', () => {
  expect(sitePolicyPointer(undefined)).toBeNull();
  expect(sitePolicyPointer('https://plain-pointer.com/a')).toBeNull();

  const url = 'https://www.xiaohongshu.com/search_result?keyword=x';
  const ext = sitePolicyPointer(url);
  expect(ext).toContain('dogear__extension__site_policy');
  const browserPointer = sitePolicyPointer(url, 'dogear__browser');
  expect(browserPointer).toContain('dogear__browser__site_policy');
  expect(browserPointer).not.toContain('dogear__extension');
});
