import { useEffect, useState } from 'react';
import { Check, ChevronRight, FolderInput, Loader2, PlusCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { showConfirm } from '@/stores/confirm-store';
import { useConversationStore } from '@/stores/conversation-store';
import { client } from '@/lib/client';
import type { Workspace } from '@/types/electron-api';
import type { Group } from '@/types/group';

interface MoveToWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conversationId: string;
  conversationTitle: string;
}

/**
 * 临时会话「移入工作区」弹层：选目标工作区（personal 天然不在列表）→ 选现有话题或新建话题
 * → showConfirm 确认后走 movePersonalConversationToWorkspace（索引迁移 + session 搬运 + 跳转）。
 */
export function MoveToWorkspaceDialog({ open, onOpenChange, conversationId, conversationTitle }: MoveToWorkspaceDialogProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [newGroupMode, setNewGroupMode] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [newGroupTitle, setNewGroupTitle] = useState('');
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setWorkspaces([]);
    setSelectedWorkspaceId(null);
    setGroups([]);
    setNewGroupMode(false);
    setSelectedGroupId(null);
    setNewGroupTitle('');
    client.getAll()
      .then(({ workspaces: list }) => setWorkspaces(list ?? []))
      .catch((err) => toast.error('获取工作区列表失败', { description: err instanceof Error ? err.message : String(err) }));
  }, [open]);

  useEffect(() => {
    if (!open || !selectedWorkspaceId) return;
    setGroupsLoading(true);
    client.listGroups({ workspaceId: selectedWorkspaceId })
      .then(({ groups: list }) => setGroups(list ?? []))
      .catch(() => setGroups([]))
      .finally(() => setGroupsLoading(false));
  }, [open, selectedWorkspaceId]);

  const targetGroupName = newGroupMode
    ? (newGroupTitle.trim() || conversationTitle)
    : groups.find((g) => g.id === selectedGroupId)?.title?.trim() || '未命名话题';
  const canSubmit = !!selectedWorkspaceId && (newGroupMode || !!selectedGroupId) && !moving;

  const handleMove = async () => {
    if (!selectedWorkspaceId) return;
    const wsName = workspaces.find((w) => w.id === selectedWorkspaceId)?.name ?? selectedWorkspaceId;
    const confirmed = await showConfirm(
      '移入工作区',
      `将把「${conversationTitle || '未命名会话'}」及其全部聊天历史移入「${wsName}」的「${targetGroupName}」话题，临时会话列表中将不再保留。`,
    );
    if (!confirmed) return;

    setMoving(true);
    try {
      const ok = await useConversationStore.getState().movePersonalConversationToWorkspace(
        conversationId,
        selectedWorkspaceId,
        newGroupMode ? undefined : selectedGroupId ?? undefined,
        newGroupMode ? (newGroupTitle.trim() || undefined) : undefined,
      );
      if (ok) {
        toast.success('已移入工作区', { description: `${wsName} · ${targetGroupName}` });
        onOpenChange(false);
      }
    } finally {
      setMoving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!moving) onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md gap-0 p-0 overflow-hidden">
        <DialogHeader className="flex-shrink-0 px-5 pt-5 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <FolderInput size={15} className="text-sky-500" />
            移入工作区
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4 space-y-4">
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-2">1. 选择工作区</p>
            {workspaces.length === 0 ? (
              <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                加载中...
              </div>
            ) : (
              <div className="space-y-1">
                {workspaces.map((ws) => (
                  <button
                    key={ws.id}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-md border text-sm text-left transition-colors hover:bg-muted/60"
                    onClick={() => {
                      setSelectedWorkspaceId(ws.id);
                      setSelectedGroupId(null);
                      setNewGroupMode(false);
                    }}
                  >
                    <span className="flex-1 truncate">{ws.name}</span>
                    <span className="text-[11px] text-muted-foreground truncate max-w-[45%]">{ws.path}</span>
                    {selectedWorkspaceId === ws.id && <Check size={14} className="text-sky-500 flex-shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {selectedWorkspaceId && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">2. 选择话题归属</p>
              {groupsLoading ? (
                <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
                  <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
                  加载中...
                </div>
              ) : (
                <div className="space-y-1">
                  {groups.map((g) => (
                    <button
                      key={g.id}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-md border text-sm text-left transition-colors hover:bg-muted/60"
                      onClick={() => {
                        setSelectedGroupId(g.id);
                        setNewGroupMode(false);
                      }}
                    >
                      <span className="flex-1 truncate">{g.title?.trim() || '未命名话题'}</span>
                      {!newGroupMode && selectedGroupId === g.id && <Check size={14} className="text-sky-500 flex-shrink-0" />}
                    </button>
                  ))}
                  <button
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-md border text-sm transition-colors hover:bg-muted/60 ${newGroupMode ? 'border-sky-400/60' : ''}`}
                    onClick={() => {
                      setNewGroupMode(true);
                      setSelectedGroupId(null);
                    }}
                  >
                    <PlusCircle size={14} className="text-muted-foreground flex-shrink-0" />
                    <span className={newGroupTitle.trim() ? '' : 'text-muted-foreground'}>
                      新建话题{newGroupTitle.trim() ? `：${newGroupTitle.trim()}` : ''}
                    </span>
                    {newGroupMode && <ChevronRight size={14} className="text-sky-500 flex-shrink-0" />}
                  </button>
                  {newGroupMode && (
                    <Input
                      autoFocus
                      value={newGroupTitle}
                      onChange={(e) => setNewGroupTitle(e.target.value)}
                      placeholder={`话题名称，留空则用「${conversationTitle || '未命名会话'}」`}
                      className="h-8 text-sm"
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t bg-muted/20">
          <button
            className="px-3 py-1.5 text-sm rounded-md border bg-background hover:bg-muted/60 transition-colors"
            onClick={() => onOpenChange(false)}
            disabled={moving}
          >
            取消
          </button>
          <button
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-sky-600 text-white hover:bg-sky-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            onClick={() => void handleMove()}
            disabled={!canSubmit}
          >
            {moving && <Loader2 size={13} className="animate-spin" />}
            移入
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
