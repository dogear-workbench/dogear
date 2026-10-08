import type { BrowserWindow, Rectangle } from 'electron';
import { loadSettings } from '../../settings-service.js';
import { DEFAULT_WEB_AI_SITES } from '../../settings-types.js';
import { getEmbeddedBrowserManager, WEBAI_WORKSPACE_ID } from './embedded-browser-manager.js';
import type { EmbeddedTabRecord, EmbeddedTabSnapshot } from './types.js';

const WEBAI_HOLDER_ID = 'webai';

let webaiTabId: string | null = null;
let webaiUrl = DEFAULT_WEB_AI_SITES[0].url;

// 兜底首项与 settings.webAiSites 对齐；openWebAiSite 每次以实际切换的 url 覆盖
void loadSettings()
  .then((s) => {
    const first = s.webAiSites?.[0]?.url;
    if (first) webaiUrl = first;
  })
  .catch((err) => console.error('[webai] 读取站点配置失败:', err));
let latestRevision = 0;
let overlayHidden = false;
let reportedWin: BrowserWindow | null = null;
let reportedBounds: Rectangle | null = null;

function ensureTab(): EmbeddedTabRecord {
  const manager = getEmbeddedBrowserManager();
  const existing = webaiTabId ? manager.getTabRecord(webaiTabId) : null;
  if (existing && !existing.view.webContents.isDestroyed()) return existing;
  const snapshot = manager.openTab({
    workspaceId: WEBAI_WORKSPACE_ID,
    url: webaiUrl,
    source: 'user-connected',
    holderId: WEBAI_HOLDER_ID,
  });
  webaiTabId = snapshot.tabId;
  const record = manager.getTabRecord(snapshot.tabId);
  if (!record) throw new Error('网页 AI 标签创建失败');
  return record;
}

function attachWebAi(record: EmbeddedTabRecord): void {
  if (!reportedWin || reportedWin.isDestroyed() || !reportedBounds) return;
  const manager = getEmbeddedBrowserManager();
  if (!manager.attachToWindow(record.tabId, reportedWin, reportedBounds)) return;
  if (overlayHidden) manager.getView(record.tabId)?.setVisible(false);
}

export function getWebAiState(): EmbeddedTabSnapshot | null {
  if (!webaiTabId) return null;
  return getEmbeddedBrowserManager().getTab(webaiTabId);
}

export async function openWebAiSite(win: BrowserWindow | null, url: string): Promise<EmbeddedTabSnapshot> {
  webaiUrl = url;
  if (win && !win.isDestroyed()) {
    reportedWin = win;
    if (!reportedBounds) reportedBounds = fullscreenBounds(win);
  }
  const record = ensureTab();
  if (record.view.webContents.getURL() !== url) {
    await record.view.webContents.loadURL(url).catch((err) => {
      console.error('[webai] 站点导航失败:', url, err);
    });
  }
  attachWebAi(record);
  const snapshot = getWebAiState();
  if (!snapshot) throw new Error('网页 AI 标签已关闭');
  return snapshot;
}

export function reportWebAiBounds(win: BrowserWindow, bounds: Rectangle | null, revision: number): void {
  if (win.isDestroyed()) return;
  if (revision <= latestRevision) return;
  latestRevision = revision;
  const manager = getEmbeddedBrowserManager();
  const record = webaiTabId ? manager.getTabRecord(webaiTabId) : null;
  if (!bounds) {
    reportedWin = null;
    reportedBounds = null;
    if (record) manager.detachFromWindow(record.tabId);
    return;
  }
  reportedWin = win;
  reportedBounds = bounds;
  attachWebAi(record ?? ensureTab());
}

export function setWebAiOverlayHidden(win: BrowserWindow, hidden: boolean): void {
  overlayHidden = hidden;
  const manager = getEmbeddedBrowserManager();
  const record = webaiTabId ? manager.getTabRecord(webaiTabId) : null;
  if (!record || record.view.webContents.isDestroyed()) return;
  if (hidden) {
    manager.getView(record.tabId)?.setVisible(false);
    return;
  }
  if (record.attachedWindow === win && !win.isDestroyed()) record.view.setVisible(true);
}

/** 关闭网页 AI：销毁 embedded tab 释放内存，分区与登录态保留 */
export function closeWebAiTab(): void {
  if (!webaiTabId) return;
  const tabId = webaiTabId;
  webaiTabId = null;
  reportedWin = null;
  reportedBounds = null;
  getEmbeddedBrowserManager().closeTab(tabId);
}

function fullscreenBounds(win: BrowserWindow): Rectangle {
  const contentBounds = win.getContentBounds();
  return { x: 0, y: 0, width: contentBounds.width, height: contentBounds.height };
}
