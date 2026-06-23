import React, { useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useConversationStore } from '@/stores/conversation-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

import { Toolbar } from './conversation-list/Toolbar';
import { ManualSection } from './conversation-list/ManualSection';
import { ViewTabs } from './conversation-list/ViewTabs';
import type { ListView } from './conversation-list/ViewTabs';
import { SmartSection } from './conversation-list/SmartSection';
import { TimeSection } from './conversation-list/TimeSection';
import { ArchiveSection } from './conversation-list/ArchiveSection';

/**
 * 对话接口（对话直接属于工作区）
 * 其他文件依然从这里 import Conversation，保持向后兼容。
 */
import type { ModelSelection } from '@/types/settings';

export interface Conversation {
  id: string;
  workspace_id: string;
  title: string;
  model: string;
  sdk_session_id?: string;
  parent_conversation_id?: string;
  fork_message_sdk_uuid?: string;
  persona_id?: string;
  temp_prompt?: string;
  modelSelection: ModelSelection | null;
  cachePolicy?: '5m' | '1h';
  fork_pending?: boolean;
  archived_at?: string;
  created_at: number;
  updated_at: number;
}

export function ConversationList() {
  const loadingConversations = useConversationStore((s) => s.loadingConversations);
  const conversations = useConversationStore((s) => s.conversations);
  const workspaceId = useWorkspaceStore((s) => s.workspace?.id) ?? '';
  const [view, setView] = useState<ListView>('smart');

  if (loadingConversations) {
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

      <ScrollArea className="flex-1 overflow-hidden">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-16">
            <MessageSquare className="w-12 h-12 mb-4 opacity-50" />
            <p className="text-sm">暂无对话</p>
            <p className="text-xs mt-1">点击上方按钮开始</p>
          </div>
        ) : (
          <>
            <ManualSection workspaceId={workspaceId} />
            <ViewTabs value={view} onChange={setView} />
            {view === 'smart'
              ? <SmartSection workspaceId={workspaceId} />
              : <TimeSection />
            }
          </>
        )}
      </ScrollArea>

      <ArchiveSection workspaceId={workspaceId} />
    </div>
  );
}
