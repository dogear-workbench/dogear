import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Folder, FolderOpen, FolderPlus, ChevronRight, ChevronDown, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useConversationStore } from '@/stores/conversation-store';
import type { ConversationFlatNode } from '@/stores/conversation-store';
import { useTree } from '@headless-tree/react';
import {
  syncDataLoaderFeature,
  selectionFeature,
  hotkeysCoreFeature,
  renamingFeature,
  propMemoizationFeature,
} from '@headless-tree/core';
import type { ItemInstance } from '@headless-tree/core';
import { ConversationRow } from './ConversationRow';
import { CONV_TREE_ROOT, openOrFocusConversation } from './utils';

interface FolderOption {
  id: string;
  name: string;
}

function NewFolderInput({
  indent,
  onConfirm,
  onCancel,
}: {
  indent: number;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      className="flex items-center gap-1.5 py-1 pr-2"
      style={{ paddingLeft: `${indent}px` }}
    >
      <Folder className="w-4 h-4 shrink-0 text-amber-500" />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim()) {
            onConfirm(value.trim());
          } else if (e.key === 'Escape') {
            onCancel();
          }
        }}
        onBlur={() => {
          if (value.trim()) {
            onConfirm(value.trim());
          } else {
            onCancel();
          }
        }}
        className="flex-1 min-w-0 bg-background border border-primary rounded px-1.5 py-0.5 text-sm outline-none"
        placeholder="文件夹名称"
      />
    </div>
  );
}

function FolderTreeItem({
  item,
  folderOptions,
  parentId,
}: {
  item: ItemInstance<ConversationFlatNode>;
  folderOptions: FolderOption[];
  parentId: string;
}) {
  const data = item.getItemData();
  const meta = item.getItemMeta();
  const deleteFolder = useConversationStore((s) => s.deleteFolder);

  const paddingLeft = meta.level * 16 + 8;
  const { ref, ...props } = item.getProps();

  if (data.nodeType === 'folder') {
    return (
      <div
        ref={ref}
        {...props}
        className={cn(
          'flex items-center gap-1.5 py-1.5 pr-2 cursor-pointer select-none group',
          'hover:bg-muted/50 transition-colors rounded-sm mx-1',
        )}
        style={{ paddingLeft: `${paddingLeft}px` }}
      >
        {item.isExpanded()
          ? <ChevronDown className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
          : <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
        }
        {item.isExpanded()
          ? <FolderOpen className="w-4 h-4 shrink-0 text-amber-500" />
          : <Folder className="w-4 h-4 shrink-0 text-amber-500" />
        }
        {item.isRenaming() ? (
          <input
            {...item.getRenameInputProps()}
            className="flex-1 min-w-0 bg-background border border-primary rounded px-1.5 py-0.5 text-sm outline-none"
          />
        ) : (
          <span className="text-sm truncate flex-1">{data.name}</span>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            deleteFolder(data.id);
          }}
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
    );
  }

  if (!data.conversation) return null;

  return (
    <ConversationRow
      conv={data.conversation}
      inFolder={parentId !== CONV_TREE_ROOT}
      folderId={parentId !== CONV_TREE_ROOT ? parentId : undefined}
      indent={paddingLeft}
      folderOptions={folderOptions}
    />
  );
}

interface ManualSectionProps {
  workspaceId: string;
}

