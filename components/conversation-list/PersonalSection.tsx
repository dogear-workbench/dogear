import { useMemo } from 'react';
import { ChevronDown, ChevronRight, Globe, History, Plus, Zap } from 'lucide-react';
import { PERSONAL_WORKSPACE_ID } from '@/types/workspace';
import { useConversationStore } from '@/stores/conversation-store';
import { useSessionStore } from '@/stores/session-store';
import { useSectionCollapseStore } from '@/stores/section-collapse-store';
import { ConversationRow } from './ConversationRow';
import { openPersonalConversation } from './utils';
import type { Conversation } from '@/components/ConversationList';

/**
 * 左侧列表顶部固定的「临时会话」分区（personal 空间，所有工作区视图下常显）：
 * 当天会话平铺，1 天前收进「更早」折叠区（默认收起）；单会话行平铺不显示组概念。
 */
export function PersonalSection() {
  const personalConversations = useConversationStore((s) => s.personalConversations);
  const newPersonalConversation = useConversationStore((s) => s.newPersonalConversation);
  const openWebAiTab = useSessionStore((s) => s.openWebAiTab);
  const olderExpanded = useSectionCollapseStore((s) => s.personalOlderExpanded);
  const toggleOlder = useSectionCollapseStore((s) => s.togglePersonalOlder);

  const { today, older } = useMemo(() => {
    const now = new Date().toDateString();
    const sorted = [...personalConversations].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return {
      today: sorted.filter((c) => new Date(c.updatedAt).toDateString() === now),
      older: sorted.filter((c) => new Date(c.updatedAt).toDateString() !== now),
    };
  }, [personalConversations]);

  const renderRow = (conv: Conversation) => (
    <ConversationRow
      key={conv.id}
      conv={conv}
      nodeId={conv.id}
      workspaceId={PERSONAL_WORKSPACE_ID}
      onClick={() => openPersonalConversation(conv)}
    />
  );

  return (
    <div className="border-b pb-1">
      <div className="flex items-center gap-1.5 py-1.5 pl-3 pr-2 select-none text-[11px] font-semibold tracking-wider text-muted-foreground">
        <Zap className="w-3 h-3 text-sky-500" />
        <span>临时会话</span>
        <span className="ml-auto text-[10px] opacity-70">{personalConversations.length}</span>
        <button
          className="flex items-center justify-center w-5 h-5 rounded hover:bg-muted/60 hover:text-foreground transition-colors"
          title="网页 AI"
          onClick={openWebAiTab}
        >
          <Globe className="w-3.5 h-3.5" />
        </button>
        <button
          className="flex items-center justify-center w-5 h-5 rounded hover:bg-muted/60 hover:text-foreground transition-colors"
          title="新建临时会话 (Ctrl+Alt+N)"
          onClick={() => void newPersonalConversation()}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
      {today.map(renderRow)}
      {older.length > 0 && (
        <div>
          <div
            className="flex items-center gap-1.5 py-1.5 pl-3 pr-3 cursor-pointer select-none text-[11px] font-semibold tracking-wider text-muted-foreground hover:bg-muted/40 hover:text-foreground transition-colors"
            onClick={toggleOlder}
          >
            {olderExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            <History className="w-3 h-3" />
            <span>更早</span>
            <span className="ml-auto text-[10px] opacity-70">{older.length}</span>
          </div>
          {olderExpanded && older.map(renderRow)}
        </div>
      )}
    </div>
  );
}
