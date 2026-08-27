import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { FileText } from 'lucide-react';
import { client } from '@/lib/client';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useMarkdownPreviewStore } from '@/stores/markdown-preview-store';
import { useWorkspaceId } from './workspace-id-context';

export interface PathSegment {
  type: 'text' | 'path';
  text: string;
  resolved?: string;
  fileName?: string;
}

const PATH_TOKEN_RE = /(?:[A-Za-z]:[\\/]|[\\/])[A-Za-z0-9_.\-~@$()+\\/]*|[A-Za-z0-9_.\-~@$()+]*[\\/][A-Za-z0-9_.\-~@$()+\\/]*/g;
const TRAILING_PUNCT_RE = /[.,;:!?)\]}'"]+$/;
const ALLOWED_EXT_RE = /\.(md|markdown|txt|json)$/i;

export function resolvePathInWorkspace(candidate: string, workspacePath: string): string | null {
  const root = workspacePath.replace(/\\/g, '/').replace(/\/+$/, '');
  if (!root) return null;
  const posix = candidate.replace(/\\/g, '/');
  const drive = /^([A-Za-z]):\//.exec(posix);
  let prefix: string;
  let parts: string[];
  if (drive || posix.startsWith('/')) {
    prefix = drive ? `${drive[1]}:/` : '/';
    parts = posix.slice(prefix.length).split('/');
  } else {
    const rootDrive = /^([A-Za-z]):\//.exec(root);
    if (rootDrive) prefix = `${rootDrive[1]}:/`;
    else if (root.startsWith('/')) prefix = '/';
    else return null;
    parts = [...root.slice(prefix.length).split('/'), ...posix.split('/')];
  }
  const stack: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  const resolved = prefix + stack.join('/');
  const lowerResolved = resolved.toLowerCase();
  const lowerRoot = root.toLowerCase();
  if (lowerResolved === lowerRoot || lowerResolved.startsWith(lowerRoot + '/')) return resolved;
  return null;
}

export function splitPathSegments(text: string, workspacePath: string | null): PathSegment[] {
  if (!workspacePath || !text) return [{ type: 'text', text }];
  const segments: PathSegment[] = [];
  let cursor = 0;
  const emitText = (end: number) => {
    if (end > cursor) segments.push({ type: 'text', text: text.slice(cursor, end) });
  };
  PATH_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PATH_TOKEN_RE.exec(text)) !== null) {
    const token = match[0].replace(TRAILING_PUNCT_RE, '');
    if (!/[\\/]/.test(token) || !ALLOWED_EXT_RE.test(token)) continue;
    const resolved = resolvePathInWorkspace(token, workspacePath);
    if (!resolved) continue;
    emitText(match.index);
    segments.push({ type: 'path', text: token, resolved, fileName: resolved.split('/').pop() ?? resolved });
    cursor = match.index + token.length;
  }
  emitText(text.length);
  if (segments.length === 0) return [{ type: 'text', text }];
  return segments;
}

const workspacePathsCache = {
  map: new Map<string, string>(),
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
    for (const w of result.workspaces ?? []) workspacePathsCache.map.set(w.id, w.path);
    workspacePathsCache.loaded = true;
    workspacePathsCache.inflight = null;
    workspacePathsCache.listeners.forEach((l) => l());
  }).catch(() => {
    workspacePathsCache.inflight = null;
  });
}

export function useWorkspacePath(workspaceId: string | null): string | null {
  const focused = useWorkspaceStore((s) => (workspaceId && s.workspace?.id === workspaceId ? s.workspace : null));
  const cached = useSyncExternalStore(
    subscribeWorkspacePaths,
    () => (workspaceId ? workspacePathsCache.map.get(workspaceId) ?? null : null),
    () => null,
  );
  useEffect(() => {
    if (!workspaceId || focused) return;
    if (!workspacePathsCache.map.has(workspaceId)) ensureWorkspacePaths();
  }, [workspaceId, focused]);
  return focused?.path ?? cached;
}

export function PathChip({ text, resolved, fileName, workspaceId }: {
  text: string;
  resolved: string;
  fileName?: string;
  workspaceId: string;
}) {
  const displayName = fileName ?? resolved.split(/[\\/]/).pop() ?? resolved;
  return (
    <button
      type="button"
      onClick={() => useMarkdownPreviewStore.getState().open(workspaceId, resolved, displayName)}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 mx-0.5 align-baseline max-w-[280px] rounded-full border border-teal-200 bg-teal-50 text-xs text-teal-700 hover:bg-teal-100 hover:border-teal-300 transition-colors"
      title={resolved}
    >
      <FileText size={12} className="shrink-0" />
      <span className="font-mono truncate">{text}</span>
    </button>
  );
}

export function PathText({ text }: {
  text: string;
}) {
  const workspaceId = useWorkspaceId();
  const workspacePath = useWorkspacePath(workspaceId);
  const segments = useMemo(() => splitPathSegments(text, workspacePath), [text, workspacePath]);
  if (segments.length === 1 && segments[0].type === 'text') {
    return <>{text}</>;
  }
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === 'path' && workspaceId && seg.resolved) {
          return <PathChip key={i} text={seg.text} resolved={seg.resolved} fileName={seg.fileName} workspaceId={workspaceId} />;
        }
        return <span key={i}>{seg.text}</span>;
      })}
    </>
  );
}
