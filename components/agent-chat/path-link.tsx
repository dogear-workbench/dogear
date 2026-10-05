import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { FileText } from 'lucide-react';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useMarkdownPreviewStore } from '@/stores/markdown-preview-store';
import { useGroupId, useWorkspaceId } from './workspace-id-context';
import { splitPathSegments } from './path-resolve';

export { resolvePathInWorkspace, resolvePathCandidates, splitPathSegments, ALLOWED_EXT_RE } from './path-resolve';
export type { PathSegment } from './path-resolve';

const workspacePathsCache = {
  // id → roots（[主根, ...enabled 附加根]）；数组引用在缓存更新前保持稳定
  map: new Map<string, string[]>(),
  loaded: false,
  inflight: null as Promise<void> | null,
  listeners: new Set<() => void>(),
};

function subscribeWorkspacePaths(listener: () => void) {
  workspacePathsCache.listeners.add(listener);
  return () => {
    workspacePathsCache.listeners.delete(listener);
  };
}

function ensureWorkspacePaths() {
  if (workspacePathsCache.loaded || workspacePathsCache.inflight) return;
  workspacePathsCache.inflight = client.getAll().then((result) => {
    for (const w of result.workspaces ?? []) {
      workspacePathsCache.map.set(w.id, [
        w.path,
        ...(w.additionalPaths ?? []).filter((p) => p.enabled && p.path).map((p) => p.path),
      ]);
    }
    workspacePathsCache.loaded = true;
    workspacePathsCache.inflight = null;
    workspacePathsCache.listeners.forEach((l) => l());
  }).catch(() => {
    workspacePathsCache.inflight = null;
  });
}

/** 会话所属工作区的多根列表（主根在前）；workspace-store 聚焦同一工作区时实时取，否则走列表缓存 */
export function useWorkspaceRoots(workspaceId: string | null): string[] | null {
  const focused = useWorkspaceStore((s) => (workspaceId && s.workspace?.id === workspaceId ? s.workspace : null));
  const focusedRoots = useMemo(() => {
    if (!focused) return null;
    return [
      focused.path,
      ...(focused.additionalPaths ?? []).filter((p) => p.enabled && p.path).map((p) => p.path),
    ];
  }, [focused]);
  const cached = useSyncExternalStore(
    subscribeWorkspacePaths,
    useCallback(() => (workspaceId ? workspacePathsCache.map.get(workspaceId) ?? null : null), [workspaceId]),
    () => null,
  );
  useEffect(() => {
    if (!workspaceId || focused) return;
    if (!workspacePathsCache.map.has(workspaceId)) ensureWorkspacePaths();
  }, [workspaceId, focused]);
  return focusedRoots ?? cached;
}

// ==================== 组共享区根目录 ====================

const sharedRootsCache = {
  // groupId → sharedDir；'' 表示已确认无共享区（组缺失/已归档），读取时归一为 null
  map: new Map<string, string>(),
  inflight: new Set<string>(),
  listeners: new Set<() => void>(),
};

function subscribeSharedRoots(listener: () => void) {
  sharedRootsCache.listeners.add(listener);
  return () => {
    sharedRootsCache.listeners.delete(listener);
  };
}

/** 会话所属组的共享区目录（主进程从 workspaceId+groupId 计算）；组不可用时返回 null，调用方安全降级 */
export function useSharedRoot(groupId: string | null): string | null {
  const workspaceId = useWorkspaceId();
  const cached = useSyncExternalStore(
    subscribeSharedRoots,
    useCallback(() => (groupId ? sharedRootsCache.map.get(groupId) || null : null), [groupId]),
    () => null,
  );
  useEffect(() => {
    if (!groupId || !workspaceId) return;
    if (sharedRootsCache.map.has(groupId) || sharedRootsCache.inflight.has(groupId)) return;
    sharedRootsCache.inflight.add(groupId);
    client.listSharedFiles({ workspaceId, groupId })
      .then((r) => {
        sharedRootsCache.map.set(groupId, r.sharedDir || '');
      })
      .catch(() => {
        sharedRootsCache.map.set(groupId, '');
      })
      .finally(() => {
        sharedRootsCache.inflight.delete(groupId);
        sharedRootsCache.listeners.forEach((l) => l());
      });
  }, [groupId, workspaceId]);
  return cached;
}

