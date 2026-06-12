import { useMemo } from 'react';
import { Folder, FolderPlus } from 'lucide-react';
import {
  ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent,
  ContextMenuCheckboxItem, ContextMenuItem,
} from '@/components/ui/context-menu';
import { useConversationStore } from '@/stores/conversation-store';

interface AddToFolderMenuProps {
  conversationId: string;
}

/**
 * 多选子菜单：勾选 = 该会话在该 folder 里。
 * toggle 调 add/remove IPC，菜单不关闭让用户连选。
 */
export function AddToFolderMenu({ conversationId }: AddToFolderMenuProps) {
  const nodeMap = useConversationStore((s) => s.nodeMap);
  const addConversationToFolder = useConversationStore((s) => s.addConversationToFolder);
  const removeConversationFromFolder = useConversationStore((s) => s.removeConversationFromFolder);

  // 所有文件夹（不含 root） + 该 folder 是否已含 conversationId
  const folders = useMemo(() => {
    return Object.values(nodeMap)
      .filter((n) => n.nodeType === 'folder' && n.id !== '__root__')
      .map((n) => ({
        id: n.id,
        name: n.name,
        included: n.childrenIds.includes(conversationId),
      }));
  }, [nodeMap, conversationId]);

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
              if (checked) addConversationToFolder(conversationId, f.id);
              else removeConversationFromFolder(conversationId, f.id);
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
