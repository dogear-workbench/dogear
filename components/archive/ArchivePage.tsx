import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Loader2 } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import { client } from '@/lib/client';
import { useGroupStore } from '@/stores/group-store';
import { buildConversationTree } from '@/lib/conversation-sort';
import { deriveGroupTitle } from '@/components/group-list/utils';
import type { Conversation } from '@/components/ConversationList';
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
    client.listArchivedTopics({ workspaceId }).then((result) => {
      if (cancelled) return;
      const next = (result.topics ?? [])
        .map((topic) => ({
          group: topic.group,
          tree: buildConversationTree(topic.conversations as Conversation[]),
        }))
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
        <div className="p-2 border-b">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索话题"
            className="h-8 text-sm bg-background"
          />
        </div>
        <ScrollArea className="flex-1">
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
    </div>
  );
}
