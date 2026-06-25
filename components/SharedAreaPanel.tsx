import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Plus, Link, Trash2, ExternalLink, FileText, ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { useGroupStore } from '@/stores/group-store';
import { showConfirm } from '@/stores/confirm-store';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import type { NativeFileEntry, SharedReference } from '@/types/group';

export interface SharedAreaPanelProps {
  workspaceId: string;
  groupId: string | null;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMtime(mtime: number): string {
  return new Date(mtime).toLocaleString();
}

export function SharedAreaPanel({ workspaceId, groupId }: SharedAreaPanelProps) {
  const groups = useGroupStore((s) => s.groups);
  const groupTitle = groups.find((g) => g.id === groupId)?.title || '未命名组';

  const [refreshKey, setRefreshKey] = useState(0);
  const [nativeFiles, setNativeFiles] = useState<NativeFileEntry[]>([]);
  const [references, setReferences] = useState<SharedReference[]>([]);
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewExt, setPreviewExt] = useState<string>('');
  const [nativeExpanded, setNativeExpanded] = useState(true);
  const [refExpanded, setRefExpanded] = useState(true);

  // 新建文件 Dialog
  const [newFileDialogOpen, setNewFileDialogOpen] = useState(false);
  const [newFilePath, setNewFilePath] = useState('');
  const [newFileCreating, setNewFileCreating] = useState(false);

  // 添加引用 Dialog
  const [addRefDialogOpen, setAddRefDialogOpen] = useState(false);
  const [addRefPath, setAddRefPath] = useState('');
  const [addRefLabel, setAddRefLabel] = useState('');
  const [addRefAdding, setAddRefAdding] = useState(false);

  useEffect(() => {
    setPreviewContent(null);
  }, [groupId]);

  useEffect(() => {
    const gid = groupId;
    if (!gid) {
      setNativeFiles([]);
      return;
    }
    client.listSharedFiles({ workspaceId, groupId: gid }).then((r) => {
      if (r.error) toast.error('加载原生文件失败', { description: r.error });
      else setNativeFiles(r.files ?? []);
    });
  }, [workspaceId, groupId, refreshKey]);

  useEffect(() => {
    const gid = groupId;
    if (!gid) {
      setReferences([]);
      return;
    }
    client.listSharedReferences({ workspaceId, groupId: gid }).then((r) => {
      if (r.error) toast.error('加载引用列表失败', { description: r.error });
      else setReferences(r.references ?? []);
    });
  }, [workspaceId, groupId, refreshKey]);

  const handleClickNativeFile = async (relPath: string) => {
    const gid = groupId;
    if (!gid) return;
    const r = await client.readSharedFile({ workspaceId, groupId: gid, relPath });
    if (r.error) {
      toast.error('读取文件失败', { description: r.error });
      return;
    }
    setPreviewContent(r.content ?? '');
    const ext = relPath.split('.').pop()?.toLowerCase() ?? '';
    setPreviewExt(ext);
  };

  const handleDeleteNativeFile = async (relPath: string) => {
    const gid = groupId;
    if (!gid) return;
    const ok = await showConfirm('删除文件', `确认删除 "${relPath}"？此操作不可恢复。`);
    if (!ok) return;
    const r = await client.deleteSharedFile({ workspaceId, groupId: gid, relPath });
    if (r.error) toast.error('删除失败', { description: r.error });
    else {
      if (previewContent !== null) setPreviewContent(null);
      setRefreshKey((k) => k + 1);
    }
  };

  const handleClickReference = async (ref: SharedReference) => {
    const gid = groupId;
    if (!gid) return;
    const r = await client.readReferencedFile({ workspaceId, groupId: gid, refId: ref.id });
    if (r.error) {
      toast.error('读取引用文件失败', { description: r.error });
      return;
    }
    setPreviewContent(r.content ?? '');
    const pathStr = ref.type === 'file' ? ref.path : '';
    const ext = pathStr.split('.').pop()?.toLowerCase() ?? '';
    setPreviewExt(ext);
  };

  const handleRemoveReference = async (refId: string) => {
    const gid = groupId;
    if (!gid) return;
    const ok = await showConfirm('移除引用', '确认从此组移除该引用？');
    if (!ok) return;
    const r = await client.removeReference({ workspaceId, groupId: gid, refId });
    if (r.error) toast.error('移除引用失败', { description: r.error });
    else setRefreshKey((k) => k + 1);
  };

  const handleCreateFile = async () => {
    const gid = groupId;
    if (!gid || !newFilePath.trim()) return;
    setNewFileCreating(true);
    const r = await client.writeSharedFile({ workspaceId, groupId: gid, relPath: newFilePath.trim(), content: '' });
    setNewFileCreating(false);
    if (r.error) {
      toast.error('创建文件失败', { description: r.error });
      return;
    }
    toast.success('文件已创建');
    setNewFileDialogOpen(false);
    setNewFilePath('');
    setRefreshKey((k) => k + 1);
  };

  const handleAddReference = async () => {
    const gid = groupId;
    if (!gid || !addRefPath.trim()) return;
    setAddRefAdding(true);
    const r = await client.addReference({
      workspaceId,
      groupId: gid,
      refType: 'file',
      path: addRefPath.trim(),
      label: addRefLabel.trim() || undefined,
    });
    setAddRefAdding(false);
    if (r.error) {
      toast.error('添加引用失败', { description: r.error });
      return;
    }
    toast.success('引用已添加');
    setAddRefDialogOpen(false);
    setAddRefPath('');
    setAddRefLabel('');
    setRefreshKey((k) => k + 1);
  };

