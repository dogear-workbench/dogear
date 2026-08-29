import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  ChevronDown, ChevronRight, ExternalLink, FileText, FolderOpen, Lightbulb, Link2, ScrollText, Trash2,
} from 'lucide-react';
import { client } from '@/lib/client';
import { useGroupStore } from '@/stores/group-store';
import { showConfirm } from '@/stores/confirm-store';
import { useReferenceStore } from '@/stores/reference-store';
import { requireAnchorConversationId } from '@/lib/reference-guard';
import { useMarkdownPreviewStore } from '@/stores/markdown-preview-store';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import type { NativeFileEntry } from '@/types/group';

export interface TopicPanelProps {
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

interface GroupBackgroundInfo {
  groupId: string;
  updatedAt: string;
  topic: string;
  progress: string;
  keyDecisions: string[];
  openQuestions: string[];
}

interface GroupDigestBrief {
  title: string;
  updatedAt: string;
  summary: string;
}

export function TopicPanel({ workspaceId, groupId }: TopicPanelProps) {
  const groups = useGroupStore((s) => s.groups);
  const groupTitle = groups.find((g) => g.id === groupId)?.title || '未命名话题';

  const [refreshKey, setRefreshKey] = useState(0);
  const [nativeFiles, setNativeFiles] = useState<NativeFileEntry[]>([]);
  const [sharedDir, setSharedDir] = useState<string>('');
  const [background, setBackground] = useState<GroupBackgroundInfo | null>(null);
  const [digest, setDigest] = useState<GroupDigestBrief | null>(null);

  const [bgOpen, setBgOpen] = useState(true);
  const [digestOpen, setDigestOpen] = useState(true);
  const [filesOpen, setFilesOpen] = useState(true);

  useEffect(() => {
    const gid = groupId;
    if (!gid) {
      setNativeFiles([]);
      setBackground(null);
      setDigest(null);
      return;
    }
    client.listSharedFiles({ workspaceId, groupId: gid }).then((r) => {
      if (r.error) toast.error('加载文件列表失败', { description: r.error });
      else {
        setNativeFiles(r.files ?? []);
        setSharedDir(r.sharedDir ?? '');
      }
    });
    client.readGroupBackground({ workspaceId, groupId: gid }).then((r) => {
      if (r.error) toast.error('读取话题背景失败', { description: r.error });
      else setBackground(r.background ?? null);
    });
    client.readGroupDigest({ workspaceId, groupId: gid }).then((r) => {
      if ('card' in r && r.card) {
        const card = r.card as { title: string; updatedAt: string; summary: string };
        setDigest({ title: card.title, updatedAt: card.updatedAt, summary: card.summary });
      } else {
        setDigest(null);
      }
    });
  }, [workspaceId, groupId, refreshKey]);

  const handleOpenInExplorer = async () => {
    const gid = groupId;
    if (!gid) return;
    const r = await client.openSharedAreaInExplorer({ workspaceId, groupId: gid });
    if (!r.ok) toast.error('打开资源管理器失败', { description: r.error });
  };

  const openSharedMd = async (relPath: string) => {
    const gid = groupId;
    if (!gid) return;
    const r = await client.readSharedFile({ workspaceId, groupId: gid, relPath });
    if (r.error) {
      toast.error('读取文件失败', { description: r.error });
      return;
    }
    useMarkdownPreviewStore.getState().openInline(relPath, r.content ?? '');
  };

  const openDigest = async () => {
    const gid = groupId;
    if (!gid) return;
    const r = await client.readGroupDigestRaw({ workspaceId, groupId: gid });
    if ('error' in r || r.content === null || r.content === undefined) {
      toast.error('读取组卡失败', { description: 'error' in r ? r.error : '组卡不存在' });
      return;
    }
    useMarkdownPreviewStore.getState().openInline('组卡提炼 · md', r.content);
  };

  const handleDeleteFile = async (relPath: string) => {
    const gid = groupId;
    if (!gid) return;
    const ok = await showConfirm('删除文件', `确认删除 "${relPath}"？此操作不可恢复。`);
    if (!ok) return;
    const r = await client.deleteSharedFile({ workspaceId, groupId: gid, relPath });
    if (r.error) toast.error('删除失败', { description: r.error });
    else setRefreshKey((k) => k + 1);
  };

  return (
    <div className="flex flex-col h-full">
      {/* 顶部头 */}
      <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
        <span className="text-sm font-semibold truncate" title={groupTitle}>{groupTitle}</span>
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
            选中一个会话以查看其话题
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {/* 话题背景 */}
            <Section
              icon={<Lightbulb className="w-3.5 h-3.5 text-amber-500" />}
              title="话题背景"
              open={bgOpen}
              onToggle={() => setBgOpen((v) => !v)}
            >
              {background ? (
                <div className="space-y-2 px-2 py-1.5">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">主题</div>
                    <div className="text-xs font-medium">{background.topic || '—'}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">当前进展</div>
                    <div className="text-xs text-foreground/90 whitespace-pre-wrap">{background.progress || '—'}</div>
                  </div>
                  {background.keyDecisions.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">已拍板决策</div>
                      <ul className="space-y-0.5">
                        {background.keyDecisions.map((d, i) => (
                          <li key={i} className="text-xs text-foreground/90">· {d}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {background.openQuestions.length > 0 && (
                    <div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-0.5">待议问题</div>
                      <ul className="space-y-0.5">
                        {background.openQuestions.map((q, i) => (
                          <li key={i} className="text-xs text-foreground/90">· {q}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <div className="px-2 py-3 text-xs text-muted-foreground">暂无背景</div>
              )}
            </Section>

            {/* 组卡提炼 */}
            <Section
              icon={<ScrollText className="w-3.5 h-3.5 text-violet-500" />}
              title="组卡提炼"
              open={digestOpen}
              onToggle={() => setDigestOpen((v) => !v)}
            >
              {digest ? (
                <div
                  className="px-2 py-1.5 cursor-pointer hover:bg-muted/40 rounded-sm"
                  onClick={() => void openDigest()}
                  title="点击查看完整组卡"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-xs font-medium truncate">{digest.title || '(无标题)'}</span>
                    <ExternalLink className="w-3 h-3 shrink-0 text-muted-foreground" />
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-3 whitespace-pre-wrap">{digest.summary}</p>
                  <div className="text-[10px] text-muted-foreground/70 mt-1">
                    {new Date(digest.updatedAt).toLocaleString()} · 点击查看全文
                  </div>
                </div>
              ) : (
                <div className="px-2 py-3 text-xs text-muted-foreground">暂无组卡</div>
              )}
            </Section>

            {/* 共享文件 */}
            <Section
              icon={<FileText className="w-3.5 h-3.5 text-muted-foreground" />}
              title={`共享文件${nativeFiles.length ? ` · ${nativeFiles.length}` : ''}`}
              open={filesOpen}
              onToggle={() => setFilesOpen((v) => !v)}
            >
              {nativeFiles.length === 0 ? (
                <div className="px-2 py-3 text-xs text-muted-foreground">暂无共享文件</div>
              ) : (
                nativeFiles.map((f) => (
                  <SharedFileRow
                    key={f.relPath}
                    file={f}
                    onClick={() => {
                      const ext = f.relPath.split('.').pop()?.toLowerCase() ?? '';
                      if (ext === 'md') void openSharedMd(f.relPath);
                      else toast.info('仅 .md 文件可预览，可用右上角按钮在资源管理器中查看');
                    }}
                    onDelete={() => handleDeleteFile(f.relPath)}
                    onReference={() => {
                      if (!groupId || !sharedDir) return;
                      const anchorId = requireAnchorConversationId();
                      if (!anchorId) return;
                      const absPath = sharedDir.endsWith('/') || sharedDir.endsWith('\\')
                        ? `${sharedDir}${f.relPath}`
                        : `${sharedDir}/${f.relPath}`;
                      useReferenceStore.getState().addReferencedSharedFile({
                        groupId,
                        relPath: f.relPath,
                        absPath,
                      }, anchorId);
                      toast.success(`已引用 ${f.relPath}`);
                    }}
                  />
                ))
              )}
            </Section>
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

interface SectionProps {
  icon: ReactNode;
  title: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

function Section({ icon, title, open, onToggle, children }: SectionProps) {
  return (
    <div>
      <button
        className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded-sm hover:bg-muted/40 transition-colors text-left"
        onClick={onToggle}
      >
        {open
          ? <ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground" />
          : <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground" />}
        {icon}
        <span className="text-xs font-medium text-foreground/80">{title}</span>
      </button>
      {open && <div className="mx-1">{children}</div>}
    </div>
  );
}

interface SharedFileRowProps {
  file: NativeFileEntry;
  onClick: () => void;
  onDelete: () => void;
  onReference: () => void;
}

function SharedFileRow({ file, onClick, onDelete, onReference }: SharedFileRowProps) {
  return (
    <div
      className="group flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-muted/50 text-xs"
      onClick={onClick}
    >
      <FileText className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <div className="truncate font-medium" title={file.relPath}>{file.relPath}</div>
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
