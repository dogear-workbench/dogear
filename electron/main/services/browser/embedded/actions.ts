import { assertRefUsable, RefExpiredError } from './ax-observe.js';
import { getCdpSession } from './cdp-session.js';
import { getEmbeddedBrowserManager } from './embedded-browser-manager.js';
import { resolvePageState } from './page-state.js';
import {
  assertSameGeneration,
  callFnOnNode,
  centerForNode,
  CLICK_VERIFY_DELAY_MS,
  resolveNodeObjectId,
  sleep,
} from './action-utils.js';
import type { EmbeddedPageState, EmbeddedTabRecord } from './types.js';

export type ActionGuardCode = 'guard_password' | 'guard_submit';

/** 动作语义级拦截（对齐扩展通道 guard 规则）：不是失败，是策略禁止 */
export class ActionGuardError extends Error {
  constructor(readonly code: ActionGuardCode, message: string) {
    super(message);
    this.name = 'ActionGuardError';
  }
}

const MAX_FILL_CHARS = 10_000;

const SUBMIT_CHECK_FN =
  'function () {\n' +
  '  const el = this;\n' +
  '  if (!el || !el.tagName) return false;\n' +
  '  const tag = el.tagName.toLowerCase();\n' +
  '  const type = (el.getAttribute("type") || "").toLowerCase();\n' +
  '  return (tag === "button" && type === "submit") ||\n' +
  '    (tag === "input" && (type === "submit" || type === "image")) ||\n' +
  '    (tag === "button" && !type && !!el.closest("form"));\n' +
  '}';

const PASSWORD_CHECK_FN =
  'function () {\n' +
  '  const el = this;\n' +
  '  if (!el || !el.tagName) return false;\n' +
  '  const tag = el.tagName.toLowerCase();\n' +
  '  const type = (el.getAttribute("type") || "").toLowerCase();\n' +
  '  if (tag === "input" && type === "password") return true;\n' +
  '  try { return !!(el.closest("form") && el.closest("form").querySelector(\'input[type="password"]\')); } catch (err) { return false; }\n' +
  '}';

const EDITABLE_CHECK_FN =
  'function () {\n' +
  '  const el = this;\n' +
  '  if (!el || !el.tagName) return false;\n' +
  '  const tag = el.tagName.toLowerCase();\n' +
  '  if (tag === "textarea" || tag === "select") return true;\n' +
  '  if (el.isContentEditable) return true;\n' +
  '  if (tag === "input") {\n' +
  '    const type = (el.getAttribute("type") || "text").toLowerCase();\n' +
  '    return ["button", "submit", "image", "file", "checkbox", "radio", "hidden", "reset"].indexOf(type) === -1;\n' +
  '  }\n' +
  '  return false;\n' +
  '}';

const VALUE_CHECK_FN =
  'function (expected) {\n' +
  '  const el = this;\n' +
  '  if (!el) return false;\n' +
  '  if (el.isContentEditable) return el.textContent === expected;\n' +
  '  return el.value === expected;\n' +
  '}';

const TAG_TYPE_FN =
  'function () {\n' +
  '  const el = this;\n' +
  '  if (!el || !el.tagName) return null;\n' +
  '  return { tag: el.tagName.toLowerCase(), type: (el.getAttribute("type") || "").toLowerCase() };\n' +
  '}';

const CHECKED_FN =
  'function () {\n' +
  '  const el = this;\n' +
  '  if (!el || typeof el.checked !== "boolean") return null;\n' +
  '  return el.checked;\n' +
  '}';

const SYNTHETIC_CLICK_FN =
  'function () {\n' +
  '  if (this && typeof this.click === "function") { this.click(); return true; }\n' +
  '  return false;\n' +
  '}';

const CLEAR_VALUE_FN =
  'function () {\n' +
  '  const el = this;\n' +
  '  if (!el) return false;\n' +
  '  if (el.isContentEditable) { el.textContent = ""; return true; }\n' +
  '  const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype\n' +
  '    : el.tagName === "SELECT" ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;\n' +
  '  const setter = Object.getOwnPropertyDescriptor(proto, "value");\n' +
  '  if (!setter || !setter.set) return false;\n' +
  '  setter.set.call(el, "");\n' +
  '  el.dispatchEvent(new Event("input", { bubbles: true }));\n' +
  '  return true;\n' +
  '}';

export interface ClickResult {
  ref: string;
  urlBefore: string;
  urlAfter: string;
  navigated: boolean;
  elementGone: boolean;
  /** 不导航但元素状态已翻转（checkbox/radio），据此跳过了 synthetic 兜底 */
  statusChanged?: boolean;
  /** keyboard = 真实键盘激活；synthetic = 输入管线不可用时的合成点击兜底（isTrusted=false） */
  method: 'keyboard' | 'synthetic';
  pageState: EmbeddedPageState;
}

async function readChecked(
  cdp: ReturnType<typeof getCdpSession>,
  objectId: string,
): Promise<boolean | null> {
  try {
    const value = await callFnOnNode<boolean>(cdp, objectId, CHECKED_FN);
    return typeof value === 'boolean' ? value : null;
  } catch {
    return null;
  }
}

export interface FillResult {
  ref: string;
  verified: boolean;
  pageState: EmbeddedPageState;
}

