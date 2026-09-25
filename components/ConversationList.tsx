import React, { useEffect } from 'react';
import { MessageSquare } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { registerHotkey } from '@/lib/hotkey-registry';
import { useConversationStore } from '@/stores/conversation-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

import { Toolbar } from './conversation-list/Toolbar';
import { RecentVirtualGroup } from './conversation-list/RecentVirtualGroup';
import { ArchiveSection } from './conversation-list/ArchiveSection';
import { PersonalSection } from './conversation-list/PersonalSection';

/**
 * 对话接口（对话直接属于工作区）
 * 其他文件依然从这里 import Conversation，保持向后兼容。
 */
import type { Conversation as ConversationData } from '@/types/electron-api';

export type Conversation = ConversationData;

export function ConversationList() {
  const loadingConversations = useConversationStore((s) => s.loadingConversations);
  const conversations = useConversationStore((s) => s.conversations);
  const workspaceId = useWorkspaceStore((s) => s.workspace?.id) ?? '';

  useEffect(() => registerHotkey('quick-chat-new', () => {
    void useConversationStore.getState().newPersonalConversation();
  }), []);

  if (loadingConversations && conversations.length === 0) {
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
        <PersonalSection />
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-muted-foreground py-16">
            <MessageSquare className="w-12 h-12 mb-4 opacity-50" />
            <p className="text-sm">暂无话题</p>
            <p className="text-xs mt-1">点击上方按钮创建话题</p>
          </div>
        ) : (
          <>
            <RecentVirtualGroup />
          </>
        )}
      </ScrollArea>

      <ArchiveSection workspaceId={workspaceId} />
    </div>
  );
}
