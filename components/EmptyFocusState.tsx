/**
 * 无聚焦会话空态（里程碑 1.5 Step A2.5）
 *
 * 当用户已进入工作区但没有活跃 Tab 时显示。
 * 和 "首次打开+已有工作区" 场景复用。
 *
 * 职责：
 * - 提示用户从左侧挑对话，或 + 新建
 * - 不负责工作区选择（顶部 Popover 已承担）
 */

import { MessageSquareText, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useConversationStore } from '@/stores/conversation-store';
import { useWorkspaceStore } from '@/stores/workspace-store';

export function EmptyFocusState() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const newConversation = useConversationStore((s) => s.newConversation);
  const conversations = useConversationStore((s) => s.conversations);

  return (
    <div className="flex-1 flex items-center justify-center bg-muted/10">
      <div className="max-w-md text-center space-y-5 px-6">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-muted">
          <MessageSquareText className="w-7 h-7 text-muted-foreground" />
        </div>

        <div className="space-y-1.5">
          <h2 className="text-base font-semibold">还没有选中对话</h2>
          <p className="text-sm text-muted-foreground">
            {workspace ? (
              <>
                当前工作区 <span className="font-medium">「{workspace.name}」</span> 有{' '}
                <span className="font-medium">{conversations.length}</span> 个对话，
                从左侧挑一个继续，或新建一个。
              </>
            ) : (
              '从左侧挑一个对话继续，或新建一个。'
            )}
          </p>
        </div>

        <div className="flex items-center justify-center">
          <Button size="sm" onClick={() => newConversation()}>
            <Plus className="w-4 h-4 mr-1" />
            新建对话
          </Button>
        </div>
      </div>
    </div>
  );
}
