import type { EmbeddedPageState, EmbeddedTabRecord } from './types.js';

/** pageState 判定统一入口：本步沿用 tab-events 维护的基础流转，URL 模式与页面特征关键词的完整判定在此文件扩展 */
export function resolvePageState(tab: EmbeddedTabRecord): EmbeddedPageState {
  return tab.state;
}
