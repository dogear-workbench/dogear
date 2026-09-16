import { useMemo, useState } from 'react';
import { ArchiveRestore, CircleAlert, Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { getConversationTitle, getRelativeTime } from '@/components/conversation-list/utils';
import { useGroupStore } from '@/stores/group-store';
import { countDescendants, countTreeConversations, findTreeNode } from './utils';
import { useTopicDigest } from './use-topic-digest';
import type { ArchivedTopicData, DigestTurn } from './types';

function DigestTurnItem({ turn }: { turn: DigestTurn }) {
  return (
    <div className="py-4 border-b border-border/60 last:border-b-0">
      <div className="text-xs text-muted-foreground mb-1.5">{getRelativeTime(turn.inputAt)}</div>
      <MarkdownRenderer content={turn.input} />
      {turn.conclusion ? (
        <div className="mt-3 border-l-2 border-border pl-3">
          <MarkdownRenderer content={turn.conclusion} />
        </div>
      ) : (
        <div className="mt-3 text-sm text-muted-foreground">（无文字回复）</div>
      )}
    </div>
  );
}

interface DigestViewProps {
  workspaceId: string;
  topic: ArchivedTopicData;
  conversationId: string;
}

export function DigestView({ workspaceId, topic, conversationId }: DigestViewProps) {
  const { digest, loading, error, retry } = useTopicDigest(workspaceId, topic.group.id);
  const [restoring, setRestoring] = useState(false);
  const node = useMemo(() => findTreeNode(topic.tree, conversationId), [topic.tree, conversationId]);

  const handleRestore = async () => {
    if (restoring) return;
    setRestoring(true);
    const ok = await useGroupStore.getState().restoreTopic(topic.group.id);
    setRestoring(false);
    if (ok) toast.success('话题已恢复');
  };

  if (!node) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-sm text-muted-foreground">会话不存在</div>
      </div>
    );
  }

  const childTotal = countDescendants(node);
  const session = digest?.sessions.find((s) => s.conversationId === conversationId);

  return (
    <div className="flex-1 flex flex-col min-w-0">
      <header className="shrink-0 border-b px-4 py-2.5 flex items-center gap-2 min-w-0">
        <h2 className="text-sm font-semibold truncate flex-1 min-w-0" title={getConversationTitle(node.conv)}>
          {getConversationTitle(node.conv)}
        </h2>
        {childTotal > 0 && (
          <Badge variant="subtle" className="shrink-0 font-normal">{childTotal} 个子会话</Badge>
        )}
        <Button
          variant="outline"
          size="sm"
          className="shrink-0 h-7 px-2.5 text-xs"
          disabled={restoring}
          onClick={() => void handleRestore()}
          title={`恢复该话题及其中 ${countTreeConversations(topic.tree)} 个对话，恢复后可继续工作`}
        >
          <ArchiveRestore className="size-3.5" />
          恢复话题
        </Button>
      </header>
      <ScrollArea className="flex-1 overflow-hidden">
        <div className="mx-auto max-w-3xl px-6 py-2">
          {loading && (
            <div className="py-16 flex items-center justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          )}
          {!loading && error && (
            <div className="py-16 flex flex-col items-center text-sm text-muted-foreground">
              <CircleAlert className="w-8 h-8 mb-2 opacity-40" />
              <span className="mb-3">加载话题摘要失败：{error}</span>
              <Button variant="outline" size="sm" onClick={retry}>
                <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                重试
              </Button>
            </div>
          )}
          {!loading && !error && session && session.turns.length > 0 && (
            session.turns.map((turn, index) => <DigestTurnItem key={index} turn={turn} />)
          )}
          {!loading && !error && (!session || session.turns.length === 0) && (
            <div className="py-16 text-center text-sm text-muted-foreground">（无对话内容）</div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