/** 真实输入事件点击：mouseMoved → mousePressed → mouseReleased（不用 DOM click() 合成） */
export async function clickTab(tab: EmbeddedTabRecord, ref: string): Promise<ClickResult> {
  getEmbeddedBrowserManager().ensureInputReady(tab.tabId);
  const backendNodeId = await assertRefUsable(tab, ref);
  const generation = tab.generation;
  const cdp = getCdpSession(tab);

  const objectId = await resolveNodeObjectId(cdp, backendNodeId, ref);
  const isSubmit = await callFnOnNode<boolean>(cdp, objectId, SUBMIT_CHECK_FN);
  if (isSubmit === true) {
    throw new ActionGuardError('guard_submit', '提交类操作本阶段未开放，请引导用户手动完成提交');
  }

  await cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId });
  assertSameGeneration(tab, generation, ref);
  await centerForNode(cdp, backendNodeId);
  assertSameGeneration(tab, generation, ref);

  const urlBefore = tab.url;
  // 主路径：真实键盘激活（DOM.focus + Enter/Space，isTrusted 事件）。
  // Electron/Windows 部分环境输入管线不投递（CDP 与 sendInputEvent 均被丢），
  // 无效果时降级合成点击（与扩展通道同级）并在结果中标注。
  let navigated = false;
  let statusChanged = false;
  try {
    await cdp.send('DOM.focus', { backendNodeId });
    assertSameGeneration(tab, generation, ref);
    const target = await callFnOnNode<{ tag: string; type: string }>(cdp, objectId, TAG_TYPE_FN);
    const useSpace = target?.tag === 'input' && (target.type === 'checkbox' || target.type === 'radio');
    const checkedBefore = useSpace ? await readChecked(cdp, objectId) : null;
    const keyEvent = useSpace
      ? { key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }
      : { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 };
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...keyEvent });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...keyEvent });
    await sleep(CLICK_VERIFY_DELAY_MS);
    navigated = tab.generation !== generation;
    if (!navigated && useSpace && checkedBefore !== null) {
      const checkedAfter = await readChecked(cdp, objectId);
      statusChanged = checkedAfter !== null && checkedAfter !== checkedBefore;
    }
  } catch (err) {
    if (err instanceof RefExpiredError || tab.generation !== generation) {
      navigated = true;
    } else {
      throw err;
    }
  }

  let method: ClickResult['method'] = 'keyboard';
  if (!navigated && !statusChanged) {
    method = 'synthetic';
    try {
      await callFnOnNode<boolean>(cdp, objectId, SYNTHETIC_CLICK_FN);
    } catch (err) {
      if (!(err instanceof RefExpiredError)) throw err;
    }
    await sleep(CLICK_VERIFY_DELAY_MS);
    navigated = tab.generation !== generation;
  }

  await sleep(CLICK_VERIFY_DELAY_MS);
  let elementGone = false;
  if (!navigated) {
    try {
      await cdp.send('DOM.describeNode', { backendNodeId });
    } catch {
      elementGone = true;
    }
  }
  const result: ClickResult = {
    ref,
    urlBefore,
    urlAfter: tab.url,
    navigated,
    elementGone,
    method,
    pageState: resolvePageState(tab),
  };
  if (statusChanged) result.statusChanged = true;
  return result;
}

export async function fillTab(tab: EmbeddedTabRecord, ref: string, value: string): Promise<FillResult> {
  if (!value.length) throw new Error('填写内容不能为空');
  if (value.length > MAX_FILL_CHARS) throw new Error(`单次填写不能超过 ${MAX_FILL_CHARS} 个字符`);
  getEmbeddedBrowserManager().ensureInputReady(tab.tabId);
  const backendNodeId = await assertRefUsable(tab, ref);
  const generation = tab.generation;
  const cdp = getCdpSession(tab);

  const objectId = await resolveNodeObjectId(cdp, backendNodeId, ref);
  const isPassword = await callFnOnNode<boolean>(cdp, objectId, PASSWORD_CHECK_FN);
  if (isPassword === true) {
    throw new ActionGuardError('guard_password', '密码类输入本阶段禁止，请引导用户手动填写密码');
  }
  const editable = await callFnOnNode<boolean>(cdp, objectId, EDITABLE_CHECK_FN);
  if (editable !== true) {
    throw new Error('目标元素不是可输入字段（input/textarea/select/contenteditable），请重新 observe_page 后选择');
  }

  await cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId });
  assertSameGeneration(tab, generation, ref);
  await cdp.send('DOM.focus', { backendNodeId });
  assertSameGeneration(tab, generation, ref);

  // 键盘全选（Ctrl+A）在输入管线不投递的环境无效；用 native setter 清空保证覆盖语义，insertText 输入真实文本
  await callFnOnNode<boolean>(cdp, objectId, CLEAR_VALUE_FN);
  await cdp.send('Input.insertText', { text: value });

  let verified = false;
  try {
    verified = (await callFnOnNode<boolean>(cdp, objectId, VALUE_CHECK_FN, [value])) === true;
  } catch {
    verified = false;
  }
  return { ref, verified, pageState: resolvePageState(tab) };
}

export function refExpiredMessage(err: unknown): string | null {
  return err instanceof RefExpiredError ? err.message : null;
}
