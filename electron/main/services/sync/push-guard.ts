import { EXTERNAL_ANCHOR_PREFIX, EXTERNAL_ARTICLES_REL, EXTERNAL_TASKS_REL, sensitiveRelPaths } from '../data-registry.js';
import { isExcluded, type ManifestExcludes } from './manifest.js';
import { isWorkspacePathSyncEnabled, type WorkspaceMapEntry } from './workspace-map.js';

export interface PushGuardInput {
  /** 本端同步范围排除（与 pull 侧 applyIncoming/diff 共用同一判定，含 optionalDirs/shadowGit/冲突副本） */
  excludes?: ManifestExcludes;
  /** 推送方（per-peer）工作区映射表：本端 wsid → 映射条目 */
  workspaceMap?: Record<string, WorkspaceMapEntry>;
  /** 本端注册工作区 id 集合（workspaces.json）：虚拟路径放行的前置条件，缺省 = 全拒 */
  registeredWorkspaceIds?: ReadonlySet<string>;
  /** 用户勾选跨设备同步的工作区子树（wsid → 相对路径列表，settings 层已清洗） */
  userSyncPaths?: Record<string, string[]>;
}

export type PushGuardVerdict = { ok: true } | { ok: false; status: 403; reason: string };

function isUnder(relPath: string, base: string): boolean {
  return relPath === base || relPath.startsWith(`${base}/`);
}

/** 段级安全（对端路径不可信）：空段/./..//反斜杠一律非法 */
function isSafeSegs(segs: string[]): boolean {
  return segs.every((s) => s !== '' && s !== '.' && s !== '..' && !s.includes('\\'));
}

function segsMatch(rest: string[], prefix: string[]): boolean {
  return rest.length >= prefix.length && prefix.every((s, i) => rest[i] === s);
}

/**
 * 虚拟路径白名单（纯函数）：仅放行 workspaces.json 注册工作区下、registry 声明
 * （.dogear/tasks.json 含其冲突副本名 / .dogear/articles 子树）或 userSyncPaths 勾选子树内的路径；
 * 其余 __ws-external__ 路径（未注册 wsid、.dogear 其他文件、勾选树外）一律拒绝。
 */
export function isRegisteredVirtualPath(
  relPath: string,
  registeredIds: ReadonlySet<string> | undefined,
  userSyncPaths: Record<string, string[]> | undefined,
): boolean {
  const segs = relPath.split('/');
  if (segs[0] !== EXTERNAL_ANCHOR_PREFIX || segs.length < 3 || !isSafeSegs(segs)) return false;
  if (!registeredIds?.has(segs[1])) return false;
  const rest = segs.slice(2);
  const tasksSegs = EXTERNAL_TASKS_REL.split('/');
  if (rest.length === tasksSegs.length) {
    const last = rest[rest.length - 1];
    const dirsOk = tasksSegs.slice(0, -1).every((s, i) => rest[i] === s);
    if (dirsOk && (last === tasksSegs[tasksSegs.length - 1] || last.startsWith(`${tasksSegs[tasksSegs.length - 1]}.conflict-`))) return true;
  }
  if (segsMatch(rest, EXTERNAL_ARTICLES_REL.split('/'))) return true;
  for (const rel of userSyncPaths?.[segs[1]] ?? []) {
    if (segsMatch(rest, rel.split('/'))) return true;
  }
  return false;
}

/**
 * push 接收端校验（D1/S1）：与 pull 侧对称的范围/开关/禁写检查，拒绝对端经 push 写入
 * 本端不同步或不可触碰的路径。检查顺序：引擎自身状态 → registry 敏感路径 → registry 外部锚点
 * （白名单：注册工作区的 tasks/articles/勾选子树放行，落盘由 apply 侧反解到工作区真实路径）
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
  if (isUnder(relPath, EXTERNAL_ANCHOR_PREFIX) && !isRegisteredVirtualPath(relPath, input.registeredWorkspaceIds, input.userSyncPaths)) {
    return { ok: false, status: 403, reason: `外部锚点路径未在本端注册工作区的同步范围内: ${relPath}` };
  }
  if (isExcluded(relPath, input.excludes)) {
    return { ok: false, status: 403, reason: '本端同步范围已排除，拒绝对端推送' };
  }
  if (!isWorkspacePathSyncEnabled(input.workspaceMap, relPath)) {
    return { ok: false, status: 403, reason: '工作区未启用同步（未建映射或已暂停），拒绝对端推送' };
  }
  return { ok: true };
}
