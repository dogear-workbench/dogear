import { assertRefUsable } from './ax-observe.js';
import { getCdpSession } from './cdp-session.js';
import { getEmbeddedBrowserManager } from './embedded-browser-manager.js';
import { resolvePageState } from './page-state.js';
import { assertSameGeneration, resolveNodeObjectId, sleep } from './action-utils.js';
import type { EmbeddedPageState, EmbeddedTabRecord } from './types.js';

const MAX_SCROLL_DELTA = 50_000;
const WHEEL_SETTLE_DELAY_MS = 250;
const WHEEL_VERIFY_DELAY_MS = 150;

export interface ScrollInput {
  /** 容器 ref；不传滚动文档 */
  ref?: string;
  /** 相对滚动像素（正向下），position 给定时忽略 */
  deltaY?: number;
  position?: 'top' | 'bottom';
}

export interface ScrollPosition {
  top: number;
  height: number;
  clientHeight: number;
}

export interface ScrollResult {
  target: 'document' | 'container';
  before: ScrollPosition;
  after: ScrollPosition;
  moved: boolean;
  pageState: EmbeddedPageState;
}

const DOCUMENT_POSITION_FN =
  '(() => { const el = document.scrollingElement || document.documentElement;' +
  ' return { top: Math.round(el.scrollTop), height: Math.round(el.scrollHeight), clientHeight: Math.round(el.clientHeight) }; })()';

const CONTAINER_SCROLL_FN =
  'function (input) {\n' +
  '  const el = this;\n' +
  '  if (!el || typeof el.scrollTo !== "function") return { ok: false, error: "目标不支持滚动" };\n' +
  '  const read = () => ({ top: Math.round(el.scrollTop), height: Math.round(el.scrollHeight), clientHeight: Math.round(el.clientHeight) });\n' +
  '  const before = read();\n' +
  '  const top = input.position === "top" ? 0' +
  '    : input.position === "bottom" ? Math.max(0, el.scrollHeight - el.clientHeight)' +
  '    : el.scrollTop + input.deltaY;\n' +
  '  el.scrollTo({ top, left: el.scrollLeft, behavior: "auto" });\n' +
  '  const after = read();\n' +
  '  return { ok: true, before, after, moved: before.top !== after.top };\n' +
  '}';

const DOCUMENT_SCROLL_FN =
  '(async (input) => {\n' +
  '  const el = document.scrollingElement || document.documentElement;\n' +
  '  const read = () => ({ top: Math.round(el.scrollTop), height: Math.round(el.scrollHeight), clientHeight: Math.round(el.clientHeight) });\n' +
  '  const top = input.position === "top" ? 0' +
  '    : input.position === "bottom" ? Math.max(0, el.scrollHeight - el.clientHeight)' +
  '    : el.scrollTop + input.deltaY;\n' +
  '  el.scrollTo({ top, left: el.scrollLeft, behavior: "auto" });\n' +
  '  return read();\n' +
  '})';

function assertScrollInput(input: ScrollInput): void {
  if (input.position !== undefined && input.position !== 'top' && input.position !== 'bottom') {
    throw new Error('position 仅支持 "top" 或 "bottom"');
  }
  if (input.position === undefined) {
    if (typeof input.deltaY !== 'number' || !Number.isFinite(input.deltaY) || input.deltaY === 0) {
      throw new Error('deltaY 与 position 至少提供一个，且 deltaY 不能为 0');
    }
    if (Math.abs(input.deltaY) > MAX_SCROLL_DELTA) {
      throw new Error(`单次滚动幅度不能超过 ${MAX_SCROLL_DELTA} 像素`);
    }
  }
}

async function readDocumentPosition(tab: EmbeddedTabRecord): Promise<ScrollPosition> {
  return (await tab.view.webContents.executeJavaScript(DOCUMENT_POSITION_FN)) as ScrollPosition;
}

/** 文档滚动优先用真实 wheel 事件（拟真）；wheel 未生效时回退 scrollTo 保证可靠 */
async function scrollDocument(tab: EmbeddedTabRecord, input: ScrollInput): Promise<ScrollResult> {
  const before = await readDocumentPosition(tab);
  if (input.position === undefined && input.deltaY !== undefined) {
    const viewport = (await tab.view.webContents.executeJavaScript(
      '(() => ({ width: window.innerWidth, height: window.innerHeight }))()',
    )) as { width?: unknown; height?: unknown };
    const x = Number(viewport.width) > 0 ? Number(viewport.width) / 2 : 640;
    const y = Number(viewport.height) > 0 ? Number(viewport.height) / 2 : 400;
    await tab.view.webContents.sendInputEvent({
      type: 'mouseWheel',
      x,
      y,
      deltaX: 0,
      deltaY: input.deltaY,
    });
    await sleep(WHEEL_SETTLE_DELAY_MS);
    const afterWheel = await readDocumentPosition(tab);
    if (afterWheel.top !== before.top) {
      await sleep(WHEEL_VERIFY_DELAY_MS);
      return {
        target: 'document',
        before,
        after: await readDocumentPosition(tab),
        moved: true,
        pageState: resolvePageState(tab),
      };
    }
  }
  const after = (await tab.view.webContents.executeJavaScript(
    `(${DOCUMENT_SCROLL_FN})(${JSON.stringify({ position: input.position, deltaY: input.deltaY ?? 0 })})`,
  )) as ScrollPosition;
  return { target: 'document', before, after, moved: before.top !== after.top, pageState: resolvePageState(tab) };
}

/** 容器内滚动走固定 scrollTo 函数（wheel 命中测试不可控，精确性优先） */
async function scrollContainer(tab: EmbeddedTabRecord, ref: string, input: ScrollInput): Promise<ScrollResult> {
  const backendNodeId = await assertRefUsable(tab, ref);
  const generation = tab.generation;
  const cdp = getCdpSession(tab);
  const objectId = await resolveNodeObjectId(cdp, backendNodeId, ref);
  assertSameGeneration(tab, generation, ref);
  const payload = { position: input.position, deltaY: input.deltaY ?? 0 };
  const result = await cdp.send<{ result?: { value?: { ok?: boolean; error?: string; before?: ScrollPosition; after?: ScrollPosition; moved?: boolean } } }>(
    'Runtime.callFunctionOn',
    { objectId, functionDeclaration: CONTAINER_SCROLL_FN, arguments: [{ value: payload }], returnByValue: true, awaitPromise: true },
  );
  const value = result.result?.value;
  if (!value || value.ok !== true) {
    throw new Error(value?.error ?? '容器滚动失败，请重新 observe_page 确认目标元素');
  }
  return {
    target: 'container',
    before: value.before!,
    after: value.after!,
    moved: value.moved === true,
    pageState: resolvePageState(tab),
  };
}

export async function scrollTab(tab: EmbeddedTabRecord, input: ScrollInput): Promise<ScrollResult> {
  assertScrollInput(input);
  if (input.position === undefined) getEmbeddedBrowserManager().ensureInputReady(tab.tabId);
  if (input.ref) return scrollContainer(tab, input.ref, input);
  return scrollDocument(tab, input);
}