  const isEmpty = !groupId || (nativeFiles.length === 0 && references.length === 0);

  return (
    <div className="flex flex-col h-full">
      {/* 顶部头 */}
      <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
        <span className="text-sm font-semibold truncate">{groupId ? groupTitle : '共享区'}</span>
        {groupId && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              title="新建文件"
              onClick={() => setNewFileDialogOpen(true)}
            >
              <Plus className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              title="添加引用"
              onClick={() => setAddRefDialogOpen(true)}
            >
              <Link className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>

      {/* 主体 */}
      <ScrollArea className="flex-1 overflow-hidden">
        {isEmpty ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
            暂无共享内容
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {/* 原生项段 */}
            <div>
              <button
                className="flex items-center gap-1 w-full px-1 py-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setNativeExpanded((v) => !v)}
              >
                {nativeExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                原生项
                <span className="ml-1 text-muted-foreground/60">({nativeFiles.length})</span>
              </button>
              {nativeExpanded && (
                <div className="mt-0.5 space-y-0.5">
                  {nativeFiles.length === 0 ? (
                    <p className="px-3 py-1 text-xs text-muted-foreground/60">暂无原生文件</p>
                  ) : (
                    nativeFiles.map((f) => (
                      <NativeFileRow
                        key={f.relPath}
                        file={f}
                        onClick={() => handleClickNativeFile(f.relPath)}
                        onDelete={() => handleDeleteNativeFile(f.relPath)}
                      />
                    ))
                  )}
                </div>
              )}
            </div>

            {/* 引用项段 */}
            <div>
              <button
                className="flex items-center gap-1 w-full px-1 py-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => setRefExpanded((v) => !v)}
              >
                {refExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                引用项
                <span className="ml-1 text-muted-foreground/60">({references.length})</span>
              </button>
              {refExpanded && (
                <div className="mt-0.5 space-y-0.5">
                  {references.length === 0 ? (
                    <p className="px-3 py-1 text-xs text-muted-foreground/60">暂无引用</p>
                  ) : (
                    references.map((ref) => (
                      <ReferenceRow
                        key={ref.id}
                        reference={ref}
                        onClick={() => handleClickReference(ref)}
                        onRemove={() => handleRemoveReference(ref.id)}
                      />
                    ))
                  )}
                </div>
              )}
            </div>

            {/* 预览区 */}
            {previewContent !== null && (
              <div className="mt-2 border rounded-md overflow-hidden">
                <div className="flex items-center justify-between px-2 py-1 bg-muted/40 border-b">
                  <span className="text-xs text-muted-foreground">预览</span>
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setPreviewContent(null)}
                  >
                    关闭
                  </button>
                </div>
                <div className="p-2 max-h-64 overflow-auto">
                  {previewExt === 'md' ? (
                    <MarkdownRenderer content={previewContent} className="text-xs" />
                  ) : (
                    <pre className="text-xs whitespace-pre-wrap break-all">{previewContent}</pre>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      {/* 新建文件 Dialog */}
      <Dialog open={newFileDialogOpen} onOpenChange={setNewFileDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建共享文件</DialogTitle>
          </DialogHeader>
          <div className="py-2">
            <Input
              placeholder="相对路径，例如 notes.md"
              value={newFilePath}
              onChange={(e) => setNewFilePath(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreateFile(); }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFileDialogOpen(false)}>取消</Button>
            <Button onClick={handleCreateFile} disabled={!newFilePath.trim() || newFileCreating}>创建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 添加引用 Dialog */}
      <Dialog open={addRefDialogOpen} onOpenChange={setAddRefDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加文件引用</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-2">
            <Input
              placeholder="workspace 内相对路径或绝对路径"
              value={addRefPath}
              onChange={(e) => setAddRefPath(e.target.value)}
              autoFocus
            />
            <Input
              placeholder="显示标签（可选）"
              value={addRefLabel}
              onChange={(e) => setAddRefLabel(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddReference(); }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddRefDialogOpen(false)}>取消</Button>
            <Button onClick={handleAddReference} disabled={!addRefPath.trim() || addRefAdding}>添加</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface NativeFileRowProps {
  file: NativeFileEntry;
  onClick: () => void;
  onDelete: () => void;
}

function NativeFileRow({ file, onClick, onDelete }: NativeFileRowProps) {
  return (
    <div
      className={cn(
        'group flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-muted/50 text-xs',
      )}
      onClick={onClick}
    >
      <FileText className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="truncate font-medium">{file.relPath}</div>
        <div className="text-muted-foreground/70 truncate">
          {formatSize(file.size)} · {formatMtime(file.mtime)}
        </div>
      </div>
      <button
        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/10 hover:text-destructive transition-opacity shrink-0"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        title="删除"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

interface ReferenceRowProps {
  reference: SharedReference;
  onClick: () => void;
  onRemove: () => void;
}

function ReferenceRow({ reference, onClick, onRemove }: ReferenceRowProps) {
  const displayLabel = reference.label || (reference.type === 'file' ? reference.path : reference.id);
  const subLabel = reference.type === 'file' ? reference.path : undefined;

  return (
    <div
      className="group flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-muted/50 text-xs"
      onClick={onClick}
    >
      <ExternalLink className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="truncate font-medium">{displayLabel}</div>
        {subLabel && <div className="text-muted-foreground/70 truncate">{subLabel}</div>}
      </div>
      <button
        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/10 hover:text-destructive transition-opacity shrink-0"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        title="移除引用"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
