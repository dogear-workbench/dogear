import { useEffect, useState } from 'react';
import { Brain } from 'lucide-react';
import { client } from '@/lib/client';
import { useSessionStore, DATA_CENTER_TAB_ID } from '@/stores/session-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { registerProvider, unregisterProvider, type SearchProvider } from '@/stores/search-store';
import { useDataCenterFocusStore } from './memory-focus';
import type { MemoryScope, TopicIndexEntry } from './memory-types';

interface MemoryTopicCopy extends TopicIndexEntry {
  scope: MemoryScope;
  workspaceId: string;
}

function createDataCenterSearchProvider(copies: MemoryTopicCopy[]): SearchProvider {
  return {
    id: 'data-center-memory',
    placeholder: '搜索记忆',
    isActive: () => useSessionStore.getState().activeTabId === DATA_CENTER_TAB_ID,
    search: (query) => {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      return copies
        .filter((t) => t.title.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q))
        .slice(0, 8)
        .map((t) => ({
          id: `data-center-memory:${t.scope}:${t.workspaceId}:${t.slug}`,
          title: t.title,
          subtitle: t.scope === 'global' ? '全局记忆' : '工作区记忆',
          icon: Brain,
          onSelect: () => {
            useDataCenterFocusStore.getState().requestMemoryTopic({
              scope: t.scope,
              workspaceId: t.workspaceId,
              slug: t.slug,
            });
            useSessionStore.getState().switchTab(DATA_CENTER_TAB_ID);
          },
        }));
    },
  };
}

export function DataCenterSearchProvider() {
  const activeTabId = useSessionStore((s) => s.activeTabId);
  const workspaceId = useWorkspaceStore((s) => s.workspace?.id ?? null);
  const [copies, setCopies] = useState<MemoryTopicCopy[]>([]);

  // 进入数据中心页时预拉记忆主题内存副本（当前工作区 + 全局），search 只做同步过滤
  useEffect(() => {
    if (activeTabId !== DATA_CENTER_TAB_ID) return;
    let cancelled = false;
    (async () => {
      const loads: Array<Promise<MemoryTopicCopy[]>> = [];
      if (workspaceId) {
        loads.push(client.listMemoryTopics({ workspaceId, scope: 'workspace' }).then((r) => {
          const topics = 'topics' in r ? r.topics : undefined;
          return (topics ?? []).map((t) => ({ ...t, scope: 'workspace' as const, workspaceId }));
        }));
      }
      loads.push(client.listMemoryTopics({ workspaceId: 'global', scope: 'global' }).then((r) => {
        const topics = 'topics' in r ? r.topics : undefined;
        return (topics ?? []).map((t) => ({ ...t, scope: 'global' as const, workspaceId: 'global' }));
      }));
      const settled = await Promise.all(loads);
      if (!cancelled) setCopies(settled.flat());
    })().catch((e) => console.error('[data-center] 记忆主题预拉失败:', e));
    return () => {
      cancelled = true;
    };
  }, [activeTabId, workspaceId]);

  useEffect(() => {
    const provider = createDataCenterSearchProvider(copies);
    registerProvider(provider);
    return () => unregisterProvider(provider.id);
  }, [copies]);

  return null;
}
