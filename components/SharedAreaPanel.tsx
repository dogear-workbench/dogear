import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FolderOpen, Trash2, FileText, Link2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { useGroupStore } from '@/stores/group-store';
import { showConfirm } from '@/stores/confirm-store';
import { useReferenceStore } from '@/stores/reference-store';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import type { NativeFileEntry } from '@/types/group';

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
  const groupTitle = groups.find((g) => g.id === groupId)?.title || '未命名话题';

  const [refreshKey, setRefreshKey] = useState(0);
  const [nativeFiles, setNativeFiles] = useState<NativeFileEntry[]>([]);
  const [sharedDir, setSharedDir] = useState<string>('');
  const [previewContent, setPreviewContent] = useState<string | null>(null);
  const [previewExt, setPreviewExt] = useState<string>('');
  const [previewRelPath, setPreviewRelPath] = useState<string>('');

  useEffect(() => {
    setPreviewContent(null);
    setPreviewRelPath('');
  }, [groupId]);

  useEffect(() => {
    const gid = groupId;
    if (!gid) {
      setNativeFiles([]);
      return;
    }
    client.listSharedFiles({ workspaceId, groupId: gid }).then((r) => {
      if (r.error) toast.error('加载文件列表失败', { description: r.error });
      else {
        setNativeFiles(r.files ?? []);
        setSharedDir(r.sharedDir ?? '');
      }
    });
  }, [workspaceId, groupId, refreshKey]);

  const handleOpenInExplorer = async () => {
    const gid = groupId;
    if (!gid) return;
    const r = await client.openSharedAreaInExplorer({ workspaceId, groupId: gid });
    if (!r.ok) toast.error('打开资源管理器失败', { description: r.error });
  };

  const handleClickFile = async (relPath: string) => {
    const gid = groupId;
    if (!gid) return;
    const ext = relPath.split('.').pop()?.toLowerCase() ?? '';
    setPreviewExt(ext);
    setPreviewRelPath(relPath);
    if (ext !== 'md') {
      setPreviewContent('');
      return;
    }
    const r = await client.readSharedFile({ workspaceId, groupId: gid, relPath });
    if (r.error) {
      toast.error('读取文件失败', { description: r.error });
      return;
    }
    setPreviewContent(r.content ?? '');
  };

  const handleDeleteFile = async (relPath: string) => {
    const gid = groupId;
    if (!gid) return;
    const ok = await showConfirm('删除文件', `确认删除 "${relPath}"？此操作不可恢复。`);
    if (!ok) return;
    const r = await client.deleteSharedFile({ workspaceId, groupId: gid, relPath });
    if (r.error) toast.error('删除失败', { description: r.error });
    else {
      if (previewRelPath === relPath) {
        setPreviewContent(null);
        setPreviewRelPath('');
      }
      setRefreshKey((k) => k + 1);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* 顶部头 */}
      <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
        <span className="text-sm font-semibold truncate">{groupId ? groupTitle : '共享区'}</span>
        {groupId && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            title="在资源管理器打开共享目录"
            onClick={handleOpenInExplorer}
          >
            <FolderOpen className="w-4 h-4" />
          </Button>
        )}
      </div>

      {/* 主体 */}
      <ScrollArea className="flex-1 overflow-hidden">
        {!groupId ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
            选中一个会话以查看其共享区
          </div>
        ) : nativeFiles.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
            暂无共享文件
          </div>
        ) : (
          <div className="p-2 space-y-0.5">
            {nativeFiles.map((f) => (
              <SharedFileRow
                key={f.relPath}
                file={f}
                isActive={previewRelPath === f.relPath}
                onClick={() => handleClickFile(f.relPath)}
                onDelete={() => handleDeleteFile(f.relPath)}
                onReference={() => {
                  if (!groupId || !sharedDir) return;
                  const absPath = sharedDir.endsWith('/') || sharedDir.endsWith('\\')
                    ? `${sharedDir}${f.relPath}`
                    : `${sharedDir}/${f.relPath}`;
                  useReferenceStore.getState().addReferencedSharedFile({
                    groupId,
                    relPath: f.relPath,
                    absPath,
                  });
                  toast.success(`已引用 ${f.relPath}`);
                }}
              />
            ))}

            {/* 预览区 */}
            {previewContent !== null && (
              <div className="mt-2 border rounded-md overflow-hidden">
                <div className="flex items-center justify-between px-2 py-1 bg-muted/40 border-b">
                  <span className="text-xs text-muted-foreground truncate">{previewRelPath}</span>
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground shrink-0 ml-2"
                    onClick={() => { setPreviewContent(null); setPreviewRelPath(''); }}
                  >
                    关闭
                  </button>
                </div>
                <div className="p-2 max-h-64 overflow-auto">
                  {previewExt === 'md' ? (
                    <MarkdownRenderer content={previewContent} className="text-xs" />
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      不支持预览（仅 .md 文件可预览），点击右上角「在资源管理器打开」用外部程序查看。
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

interface SharedFileRowProps {
  file: NativeFileEntry;
  isActive: boolean;
  onClick: () => void;
  onDelete: () => void;
  onReference: () => void;
}

function SharedFileRow({ file, isActive, onClick, onDelete, onReference }: SharedFileRowProps) {
  return (
    <div
      className={cn(
        'group flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-muted/50 text-xs',
        isActive && 'bg-muted/60',
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
        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-teal-100 hover:text-teal-700 transition-opacity shrink-0"
        onClick={(e) => { e.stopPropagation(); onReference(); }}
        title="引用到当前对话"
      >
        <Link2 className="w-3.5 h-3.5" />
      </button>
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
