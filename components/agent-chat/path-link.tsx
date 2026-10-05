import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { FileText } from 'lucide-react';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useMarkdownPreviewStore } from '@/stores/markdown-preview-store';
import { useWorkspaceId } from './workspace-id-context';
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

function existenceKey(workspaceId: string, p: string) {
  return `${workspaceId}\n${p}`;
}

function peekExistence(workspaceId: string, p: string): boolean | null {
  const entry = existenceCache.get(existenceKey(workspaceId, p));
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

const pendingChecks = new Map<string, { workspaceId: string; path: string }>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function requestExistence(workspaceId: string, p: string) {
  if (peekExistence(workspaceId, p) !== null) return;
  const key = existenceKey(workspaceId, p);
  if (pendingChecks.has(key)) return;
  pendingChecks.set(key, { workspaceId, path: p });
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushExistenceChecks();
  }, FLUSH_DELAY_MS);
}

async function flushExistenceChecks() {
  const batch = [...pendingChecks.values()];
  pendingChecks.clear();
  const byWorkspace = new Map<string, string[]>();
  for (const item of batch) {
    const list = byWorkspace.get(item.workspaceId) ?? [];
    list.push(item.path);
    byWorkspace.set(item.workspaceId, list);
  }
  await Promise.all([...byWorkspace].map(async ([workspaceId, paths]) => {
    try {
      const result = await client.checkPathsExist({ workspaceId, paths });
      const now = Date.now();
      for (const p of paths) {
        existenceCache.set(existenceKey(workspaceId, p), { value: !!result.exists?.[p], at: now });
      }
    } catch {
      // IPC 失败不写缓存，下次触发重试
    }
  }));
  existenceListeners.forEach((l) => l());
}

/** 候选列表中第一个存在性通过的绝对路径；PENDING=校验中，null=全部不存在 */
export function useExistenceResolved(workspaceId: string | null, candidates: string[] | null | undefined): ExistenceState {
  const getSnapshot = useCallback(() => {
    if (!workspaceId || !candidates?.length) return null;
    let pending = false;
    for (const c of candidates) {
      const v = peekExistence(workspaceId, c);
      if (v === true) return c;
      if (v === null) pending = true;
    }
    return pending ? PENDING : null;
  }, [workspaceId, candidates]);
  const state = useSyncExternalStore(subscribeExistence, getSnapshot, getSnapshot);
  useEffect(() => {
    if (!workspaceId || !candidates?.length) return;
    for (const c of candidates) {
      if (peekExistence(workspaceId, c) === true) break;
      requestExistence(workspaceId, c);
    }
  }, [workspaceId, candidates]);
  return state;
}

// ==================== PathChip 渲染 ====================

export function PathChip({ text, resolved, fileName, workspaceId, children }: {
  text: string;
  resolved: string;
  fileName?: string;
  workspaceId: string;
  /** 覆盖胶囊内显示内容（如 markdown 链接文本 / 搜索高亮节点）；缺省显示 text */
  children?: React.ReactNode;
}) {
  const displayName = fileName ?? resolved.split(/[\\/]/).pop() ?? resolved;
  const handleClick = async () => {
    let exists = false;
    try {
      const result = await client.checkPathsExist({ workspaceId, paths: [resolved] });
      exists = !!result.exists?.[resolved];
    } catch {
      exists = false;
    }
    if (!exists) {
      toast.error('文件不存在或已被移动');
      return;
    }
    useMarkdownPreviewStore.getState().open(workspaceId, resolved, displayName);
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
export function GatedPathChip({ text, candidates, workspaceId, children }: {
  text: string;
  candidates: string[] | null | undefined;
  workspaceId: string;
  children?: React.ReactNode;
}) {
  const resolved = useExistenceResolved(workspaceId, candidates);
  if (typeof resolved !== 'string') return <span>{children ?? text}</span>;
  return <PathChip text={text} resolved={resolved} workspaceId={workspaceId}>{children}</PathChip>;
}

export function PathText({ text }: {
  text: string;
}) {
  const workspaceId = useWorkspaceId();
  const roots = useWorkspaceRoots(workspaceId);
  const segments = useMemo(() => splitPathSegments(text, roots), [text, roots]);
  if (segments.length === 1 && segments[0].type === 'text') {
    return <>{text}</>;
  }
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === 'path' && workspaceId && seg.candidates?.length) {
          return <GatedPathChip key={i} text={seg.text} candidates={seg.candidates} workspaceId={workspaceId} />;
        }
        return <span key={i}>{seg.text}</span>;
      })}
    </>
  );
}
