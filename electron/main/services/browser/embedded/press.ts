import { getCdpSession } from './cdp-session.js';
import { getEmbeddedBrowserManager } from './embedded-browser-manager.js';
import { resolvePageState } from './page-state.js';
import type { EmbeddedPageState, EmbeddedTabRecord } from './types.js';

const MAX_PRESS_TEXT_CHARS = 10_000;

/**
 * 导航键派发必须带 windowsVirtualKeyCode，Chromium 才会识别为真实按键并触发
 * 默认行为（PageDown 滚动、Enter 提交、Tab 移动焦点）。
 */
const NAVIGATION_KEY_CODES: Record<string, { code: string; windowsVirtualKeyCode: number }> = {
  Enter: { code: 'Enter', windowsVirtualKeyCode: 13 },
  Tab: { code: 'Tab', windowsVirtualKeyCode: 9 },
  Escape: { code: 'Escape', windowsVirtualKeyCode: 27 },
  ArrowUp: { code: 'ArrowUp', windowsVirtualKeyCode: 38 },
  ArrowDown: { code: 'ArrowDown', windowsVirtualKeyCode: 40 },
  ArrowLeft: { code: 'ArrowLeft', windowsVirtualKeyCode: 37 },
  ArrowRight: { code: 'ArrowRight', windowsVirtualKeyCode: 39 },
  Backspace: { code: 'Backspace', windowsVirtualKeyCode: 8 },
  Delete: { code: 'Delete', windowsVirtualKeyCode: 46 },
  Home: { code: 'Home', windowsVirtualKeyCode: 36 },
  End: { code: 'End', windowsVirtualKeyCode: 35 },
  PageUp: { code: 'PageUp', windowsVirtualKeyCode: 33 },
  PageDown: { code: 'PageDown', windowsVirtualKeyCode: 34 },
};

export type PressAction = { kind: 'key'; key: string; code: string; windowsVirtualKeyCode: number } | { kind: 'text'; text: string };

export function parsePressAction(input: string): PressAction {
  const keyCode = NAVIGATION_KEY_CODES[input];
  if (keyCode) return { kind: 'key', key: input, ...keyCode };
  if (input === 'Space') return { kind: 'text', text: ' ' };
  if (!input) throw new Error('按键参数不能为空：导航键（如 Enter/PageDown）或非空文本');
  if (input.length > MAX_PRESS_TEXT_CHARS) throw new Error(`单次输入不能超过 ${MAX_PRESS_TEXT_CHARS} 个字符`);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(input)) throw new Error('输入文本包含不支持的控制字符');
  return { kind: 'text', text: input };
}

export interface PressResult {
  url: string;
  pageState: EmbeddedPageState;
}

/** 作用于当前聚焦元素（真实键盘语义）；不主动聚焦目标，需要时先 fill 或 click */
export async function pressTab(tab: EmbeddedTabRecord, key: string): Promise<PressResult> {
  const action = parsePressAction(key);
  getEmbeddedBrowserManager().ensureInputReady(tab.tabId);
  const cdp = getCdpSession(tab);
  if (action.kind === 'key') {
    const keyEvent = { key: action.key, code: action.code, windowsVirtualKeyCode: action.windowsVirtualKeyCode };
    await cdp.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...keyEvent });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...keyEvent });
  } else {
    await cdp.send('Input.insertText', { text: action.text });
  }
  return { url: tab.url, pageState: resolvePageState(tab) };
}
