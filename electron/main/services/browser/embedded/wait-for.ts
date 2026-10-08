import type { EmbeddedTabRecord } from './types.js';

const POLL_INTERVAL_MS = 400;

export interface WaitForQuery {
  text?: string;
  urlContains?: string;
  timeoutSec: number;
}

const BODY_TEXT_QUERY = '(() => (document.body ? document.body.innerText : ""))()';

export async function waitForTabCondition(
  record: EmbeddedTabRecord,
  query: WaitForQuery,
): Promise<{ matched: boolean; url: string }> {
  const deadline = Date.now() + query.timeoutSec * 1000;
  while (Date.now() < deadline) {
    if (record.view.webContents.isDestroyed()) throw new Error('内嵌浏览器标签已关闭');
    if (query.urlContains && record.url.includes(query.urlContains)) {
      return { matched: true, url: record.url };
    }
    if (query.text) {
      const bodyText = (await record.view.webContents.executeJavaScript(BODY_TEXT_QUERY).catch(() => '')) as string;
      if (bodyText.includes(query.text)) return { matched: true, url: record.url };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return { matched: false, url: record.url };
}
