/**
 * 文件快照保护静态判定：该文件按当前配置是否会被影子快照覆盖（纯函数，不查 git）。
 * 语义对齐 takeSnapshot 的 add pathspec 排除 + unstageOversized 大小过滤；
 * 排除按段前缀命中：relPath 段数组以某条排除路径段数组为前缀（含相等）即整子树覆盖，路径顶层锚定
 */
import type { SnapshotSettings } from '../settings-types.js';

export type SnapshotProtectionReason = 'size' | 'excluded' | 'disabled';

export interface SnapshotProtection {
  protected: boolean;
  reason?: SnapshotProtectionReason;
}

/** 排除路径单一判定源：pathspec 拼接（shadow.ts）与历史重写剔除（shadow-slim.ts）共用，防语义漂移 */
export function isExcludedRelPath(segments: string[], excludedPaths: string[]): boolean {
  return excludedPaths.some((p) => {
    const exSegs = p.split('/').filter(Boolean);
    return exSegs.length > 0 && exSegs.length <= segments.length && exSegs.every((s, i) => segments[i] === s);
  });
}

export function judgeSnapshotProtection(
  workspaceId: string,
  relPath: string,
  settings: SnapshotSettings,
  fileSizeBytes: number | null,
): SnapshotProtection {
  if (settings.disabledWorkspaces?.includes(workspaceId)) return { protected: false, reason: 'disabled' };
  const segments = relPath.replace(/\\/g, '/').split('/').filter(Boolean);
  if (isExcludedRelPath(segments, settings.excludedPaths[workspaceId] ?? [])) {
    return { protected: false, reason: 'excluded' };
  }
  if (fileSizeBytes !== null && fileSizeBytes > settings.maxFileSizeBytes) return { protected: false, reason: 'size' };
  return { protected: true };
}
