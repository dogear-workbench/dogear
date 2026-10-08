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
const latestRevisionByWindow = new Map<number, number>();
const overlayHiddenByWindow = new Map<number, boolean>();
let broadcaster: PresentationBroadcaster | null = null;

export function setPresentationBroadcaster(fn: PresentationBroadcaster | null): void {
  broadcaster = fn;
}

/**
 * companion 面板布局变化时上报页面视图区 bounds（null = 面板不可见/收起）。
 * revision 为渲染层全局单调递增：旧实例晚到的低 revision 上报（如卸载 null）不得覆盖新布局。
 */
export function reportPageViewBounds(win: BrowserWindow, bounds: Rectangle | null, revision: number): void {
  pruneWindowEntries();
  if (win.isDestroyed()) return;
  if (revision <= (latestRevisionByWindow.get(win.id) ?? 0)) return;
  latestRevisionByWindow.set(win.id, revision);
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

/** 渲染层弹层遮挡视图区时临时隐藏画面：只切可见性，不碰 retain/release 与呈现状态 */
export function setOverlayHidden(win: BrowserWindow, hidden: boolean): void {
  pruneWindowEntries();
  if (win.isDestroyed()) return;
  if (hidden) {
    overlayHiddenByWindow.set(win.id, true);
    const tabId = tabIdByWindow.get(win.id);
    if (tabId) getEmbeddedBrowserManager().getView(tabId)?.setVisible(false);
    return;
  }
  overlayHiddenByWindow.delete(win.id);
  const tabId = tabIdByWindow.get(win.id);
  const record = tabId ? getEmbeddedBrowserManager().getTabRecord(tabId) : null;
  if (!record || record.view.webContents.isDestroyed()) return;
  if (record.attachedWindow === win) {
    record.view.setVisible(true);
    return;
  }
  const bounds = boundsByWindow.get(win.id);
  if (tabId && bounds) attachWithBounds(tabId, win, bounds);
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
  attachWithBounds(record.tabId, win, attachBoundsFor(record.tabId, win));
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
  attachWithBounds(tab.tabId, win, attachBoundsFor(tab.tabId, win));
}

/** agent 导航智能跟随：仅呈现为空或正呈现 agent 旧 tab 的面板窗口跟随（用户手动呈现的窗口不打扰）；无面板窗口时静默跳过 */
export function followAgentNavigation(
  manager: EmbeddedBrowserManager,
  fromTabId: string | null,
  toTabId: string,
): void {
  pruneWindowEntries();
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || !boundsByWindow.has(win.id)) continue;
    const presented = tabIdByWindow.get(win.id);
    if (presented !== undefined && presented !== fromTabId) continue;
    manager.retain(toTabId, PRESENT_HOLDER_ID);
    attachWithBounds(toTabId, win, attachBoundsFor(toTabId, win));
  }
}

/** 挂载 bounds：窗口已上报的视图区优先；其次该 tab 上次的用户可见位置（屏外挂载 bounds 不可用作呈现位置） */
function attachBoundsFor(tabId: string, win: BrowserWindow): Rectangle {
  const reported = boundsByWindow.get(win.id);
  if (reported) return reported;
  const last = getEmbeddedBrowserManager().getTabRecord(tabId)?.bounds;
  if (last && last.x > -16000 && last.y > -16000) return last;
  return fullscreenBounds(win);
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
  if (overlayHiddenByWindow.get(win.id)) manager.getView(tabId)?.setVisible(false);
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
    latestRevisionByWindow.delete(win.id);
    overlayHiddenByWindow.delete(win.id);
  }
}

function broadcastState(windowId: number, tabId: string | null): void {
  broadcaster?.({ windowId, tabId });
}