export function useWorkspacePath(workspaceId: string | null): string | null {
  const roots = useWorkspaceRoots(workspaceId);
  return roots?.[0] ?? null;
}

export function useWorkspaceIdByPath(workspacePath: string | null): string | null {
  const focused = useWorkspaceStore((s) => (workspacePath && s.workspace?.path === workspacePath ? s.workspace : null));
  const cached = useSyncExternalStore(
    subscribeWorkspacePaths,
    useCallback(() => {
      if (!workspacePath) return null;
      for (const [id, roots] of workspacePathsCache.map) {
        if (roots[0] === workspacePath) return id;
      }
      return null;
    }, [workspacePath]),
    () => null,
  );
  useEffect(() => {
    if (!workspacePath || focused) return;
    if (workspacePathsCache.map.size === 0) ensureWorkspacePaths();
  }, [workspacePath, focused]);
  return focused?.id ?? cached;
}

// ==================== 路径存在性校验（前端缓存 + 批量 IPC 聚合） ====================

type ExistenceEntry = { value: boolean; at: number };
const existenceCache = new Map<string, ExistenceEntry>();
const existenceListeners = new Set<() => void>();
const NEGATIVE_TTL_MS = 30_000;
const FLUSH_DELAY_MS = 30;
const PENDING = Symbol('path-existence-pending');

export type ExistenceState = typeof PENDING | string | null;

function existenceKey(workspaceId: string, groupId: string | undefined, p: string) {
  return `${workspaceId}\n${groupId ?? ''}\n${p}`;
}

function peekExistence(workspaceId: string, groupId: string | undefined, p: string): boolean | null {
  const entry = existenceCache.get(existenceKey(workspaceId, groupId, p));
  if (!entry) return null;
  if (!entry.value && Date.now() - entry.at > NEGATIVE_TTL_MS) return null;
  return entry.value;
}

function subscribeExistence(listener: () => void) {
  existenceListeners.add(listener);
  return () => {
    existenceListeners.delete(listener);
  };
}

type PendingCheck = { workspaceId: string; groupId?: string; path: string };
const pendingChecks = new Map<string, PendingCheck>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function requestExistence(workspaceId: string, groupId: string | undefined, p: string) {
  if (peekExistence(workspaceId, groupId, p) !== null) return;
  const key = existenceKey(workspaceId, groupId, p);
  if (pendingChecks.has(key)) return;
  pendingChecks.set(key, { workspaceId, groupId, path: p });
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushExistenceChecks();
  }, FLUSH_DELAY_MS);
}

async function flushExistenceChecks() {
  const batch = [...pendingChecks.values()];
  pendingChecks.clear();
  const byScope = new Map<string, { workspaceId: string; groupId?: string; paths: string[] }>();
  for (const item of batch) {
    const scopeKey = `${item.workspaceId}\n${item.groupId ?? ''}`;
    const scope = byScope.get(scopeKey) ?? { workspaceId: item.workspaceId, groupId: item.groupId, paths: [] };
    scope.paths.push(item.path);
    byScope.set(scopeKey, scope);
  }
  await Promise.all([...byScope.values()].map(async ({ workspaceId, groupId, paths }) => {
    try {
      const result = await client.checkPathsExist({ workspaceId, paths, groupId });
      const now = Date.now();
      for (const p of paths) {
        existenceCache.set(existenceKey(workspaceId, groupId, p), { value: !!result.exists?.[p], at: now });
      }
    } catch {
      // IPC 失败不写缓存，下次触发重试
    }
  }));
  existenceListeners.forEach((l) => l());
}

