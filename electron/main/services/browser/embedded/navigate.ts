import type { EmbeddedBrowserManager } from './embedded-browser-manager.js';
import type { EmbeddedTabRecord, EmbeddedTabSnapshot } from './types.js';

const NAVIGATE_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 150;

export async function navigateTab(
  manager: EmbeddedBrowserManager,
  workspaceId: string,
  url: string,
  holderId: string,
): Promise<{ snapshot: EmbeddedTabSnapshot; record: EmbeddedTabRecord; navigated: boolean }> {
  const existingTabId = manager.getAgentTabId(workspaceId);
  const existing = existingTabId ? manager.getTabRecord(existingTabId) : null;
  if (!existing) {
    const snapshot = manager.openTab({ workspaceId, url, source: 'agent-opened', holderId });
    const record = manager.getTabRecord(snapshot.tabId);
    if (!record) throw new Error('内嵌浏览器标签创建失败');
    await waitReady(record);
    return { snapshot: snapshotOf(manager, snapshot.tabId), record, navigated: true };
  }
  const generationBefore = existing.generation;
  try {
    await existing.view.webContents.loadURL(url);
  } catch (err) {
    throw new Error(`导航失败：${err instanceof Error ? err.message : String(err)}`);
  }
  await waitReady(existing);
  return {
    snapshot: snapshotOf(manager, existing.tabId),
    record: existing,
    navigated: existing.generation !== generationBefore,
  };
}

async function waitReady(record: EmbeddedTabRecord): Promise<void> {
  const deadline = Date.now() + NAVIGATE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (record.view.webContents.isDestroyed()) throw new Error('内嵌浏览器标签已关闭');
    if (record.state !== 'loading') return;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`页面加载超时（${NAVIGATE_TIMEOUT_MS / 1000}s），当前状态: ${record.state}，可稍后重试或直接观察当前页面`);
}

function snapshotOf(manager: EmbeddedBrowserManager, tabId: string): EmbeddedTabSnapshot {
  const snapshot = manager.getTab(tabId);
  if (!snapshot) throw new Error('内嵌浏览器标签不存在');
  return snapshot;
}
