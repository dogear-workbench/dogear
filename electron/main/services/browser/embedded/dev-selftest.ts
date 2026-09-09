import { getEmbeddedBrowserManager } from './embedded-browser-manager.js';

const SELFTEST_URL = 'https://example.com/';
const SELFTEST_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 200;

export async function runEmbeddedBrowserSelfTest(): Promise<void> {
  const manager = getEmbeddedBrowserManager();
  const tab = manager.openTab({
    workspaceId: 'embedded-selftest',
    url: SELFTEST_URL,
    source: 'agent-opened',
    holderId: 'selftest',
  });
  const deadline = Date.now() + SELFTEST_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const snap = manager.getTab(tab.tabId);
    if (snap && snap.state !== 'loading' && snap.title) break;
    await sleep(POLL_INTERVAL_MS);
  }
  const snap = manager.getTab(tab.tabId);
  if (!snap) throw new Error('自测标签页已丢失');
  console.log('[embedded-selftest]', JSON.stringify({
    url: snap.url,
    title: snap.title,
    state: snap.state,
    generation: snap.generation,
  }));
  if (!snap.title) throw new Error(`自测未拿到页面标题（state=${snap.state}, url=${snap.url}）`);
  manager.release(tab.tabId, 'selftest');
  manager.closeTab(tab.tabId);
  console.log('[embedded-selftest] 通过');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
