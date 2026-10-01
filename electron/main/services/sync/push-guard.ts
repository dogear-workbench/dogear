import { EXTERNAL_ANCHOR_PREFIX, sensitiveRelPaths } from '../data-registry.js';
import { isExcluded, type ManifestExcludes } from './manifest.js';
import { isWorkspacePathSyncEnabled, type WorkspaceMapEntry } from './workspace-map.js';

export interface PushGuardInput {
  /** 本端同步范围排除（与 pull 侧 applyIncoming/diff 共用同一判定，含 optionalDirs/shadowGit/冲突副本） */
  excludes?: ManifestExcludes;
  /** 推送方（per-peer）工作区映射表：本端 wsid → 映射条目 */
  workspaceMap?: Record<string, WorkspaceMapEntry>;
}

export type PushGuardVerdict = { ok: true } | { ok: false; status: 403; reason: string };

function isUnder(relPath: string, base: string): boolean {
  return relPath === base || relPath.startsWith(`${base}/`);
}

/**
 * push 接收端校验（D1/S1）：与 pull 侧对称的范围/开关/禁写检查，拒绝对端经 push 写入
 * 本端不同步或不可触碰的路径。检查顺序：引擎自身状态 → registry 敏感路径 → registry 外部锚点
 * → 本端同步范围（isExcluded）→ 工作区映射 enabled。
 */
export function checkIncomingPushRelPath(relPath: string, input: PushGuardInput): PushGuardVerdict {
  if (isUnder(relPath, 'sync-state.json') || isUnder(relPath, 'backups')) {
    return { ok: false, status: 403, reason: `引擎状态路径禁止推送: ${relPath}` };
  }
  for (const sensitive of sensitiveRelPaths()) {
    if (isUnder(relPath, sensitive)) {
      return { ok: false, status: 403, reason: `敏感数据不参与同步: ${relPath}` };
    }
  }
  if (isUnder(relPath, EXTERNAL_ANCHOR_PREFIX)) {
    return { ok: false, status: 403, reason: `外部锚点是虚拟路径，不落数据目录: ${relPath}` };
  }
  if (isExcluded(relPath, input.excludes)) {
    return { ok: false, status: 403, reason: '本端同步范围已排除，拒绝对端推送' };
  }
  if (!isWorkspacePathSyncEnabled(input.workspaceMap, relPath)) {
    return { ok: false, status: 403, reason: '工作区未启用同步（未建映射或已暂停），拒绝对端推送' };
  }
  return { ok: true };
}
