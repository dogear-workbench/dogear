import {
  AX_FIND_DEPTH,
  AX_OBSERVE_DEPTH,
  MAX_HEADING_ELEMENTS,
  MAX_INTERACTIVE_ELEMENTS,
  collectAxCandidates,
  elementOf,
  summarizeByRole,
  type AxNodeSummary,
  type FindPayload,
  type ObserveElement,
  type ObservePayload,
  type ObserveRegion,
} from './ax-tree.js';
import { CDP_OBSERVE_TIMEOUT_MS, getCdpSession } from './cdp-session.js';
import { resolvePageState } from './page-state.js';
import type { EmbeddedTabRecord } from './types.js';

export const READ_MAX_CHARS = 8_000;

const REF_PATTERN = /^(\d+)@(\d+)$/;
const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

const VIEWPORT_QUERY = '(() => ({ width: window.innerWidth, height: window.innerHeight }))()';

const CONTAINER_TEXT_QUERY = `(() => {
  const trimmed = (el) => (el && el.innerText ? el.innerText : '');
  let best = '';
  document.querySelectorAll('article, main, [role="main"], #content, .content').forEach((el) => {
    if (trimmed(el).length > best.length) best = trimmed(el);
  });
  const text = best || trimmed(document.body);
  return { text: text.slice(0, ${READ_MAX_CHARS}), totalLength: text.length };
})()`;

export class RefExpiredError extends Error {
  constructor(ref: string, reason: string) {
    super(
      `ref "${ref}" 已失效（${reason}）。页面可能已导航、路由已变化或调试通道已重连，请重新调用 dogear__browser__observe_page 获取新 ref。`,
    );
    this.name = 'RefExpiredError';
  }
}

export function parseRef(ref: string): { backendNodeId: number; generation: number } | null {
  const match = REF_PATTERN.exec(ref.trim());
  if (!match) return null;
  return { backendNodeId: Number(match[1]), generation: Number(match[2]) };
}

/** ref 校验：generation 匹配当前 tab + backendNodeId 仍属于当前文档（describeNode 探活） */
export async function assertRefUsable(tab: EmbeddedTabRecord, ref: string): Promise<number> {
  const parsed = parseRef(ref);
  if (!parsed) throw new RefExpiredError(ref, '格式无法识别');
  if (parsed.generation !== tab.generation) {
    throw new RefExpiredError(ref, `记录代际 ${parsed.generation} ≠ 当前代际 ${tab.generation}`);
  }
  try {
    await getCdpSession(tab).send('DOM.describeNode', { backendNodeId: parsed.backendNodeId });
  } catch {
    throw new RefExpiredError(ref, '节点已不在当前文档');
  }
  return parsed.backendNodeId;
}

async function readViewport(tab: EmbeddedTabRecord): Promise<{ width: number; height: number }> {
  try {
    const result = (await tab.view.webContents.executeJavaScript(VIEWPORT_QUERY)) as
      | { width?: unknown; height?: unknown }
      | null;
    if (result && typeof result.height === 'number' && result.height > 0) {
      return { width: Number(result.width) || DEFAULT_VIEWPORT.width, height: result.height };
    }
  } catch {
    // 页面导航中执行环境暂不可用，用默认视口兜底
  }
  return DEFAULT_VIEWPORT;
}

async function readBox(
  cdp: ReturnType<typeof getCdpSession>,
  backendNodeId: number,
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  try {
    const response = await cdp.send<{ model?: { content?: number[] } }>('DOM.getBoxModel', { backendNodeId });
    const quad = response.model?.content;
    if (!Array.isArray(quad) || quad.length < 8) return null;
    const xs = [quad[0], quad[2], quad[4], quad[6]];
    const ys = [quad[1], quad[3], quad[5], quad[7]];
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const width = Math.max(...xs) - x;
    const height = Math.max(...ys) - y;
    if (width <= 0 || height <= 0) return null;
    return { x, y, width, height };
  } catch {
    return null;
  }
}

function regionOfBox(box: { y: number; height: number }, viewportHeight: number): ObserveRegion {
  const centerY = box.y + box.height / 2;
  if (centerY < viewportHeight / 3) return 'top';
  if (centerY > (viewportHeight * 2) / 3) return 'bottom';
  return 'middle';
}

export interface ObserveOptions {
  region?: ObserveRegion;
  textFilter?: string;
}

