import { findInTab, observeTab, parseRef, readTabText, RefExpiredError } from './ax-observe.js';
import { getEmbeddedBrowserManager } from './embedded-browser-manager.js';
import { navigateTab } from './navigate.js';
import { waitForTabCondition } from './wait-for.js';

const SELFTEST_URL = 'https://example.com/';
const SELFTEST_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 200;

export async function runEmbeddedBrowserSelfTest(): Promise<void> {
  const manager = getEmbeddedBrowserManager();
  manager.openTab({
    workspaceId: 'embedded-selftest',
    url: SELFTEST_URL,
    source: 'agent-opened',
    holderId: 'selftest',
  });
  await waitForReady(manager);
  const tabId = manager.getAgentTabId('embedded-selftest');
  const tab = tabId ? manager.getTabRecord(tabId) : null;
  if (!tab) throw new Error('自测标签页已丢失');

  const observe = await observeTab(tab);
  console.log('[embedded-selftest] observe:', JSON.stringify({
    url: observe.url,
    title: observe.title,
    state: observe.pageState,
    generation: observe.generation,
    interactive: observe.elements.length,
    headings: observe.headings.map((el) => el.text),
    regionCounts: observe.regionCounts,
  }));
  const link = observe.elements.find((el) => el.role === 'link' && !!el.href);
  if (!link) {
    console.log('[embedded-selftest] elements:', JSON.stringify(observe.elements, null, 2));
    throw new Error(`观察未发现预期链接（interactive=${observe.elements.length}）`);
  }
  if (!parseRef(link.ref)) throw new Error(`ref 格式异常: ${link.ref}`);

  const found = await findInTab(tab, { role: 'link' });
  if (found.elements.length === 0) throw new Error('find 未命中已知存在的链接');

  const elementText = await readTabText(tab, link.ref);
  const containerText = await readTabText(tab);
  console.log('[embedded-selftest] read_text:', JSON.stringify({
    ref: link.ref,
    chars: elementText.totalLength,
    containerChars: containerText.totalLength,
  }));
  if (elementText.totalLength === 0) throw new Error('按 ref 读取文本为空');
  if (!containerText.text.includes('Example Domain')) throw new Error('容器文本未包含页面标题');

  tab.generation += 1;
  let expired = false;
  try {
    await readTabText(tab, link.ref);
  } catch (err) {
    expired = err instanceof RefExpiredError;
    if (!expired) throw err;
  }
  if (!expired) throw new Error('generation 变化后 ref 校验未拦截');

  const nav = await navigateTab(manager, 'embedded-selftest', 'https://www.iana.org/domains/example', 'selftest');
  console.log('[embedded-selftest] navigate:', JSON.stringify({
    url: nav.snapshot.url,
    state: nav.snapshot.state,
    generationBefore: observe.generation,
    generationAfter: nav.snapshot.generation,
  }));
  if (!nav.snapshot.url.includes('iana.org')) throw new Error('导航未生效');
  if (nav.snapshot.generation <= observe.generation) {
    throw new Error(`二次导航 generation 应递增，实际 ${observe.generation} → ${nav.snapshot.generation}`);
  }
  const wait = await waitForTabCondition(nav.record, { urlContains: 'iana.org', timeoutSec: 5 });
  if (!wait.matched) throw new Error('wait_for 未命中 url 条件');

  manager.release(tab.tabId, 'selftest');
  manager.closeTab(tab.tabId);
  console.log('[embedded-selftest] 通过');
}

async function waitForReady(manager: ReturnType<typeof getEmbeddedBrowserManager>): Promise<void> {
  const deadline = Date.now() + SELFTEST_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const snap = manager.getTab(manager.getAgentTabId('embedded-selftest') ?? '');
    if (snap && snap.state !== 'loading' && snap.title) return;
    await sleep(POLL_INTERVAL_MS);
  }
  const snap = manager.getTab(manager.getAgentTabId('embedded-selftest') ?? '');
  throw new Error(`自测页面加载超时（state=${snap?.state ?? 'unknown'}, url=${snap?.url ?? ''}）`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
