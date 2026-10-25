export interface GatewayTabEntry {
  tabId: number;
  title: string;
  url: string;
  generation: number;
}

export interface GatewayTabFields {
  /** 操作焦点 tab；NO_FOCUS_TAB_ID 表示无可用标签页（agent 窗口为空） */
  tabId: number;
  title: string;
  url: string;
  textPreview: string;
  generation: number;
  tabs: GatewayTabEntry[];
}

export const NO_FOCUS_TAB_ID = -1;

interface SnapshotInput {
  tabId?: unknown;
  title?: unknown;
  url?: unknown;
  textPreview?: unknown;
  generation?: unknown;
}

export function initialTabFields(tabId: number): GatewayTabFields {
  return { tabId, title: '', url: '', textPreview: '', generation: 0, tabs: [] };
}

function upsertEntry(tabs: GatewayTabEntry[], entry: GatewayTabEntry): GatewayTabEntry[] {
  const idx = tabs.findIndex((t) => t.tabId === entry.tabId);
  if (idx === -1) return [...tabs, entry];
  const next = tabs.slice();
  next[idx] = entry;
  return next;
}

export function applyTabSnapshot(fields: GatewayTabFields, message: SnapshotInput): GatewayTabFields {
  const tabId = typeof message.tabId === 'number' ? message.tabId : fields.tabId;
  const title = typeof message.title === 'string' ? message.title : '';
  const url = typeof message.url === 'string' ? message.url : '';
  const textPreview = typeof message.textPreview === 'string' ? message.textPreview : '';
  const isFocus = tabId === fields.tabId || fields.tabId === NO_FOCUS_TAB_ID;
  const generation =
    typeof message.generation === 'number' ? message.generation : isFocus ? fields.generation : 0;
  const tabs = upsertEntry(fields.tabs, { tabId, title, url, generation });
  if (!isFocus) return { ...fields, tabs };
  return { tabId, title, url, textPreview, generation, tabs };
}

export function adoptFocusedTab(
  fields: GatewayTabFields,
  tabId: number,
  partial: { url?: unknown; title?: unknown },
): GatewayTabFields {
  const existing = fields.tabs.find((t) => t.tabId === tabId);
  const title = typeof partial.title === 'string' && partial.title ? partial.title : existing?.title ?? '';
  const url = typeof partial.url === 'string' && partial.url ? partial.url : existing?.url ?? '';
  const generation = existing?.generation ?? 0;
  return {
    tabId,
    title,
    url,
    textPreview: '',
    generation,
    tabs: upsertEntry(fields.tabs, { tabId, title, url, generation }),
  };
}

export function removeClosedTab(
  fields: GatewayTabFields,
  closedTabId: number,
  focusedTabId: unknown,
): GatewayTabFields {
  const tabs = fields.tabs.filter((t) => t.tabId !== closedTabId);
  if (closedTabId !== fields.tabId) return { ...fields, tabs };
  const nextId = typeof focusedTabId === 'number' && focusedTabId !== closedTabId ? focusedTabId : null;
  if (nextId === null) {
    return { tabId: NO_FOCUS_TAB_ID, title: '', url: '', textPreview: '', generation: 0, tabs };
  }
  const next = tabs.find((t) => t.tabId === nextId);
  return {
    tabId: nextId,
    title: next?.title ?? '',
    url: next?.url ?? '',
    textPreview: '',
    generation: next?.generation ?? 0,
    tabs,
  };
}

interface ListItemInput {
  tabId?: unknown;
  title?: unknown;
  url?: unknown;
  focused?: unknown;
}

export function syncTabsFromList(fields: GatewayTabFields, data: unknown): GatewayTabFields {
  const raw = (data as { tabs?: unknown } | null | undefined)?.tabs;
  if (!Array.isArray(raw)) return fields;
  const items: Array<{ item: ListItemInput; tabId: number }> = [];
  for (const entry of raw) {
    const item = (entry ?? {}) as ListItemInput;
    if (typeof item.tabId === 'number' && !items.some((it) => it.tabId === item.tabId)) {
      items.push({ item, tabId: item.tabId });
    }
  }
  const focusedFromList = items.find((it) => it.item.focused === true)?.tabId ?? null;
  const tabs: GatewayTabEntry[] = items.map(({ item, tabId }) => {
    const existing = fields.tabs.find((t) => t.tabId === tabId);
    return {
      tabId,
      title: typeof item.title === 'string' && item.title ? item.title : existing?.title ?? '',
      url: typeof item.url === 'string' && item.url ? item.url : existing?.url ?? '',
      generation: existing?.generation ?? 0,
    };
  });
  if (!tabs.some((t) => t.tabId === fields.tabId)) {
    const focusEntry = fields.tabs.find((t) => t.tabId === fields.tabId);
    if (focusEntry) tabs.push(focusEntry);
  }
  let next: GatewayTabFields = { ...fields, tabs };
  if (fields.tabId === NO_FOCUS_TAB_ID && focusedFromList !== null) {
    const entry = tabs.find((t) => t.tabId === focusedFromList);
    next = {
      ...next,
      tabId: focusedFromList,
      title: entry?.title ?? '',
      url: entry?.url ?? '',
      textPreview: '',
      generation: entry?.generation ?? 0,
    };
  }
  return next;
}
