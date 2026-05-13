import { useCallback, useEffect, useState } from 'react';
import { Archive, RotateCcw, Trash2, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { showConfirm } from '@/stores/confirm-store';
import { useUIStore } from '@/stores/ui-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { client } from '@/lib/client';
import type { Conversation } from '@/components/ConversationList';

function formatArchivedTime(iso?: string): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);
    if (diffHours < 1) return '刚刚';
    if (diffHours < 24) return `${Math.floor(diffHours)} 小时前`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays} 天前`;
    return d.toLocaleDateString('zh-CN');
  } catch {
    return iso;
  }
}

/**
 * 归档面板
 *
 * 列出当前工作区已归档的对话，支持"恢复"和"永久删除"。
 * 状态不跨会话持久化 —— 打开面板时加载列表，关闭后丢弃。
 */
export function ArchivePanel() {
  const open = useUIStore((s: any) => s.archivePanelOpen);
  const closePanel = useUIStore((s: any) => s.closeArchivePanel);
  const workspace = useWorkspaceStore((s) => s.workspace);
  const loadConversations = useConversationStore((s) => s.loadConversations);

  const [archived, setArchived] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);

  const loadArchived = useCallback(async () => {
    if (!workspace) return;
    setLoading(true);
    try {
      const res = await client.listArchivedConversations({ workspaceId: workspace.id });
      if (res.error) {
        toast.error('加载归档失败', { description: res.error });
        setArchived([]);
      } else {
        setArchived((res.conversations || []) as Conversation[]);
      }
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  // 打开面板时加载
  useEffect(() => {
    if (open) loadArchived();
  }, [open, loadArchived]);

  const handleUnarchive = useCallback(async (conv: Conversation) => {
    if (!workspace) return;
    try {
      const res = await client.unarchiveConversation({ conversationId: conv.id, workspaceId: workspace.id });
      if (res.error) {
        toast.error('恢复失败', { description: res.error });
        return;
      }
      toast.success('已恢复到对话列表');
      await loadArchived();
      await loadConversations(); // 主列表也要刷新（多出这条对话）
    } catch (error) {
      toast.error('恢复失败', { description: error instanceof Error ? error.message : String(error) });
    }
  }, [workspace, loadArchived, loadConversations]);

  const handlePermanentDelete = useCallback(async (conv: Conversation) => {
    if (!workspace) return;
    const confirmed = await showConfirm(
      '永久删除对话',
      `"${conv.title || '新对话'}" 及其所有 AI 对话历史将被永久删除。此操作不可恢复。`,
    );
    if (!confirmed) return;
    try {
      const res = await client.deleteConversation({ conversationId: conv.id, workspaceId: workspace.id });
      if (res.error) {
        toast.error('删除失败', { description: res.error });
        return;
      }
      toast.success('已永久删除');
      await loadArchived();
    } catch (error) {
      toast.error('删除失败', { description: error instanceof Error ? error.message : String(error) });
    }
  }, [workspace, loadArchived]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) closePanel(); }}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Archive className="w-5 h-5" />
            归档对话
          </DialogTitle>
          <DialogDescription>
            已归档的对话保留完整历史。你可以恢复到对话列表，或永久删除。
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : archived.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Archive className="w-10 h-10 mb-3 opacity-40" />
              <p className="text-sm">暂无归档对话</p>
              <p className="text-xs mt-1">从对话列表删除有内容的对话会移到这里</p>
            </div>
          ) : (
            <ul className="space-y-2 py-2">
              {archived.map((conv) => (
                <li
                  key={conv.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-md border bg-card hover:bg-muted/30 transition-colors"
                >
                  <MessageSquare className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">
                      {conv.title || '新对话'}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      归档于 {formatArchivedTime(conv.archived_at)}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => handleUnarchive(conv)}
                    title="恢复到对话列表"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    恢复
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => handlePermanentDelete(conv)}
                    title="永久删除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
