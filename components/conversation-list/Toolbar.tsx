import React from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WorkspaceSwitcherPopover } from '@/components/WorkspaceSwitcherPopover';
import { useDraftStore } from '@/stores/draft-store';
import { useSessionStore, DRAFT_VIEW_ID } from '@/stores/session-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

export function Toolbar() {
  const workspaceId = useWorkspaceStore((s) => s.workspace?.id);

  const enterNewDraft = () => {
    if (!workspaceId) return;
    useDraftStore.getState().enterDraft(workspaceId);
    useSessionStore.getState().switchTab(DRAFT_VIEW_ID);
  };

  return (
    <div className="px-3 py-2 border-b flex items-center gap-2">
      <div className="flex-1 min-w-0">
        <WorkspaceSwitcherPopover />
      </div>
      <Button
        variant="outline"
        size="sm"
        className="shrink-0 gap-2"
        onClick={enterNewDraft}
      >
        <Plus className="w-4 h-4" />
        新建话题
      </Button>
    </div>
  );
}
