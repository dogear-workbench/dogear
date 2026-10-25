import { useEffect } from 'react';
import { Archive } from 'lucide-react';
import { useSessionStore, ARCHIVE_TAB_ID } from '@/stores/session-store';
import { registerProvider, unregisterProvider, type SearchProvider } from '@/stores/search-store';
import { deriveGroupTitle } from '@/components/group-list/utils';
import type { ArchiveSegment, ArchivedTopicData } from './types';

interface Props {
  topics: ArchivedTopicData[];
  segment: ArchiveSegment;
  onSelectTopic: (topic: ArchivedTopicData) => void;
}

export function ArchiveSearchProvider({ topics, segment, onSelectTopic }: Props) {
  // topics/onSelectTopic/segment 变化时重注册，保持闭包新鲜；数据复用 ArchivePage 已拉取的列表，不发 IPC
  useEffect(() => {
    const provider: SearchProvider = {
      id: 'archive',
      placeholder: '搜索归档话题',
      isActive: () =>
        useSessionStore.getState().activeTabId === ARCHIVE_TAB_ID && segment === 'topics',
      search: (query) => {
        const q = query.trim().toLowerCase();
        if (!q) return [];
        return topics
          .filter((t) => t.tree.length > 0 && deriveGroupTitle(t.group).toLowerCase().includes(q))
          .slice(0, 8)
          .map((t) => ({
            id: `archive:${t.group.id}`,
            title: deriveGroupTitle(t.group),
            subtitle: t.group.archivedAt
              ? new Date(t.group.archivedAt).toLocaleDateString('zh-CN')
              : undefined,
            icon: Archive,
            onSelect: () => onSelectTopic(t),
          }));
      },
    };
    registerProvider(provider);
    return () => unregisterProvider(provider.id);
  }, [topics, onSelectTopic, segment]);
  return null;
}
