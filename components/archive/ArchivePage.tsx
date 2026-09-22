import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { client } from '@/lib/client';
import { PERSONAL_WORKSPACE_ID } from '@/types/workspace';
import { useGroupStore, OLDER_THRESHOLD_MS } from '@/stores/group-store';
import { showConfirm } from '@/stores/confirm-store';
import { buildConversationTree } from '@/lib/conversation-sort';
import { deriveGroupTitle } from '@/components/group-list/utils';
import type { Conversation } from '@/components/ConversationList';
import type { Group } from '@/types/group';
import { ArchiveTopicList } from './ArchiveTopicList';
import { DigestView } from './DigestView';
import type { ArchiveSelection, ArchivedTopicData } from './types';

export interface ArchivePageProps {
  workspaceId: string;
  /** 选中变化回调（含清空为 null）；Step 3 右侧 digest 视图接线用 */
  onSelectionChange?: (selection: ArchiveSelection | null) => void;
}

export function ArchivePage({ workspaceId, onSelectionChange }: ArchivePageProps) {
  const [topics, setTopics] = useState<ArchivedTopicData[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<ArchiveSelection | null>(null);
  const groups = useGroupStore((s) => s.groups);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!workspaceId) {
      setTopics([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    // 工作区归档 + personal 临时归档（7 天自动归档落点）合并展示，排序后临时话题带标记
    Promise.all([
      client.listArchivedTopics({ workspaceId }),
      client.listArchivedTopics({ workspaceId: PERSONAL_WORKSPACE_ID }).catch(() => ({ topics: [] })),
    ]).then(([wsResult, personalResult]) => {
      if (cancelled) return;
      const toTopic = (topic: { group: Group; conversations: Conversation[] }, isPersonal: boolean): ArchivedTopicData => ({
        group: topic.group,
        tree: buildConversationTree(topic.conversations as Conversation[]),
        isPersonal,
      });
      const next = [
        ...(wsResult.topics ?? []).map((topic) => toTopic(topic, false)),
        ...(personalResult.topics ?? []).map((topic) => toTopic(topic as { group: Group; conversations: Conversation[] }, true)),
      ].sort((a, b) => (b.group.archivedAt ?? 0) - (a.group.archivedAt ?? 0));
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

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (topics.length === 0) {
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
      <aside className="w-64 border-r bg-sidebar flex flex-col shrink-0">
        <div className="p-2 border-b flex items-center gap-1.5">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索话题"
            className="h-8 text-sm bg-background"
          />
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
        </div>
        <ScrollArea className="flex-1 overflow-hidden">
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
        </ScrollArea>
      </aside>
      <section className="flex-1 flex flex-col min-w-0">
        {selection && selectionTopic ? (
          <DigestView
            workspaceId={selectionTopic.isPersonal ? PERSONAL_WORKSPACE_ID : workspaceId}
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
    </div>
  );
}
