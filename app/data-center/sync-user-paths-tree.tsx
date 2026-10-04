import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Folder, FileText, TriangleAlert } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { client } from '@/lib/client';
import type { SyncTreeNode, SyncDirStats } from '@/electron/main/services/sync/ws-tree';
import {
  isUserPathChecked,
  isUserPathCoveredByAncestor,
  hasUserPathCheckedDescendant,
  formatBytes,
} from './user-sync-paths';

const MAX_STAT_FILES = 20_000;

/**
 * 用户文件勾选树：根 listing 加载一次（顺带取 .git 检测，命中即渲染「走你自己的 git」提示），
 * 子级展开时单层懒加载；目录自身在勾选列表时异步统计子树规模，提醒误勾巨型目录。
 */
export function SyncUserPathsTree({
  workspaceId,
  checkedPaths,
  onToggle,
}: {
  workspaceId: string;
  checkedPaths: string[];
  onToggle: (relPath: string, on: boolean) => void;
}) {
  const [rootEntries, setRootEntries] = useState<SyncTreeNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasGit, setHasGit] = useState(false);

  useEffect(() => {
    let alive = true;
    setRootEntries(null);
    setError(null);
    client
      .getSyncWorkspaceDir({ workspaceId, relPath: '' })
      .then((r) => {
        if (!alive) return;
        if (r.error) setError(r.error);
        if (r.entries.length > 0 || !r.error) setRootEntries(r.entries);
        setHasGit(r.hasGit);
      })
      .catch((e) => {
        if (alive) setError(String(e));
      });
    return () => {
      alive = false;
    };
  }, [workspaceId]);

  return (
    <div className="rounded-md border p-2">
      {hasGit && (
        <p className="mb-2 flex items-start gap-1.5 rounded bg-muted/60 px-2 py-1.5 text-xs text-muted-foreground">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          检测到此工作区是 git 仓库：代码与文档建议走你自己的 git 管理，无需在下方勾选（勾选会与 git 操作互相产生文件级噪音）。
        </p>
      )}
      {rootEntries === null ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">{error ?? '正在读取目录…'}</p>
      ) : rootEntries.length === 0 ? (
        <p className="px-2 py-1 text-xs text-muted-foreground">工作区目录为空。</p>
      ) : (
        <ul>
          {rootEntries.map((node) => (
            <TreeRow
              key={node.relPath}
              workspaceId={workspaceId}
              node={node}
              depth={0}
              checkedPaths={checkedPaths}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function TreeRow({
  workspaceId,
  node,
  depth,
  checkedPaths,
  onToggle,
}: {
  workspaceId: string;
  node: SyncTreeNode;
  depth: number;
  checkedPaths: string[];
  onToggle: (relPath: string, on: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<SyncTreeNode[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<SyncDirStats | null>(null);

  const checked = isUserPathChecked(checkedPaths, node.relPath);
  const covered = isUserPathCoveredByAncestor(checkedPaths, node.relPath);
  const hasDescendant = hasUserPathCheckedDescendant(checkedPaths, node.relPath);
  const checkState = checked ? true : hasDescendant ? 'indeterminate' : false;

  useEffect(() => {
    if (!(node.type === 'directory' && checked && !covered && stats === null)) return;
    let alive = true;
    client
      .getSyncWorkspaceDirStats({ workspaceId, relPath: node.relPath })
      .then((r) => {
        if (alive) setStats(r);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [workspaceId, node.relPath, node.type, checked, covered, stats]);

  const toggleExpand = async () => {
    if (node.type !== 'directory') return;
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (children !== null) {
      setExpanded(true);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await client.getSyncWorkspaceDir({ workspaceId, relPath: node.relPath });
      setChildren(r.entries);
      setExpanded(true);
      if (r.error) setError(r.error);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <li>
      <div
        className="flex items-center gap-1.5 rounded px-2 py-1 hover:bg-muted/50"
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <span
          className={node.type === 'directory' ? 'shrink-0 cursor-pointer' : 'w-4 shrink-0'}
          onClick={() => void toggleExpand()}
        >
          {node.type === 'directory' &&
            (loading ? (
              <span className="inline-block h-3.5 w-3.5 animate-pulse rounded-sm bg-muted-foreground/30" />
            ) : expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            ))}
        </span>
        <Checkbox
          checked={checkState}
          disabled={covered}
          onCheckedChange={(v) => onToggle(node.relPath, v === true)}
          className="shrink-0"
        />
        {node.type === 'directory' ? (
          <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
        ) : (
          <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
        )}
        <span className="min-w-0 truncate text-sm" onClick={() => void toggleExpand()}>
          {node.name}
        </span>
        <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
          {node.type === 'file' && node.size !== undefined && formatBytes(node.size)}
          {node.type === 'directory' &&
            stats &&
            (stats.truncated
              ? `超过 ${MAX_STAT_FILES.toLocaleString()} 个文件，请确认再勾选`
              : `${stats.fileCount.toLocaleString()} 个文件 · ${formatBytes(stats.totalBytes)}`)}
        </span>
      </div>
      {error && <p className="pl-10 text-[11px] text-destructive">{error}</p>}
      {expanded && children !== null && (
        <ul>
          {children.map((child) => (
            <TreeRow
              key={child.relPath}
              workspaceId={workspaceId}
              node={child}
              depth={depth + 1}
              checkedPaths={checkedPaths}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
