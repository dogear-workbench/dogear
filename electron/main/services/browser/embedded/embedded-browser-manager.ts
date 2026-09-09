import { WebContentsView, BrowserWindow, session, type Rectangle, type Session } from 'electron';
import { buildPersistentPartition, resolveProfileKey } from './profile.js';
import { applySessionProxy } from './proxy.js';
import { applyEmbeddedUserAgent } from './ua.js';
import { attachTabEvents } from './tab-events.js';
import { disposeCdpSession } from './cdp-session.js';
import type {
  EmbeddedTabRecord,
  EmbeddedTabSnapshot,
  EmbeddedWorkspaceRecord,
  OpenEmbeddedTabInput,
} from './types.js';

const IDLE_SWEEP_INTERVAL_MS = 30_000;
const IDLE_TAB_TTL_MS = 3 * 60 * 1000;
/** 滚动/viewport 需要确定尺寸与挂载态；屏外挂载对用户不可见（CDP 鼠标域在本环境不可用，见 actions.ts） */
const INPUT_OFFSCREEN_BOUNDS: Rectangle = { x: -32000, y: 0, width: 1280, height: 800 };

export class EmbeddedBrowserManager {
  private readonly workspaces = new Map<string, EmbeddedWorkspaceRecord>();
  private readonly uaAppliedSessions = new WeakSet<Session>();
  private idleTimer: NodeJS.Timeout | null = null;
  private disposed = false;

  constructor() {
    this.idleTimer = setInterval(() => this.sweepIdleTabs(), IDLE_SWEEP_INTERVAL_MS);
    this.idleTimer.unref();
  }

