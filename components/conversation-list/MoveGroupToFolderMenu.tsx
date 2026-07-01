import { useMemo } from 'react';
import { Folder, FolderInput } from 'lucide-react';
import {
  ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent, ContextMenuItem,
} from '@/components/ui/context-menu';
import { useConversationStore } from '@/stores/conversation-store';

interface MoveGroupToFolderMenuProps {
  groupId: string;
  /** 当前所在 folderId（用于过滤掉自身 + 调 move IPC） */
  fromFolderId: string;
}

/**
 * 单选子菜单：从 from 文件夹移动组到目标文件夹
 */
export function MoveGroupToFolderMenu({ groupId, fromFolderId }: MoveGroupToFolderMenuProps) {
  const nodeMap = useConversationStore((s) => s.nodeMap);
  const moveGroupBetweenFolders = useConversationStore((s) => s.moveGroupBetweenFolders);

  const folders = useMemo(() => {
    return Object.values(nodeMap)
      .filter((n) => n.nodeType === 'folder' && n.id !== '__root__' && n.id !== fromFolderId)
      .map((n) => ({ id: n.id, name: n.name }));
  }, [nodeMap, fromFolderId]);

  if (folders.length === 0) {
    return (
      <ContextMenuItem disabled>
        <FolderInput className="w-3.5 h-3.5 mr-2" />
        移动到文件夹（暂无其他文件夹）
      </ContextMenuItem>
    );
  }

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <FolderInput className="w-3.5 h-3.5 mr-2" />
        移动到文件夹
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        {folders.map((f) => (
          <ContextMenuItem
            key={f.id}
            onClick={() => moveGroupBetweenFolders(groupId, fromFolderId, f.id)}
          >
            <Folder className="w-3.5 h-3.5 mr-2 text-amber-500" />
            {f.name}
          </ContextMenuItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
