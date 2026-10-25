import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GitBranch, MessageSquare, MessagesSquare, Network } from 'lucide-react';
import { PanelSearchBox } from '@/components/ui/search-dropdown';
import { visibleConversationsOf, useConversationStore } from '@/stores/conversation-store';
import { useDraftStore } from '@/stores/draft-store';
import { useGroupStore } from '@/stores/group-store';
import { useSectionCollapseStore } from '@/stores/section-collapse-store';
import { useSessionStore, DRAFT_VIEW_ID } from '@/stores/session-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { deriveGroupTitle } from './group-list/utils';

import { Toolbar } from './conversation-list/Toolbar';
import { RecentVirtualGroup } from './conversation-list/RecentVirtualGroup';
import { DraftRow } from './conversation-list/DraftRow';
import { getConversationTitle, getRelativeTime, openOrFocusConversation, ancestorChainIds } from './conversation-list/utils';

/**
 * 对话接口（对话直接属于工作区）
 * 其他文件依然从这里 import Conversation，保持向后兼容。
 */
import type { Conversation as ConversationData } from '@/types/electron-api';

export type Conversation = ConversationData;

interface ConversationHit {
  conv: ConversationData;
  groupTitle: string;
}

function hitIcon(conv: ConversationData) {
  if (conv.contractMetadata?.createdBy === 'agent') {
    return <Network className="w-4 h-4 shrink-0 text-muted-foreground" />;
  }
  if (conv.parentConversationId) {
    return <GitBranch className="w-4 h-4 shrink-0 text-purple-400" />;
  }
  return <MessagesSquare className="w-4 h-4 shrink-0 text-muted-foreground" />;
}

const LOCATE_TIMEOUT_MS = 2000;

export function ConversationList() {
  const loadingConversations = useConversationStore((s) => s.loadingConversations);
  const conversations = useConversationStore((s) => s.conversations);
  const visibleConversations = useMemo(() => visibleConversationsOf(conversations), [conversations]);
  const workspaceId = useWorkspaceStore((s) => s.workspace?.id) ?? '';
  const draftSlot = useDraftStore((s) => s.slots[workspaceId]);
  // activeTabId === DRAFT_VIEW_ID 即草稿视图激活（含关全部会话/启动兜底等非 enterDraft 入口），左栏必有行
  const isDraftView = useSessionStore((s) => s.activeTabId) === DRAFT_VIEW_ID;
  const showTopDraft = (isDraftView || !!draftSlot?.draftActive) && (draftSlot?.groupId ?? null) === null;
  const [hits, setHits] = useState<ConversationHit[]>([]);
  const locateTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (locateTimerRef.current !== null) window.clearInterval(locateTimerRef.current);
  }, []);

  const runSearch = useCallback((query: string) => {
    const q = query.trim().toLowerCase();
    if (!q) {
      setHits([]);
      return;
    }
    const groups = useGroupStore.getState().groups;
    const convs = visibleConversationsOf(useConversationStore.getState().conversations);
    const matched = convs
      .filter((c) => getConversationTitle(c).toLowerCase().includes(q))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map((c) => {
        const group = c.groupId ? groups.find((g) => g.id === c.groupId) : undefined;
        return { conv: c, groupTitle: group ? deriveGroupTitle(group) : '' };
      });
    setHits(matched);
  }, []);

  const handleSelect = useCallback((hit: ConversationHit) => {
    const { conv } = hit;
    const collapse = useSectionCollapseStore.getState();
    // focusConversationById 只展开一层父，深派链补全整条祖先链
    for (const id of ancestorChainIds(conv, useConversationStore.getState().conversations)) {
      collapse.expandSubConv(id);
    }
    const nodeId = conv.groupId ? `topic:${conv.groupId}:${conv.id}` : null;
    openOrFocusConversation(conv, nodeId ?? undefined);
    if (!nodeId) return;
    if (locateTimerRef.current !== null) window.clearInterval(locateTimerRef.current);
    const start = Date.now();
    locateTimerRef.current = window.setInterval(() => {
      const el = document.querySelector(`[data-node-id="${nodeId}"]`);
      if (el) {
        el.scrollIntoView({ block: 'nearest' });
        window.clearInterval(locateTimerRef.current!);
        locateTimerRef.current = null;
      } else if (Date.now() - start > LOCATE_TIMEOUT_MS) {
        window.clearInterval(locateTimerRef.current!);
        locateTimerRef.current = null;
      }
    }, 30);
  }, []);

  if (loadingConversations && visibleConversations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm">加载中...</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <Toolbar />

      <div className="px-3 pb-2">
        <PanelSearchBox
          results={hits}
          total={hits.length}
          onSelect={handleSelect}
          renderItem={(hit) => (
            <div className="flex items-center gap-2 px-2 py-1">
              {hitIcon(hit.conv)}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{getConversationTitle(hit.conv)}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {hit.groupTitle ? `${hit.groupTitle} · ` : ''}
                  {getRelativeTime(hit.conv.updatedAt)}
                </div>
              </div>
            </div>
          )}
          getKey={(hit) => hit.conv.id}
          emptyText="没有匹配的会话"
          placeholder="搜索会话"
          onQueryChange={runSearch}
        />
      </div>

      {showTopDraft && <DraftRow />}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {visibleConversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-muted-foreground py-16">
            <MessageSquare className="w-12 h-12 mb-4 opacity-50" />
            <p className="text-sm">暂无话题</p>
            <p className="text-xs mt-1">点击上方按钮创建话题</p>
          </div>
        ) : (
          <RecentVirtualGroup />
        )}
      </div>
    </div>
  );
}
