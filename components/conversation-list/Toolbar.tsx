import React from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConversationStore } from '@/stores/conversation-store';

export function Toolbar() {
  const newConversation = useConversationStore((s) => s.newConversation);

  return (
    <div className="px-3 py-2 border-b flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        className="flex-1 justify-start gap-2"
        onClick={() => newConversation()}
      >
        <Plus className="w-4 h-4" />
        新建话题
      </Button>
    </div>
  );
}