export async function observeTab(tab: EmbeddedTabRecord, opts: ObserveOptions = {}): Promise<ObservePayload> {
  const cdp = getCdpSession(tab);
  const response = await cdp.send<{ nodes?: unknown[] }>(
    'Accessibility.getFullAXTree',
    { depth: AX_OBSERVE_DEPTH },
    CDP_OBSERVE_TIMEOUT_MS,
  );
  const candidates = collectAxCandidates(Array.isArray(response.nodes) ? response.nodes : []);
  const viewport = await readViewport(tab);
  const generation = tab.generation;

  const interactive: AxNodeSummary[] = [];
  const headings: AxNodeSummary[] = [];
  const contextual: AxNodeSummary[] = [];
  for (const candidate of candidates) {
    if (candidate.interactive) interactive.push(candidate);
    else if (candidate.role === 'heading') headings.push(candidate);
    else contextual.push(candidate);
  }

  const regionCounts: Record<ObserveRegion, number> = { top: 0, middle: 0, bottom: 0 };
  const visibleInteractive: AxNodeSummary[] = [];
  for (const candidate of interactive) {
    const box = await readBox(cdp, candidate.backendNodeId);
    if (!box) continue;
    candidate.box = box;
    regionCounts[regionOfBox(box, viewport.height)] += 1;
    visibleInteractive.push(candidate);
  }

  const filterText = opts.textFilter?.trim().toLowerCase();
  const matches = (candidate: AxNodeSummary): boolean =>
    !filterText || `${candidate.name} ${candidate.hint}`.toLowerCase().includes(filterText);

  let selected = visibleInteractive.filter(matches);
  if (opts.region) {
    selected = selected.filter((candidate) => regionOfBox(candidate.box!, viewport.height) === opts.region);
  }
  const interactiveTruncated = selected.length > MAX_INTERACTIVE_ELEMENTS;
  const shownInteractive = selected.slice(0, MAX_INTERACTIVE_ELEMENTS);
  const shownHeadings = headings.filter(matches).slice(0, MAX_HEADING_ELEMENTS);
  const headingsTruncated = headings.filter(matches).length > shownHeadings.length;

  return {
    tabId: tab.tabId,
    url: tab.url,
    title: tab.title,
    generation,
    pageState: resolvePageState(tab),
    totalInteractive: visibleInteractive.length,
    shownInteractive: shownInteractive.length,
    regionCounts,
    elements: shownInteractive.map((candidate) => elementOf(candidate, generation)),
    headings: shownHeadings.map((candidate) => elementOf(candidate, generation)),
    roleSummary: summarizeByRole(contextual),
    truncated: interactiveTruncated || headingsTruncated,
  };
}

export interface FindQuery {
  role?: string;
  name?: string;
  exact?: boolean;
  maxResults?: number;
}

export async function findInTab(tab: EmbeddedTabRecord, query: FindQuery): Promise<FindPayload> {
  const role = query.role?.trim().toLowerCase();
  const name = query.name?.trim().toLowerCase();
  if (!role && !name) throw new Error('语义定位至少需要 role 或 name 参数');
  const maxResults = Math.min(Math.max(query.maxResults ?? 20, 1), 50);
  const cdp = getCdpSession(tab);
  const response = await cdp.send<{ nodes?: unknown[] }>(
    'Accessibility.getFullAXTree',
    { depth: AX_FIND_DEPTH },
    CDP_OBSERVE_TIMEOUT_MS,
  );
  const candidates = collectAxCandidates(Array.isArray(response.nodes) ? response.nodes : []);
  const generation = tab.generation;
  const elements: ObserveElement[] = [];
  for (const candidate of candidates) {
    if (role && candidate.role !== role) continue;
    const lowered = candidate.name.toLowerCase();
    if (name && (query.exact ? lowered !== name : !lowered.includes(name))) continue;
    elements.push(elementOf(candidate, generation));
    if (elements.length >= maxResults) break;
  }
  return {
    tabId: tab.tabId,
    url: tab.url,
    title: tab.title,
    generation,
    pageState: resolvePageState(tab),
    elements,
  };
}

export async function readTabText(
  tab: EmbeddedTabRecord,
  ref?: string,
): Promise<{ text: string; totalLength: number }> {
  if (ref) {
    const backendNodeId = await assertRefUsable(tab, ref);
    const cdp = getCdpSession(tab);
    let objectId: string | undefined;
    try {
      const resolved = await cdp.send<{ object?: { objectId?: string } }>('DOM.resolveNode', { backendNodeId });
      objectId = resolved.object?.objectId;
    } catch {
      throw new RefExpiredError(ref, '节点已不在当前文档');
    }
    if (!objectId) throw new RefExpiredError(ref, '节点已不在当前文档');
    const result = await cdp.send<{ result?: { value?: unknown } }>(
      'Runtime.callFunctionOn',
      {
        objectId,
        functionDeclaration: 'function () { return this && this.innerText !== undefined ? this.innerText : (this.textContent || ""); }',
        returnByValue: true,
      },
      CDP_OBSERVE_TIMEOUT_MS,
    );
    void cdp.send('Runtime.releaseObject', { objectId }).catch(() => undefined);
    const text = typeof result.result?.value === 'string' ? result.result.value : '';
    return { text: text.slice(0, READ_MAX_CHARS), totalLength: text.length };
  }
  try {
    const payload = (await tab.view.webContents.executeJavaScript(CONTAINER_TEXT_QUERY)) as
      | { text?: unknown; totalLength?: unknown }
      | null;
    if (payload && typeof payload.text === 'string') {
      return { text: payload.text, totalLength: Number(payload.totalLength) || payload.text.length };
    }
  } catch (err) {
    throw new Error(`页面执行环境暂不可用（可能正在导航）：${err instanceof Error ? err.message : String(err)}`);
  }
  return { text: '', totalLength: 0 };
}
