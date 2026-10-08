import { getCdpSession, type EmbeddedCdpSession } from './cdp-session.js';
import { RefExpiredError } from './ax-observe.js';
import type { EmbeddedTabRecord } from './types.js';

export const CLICK_VERIFY_DELAY_MS = 400;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 多步操作序列（scrollIntoView → getBoxModel → dispatch）每步校验：页面中途导航即中止，不做静默重试 */
export function assertSameGeneration(tab: EmbeddedTabRecord, generation: number, ref: string): void {
  if (tab.view.webContents.isDestroyed()) throw new Error('内嵌浏览器标签已关闭');
  if (tab.generation !== generation) {
    throw new RefExpiredError(ref, '多步操作中途页面发生了导航或路由变化');
  }
}

export async function resolveNodeObjectId(
  cdp: EmbeddedCdpSession,
  backendNodeId: number,
  ref: string,
): Promise<string> {
  const resolved = await cdp.send<{ object?: { objectId?: string } }>('DOM.resolveNode', { backendNodeId });
  const objectId = resolved.object?.objectId;
  if (!objectId) throw new RefExpiredError(ref, '节点已不在当前文档');
  return objectId;
}

export async function callFnOnNode<T>(
  cdp: EmbeddedCdpSession,
  objectId: string,
  functionDeclaration: string,
  args?: unknown[],
): Promise<T | null> {
  const response = await cdp.send<{ result?: { value?: unknown } }>(
    'Runtime.callFunctionOn',
    {
      objectId,
      functionDeclaration,
      arguments: (args ?? []).map((value) => ({ value })),
      returnByValue: true,
    },
  );
  return (response.result?.value ?? null) as T | null;
}

/** 坐标用 DOM.getBoxModel content quad 四点均值（元素须先 scrollIntoView，避免旧坐标） */
export async function centerForNode(
  cdp: EmbeddedCdpSession,
  backendNodeId: number,
): Promise<{ x: number; y: number }> {
  const response = await cdp.send<{ model?: { content?: number[] } }>('DOM.getBoxModel', { backendNodeId });
  const quad = response.model?.content;
  if (!Array.isArray(quad) || quad.length < 8) {
    throw new Error('目标元素当前不可交互（无有效渲染盒），请重新 observe_page 后重试');
  }
  return {
    x: (quad[0] + quad[2] + quad[4] + quad[6]) / 4,
    y: (quad[1] + quad[3] + quad[5] + quad[7]) / 4,
  };
}
