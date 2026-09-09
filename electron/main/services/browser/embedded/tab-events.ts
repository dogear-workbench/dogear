import type { EmbeddedBrowserManager } from './embedded-browser-manager.js';
import type { EmbeddedTabRecord, EmbeddedWorkspaceRecord } from './types.js';

export function attachTabEvents(
  manager: EmbeddedBrowserManager,
  workspace: EmbeddedWorkspaceRecord,
  tab: EmbeddedTabRecord,
): void {
  const contents = tab.view.webContents;
  const touch = () => {
    tab.lastActivityAt = Date.now();
  };

  contents.on('did-start-loading', () => {
    if (!isTabCurrent(workspace, tab)) return;
    tab.generation += 1;
    tab.state = 'loading';
    touch();
  });

  contents.on('did-navigate', (_event, url) => {
    if (!isTabCurrent(workspace, tab)) return;
    tab.url = url;
    touch();
  });

  contents.on('did-navigate-in-page', (_event, url) => {
    if (!isTabCurrent(workspace, tab)) return;
    tab.url = url;
    tab.generation += 1;
    touch();
  });

  contents.on('did-stop-loading', () => {
    if (!isTabCurrent(workspace, tab)) return;
    if (tab.state !== 'crashed') tab.state = 'ready';
    touch();
  });

  contents.on('page-title-updated', (_event, title) => {
    if (!isTabCurrent(workspace, tab)) return;
    tab.title = title;
    touch();
  });

  contents.on('render-process-gone', (_event, details) => {
    if (!isTabCurrent(workspace, tab)) return;
    tab.state = 'crashed';
    console.error('[embedded-browser] 渲染进程退出:', details.reason);
  });

  contents.on('destroyed', () => {
    manager.handleTabDestroyed(workspace, tab);
  });
}

function isTabCurrent(workspace: EmbeddedWorkspaceRecord, tab: EmbeddedTabRecord): boolean {
  return workspace.tabs.get(tab.tabId) === tab && !tab.view.webContents.isDestroyed();
}