/** 候选列表中第一个存在性通过的绝对路径；PENDING=校验中，null=全部不存在 */
export function useExistenceResolved(workspaceId: string | null, candidates: string[] | null | undefined, groupId?: string): ExistenceState {
  const getSnapshot = useCallback(() => {
    if (!workspaceId || !candidates?.length) return null;
    let pending = false;
    for (const c of candidates) {
      const v = peekExistence(workspaceId, groupId, c);
      if (v === true) return c;
      if (v === null) pending = true;
    }
    return pending ? PENDING : null;
  }, [workspaceId, groupId, candidates]);
  const state = useSyncExternalStore(subscribeExistence, getSnapshot, getSnapshot);
  useEffect(() => {
    if (!workspaceId || !candidates?.length) return;
    for (const c of candidates) {
      if (peekExistence(workspaceId, groupId, c) === true) break;
      requestExistence(workspaceId, groupId, c);
    }
  }, [workspaceId, groupId, candidates]);
  return state;
}

// ==================== PathChip 渲染 ====================

export function PathChip({ text, resolved, fileName, workspaceId, groupId, children }: {
  text: string;
  resolved: string;
  fileName?: string;
  workspaceId: string;
  /** 会话组 id：点击兜底校验与预览读盘均带 groupId，主进程据此把组共享区根纳入 roots */
  groupId?: string;
  /** 覆盖胶囊内显示内容（如 markdown 链接文本 / 搜索高亮节点）；缺省显示 text */
  children?: React.ReactNode;
}) {
  const displayName = fileName ?? resolved.split(/[\\/]/).pop() ?? resolved;
  const handleClick = async () => {
    let exists = false;
    try {
      const result = await client.checkPathsExist({ workspaceId, paths: [resolved], groupId });
      exists = !!result.exists?.[resolved];
    } catch {
      exists = false;
    }
    if (!exists) {
      toast.error('文件不存在或已被移动');
      return;
    }
    useMarkdownPreviewStore.getState().open(workspaceId, resolved, displayName, groupId);
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 align-baseline max-w-[280px] rounded-md border border-teal-200 bg-teal-50 text-xs text-teal-700 hover:bg-teal-100 hover:border-teal-300 dark:border-teal-800/60 dark:bg-teal-950/40 dark:text-teal-300 dark:hover:bg-teal-900/40 dark:hover:border-teal-700 transition-colors"
      title={resolved}
    >
      <FileText size={12} className="shrink-0" />
      <span className="font-mono truncate">{children ?? text}</span>
    </button>
  );
}

/** 存在性门槛胶囊：候选中存在性校验通过的第一个才渲染 PathChip，其余态渲染纯文本 */
export function GatedPathChip({ text, candidates, workspaceId, groupId, children }: {
  text: string;
  candidates: string[] | null | undefined;
  workspaceId: string;
  /** 会话组 id：存在性校验把组共享区根纳入 roots，防跨组串缓存 */
  groupId?: string;
  children?: React.ReactNode;
}) {
  const resolved = useExistenceResolved(workspaceId, candidates, groupId);
  if (typeof resolved !== 'string') return <span>{children ?? text}</span>;
  return <PathChip text={text} resolved={resolved} workspaceId={workspaceId} groupId={groupId}>{children}</PathChip>;
}

export function PathText({ text }: {
  text: string;
}) {
  const workspaceId = useWorkspaceId();
  const groupId = useGroupId();
  const sharedRoot = useSharedRoot(groupId);
  const roots = useWorkspaceRoots(workspaceId);
  const allRoots = useMemo(() => (roots && sharedRoot ? [...roots, sharedRoot] : roots), [roots, sharedRoot]);
  const segments = useMemo(() => splitPathSegments(text, allRoots), [text, allRoots]);
  if (segments.length === 1 && segments[0].type === 'text') {
    return <>{text}</>;
  }
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === 'path' && workspaceId && seg.candidates?.length) {
          return <GatedPathChip key={i} text={seg.text} candidates={seg.candidates} workspaceId={workspaceId} groupId={groupId ?? undefined} />;
        }
        return <span key={i}>{seg.text}</span>;
      })}
    </>
  );
}
