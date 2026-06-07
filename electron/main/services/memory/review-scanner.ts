// 复盘脏检查：复盘卡 reviewedAt 与最新摘要卡 createdAt 比对（镜像 digest-scanner）
import * as workspaceService from '../workspace-json-service.js';
import { listDigests } from './digest-store.js';
import { readReview, type ReviewCard } from './review-store.js';

export interface StaleWorkspace {
  workspaceId: string;
  workspacePath: string;
}

/** 脏条件：无复盘卡 → 脏；有卡时最新摘要卡晚于上次复盘 → 脏（纯函数，可单测） */
export function isReviewStale(card: ReviewCard | null, latestDigestCreatedAt: string | null): boolean {
  if (!card) return true;
  if (!latestDigestCreatedAt) return false;
  return latestDigestCreatedAt > card.reviewedAt;
}

/** 遍历所有工作区，返回复盘卡过时（且有摘要卡可复盘）的工作区 */
export async function findStaleWorkspaces(): Promise<StaleWorkspace[]> {
  const all = await workspaceService.getAll();
  const out: StaleWorkspace[] = [];
  for (const ws of all) {
    const digests = await listDigests(ws.id);
    if (!digests.length) continue;
    const latest = digests.reduce((m, d) => (d.createdAt > m ? d.createdAt : m), digests[0].createdAt);
    const cardData = await readReview(ws.id);
    if (isReviewStale(cardData, latest)) {
      out.push({ workspaceId: ws.id, workspacePath: ws.path });
    }
  }
  return out;
}
