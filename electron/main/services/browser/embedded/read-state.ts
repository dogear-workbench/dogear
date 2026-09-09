import type { EmbeddedTabRecord } from './types.js';

export const READ_STATE_MAX_CHARS = 8_000;

export interface ReadStateResult {
  missing?: boolean;
  notFound?: boolean;
  availableKeys?: string[];
  notSerializable?: boolean;
  summary?: string;
  json?: string;
  truncated?: boolean;
  totalLength?: number;
}

/** 与扩展通道 readStateFn 语义逐项对齐：顶层概要 / 点分路径下钻 / 可用 key 回显 */
export async function readTabState(tab: EmbeddedTabRecord, path?: string): Promise<ReadStateResult> {
  const payload = JSON.stringify(path ?? null);
  const expression =
    `(() => {\n` +
    `  const path = ${payload};\n` +
    `  const state = window.__INITIAL_STATE__;\n` +
    `  if (state === null || state === undefined) return { missing: true };\n` +
    `  const typeLabel = (v) => {\n` +
    `    if (v === null) return 'null';\n` +
    `    if (Array.isArray(v)) return 'array';\n` +
    `    return typeof v === 'object' ? 'object' : typeof v;\n` +
    `  };\n` +
    `  if (!path) {\n` +
    `    const lines = [];\n` +
    `    for (const key of Object.keys(state)) {\n` +
    `      const v = state[key];\n` +
    `      const t = typeLabel(v);\n` +
    `      let size;\n` +
    `      if (t === 'array') size = '长度 ' + v.length;\n` +
    `      else if (t === 'object') size = '子项 ' + Object.keys(v).length;\n` +
    `      else if (t === 'string') size = '长度 ' + v.length;\n` +
    `      else size = String(v);\n` +
    `      lines.push(key + '：' + t + '，' + size);\n` +
    `    }\n` +
    `    return { summary: lines.join('\\n') };\n` +
    `  }\n` +
    `  const segments = String(path).split('.').filter((s) => s !== '');\n` +
    `  let cur = state;\n` +
    `  for (let i = 0; i < segments.length; i++) {\n` +
    `    const seg = segments[i];\n` +
    `    if (cur === null || typeof cur !== 'object') return { notFound: true, availableKeys: [] };\n` +
    `    const next = cur[seg];\n` +
    `    if (next === undefined) return { notFound: true, availableKeys: Object.keys(cur) };\n` +
    `    cur = next;\n` +
    `  }\n` +
    `  let raw;\n` +
    `  try { raw = JSON.stringify(cur); } catch (err) { return { notSerializable: true }; }\n` +
    `  if (raw === undefined || raw === null) return { notSerializable: true };\n` +
    `  const totalLength = raw.length;\n` +
    `  const truncated = totalLength > ${READ_STATE_MAX_CHARS};\n` +
    `  return { json: truncated ? raw.slice(0, ${READ_STATE_MAX_CHARS}) + '…（截断）' : raw, truncated, totalLength };\n` +
    `})()`;
  return (await tab.view.webContents.executeJavaScript(expression)) as ReadStateResult;
}
