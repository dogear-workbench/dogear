/**
 * 文件快照保护静态判定：该文件按当前配置是否会被影子快照覆盖（纯函数，不查 git）。
 * 语义对齐 takeSnapshot 的 add pathspec 排除 + unstageOversized 大小过滤；
 * 逐段匹配含末段：git pathspec `:(exclude)dir` 对路径 dir 本身（文件或目录）同样生效
 */
import type { SnapshotSettings } from '../settings-types.js';

export type SnapshotProtectionReason = 'size' | 'excluded' | 'disabled';

export interface SnapshotProtection {
  protected: boolean;
  reason?: SnapshotProtectionReason;
}

export function judgeSnapshotProtection(
  workspaceId: string,
  relPath: string,
  settings: SnapshotSettings,
  fileSizeBytes: number | null,
): SnapshotProtection {
  if (settings.disabledWorkspaces?.includes(workspaceId)) return { protected: false, reason: 'disabled' };
  const segments = relPath.replace(/\\/g, '/').split('/').filter(Boolean);
  if (segments.some((seg) => settings.excludeDirs.includes(seg))) return { protected: false, reason: 'excluded' };
  if (fileSizeBytes !== null && fileSizeBytes > settings.maxFileSizeBytes) return { protected: false, reason: 'size' };
  return { protected: true };
}
