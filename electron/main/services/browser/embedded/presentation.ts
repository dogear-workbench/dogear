import { BrowserWindow, type Rectangle } from 'electron';
import { getEmbeddedBrowserManager, type EmbeddedBrowserManager } from './embedded-browser-manager.js';
import { waitTabReady } from './navigate.js';
import type { EmbeddedTabRecord } from './types.js';

export interface PresentationWindowSnapshot {
  windowId: number;
  tabId: string | null;
  hasPageView: boolean;
}

export type PresentTabInput = {
  tabId: string;
} | {
  url: string;
  workspaceId: string;
  holderId?: string;
};

export type PresentTabOutcome =
  | { ok: true; tabId: string; url: string; windowId: number | null; presented: boolean }
  | { ok: false; message: string };

type PresentationBroadcaster = (data: { windowId: number; tabId: string | null }) => void;

const PRESENT_HOLDER_ID = 'companion-present';
const PRESENT_READY_TIMEOUT_MS = 8_000;

const boundsByWindow = new Map<number, Rectangle>();
const tabIdByWindow = new Map<number, string>();
let broadcaster: PresentationBroadcaster | null = null;

export function setPresentationBroadcaster(fn: PresentationBroadcaster | null): void {
  broadcaster = fn;
}

/** companion 面板布局变化时上报页面视图区 bounds（null = 面板不可见/收起） */
export function reportPageViewBounds(win: BrowserWindow, bounds: Rectangle | null): void {
  pruneWindowEntries();
  if (win.isDestroyed()) return;
  if (!bounds) {
    if (!boundsByWindow.has(win.id)) return;
    boundsByWindow.delete(win.id);
    if (tabIdByWindow.has(win.id)) detachForWindow(win);
    return;
  }
  boundsByWindow.set(win.id, bounds);
  const tabId = tabIdByWindow.get(win.id);
  if (tabId) attachWithBounds(tabId, win, bounds);
}

/** 呈现 tab 到 companion 前台：tabId 直接呈现；url 开新 tab 加载后呈现（不占用 agent 当前 tab） */
export async function presentTab(
  manager: EmbeddedBrowserManager,
  input: PresentTabInput,
): Promise<PresentTabOutcome> {
  pruneWindowEntries();
  let record: EmbeddedTabRecord | null;
  let retained = false;
  if ('tabId' in input) {
    record = manager.getTabRecord(input.tabId);
    if (!record) return { ok: false, message: `内嵌浏览器标签不存在: ${input.tabId}` };
  } else {
    try {
      const existing = manager.listTabs().find((tab) => tab.url === input.url && tab.workspaceId === input.workspaceId);
      if (existing) {
        record = manager.getTabRecord(existing.tabId);
        if (!record) return { ok: false, message: '内嵌浏览器标签已关闭' };
      } else {
        const snapshot = manager.openTab({
          workspaceId: input.workspaceId,
          url: input.url,
          source: 'agent-opened',
          holderId: PRESENT_HOLDER_ID,
        });
        record = manager.getTabRecord(snapshot.tabId);
        if (!record) return { ok: false, message: '内嵌浏览器标签创建失败' };
        retained = true;
        await waitTabReady(record, PRESENT_READY_TIMEOUT_MS).catch(() => {});
      }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }
  if (record.view.webContents.isDestroyed()) return { ok: false, message: '内嵌浏览器标签已关闭' };
  if (retained) manager.retain(record.tabId, PRESENT_HOLDER_ID);
  const win = pickCompanionWindow();
  if (!win) {
    return { ok: true, tabId: record.tabId, url: record.url, windowId: null, presented: false };
  }
  attachWithBounds(record.tabId, win, boundsByWindow.get(win.id) ?? fullscreenBounds(win));
  return { ok: true, tabId: record.tabId, url: record.url, windowId: win.id, presented: true };
}

/** 收起呈现：tabId 缺省收起该窗口当前呈现的 tab；面板收起/关闭时也走这里 */
export function dismissPresentedTab(win: BrowserWindow, tabId?: string): void {
  const current = tabIdByWindow.get(win.id);
  if (!current || (tabId && current !== tabId)) return;
  tabIdByWindow.delete(win.id);
  const manager = getEmbeddedBrowserManager();
  manager.detachFromWindow(current);
  manager.release(current, PRESENT_HOLDER_ID);
  broadcastState(win.id, null);
}

export function detachForWindow(win: BrowserWindow): void {
  dismissPresentedTab(win);
}

export function getPresentationForWindow(win: BrowserWindow): PresentationWindowSnapshot {
  pruneWindowEntries();
  const tabId = tabIdByWindow.get(win.id) ?? null;
  return {
    windowId: win.id,
    tabId: tabId && getEmbeddedBrowserManager().getTabRecord(tabId) ? tabId : null,
    hasPageView: boundsByWindow.has(win.id),
  };
}

/** fetch 层静默呈现（登录墙/验证页递到用户面前）：优先 companion 页面视图，无面板时全屏兜底 */
export function presentRecordToCompanion(manager: EmbeddedBrowserManager, tab: EmbeddedTabRecord): void {
  pruneWindowEntries();
  const win = pickCompanionWindow();
  if (!win) {
    const fallback = BrowserWindow.getAllWindows().find((item) => !item.isDestroyed());
    if (!fallback) return;
    const contentBounds = fallback.getContentBounds();
    manager.attachToWindow(tab.tabId, fallback, {
      x: 0,
      y: 0,
      width: contentBounds.width,
      height: contentBounds.height,
    });
    return;
  }
  attachWithBounds(tab.tabId, win, boundsByWindow.get(win.id) ?? fullscreenBounds(win));
}

function attachWithBounds(tabId: string, win: BrowserWindow, bounds: Rectangle): void {
  const manager = getEmbeddedBrowserManager();
  for (const [windowId, heldTabId] of [...tabIdByWindow]) {
    if (heldTabId !== tabId || windowId === win.id) continue;
    tabIdByWindow.delete(windowId);
    broadcastState(windowId, null);
  }
  const current = tabIdByWindow.get(win.id);
  if (current && current !== tabId) {
    manager.detachFromWindow(current);
    manager.release(current, PRESENT_HOLDER_ID);
    tabIdByWindow.delete(win.id);
  }
  if (!manager.attachToWindow(tabId, win, bounds)) return;
  tabIdByWindow.set(win.id, tabId);
  broadcastState(win.id, tabId);
}

function pickCompanionWindow(): BrowserWindow | null {
  const withView = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed() && boundsByWindow.has(win.id));
  if (withView.length === 0) return null;
  return withView.find((win) => win.isFocused()) ?? withView[0];
}

function fullscreenBounds(win: BrowserWindow): Rectangle {
  const contentBounds = win.getContentBounds();
  return { x: 0, y: 0, width: contentBounds.width, height: contentBounds.height };
}

function pruneWindowEntries(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) continue;
    boundsByWindow.delete(win.id);
    tabIdByWindow.delete(win.id);
  }
}

function broadcastState(windowId: number, tabId: string | null): void {
  broadcaster?.({ windowId, tabId });
}
