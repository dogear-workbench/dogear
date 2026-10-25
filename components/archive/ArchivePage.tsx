import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { client } from '@/lib/client';
import { cn } from '@/lib/utils';
import { useGroupStore, OLDER_THRESHOLD_MS } from '@/stores/group-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { showConfirm } from '@/stores/confirm-store';
import { buildConversationTree } from '@/lib/conversation-sort';
import { deriveGroupTitle } from '@/components/group-list/utils';
import type { Conversation } from '@/components/ConversationList';
import type { Group } from '@/types/group';
import type { NoteMeta } from '@/types/note';
import { ArchiveTopicList } from './ArchiveTopicList';
import { ArchiveSearchProvider } from './ArchiveSearchProvider';
import { DigestView } from './DigestView';
import { TrashView, type TrashStats, type TrashViewHandle } from './TrashView';
import { TrashNoteDetail } from './TrashNoteDetail';
import type { ArchiveSegment, ArchiveSelection, ArchivedTopicData } from './types';

export interface ArchivePageProps {
  workspaceId: string;
  /** 选中变化回调（含清空为 null）；Step 3 右侧 digest 视图接线用 */
  onSelectionChange?: (selection: ArchiveSelection | null) => void;
}

export function ArchivePage({ workspaceId, onSelectionChange }: ArchivePageProps) {
  const [topics, setTopics] = useState<ArchivedTopicData[]>([]);
  const [loading, setLoading] = useState(true);
  const [segment, setSegment] = useState<ArchiveSegment>('topics');
  const [search, setSearch] = useState('');
  const workspacePath = useWorkspaceStore((s) => s.workspace?.path ?? null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<ArchiveSelection | null>(null);
  const [trashStats, setTrashStats] = useState<TrashStats>({ total: 0, busy: false });
  const [openTrashNote, setOpenTrashNote] = useState<NoteMeta | null>(null);
  const trashRef = useRef<TrashViewHandle>(null);
  const groups = useGroupStore((s) => s.groups);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!workspaceId) {
      setTopics([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    client.listArchivedTopics({ workspaceId }).then((wsResult) => {
      if (cancelled) return;
      const toTopic = (topic: { group: Group; conversations: Conversation[] }): ArchivedTopicData => ({
        group: topic.group,
        tree: buildConversationTree(topic.conversations as Conversation[]),
      });
      const next = (wsResult.topics ?? [])
        .map((topic) => toTopic(topic))
        .sort((a, b) => (b.group.archivedAt ?? 0) - (a.group.archivedAt ?? 0));
      setTopics(next);
      setLoading(false);
      if (!initializedRef.current && next.length > 0) {
        initializedRef.current = true;
        const firstTopic = next[0];
        const firstMain = firstTopic.tree[0];
        setExpandedIds(new Set([firstTopic.group.id]));
        if (firstMain) {
          setSelection({ topicId: firstTopic.group.id, conversationId: firstMain.conv.id });
        }
      }
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, groups]);

  // 选中话题/会话被恢复、删除或切工作区后清空选中，右侧回空态（不自动跳转）
  useEffect(() => {
    if (!selection) return;
    const topic = topics.find((t) => t.group.id === selection.topicId);
    if (!topic?.tree.some((node) => node.conv.id === selection.conversationId)) {
      setSelection(null);
    }
  }, [topics, selection]);

  // 回收站详情同理：切工作区或回收站被清空后关闭
  useEffect(() => {
    setOpenTrashNote(null);
  }, [workspaceId]);

  useEffect(() => {
    if (segment === 'trash' && trashStats.total === 0) setOpenTrashNote(null);
  }, [segment, trashStats.total]);

  useEffect(() => {
    onSelectionChange?.(selection);
  }, [selection, onSelectionChange]);

  const toggleExpand = (topicId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(topicId)) next.delete(topicId);
      else next.add(topicId);
      return next;
    });
  };

  const staleTopics = useMemo(
    () => topics.filter((t) => (t.group.archivedAt ?? 0) < Date.now() - OLDER_THRESHOLD_MS),
    [topics],
  );

  // 顶栏归档搜索命中：清搜索框、展开话题并选中其第一个主会话
  const handleSearchSelectTopic = useCallback((topic: ArchivedTopicData) => {
    const firstMain = topic.tree[0];
    if (!firstMain) return;
    setSearch('');
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.add(topic.group.id);
      return next;
    });
    setSelection({ topicId: topic.group.id, conversationId: firstMain.conv.id });
  }, []);

  const [cleaning, setCleaning] = useState(false);

  const handleBatchCleanup = async () => {
    if (staleTopics.length === 0) {
      toast.info('没有归档超过 30 天的话题');
      return;
    }
    const oldest = Math.min(...staleTopics.map((t) => t.group.archivedAt ?? 0));
    const oldestText = new Date(oldest).toLocaleDateString('zh-CN');
    const confirmed = await showConfirm(
      '清理归档话题',
      `将永久删除 ${staleTopics.length} 个归档超过 30 天的话题及全部会话与共享区，最早归档于 ${oldestText}。此操作不可恢复。`,
    );
    if (!confirmed) return;
    setCleaning(true);
    const result = await useGroupStore.getState().batchCleanupArchived();
    setCleaning(false);
    if (!result) return;
    if (result.failed.length > 0) {
      const nameById = new Map(topics.map((t) => [t.group.id, deriveGroupTitle(t.group)]));
      const failedNames = result.failed.map((f) => nameById.get(f.groupId) ?? f.groupId).join('、');
      toast.warning(`已清理 ${result.deleted.length} 个话题，${result.failed.length} 个清理失败`, {
        description: failedNames,
      });
    } else {
      toast.success(`已清理 ${result.deleted.length} 个话题`);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return topics;
    return topics.filter((t) => deriveGroupTitle(t.group).toLowerCase().includes(q));
  }, [topics, search]);

  const selectionTopic = selection
    ? topics.find((t) => t.group.id === selection.topicId) ?? null
    : null;

  const switchSegment = (next: ArchiveSegment) => {
    if (next === segment) return;
    setSegment(next);
    setSearch('');
    setOpenTrashNote(null);
  };

  // 回收站段不依赖 topics 数据，归档为空/加载中也不拦截
  if (loading && segment === 'topics') {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (segment === 'topics' && topics.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-sm text-muted-foreground">
          <Archive className="w-8 h-8 mx-auto mb-2 opacity-40" />
          暂无归档话题
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      <ArchiveSearchProvider topics={topics} segment={segment} onSelectTopic={handleSearchSelectTopic} />
      <aside className="w-64 border-r bg-sidebar flex flex-col shrink-0">
        <div className="p-2 border-b flex flex-col gap-2 shrink-0">
          <div className="flex items-center gap-0.5 p-0.5 rounded-md bg-muted/50">
            {(
              [
                { id: 'topics', label: '话题', icon: Archive },
                { id: 'trash', label: '回收站', icon: Trash2 },
              ] as const
            ).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => switchSegment(id)}
                className={cn(
                  'flex items-center gap-1 flex-1 justify-center px-2.5 py-1 rounded text-xs cursor-pointer',
                  segment === id
                    ? 'bg-background shadow-sm font-medium text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={segment === 'topics' ? '搜索话题' : '过滤回收站'}
              className="h-8 text-sm bg-background"
            />
            {segment === 'topics' ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                disabled={cleaning}
                title="清理归档超过 30 天的话题"
                onClick={() => void handleBatchCleanup()}
              >
                {cleaning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                disabled={trashStats.busy || trashStats.total === 0}
                title="清空回收站"
                onClick={() => trashRef.current?.emptyTrash()}
              >
                {trashStats.busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              </Button>
            )}
          </div>
        </div>
        <div className="flex-1 min-h-0 flex flex-col">
          {segment === 'topics' ? (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="py-1">
                {filtered.length === 0 ? (
                  <div className="px-3 py-8 text-center text-xs text-muted-foreground">无匹配话题</div>
                ) : (
                  <ArchiveTopicList
                    topics={filtered}
                    expandedIds={expandedIds}
                    onToggleExpand={toggleExpand}
                    selection={selection}
                    onSelect={setSelection}
                  />
                )}
              </div>
            </div>
          ) : workspacePath ? (
            <TrashView
              ref={trashRef}
              workspaceId={workspaceId}
              workspacePath={workspacePath}
              query={search}
              selectedNoteId={openTrashNote?.id ?? null}
              onStatsChange={setTrashStats}
              onOpenNote={(note) => setOpenTrashNote((cur) => (cur?.id === note.id ? null : note))}
              onNoteRemoved={(noteId) => setOpenTrashNote((cur) => (cur?.id === noteId ? null : cur))}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              请先选择工作区
            </div>
          )}
        </div>
      </aside>
      {segment === 'topics' ? (
        <section className="flex-1 flex flex-col min-w-0">
          {selection && selectionTopic ? (
            <DigestView
              workspaceId={workspaceId}
              topic={selectionTopic}
              conversationId={selection.conversationId}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center text-sm text-muted-foreground">
                <Archive className="w-8 h-8 mx-auto mb-2 opacity-40" />
                选择左侧会话查看
              </div>
            </div>
          )}
        </section>
      ) : openTrashNote ? (
        <section className="flex-1 flex flex-col min-w-0">
          <TrashNoteDetail
            key={openTrashNote.id}
            workspaceId={workspaceId}
            noteId={openTrashNote.id}
            onRestore={() => trashRef.current?.restoreNote(openTrashNote.id) ?? Promise.resolve(false)}
            onClose={() => setOpenTrashNote(null)}
          />
        </section>
      ) : (
        <section className="flex-1 flex items-center justify-center">
          <div className="text-center text-sm text-muted-foreground">
            <Trash2 className="w-8 h-8 mx-auto mb-2 opacity-40" />
            点击左侧笔记查看
          </div>
        </section>
      )}
    </div>
  );
}
