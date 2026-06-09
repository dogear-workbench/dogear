// 报告脏检查（历史代号 review）：报告 updatedAt 与最新摘要卡 createdAt 比对。
import * as workspaceService from '../workspace-json-service.js';
import { listDigests } from './digest-store.js';
import { readReport, type ReportDoc } from './review-store.js';

export interface StaleWorkspace {
  workspaceId: string;
  workspacePath: string;
}

/** 脏条件：无摘要卡 → 不脏（无可生成）；有摘要卡但无报告 → 脏；最新摘要卡晚于报告 updatedAt → 脏（纯函数，可单测） */
export function isReportStale(report: ReportDoc | null, latestDigestCreatedAt: string | null): boolean {
  if (!latestDigestCreatedAt) return false;
  if (!report) return true;
  return latestDigestCreatedAt > report.updatedAt;
}

/** 遍历所有工作区，返回报告过时（且有摘要卡可生成）的工作区 */
export async function findStaleWorkspaces(): Promise<StaleWorkspace[]> {
  const all = await workspaceService.getAll();
  const out: StaleWorkspace[] = [];
  for (const ws of all) {
    const digests = await listDigests(ws.id);
    if (!digests.length) continue;
    const latest = digests.reduce((m, d) => (d.createdAt > m ? d.createdAt : m), digests[0].createdAt);
    const report = await readReport(ws.id);
    if (isReportStale(report, latest)) {
      out.push({ workspaceId: ws.id, workspacePath: ws.path });
    }
  }
  return out;
}
