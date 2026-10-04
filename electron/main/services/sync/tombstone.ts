import fsp from 'node:fs/promises';
import type { FileEntry, SkippedEntry } from './protocol.js';
import { sha256File } from './manifest.js';
import { resolveIncomingRelPath } from './apply.js';

export type DeleteConflictKind = 'local-deleted' | 'remote-deleted';

export interface DeleteConflict {
  relPath: string;
  /** local-deleted = 本端已删、对端改过（保留对端版本）；remote-deleted = 对端已删、本端改过（保留本端版本） */
  kind: DeleteConflictKind;
}

/** settings.json 含配对密钥且为 merge 文件，永不参与墓碑删除传播 */
const SETTINGS_REL = 'settings.json';

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface PeerDeletionOutcome {
  deleted: string[];
  conflicts: DeleteConflict[];
  skipped: SkippedEntry[];
}

/**
 * 对端墓碑执行（diff.peerDeleted：对端已删、本端仍有文件）。
 * 本端文件 hash == 基线（未改）→ 跟随删除；无基线参照或 hash 不等（本端改过/无法确认）→
 * 删改冲突保守保留本端文件，绝不自动删。
 */
export async function applyPeerTombstones(
  root: string,
  entries: FileEntry[],
  baselineHashes: ReadonlyMap<string, string | undefined>,
): Promise<PeerDeletionOutcome> {
  const outcome: PeerDeletionOutcome = { deleted: [], conflicts: [], skipped: [] };
  for (const entry of entries) {
    const relPath = entry.relPath;
    if (relPath === SETTINGS_REL) continue;
    const abs = await resolveIncomingRelPath(root, relPath);
    if (!abs) {
      outcome.skipped.push({ relPath, reason: 'unsafe path，忽略对端删除墓碑' });
      continue;
    }
    let localHash: string;
    try {
      localHash = await sha256File(abs);
    } catch (error) {
      outcome.skipped.push({ relPath, reason: `本端文件读取失败，跳过删除跟随: ${errText(error)}` });
      continue;
    }
    const baselineHash = baselineHashes.get(relPath);
    if (baselineHash === undefined || localHash !== baselineHash) {
      outcome.conflicts.push({ relPath, kind: 'remote-deleted' });
      continue;
    }
    try {
      await fsp.unlink(abs);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
        outcome.skipped.push({ relPath, reason: `本端删除失败: ${errText(error)}` });
        continue;
      }
    }
    outcome.deleted.push(relPath);
  }
  return outcome;
}

export interface PropagationTarget {
  /** 本端视角条目（hash = 对端清单 hash，经 candidateHashes 注入） */
  entry: FileEntry;
  /** 对端原始 relPath（DELETE 请求用） */
  remoteRelPath: string;
}

export type PeerDeleteFn = (
  target: PropagationTarget,
  expectedHash: string,
) => Promise<{ ok: true; alreadyGone?: boolean } | { ok: false; status: number; reason: string }>;

export interface DeletePropagationOutcome {
  deletedOnPeer: string[];
  conflicts: DeleteConflict[];
  skipped: SkippedEntry[];
}

/**
 * 本端删除传播（diff.deletePropagation：本端已删、对端清单仍有文件）。
 * 对端 hash == 基线（未改）→ 发 DELETE /file 让对端删除（接收端二次校验 hash 防误删）；
 * 对端 hash 与基线不等（对端改过）→ 直接记删改冲突，保守保留对端文件；409 同理（响应间隙被改）。
 */
export async function propagateLocalDeletes(
  targets: PropagationTarget[],
  baselineHashes: ReadonlyMap<string, string | undefined>,
  deleteFn: PeerDeleteFn,
): Promise<DeletePropagationOutcome> {
  const outcome: DeletePropagationOutcome = { deletedOnPeer: [], conflicts: [], skipped: [] };
  for (const target of targets) {
    const relPath = target.entry.relPath;
    if (relPath === SETTINGS_REL) continue;
    const baselineHash = baselineHashes.get(relPath);
    const remoteHash = target.entry.hash;
    if (baselineHash === undefined || remoteHash === undefined) {
      outcome.skipped.push({ relPath, reason: '缺少基线或对端内容 hash，无法安全传播删除' });
      continue;
    }
    if (remoteHash !== baselineHash) {
      outcome.conflicts.push({ relPath, kind: 'local-deleted' });
      continue;
    }
    const result = await deleteFn(target, baselineHash);
    if (result.ok) {
      outcome.deletedOnPeer.push(relPath);
    } else if (result.status === 409) {
      outcome.conflicts.push({ relPath, kind: 'local-deleted' });
    } else {
      outcome.skipped.push({ relPath, reason: `对端拒绝/无法执行删除 (${result.status}): ${result.reason}` });
    }
  }
  return outcome;
}