export function ManualSection({ workspaceId: _workspaceId }: ManualSectionProps) {
  const nodeMap = useConversationStore((s) => s.nodeMap);
  const createFolder = useConversationStore((s) => s.createFolder);
  const renameFolder = useConversationStore((s) => s.renameFolder);

  const [creatingFolderAt, setCreatingFolderAt] = useState<string | null>(null);

  const nodeMapRef = useRef(nodeMap);
  nodeMapRef.current = nodeMap;

  const dataLoader = useMemo(() => ({
    getItem: (itemId: string) => nodeMapRef.current[itemId] ?? {
      id: itemId, name: itemId, isFolder: false, childrenIds: [], nodeType: 'conversation' as const,
    },
    getChildren: (itemId: string) => nodeMapRef.current[itemId]?.childrenIds ?? [],
  }), []);

  const handleRename = useCallback((item: ItemInstance<ConversationFlatNode>, value: string) => {
    const data = item.getItemData();
    if (data.nodeType === 'folder' && value.trim()) {
      renameFolder(item.getId(), value.trim());
    }
  }, [renameFolder]);

  const handlePrimaryAction = useCallback((item: ItemInstance<ConversationFlatNode>) => {
    const data = item.getItemData();
    if (data.nodeType === 'conversation' && data.conversation) {
      openOrFocusConversation(data.conversation);
    }
  }, []);

  const canRename = useCallback((item: ItemInstance<ConversationFlatNode>) => {
    return item.getItemData().nodeType === 'folder';
  }, []);

  const tree = useTree<ConversationFlatNode>({
    rootItemId: CONV_TREE_ROOT,
    dataLoader,
    indent: 16,
    features: [
      syncDataLoaderFeature,
      selectionFeature,
      hotkeysCoreFeature,
      renamingFeature,
      propMemoizationFeature,
    ],
    isItemFolder: (item) => item.getItemData().isFolder,
    getItemName: (item) => item.getItemData().name,
    onRename: handleRename,
    onPrimaryAction: handlePrimaryAction,
    canRename,
  });

  useLayoutEffect(() => {
    tree.rebuildTree();
  }, [nodeMap, tree]);

  const items = tree.getItems();

  // 只取根级文件夹及其子项（过滤出 topEntries）
  const topEntries = useMemo(() => {
    const result: Array<{ item: ItemInstance<ConversationFlatNode>; index: number }> = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const data = it.getItemData();
      const level = it.getItemMeta().level;
      const isRoot = level === 0;

      if (data.nodeType === 'folder') {
        result.push({ item: it, index: i });
        continue;
      }

      if (!isRoot) {
        // 文件夹内的对话
        result.push({ item: it, index: i });
      }
      // 根级对话不在 ManualSection 渲染
    }
    return result;
  }, [items]);

  // 文件夹选项（用于"移动到文件夹"右键菜单）
  const folderOptions = useMemo<FolderOption[]>(() => {
    return Object.values(nodeMap)
      .filter((n) => n.nodeType === 'folder' && n.id !== CONV_TREE_ROOT)
      .map((n) => ({ id: n.id, name: n.name }));
  }, [nodeMap]);

  // 给每一项算它的 parent
  const itemParentMap = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const node of Object.values(nodeMap)) {
      for (const childId of node.childrenIds) {
        map[childId] = node.id;
      }
    }
    return map;
  }, [nodeMap]);

  // 新建文件夹输入框插入位置
  const newFolderInsertInfo = useMemo(() => {
    if (creatingFolderAt === null) return null;

    if (creatingFolderAt === CONV_TREE_ROOT) {
      let insertAfterEntryIndex = -1;
      for (let i = 0; i < topEntries.length; i++) {
        const it = topEntries[i].item;
        if (it.getItemData().nodeType === 'folder' && it.getItemMeta().level === 0) {
          insertAfterEntryIndex = i;
        }
      }
      return { insertAfterEntryIndex, indent: 8 };
    }

    let parentEntryIndex = -1;
    let parentLevel = 0;
    for (let i = 0; i < topEntries.length; i++) {
      if (topEntries[i].item.getId() === creatingFolderAt) {
        parentEntryIndex = i;
        parentLevel = topEntries[i].item.getItemMeta().level;
        break;
      }
    }
    if (parentEntryIndex === -1) return null;

    let insertAfterEntryIndex = parentEntryIndex;
    for (let i = parentEntryIndex + 1; i < topEntries.length; i++) {
      if (topEntries[i].item.getItemMeta().level <= parentLevel) break;
      insertAfterEntryIndex = i;
    }
    return { insertAfterEntryIndex, indent: (parentLevel + 1) * 16 + 8 };
  }, [creatingFolderAt, topEntries]);

  const hasFolders = folderOptions.length > 0;

  if (topEntries.length === 0 && !creatingFolderAt) {
    return (
      <div className="px-3 py-1">
        <button
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          onClick={() => setCreatingFolderAt(CONV_TREE_ROOT)}
        >
          <FolderPlus className="w-3.5 h-3.5" />
          新建文件夹
        </button>
      </div>
    );
  }

  return (
    <div>
      <div {...tree.getContainerProps('手动文件夹区')}>
        {topEntries.map((entry, i) => (
          <React.Fragment key={entry.item.getId()}>
            <FolderTreeItem
              item={entry.item}
              folderOptions={folderOptions}
              parentId={itemParentMap[entry.item.getId()] ?? CONV_TREE_ROOT}
            />
            {newFolderInsertInfo && i === newFolderInsertInfo.insertAfterEntryIndex && (
              <NewFolderInput
                indent={newFolderInsertInfo.indent}
                onConfirm={async (name) => {
                  await createFolder(name, creatingFolderAt === CONV_TREE_ROOT ? undefined : creatingFolderAt!);
                  setCreatingFolderAt(null);
                }}
                onCancel={() => setCreatingFolderAt(null)}
              />
            )}
          </React.Fragment>
        ))}

        {/* 没有任何文件夹时，新建文件夹输入框单独渲染在最前 */}
        {newFolderInsertInfo && newFolderInsertInfo.insertAfterEntryIndex === -1 && (
          <NewFolderInput
            indent={newFolderInsertInfo.indent}
            onConfirm={async (name) => {
              await createFolder(name, creatingFolderAt === CONV_TREE_ROOT ? undefined : creatingFolderAt!);
              setCreatingFolderAt(null);
            }}
            onCancel={() => setCreatingFolderAt(null)}
          />
        )}
      </div>

      {hasFolders && (
        <div className="px-3 py-1">
          <button
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setCreatingFolderAt(CONV_TREE_ROOT)}
          >
            <FolderPlus className="w-3.5 h-3.5" />
            新建文件夹
          </button>
        </div>
      )}
    </div>
  );
}

export { type ManualSectionProps };
