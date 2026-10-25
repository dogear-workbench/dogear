/**
 * 工作区文件名搜索：collectWorkspacePaths 全量索引（进程内 TTL 缓存，watcher/删除工作区时失效）
 * + 名称前缀 > 名称包含 > 路径包含 排序匹配（目录优先、路径短、字母序）
 */
import * as workspaceJsonService from './workspace-json-service.js';
import * as snapshotExclusionScan from './snapshot-exclusion-scan.js';
import { collectWorkspacePaths } from './workspace-fs-service.js';

export interface WorkspaceSearchHit {
  name: string;
  path: string;
  isDir: boolean;
}

export interface WorkspaceSearchResult {
  results: WorkspaceSearchHit[];
  total: number;
  truncated: boolean;
}

interface SearchIndex {
  path: string;
  name: string;
  lowerPath: string;
  lowerName: string;
  isDir: boolean;
}

export type { SearchIndex };

const INDEX_TTL_MS = 5000;
const indexes = new Map<string, { entries: SearchIndex[]; truncated: boolean; at: number }>();

export function invalidateSearchIndex(workspaceId: string): void {
  indexes.delete(workspaceId);
}

async function getIndex(workspaceId: string, workspacePath: string): Promise<{ entries: SearchIndex[]; truncated: boolean }> {
  const cached = indexes.get(workspaceId);
  if (cached && Date.now() - cached.at < INDEX_TTL_MS) return cached;
  let excludedPaths: ReadonlySet<string> | undefined;
  try {
    excludedPaths = new Set(await snapshotExclusionScan.getWorkspaceExcludedPaths(workspaceId));
  } catch {
    excludedPaths = undefined;
  }
  const collected = await collectWorkspacePaths(workspacePath, excludedPaths);
  const entries: SearchIndex[] = collected.entries.map(entry => ({
    path: entry.path,
    name: entry.path.slice(entry.path.lastIndexOf('/') + 1),
    lowerPath: entry.path.toLowerCase(),
    lowerName: '',
    isDir: entry.isDir,
  }));
  for (const entry of entries) entry.lowerName = entry.name.toLowerCase();
  const next = { entries, truncated: collected.truncated, at: Date.now() };
  indexes.set(workspaceId, next);
  return next;
}

export async function searchWorkspaceFiles(workspaceId: string, query: string, limit = 50): Promise<WorkspaceSearchResult> {
  const normalized = query.trim().toLowerCase();
  if (normalized === '') return { results: [], total: 0, truncated: false };
  const workspace = await workspaceJsonService.getById(workspaceId);
  if (!workspace) return { results: [], total: 0, truncated: false };
  const { entries, truncated } = await getIndex(workspaceId, workspace.path);
  return rankSearchHits(entries, normalized, limit, truncated);
}

/** 名称前缀 > 名称包含 > 路径包含；同级目录优先、路径短、字母序（query 需已 trim+小写归一） */
export function rankSearchHits(
  entries: SearchIndex[],
  query: string,
  limit: number,
  truncated: boolean,
): WorkspaceSearchResult {
  const hits: { hit: WorkspaceSearchHit; rank: number }[] = [];
  for (const entry of entries) {
    const rank = entry.lowerName.startsWith(query)
      ? 0
      : entry.lowerName.includes(query)
        ? 1
        : entry.lowerPath.includes(query)
          ? 2
          : -1;
    if (rank < 0) continue;
    hits.push({ hit: { name: entry.name, path: entry.path, isDir: entry.isDir }, rank });
  }
  hits.sort((a, b) =>
    a.rank - b.rank ||
    (a.hit.isDir ? 0 : 1) - (b.hit.isDir ? 0 : 1) ||
    a.hit.path.length - b.hit.path.length ||
    a.hit.path.localeCompare(b.hit.path, 'zh-CN'),
  );
  return {
    results: hits.slice(0, limit).map(h => h.hit),
    total: hits.length,
    truncated,
  };
}
