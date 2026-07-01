import { useMemo } from 'react';
import { Folder, FolderPlus } from 'lucide-react';
import {
  ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent,
  ContextMenuCheckboxItem, ContextMenuItem,
} from '@/components/ui/context-menu';
import { useConversationStore } from '@/stores/conversation-store';

interface AddGroupToFolderMenuProps {
  groupId: string;
}

/**
 * 多选子菜单：勾选 = 该组在该 folder 里。
 * toggle 调 add/remove IPC，菜单不关闭让用户连选。
 */
export function AddGroupToFolderMenu({ groupId }: AddGroupToFolderMenuProps) {
  const nodeMap = useConversationStore((s) => s.nodeMap);
  const addGroupToFolder = useConversationStore((s) => s.addGroupToFolder);
  const removeGroupFromFolder = useConversationStore((s) => s.removeGroupFromFolder);

  const folders = useMemo(() => {
    return Object.values(nodeMap)
      .filter((n) => n.nodeType === 'folder' && n.id !== '__root__')
      .map((n) => ({
        id: n.id,
        name: n.name,
        included: n.childrenIds.includes(groupId),
      }));
  }, [nodeMap, groupId]);

  if (folders.length === 0) {
    return (
      <ContextMenuItem disabled>
        <FolderPlus className="w-3.5 h-3.5 mr-2" />
        添加到文件夹（暂无文件夹）
      </ContextMenuItem>
    );
  }

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <FolderPlus className="w-3.5 h-3.5 mr-2" />
        添加到文件夹
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        {folders.map((f) => (
          <ContextMenuCheckboxItem
            key={f.id}
            checked={f.included}
            onSelect={(e) => e.preventDefault()}
            onCheckedChange={(checked) => {
              if (checked) addGroupToFolder(groupId, f.id);
              else removeGroupFromFolder(groupId, f.id);
            }}
          >
            <Folder className="w-3.5 h-3.5 mr-2 text-amber-500" />
            {f.name}
          </ContextMenuCheckboxItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
