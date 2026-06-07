import { useEffect } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useDashboardStore } from '@/stores/dashboard-store';
import { AdvisorSection } from './AdvisorSection';
import { ScratchpadSection } from './ScratchpadSection';

export function Dashboard() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const newConversation = useConversationStore((s) => s.newConversation);
  const loadReview = useDashboardStore((s) => s.loadReview);
  const loadNotes = useDashboardStore((s) => s.loadNotes);

  useEffect(() => {
    if (!workspace?.id) return;
    loadReview(workspace.id);
    loadNotes(workspace.id);
  }, [workspace?.id, loadReview, loadNotes]);

  if (!workspace) {
    return (
      <div className="flex-1 flex items-center justify-center bg-muted/10">
        <p className="text-sm text-muted-foreground">请选择工作区</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto bg-muted/10">
      <div className="max-w-3xl mx-auto px-6 py-8 space-y-8">
        <div className="flex items-center justify-between">
          <h1 className="text-base font-semibold text-foreground truncate">
            {workspace.name}
          </h1>
          <Button size="sm" onClick={() => newConversation()}>
            <Plus className="w-4 h-4" />
            新建对话
          </Button>
        </div>

        <AdvisorSection workspaceId={workspace.id} workspacePath={workspace.path} />
        <ScratchpadSection workspaceId={workspace.id} />
      </div>
    </div>
  );
}