  openTab(input: OpenEmbeddedTabInput): EmbeddedTabSnapshot {
    if (this.disposed) throw new Error('[embedded-browser] 宿主已销毁，无法创建标签页');
    assertHttpUrl(input.url);
    const workspace = this.getOrCreateWorkspace(input.workspaceId);
    const tabId = `embedded-tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const view = new WebContentsView({
      webPreferences: {
        partition: workspace.partition,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });
    const tab: EmbeddedTabRecord = {
      tabId,
      source: input.source,
      workspaceId: input.workspaceId,
      view,
      url: input.url,
      title: '',
      generation: 0,
      state: 'loading',
      holders: new Set(),
      lastActivityAt: Date.now(),
      attachedWindow: null,
      bounds: null,
    };
    view.setVisible(false);
    view.webContents.setWindowOpenHandler(({ url: popupUrl }) => {
      console.warn('[embedded-browser] 已拦截新窗口请求:', popupUrl);
      return { action: 'deny' };
    });
    attachTabEvents(this, workspace, tab);
    workspace.tabs.set(tabId, tab);
    if (input.source === 'agent-opened' && !workspace.agentTabId) workspace.agentTabId = tabId;
    if (input.holderId) tab.holders.add(input.holderId);
    if (!input.skipInitialLoad) {
      void view.webContents.loadURL(input.url).catch((err) => {
        console.error('[embedded-browser] 初始导航失败:', input.url, err);
      });
    }
    return snapshotOf(tab);
  }

  closeTab(tabId: string): void {
    const found = this.findTab(tabId);
    if (!found) return;
    const { workspace, tab } = found;
    workspace.tabs.delete(tabId);
    this.detachView(tab);
    disposeCdpSession(tabId);
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    this.repairWorkspaceSelection(workspace, tabId);
    if (workspace.tabs.size === 0) this.workspaces.delete(workspace.profileKey);
  }

  retain(tabId: string, holderId: string): void {
    const found = this.findTab(tabId);
    if (!found) throw new Error(`内嵌浏览器标签不存在: ${tabId}`);
    found.tab.holders.add(holderId);
    found.tab.lastActivityAt = Date.now();
  }

  release(tabId: string, holderId: string): void {
    const found = this.findTab(tabId);
    if (!found) return;
    found.tab.holders.delete(holderId);
    found.tab.lastActivityAt = Date.now();
  }

  getTab(tabId: string): EmbeddedTabSnapshot | null {
    const found = this.findTab(tabId);
    return found ? snapshotOf(found.tab) : null;
  }

  getTabRecord(tabId: string): EmbeddedTabRecord | null {
    return this.findTab(tabId)?.tab ?? null;
  }

  getView(tabId: string): WebContentsView | null {
    const found = this.findTab(tabId);
    if (!found || found.tab.view.webContents.isDestroyed()) return null;
    return found.tab.view;
  }

  listTabs(): EmbeddedTabSnapshot[] {
    return [...this.workspaces.values()].flatMap((workspace) => [...workspace.tabs.values()].map(snapshotOf));
  }

  getAgentTabId(workspaceId: string): string | null {
    return this.getWorkspaceByWorkspaceId(workspaceId)?.agentTabId ?? null;
  }

  /** 把服务自建的抓取 tab（如 search/readArticle 失败保留页）切为 agent 当前 tab，供原子工具接管探索 */
  promoteToAgentTab(tabId: string): void {
    const found = this.findTab(tabId);
    if (!found) return;
    found.workspace.agentTabId = tabId;
    found.tab.lastActivityAt = Date.now();
  }

  /** 抓取类服务入口：确保 workspace session 存在并应用 PAC 代理（幂等；未配置代理时直连） */
  async ensureWorkspaceProxy(workspaceId: string, proxyServer: string | undefined): Promise<void> {
    const workspace = this.getOrCreateWorkspace(workspaceId);
    await applySessionProxy(workspace.session, proxyServer);
  }

  getActiveTabId(workspaceId: string): string | null {
    return this.getWorkspaceByWorkspaceId(workspaceId)?.activeTabId ?? null;
  }

  /** 滚动/视口类操作前置：确保 tab 已挂载宿主窗口获得确定视口尺寸，未挂载时屏外挂载 */
  ensureInputReady(tabId: string): void {
    const found = this.findTab(tabId);
    if (!found) throw new Error(`内嵌浏览器标签不存在: ${tabId}`);
    const { tab } = found;
    if (tab.view.webContents.isDestroyed()) throw new Error('内嵌浏览器标签已关闭');
    if (tab.attachedWindow && !tab.attachedWindow.isDestroyed() && tab.view.getVisible()) return;
    const host = BrowserWindow.getAllWindows().find((win) => !win.isDestroyed());
    if (!host) throw new Error('无可用宿主窗口，内嵌浏览器操作不可用');
    if (!this.attachToWindow(tabId, host, INPUT_OFFSCREEN_BOUNDS)) {
      throw new Error('内嵌浏览器挂载宿主窗口失败，操作不可用');
    }
  }

  attachToWindow(tabId: string, window: BrowserWindow, bounds?: Rectangle): boolean {
    const found = this.findTab(tabId);
    if (!found || window.isDestroyed() || found.tab.view.webContents.isDestroyed()) return false;
    const { workspace, tab } = found;
    if (tab.attachedWindow && !tab.attachedWindow.isDestroyed() && tab.attachedWindow !== window) {
      this.detachFromWindow(tabId);
    }
    try {
      if (tab.attachedWindow !== window) {
        window.contentView.addChildView(tab.view);
        tab.attachedWindow = window;
      }
      if (bounds) tab.bounds = bounds;
      if (tab.bounds) tab.view.setBounds(tab.bounds);
      tab.view.setVisible(true);
      tab.lastActivityAt = Date.now();
      workspace.activeTabId = tabId;
      return true;
    } catch (err) {
      console.error('[embedded-browser] 挂载标签页失败:', err);
      this.detachFromWindow(tabId);
      return false;
    }
  }

  detachFromWindow(tabId: string): void {
    const found = this.findTab(tabId);
    if (!found) return;
    this.detachView(found.tab);
  }

  handleTabDestroyed(workspace: EmbeddedWorkspaceRecord, tab: EmbeddedTabRecord): void {
    if (workspace.tabs.get(tab.tabId) !== tab) return;
    this.detachView(tab);
    disposeCdpSession(tab.tabId);
    workspace.tabs.delete(tab.tabId);
    this.repairWorkspaceSelection(workspace, tab.tabId);
    if (workspace.tabs.size === 0) this.workspaces.delete(workspace.profileKey);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.idleTimer) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
    for (const tabId of this.listTabs().map((tab) => tab.tabId)) {
      this.closeTab(tabId);
    }
    this.workspaces.clear();
  }

  private detachView(tab: EmbeddedTabRecord): void {
    try {
      tab.view.setVisible(false);
    } catch {
      return;
    }
    const owner = tab.attachedWindow;
    if (!owner) return;
    tab.attachedWindow = null;
    try {
      if (!owner.isDestroyed()) owner.contentView.removeChildView(tab.view);
    } catch {
      // owner 或 view 已被销毁
    }
  }

  private findTab(tabId: string): { workspace: EmbeddedWorkspaceRecord; tab: EmbeddedTabRecord } | null {
    for (const workspace of this.workspaces.values()) {
      const tab = workspace.tabs.get(tabId);
      if (tab) return { workspace, tab };
    }
    return null;
  }

  private getWorkspaceByWorkspaceId(workspaceId: string): EmbeddedWorkspaceRecord | null {
    return this.workspaces.get(resolveProfileKey(workspaceId)) ?? null;
  }

  private getOrCreateWorkspace(workspaceId: string): EmbeddedWorkspaceRecord {
    const profileKey = resolveProfileKey(workspaceId);
    const existing = this.workspaces.get(profileKey);
    if (existing) return existing;
    const partition = buildPersistentPartition(profileKey);
    const electronSession = session.fromPartition(partition);
    if (!this.uaAppliedSessions.has(electronSession)) {
      applyEmbeddedUserAgent(electronSession);
      this.uaAppliedSessions.add(electronSession);
    }
    const record: EmbeddedWorkspaceRecord = {
      workspaceId,
      profileKey,
      partition,
      session: electronSession,
      tabs: new Map(),
      agentTabId: null,
      activeTabId: null,
    };
    this.workspaces.set(profileKey, record);
    return record;
  }

  private repairWorkspaceSelection(workspace: EmbeddedWorkspaceRecord, removedTabId: string): void {
    if (workspace.agentTabId === removedTabId) workspace.agentTabId = null;
    if (workspace.activeTabId === removedTabId) workspace.activeTabId = null;
  }

  private sweepIdleTabs(): void {
    const now = Date.now();
    for (const workspace of [...this.workspaces.values()]) {
      for (const tab of [...workspace.tabs.values()]) {
        if (tab.holders.size > 0 || tab.attachedWindow) continue;
        if (now - tab.lastActivityAt < IDLE_TAB_TTL_MS) continue;
        console.log('[embedded-browser] 回收空闲标签页:', tab.tabId, tab.url);
        this.closeTab(tab.tabId);
      }
    }
  }
}

function assertHttpUrl(url: string): void {
  let protocol = '';
  try {
    protocol = new URL(url).protocol;
  } catch {
    throw new Error(`内嵌浏览器无法解析目标链接: ${url}`);
  }
  if (protocol !== 'http:' && protocol !== 'https:') {
    throw new Error(`内嵌浏览器仅支持 http(s) 链接: ${url}`);
  }
}

function snapshotOf(tab: EmbeddedTabRecord): EmbeddedTabSnapshot {
  return {
    tabId: tab.tabId,
    source: tab.source,
    workspaceId: tab.workspaceId,
    url: tab.url,
    title: tab.title,
    generation: tab.generation,
    state: tab.state,
    attached: !!tab.attachedWindow,
    holders: [...tab.holders],
  };
}

let managerInstance: EmbeddedBrowserManager | null = null;

export function getEmbeddedBrowserManager(): EmbeddedBrowserManager {
  if (!managerInstance) managerInstance = new EmbeddedBrowserManager();
  return managerInstance;
}
