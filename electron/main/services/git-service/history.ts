/**
 * 双源文件历史合并：影子仓库快照 + 用户仓库提交，统一时间线（step4 UI 历史面板用）
 */
import { GitServiceError } from './exec.js';
import { listShadowHistory } from './shadow.js';
import { getUserRepoLog } from './user-repo.js';

export interface FileHistoryEntry {
  hash: string;
  time: string;
  message: string;
  source: 'shadow' | 'repo';
  author?: string;
}

export async function getFileHistory(
  workspaceId: string,
  workspacePath: string,
  relPath: string,
): Promise<FileHistoryEntry[]> {
  const [shadowEntries, repoEntries] = await Promise.all([
    listShadowHistory(workspaceId, workspacePath, relPath).catch((err: unknown) => {
      if (err instanceof GitServiceError && err.code === 'git-missing') return [];
      throw err;
    }),
    getUserRepoLog(workspacePath, { relPath }).catch((err: unknown) => {
      if (err instanceof GitServiceError && err.code === 'not-git-repo') return [];
      throw err;
    }),
  ]);
  const merged: FileHistoryEntry[] = [
    ...shadowEntries.map((e) => ({ hash: e.hash, time: e.time, message: e.message, source: 'shadow' as const })),
    ...repoEntries.map((e) => ({
      hash: e.hash,
      time: e.time,
      message: e.message,
      source: 'repo' as const,
      author: e.author,
    })),
  ];
  return merged.sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0));
}
