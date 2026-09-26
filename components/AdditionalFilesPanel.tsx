import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import {
  Folder, FolderOpen, File, ChevronRight, ChevronDown,
  Plus, Trash2, Quote, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useReferenceStore } from '@/stores/reference-store';
import { guardReferenceIntoFocus, requireAnchorConversationId } from '@/lib/reference-guard';
import { showConfirm } from '@/stores/confirm-store';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { WorkspaceFileNode } from '@/types/electron-api';

interface AdditionalFilesPanelProps {
  workspaceId: string;
}

export function AdditionalFilesPanel({ workspaceId: _workspaceId }: AdditionalFilesPanelProps) {
  void _workspaceId;
  const workspace = useWorkspaceStore((s) => s.workspace);
  const addAdditionalPath = useWorkspaceStore((s) => s.addAdditionalPath);
  const removeAdditionalPath = useWorkspaceStore((s) => s.removeAdditionalPath);
  const toggleAdditionalPath = useWorkspaceStore((s) => s.toggleAdditionalPath);

  const [picking, setPicking] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  const additionalPaths = workspace?.additionalPaths ?? [];

  const handleAddFolder = async () => {
    if (picking) return;
    setPicking(true);
    try {
      const result = await client.pickDirectory();
      if (result.canceled || !result.path) return;
      await addAdditionalPath(result.path);
      toast.success('已添加附加路径');
    } catch (error) {
      console.error('添加附加路径失败:', error);
      toast.error('添加附加路径失败', { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setPicking(false);
    }
  };

  const handleRemove = async (path: string) => {
    const ok = await showConfirm('移除附加路径', `确定要移除 "${path}" 吗？`);
    if (!ok) return;
    await removeAdditionalPath(path);
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
  };

  const handleToggle = async (path: string, enabled: boolean) => {
    await toggleAdditionalPath(path, enabled);
    if (!enabled) {
      setExpandedPaths((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }
  };

  const handleToggleExpand = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-sm font-medium">附加文件</span>
        <div className="flex items-center gap-1">
          <button
            className={cn(
              'p-1 rounded hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors',
              picking && 'pointer-events-none',
            )}
            onClick={handleAddFolder}
            disabled={picking}
            title="添加文件夹"
          >
            {picking ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Plus className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      <ScrollArea className="flex-1 overflow-hidden">
        {additionalPaths.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-sm text-muted-foreground">
            <Folder className="w-8 h-8 opacity-40" />
            <span>暂无附加路径</span>
            <button
              className="text-xs text-primary hover:underline"
              onClick={handleAddFolder}
              disabled={picking}
            >
              点击添加文件夹
            </button>
          </div>
        ) : (
          <div className="py-1">
            {additionalPaths.map((ap) => (
              <AdditionalFolderSection
                key={ap.path}
                path={ap.path}
                enabled={ap.enabled}
                expanded={expandedPaths.has(ap.path)}
                onToggle={(enabled) => handleToggle(ap.path, enabled)}
                onRemove={() => handleRemove(ap.path)}
                onToggleExpand={() => handleToggleExpand(ap.path)}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

interface AdditionalFolderSectionProps {
  path: string;
  enabled: boolean;
  expanded: boolean;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
  onToggleExpand: () => void;
}

function AdditionalFolderSection({
  path,
  enabled,
  expanded,
  onToggle,
  onRemove,
  onToggleExpand,
}: AdditionalFolderSectionProps) {
  const dirName = path.split(/[/\\]/).filter(Boolean).pop() || path;

  return (
    <div className={cn(!enabled && 'opacity-50')}>
      <div
        className="group flex items-center gap-1 px-2 py-1 rounded cursor-pointer hover:bg-muted/40 transition-colors"
        onClick={enabled ? onToggleExpand : undefined}
      >
        {enabled ? (
          expanded ? (
            <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="w-3.5 h-3.5 shrink-0" />
        )}
        {expanded ? (
          <FolderOpen className="w-3.5 h-3.5 shrink-0 text-blue-500" />
        ) : (
          <Folder className="w-3.5 h-3.5 shrink-0 text-blue-500" />
        )}
        <div className="flex-1 min-w-0" title={path}>
          <div className="text-xs font-medium truncate">{dirName}</div>
        </div>
        <button
          className="p-0.5 rounded hover:bg-destructive/10 hover:text-destructive transition-colors shrink-0 opacity-0 group-hover:opacity-100"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          title="移除"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
          <Switch
            checked={enabled}
            onCheckedChange={onToggle}
            className="scale-75"
          />
        </div>
      </div>

      {enabled && expanded && (
        <AdditionalFileTree dirPath={path} />
      )}
    </div>
  );
}

interface AdditionalFileTreeProps {
  dirPath: string;
}

function AdditionalFileTree({ dirPath }: AdditionalFileTreeProps) {
  const [files, setFiles] = useState<WorkspaceFileNode[]>([]);
  const [loading, setLoading] = useState(true);
  const addReferencedFile = useReferenceStore((s) => s.addReferencedFile);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    client.scanAdditionalPath({ dirPath }).then((result) => {
      if (!cancelled) {
        setFiles(result.files ?? []);
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setFiles([]);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [dirPath]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
        扫描中...
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
        目录为空或不存在
      </div>
    );
  }

  return (
    <div>
      {files.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          level={0}
          onReference={(n) => {
            if (!guardReferenceIntoFocus()) return;
            const anchorId = requireAnchorConversationId();
            if (!anchorId) return;
            const isFolder = n.type === 'directory';
            addReferencedFile({ name: n.name, path: n.path, ...(isFolder && { type: 'folder' as const }) }, anchorId);
            toast.success(`已引用${isFolder ? '文件夹' : ''} ${n.name}`);
          }}
        />
      ))}
    </div>
  );
}

interface FileTreeNodeProps {
  node: WorkspaceFileNode;
  level: number;
  onReference: (node: WorkspaceFileNode) => void;
}

function FileTreeNode({ node, level, onReference }: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const isDir = node.type === 'directory';

  return (
    <>
      <div
        className="group flex items-center gap-1 py-0.5 pr-2 cursor-pointer hover:bg-muted/40 transition-colors"
        style={{ paddingLeft: `${level * 16 + 8}px` }}
        onClick={() => {
          if (isDir) setExpanded((v) => !v);
          else onReference(node);
        }}
      >
        {isDir ? (
          expanded ? (
            <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="w-3.5 shrink-0" />
        )}
        {isDir ? (
          expanded ? (
            <FolderOpen className="w-3.5 h-3.5 shrink-0 text-blue-500" />
          ) : (
            <Folder className="w-3.5 h-3.5 shrink-0 text-blue-500" />
          )
        ) : (
          <File className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="flex-1 min-w-0 text-xs truncate">{node.name}</span>
        <button
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-teal-100 hover:text-teal-700 transition-opacity shrink-0"
          onClick={(e) => { e.stopPropagation(); onReference(node); }}
          title={isDir ? '引用文件夹到对话' : '引用到对话'}
        >
          <Quote className="w-3 h-3" />
        </button>
      </div>
      {isDir && expanded && node.children && node.children.length > 0 && (
        <>
          {node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              level={level + 1}
              onReference={onReference}
            />
          ))}
        </>
      )}
    </>
  );
}
