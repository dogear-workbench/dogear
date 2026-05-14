
import React, { useCallback, useMemo, useLayoutEffect, useRef, useState } from 'react';
import {
  MessageSquare, Plus, Trash2, GitBranch, Pencil, Quote,
  Folder, FolderOpen, FolderPlus, ChevronRight, ChevronDown, Bot, Archive,
  FolderInput, FolderOutput,
} from 'lucide-react';
import { useUIStore } from '@/stores/ui-store';
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent,
  ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent,
} from '@/components/ui/context-menu';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { StatusPulse } from '@/components/StatusPulse';
import { useConversationStore } from '@/stores/conversation-store';
import type { ConversationFlatNode } from '@/stores/conversation-store';
import { useReferenceStore } from '@/stores/reference-store';
import { useSessionStore } from '@/stores/session-store';

import { useTree } from '@headless-tree/react';
import {
  syncDataLoaderFeature,
  selectionFeature,
  hotkeysCoreFeature,
  renamingFeature,
  propMemoizationFeature,
} from '@headless-tree/core';
import type { ItemInstance } from '@headless-tree/core';

/**
 * 对话接口（对话直接属于工作区）
 */
export interface Conversation {
  id: string;
  workspace_id: string;
  title: string;
  model: string;
  sdk_session_id?: string;
  parent_conversation_id?: string;
  fork_message_sdk_uuid?: string;
  persona_id?: string;
  temp_prompt?: string;
  fork_pending?: boolean;
  archived_at?: string;
  created_at: number;
  updated_at: number;
}

const CONV_TREE_ROOT = '__root__';

// 30 天阈值，超过则归入"更早"分组
const RECENT_DAYS = 30;
const RECENT_THRESHOLD_MS = RECENT_DAYS * 86400_000;

// ============================================================
// 工具函数
// ============================================================

function getRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;

  const date = new Date(timestamp);
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function getConversationTitle(conversation: Conversation): string {
  if (conversation.title && conversation.title !== '新对话') {
    return conversation.title;
  }
  const date = new Date(conversation.created_at);
  const now = new Date();
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return `对话 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  }
  return `对话 ${date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}`;
}

// ============================================================
// 新建文件夹输入框
// ============================================================

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

// ============================================================
// 分组标题行（最近 / 更早）
// ============================================================

function GroupHeader({
  label,
  count,
  collapsed,
  onToggle,
}: {
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className="flex items-center gap-1.5 py-1.5 px-3 cursor-pointer select-none text-xs font-medium text-muted-foreground hover:bg-muted/40 transition-colors"
      onClick={onToggle}
    >
      {collapsed
        ? <ChevronRight className="w-3 h-3" />
        : <ChevronDown className="w-3 h-3" />
      }
      <span>{label}</span>
      <span className="ml-auto text-[10px] opacity-70">{count}</span>
    </div>
  );
}

// ============================================================
// 树节点行渲染
// ============================================================

interface FolderOption {
  id: string;
  name: string;
}

function ConversationTreeItem({
  item,
  parentId,
  folderOptions,
}: {
  item: ItemInstance<ConversationFlatNode>;
  parentId: string;
  folderOptions: FolderOption[];
}) {
  const data = item.getItemData();
  const meta = item.getItemMeta();
  const selectedConversation = useConversationStore((s) => s.selectedConversation);
  const selectConversation = useConversationStore((s) => s.selectConversation);
  const deleteConversation = useConversationStore((s) => s.deleteConversation);
  const deleteFolder = useConversationStore((s) => s.deleteFolder);
  const moveItem = useConversationStore((s) => s.moveItem);
  const openTab = useSessionStore((s) => s.openTab);
  const sessionWindowIds = useSessionStore((s) => s.sessionWindowIds);

  const runningIds = useConversationStore((s) => s.runningConversationIds);
  const pendingIds = useConversationStore((s) => s.pendingActionConversationIds);
  const botBoundId = useConversationStore((s) => s.botBoundConversationId);
  const updateConversationTitle = useConversationStore((s) => s.updateConversationTitle);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const editInputRef = useRef<HTMLInputElement>(null);

  const conv = data.nodeType === 'folder' ? null : data.conversation ?? null;

  const startEditing = useCallback(() => {
    if (!conv) return;
    setEditTitle(getConversationTitle(conv));
    setIsEditing(true);
    setTimeout(() => {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }, 0);
  }, [conv]);

  const saveTitle = useCallback(() => {
    if (!conv) return;
    const trimmed = editTitle.trim();
    const finalTitle = trimmed || getConversationTitle(conv);
    updateConversationTitle(conv.id, finalTitle);
    setIsEditing(false);
  }, [editTitle, conv, updateConversationTitle]);

  const cancelEditing = useCallback(() => {
    setIsEditing(false);
  }, []);

  const paddingLeft = meta.level * 16 + 8;
  const { ref, ...props } = item.getProps();

  if (data.nodeType === 'folder') {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
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
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => item.startRenaming()}>
            重命名
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-destructive"
            onClick={() => deleteFolder(data.id)}
          >
            删除文件夹
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  if (!conv) return null;

  const isSelected = selectedConversation?.id === conv.id;
  const isFork = !!conv.parent_conversation_id;
  const isRunning = runningIds.has(conv.id);
  const isPending = pendingIds.has(conv.id);
  const isBotBound = conv.id === botBoundId;
  const inFolder = parentId !== CONV_TREE_ROOT;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={ref}
          {...props}
          className={cn(
            'flex items-center gap-2 py-2 pr-3 cursor-pointer transition-colors group rounded-sm mx-1',
            isSelected ? 'bg-blue-100 dark:bg-blue-900/30' : 'hover:bg-muted/30',
          )}
          style={{ paddingLeft: `${paddingLeft}px` }}
          onClick={() => {
            if (sessionWindowIds.has(conv.id)) {
              client.openSessionWindow({ conversationId: conv.id, title: getConversationTitle(conv) });
              return;
            }
            selectConversation(conv);
            openTab(conv.id, getConversationTitle(conv), conv.workspace_id);
          }}
        >
          {isRunning ? (
            <StatusPulse isPending={isPending} />
          ) : isFork ? (
            <GitBranch className={cn('w-4 h-4 flex-shrink-0',
              isSelected ? 'text-purple-600' : 'text-purple-400'
            )} />
          ) : (
            <MessageSquare className={cn('w-4 h-4 flex-shrink-0',
              isSelected ? 'text-blue-600' : 'text-muted-foreground'
            )} />
          )}
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <input
                ref={editInputRef}
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    saveTitle();
                  } else if (e.key === 'Escape') {
                    cancelEditing();
                  }
                  e.stopPropagation();
                }}
                onBlur={saveTitle}
                onClick={(e) => e.stopPropagation()}
                className="w-full bg-background border border-primary rounded px-1.5 py-0.5 text-sm outline-none"
              />
            ) : (
              <div className="flex items-center gap-1">
                <div className={cn('text-sm truncate',
                  isSelected ? 'text-blue-700 dark:text-blue-300 font-medium' : 'text-foreground'
                )}>
                  {getConversationTitle(conv)}
                </div>
                {isBotBound && (
                  <Bot className="w-3 h-3 flex-shrink-0 text-green-500" />
                )}
              </div>
            )}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>{getRelativeTime(conv.updated_at)}</span>
              {isRunning && isPending && (
                <span className="text-[10px] text-blue-600 bg-blue-50 px-1 rounded">等待确认</span>
              )}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-purple-600"
            title="引用到当前对话"
            onClick={(e) => {
              e.stopPropagation();
              useReferenceStore.getState().addReferencedConversation({
                conversationId: conv.id,
                title: getConversationTitle(conv),
                sdkSessionId: conv.sdk_session_id || null,
              });
            }}
          >
            <Quote className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-blue-600"
            onClick={(e) => {
              e.stopPropagation();
              startEditing();
            }}
          >
            <Pencil className="w-3 h-3" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              deleteConversation(conv.id);
            }}
          >
            <Trash2 className="w-3 h-3" />
          </Button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={startEditing}>
          重命名
        </ContextMenuItem>
        <ContextMenuItem onClick={() => {
          useReferenceStore.getState().addReferencedConversation({
            conversationId: conv.id,
            title: getConversationTitle(conv),
            sdkSessionId: conv.sdk_session_id || null,
          });
        }}>
          引用到当前对话
        </ContextMenuItem>
        <ContextMenuSeparator />
        {folderOptions.length > 0 ? (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <FolderInput className="w-3.5 h-3.5 mr-2" />
              移动到文件夹
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {folderOptions
                .filter((f) => f.id !== parentId)
                .map((f) => (
                  <ContextMenuItem
                    key={f.id}
                    onClick={() => moveItem(conv.id, f.id)}
                  >
                    <Folder className="w-3.5 h-3.5 mr-2 text-amber-500" />
                    {f.name}
                  </ContextMenuItem>
                ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
        ) : (
          <ContextMenuItem disabled>
            <FolderInput className="w-3.5 h-3.5 mr-2" />
            移动到文件夹（暂无文件夹）
          </ContextMenuItem>
        )}
        {inFolder && (
          <ContextMenuItem onClick={() => moveItem(conv.id, CONV_TREE_ROOT)}>
            <FolderOutput className="w-3.5 h-3.5 mr-2" />
            从文件夹移出
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          className="text-destructive"
          onClick={() => deleteConversation(conv.id)}
        >
          删除对话
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ============================================================
// 主组件
// ============================================================

export function ConversationList() {
  const conversations = useConversationStore((s) => s.conversations);
  const nodeMap = useConversationStore((s) => s.nodeMap);
  const loadingConversations = useConversationStore((s) => s.loadingConversations);
  const newConversation = useConversationStore((s) => s.newConversation);
  const createFolder = useConversationStore((s) => s.createFolder);
  const renameFolder = useConversationStore((s) => s.renameFolder);
  const selectConversation = useConversationStore((s) => s.selectConversation);

  const [creatingFolderAt, setCreatingFolderAt] = useState<string | null>(null);
  const [earlierCollapsed, setEarlierCollapsed] = useState(true);
  const [recentCollapsed, setRecentCollapsed] = useState(false);

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

  const openTabFromList = useSessionStore((s) => s.openTab);
  const sessionWindowIdsFromList = useSessionStore((s) => s.sessionWindowIds);
  const handlePrimaryAction = useCallback((item: ItemInstance<ConversationFlatNode>) => {
    const data = item.getItemData();
    if (data.nodeType === 'conversation' && data.conversation) {
      if (sessionWindowIdsFromList.has(data.conversation.id)) {
        client.openSessionWindow({ conversationId: data.conversation.id, title: getConversationTitle(data.conversation) });
        return;
      }
      selectConversation(data.conversation);
      openTabFromList(data.conversation.id, getConversationTitle(data.conversation), data.conversation.workspace_id);
    }
  }, [selectConversation, openTabFromList, sessionWindowIdsFromList]);

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

  const items = tree.getItems();

  // 文件夹选项（用于"移动到文件夹"右键菜单）
  const folderOptions = useMemo<FolderOption[]>(() => {
    return Object.values(nodeMap)
      .filter((n) => n.nodeType === 'folder' && n.id !== CONV_TREE_ROOT)
      .map((n) => ({ id: n.id, name: n.name }));
  }, [nodeMap]);

  // 给每一项算它的 parent（用 nodeMap.childrenIds 反推）
  const itemParentMap = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const node of Object.values(nodeMap)) {
      for (const childId of node.childrenIds) {
        map[childId] = node.id;
      }
    }
    return map;
  }, [nodeMap]);

  // 把 items 拆成「文件夹及其子项」与「根级对话」两部分；根级对话再分「最近 / 更早」
  type RenderEntry =
    | { kind: 'item'; item: ItemInstance<ConversationFlatNode>; parentId: string; index: number }
    | { kind: 'group'; group: 'recent' | 'earlier'; count: number };

  const { topEntries, recentEntries, earlierEntries } = useMemo(() => {
    const top: Array<{ item: ItemInstance<ConversationFlatNode>; index: number }> = [];
    const recent: Array<{ item: ItemInstance<ConversationFlatNode>; index: number }> = [];
    const earlier: Array<{ item: ItemInstance<ConversationFlatNode>; index: number }> = [];

    const now = Date.now();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const data = it.getItemData();
      const level = it.getItemMeta().level;
      const isRoot = level === 0;

      if (data.nodeType === 'folder') {
        // 根级文件夹及其展开后的子项都属于"top"段
        top.push({ item: it, index: i });
        continue;
      }

      if (!isRoot) {
        // 文件夹内的对话直接归入 top（紧跟在文件夹下）
        top.push({ item: it, index: i });
        continue;
      }

      // 根级对话 → 按 30 天阈值分流
      const ts = data.conversation?.updated_at ?? 0;
      if (now - ts <= RECENT_THRESHOLD_MS) {
        recent.push({ item: it, index: i });
      } else {
        earlier.push({ item: it, index: i });
      }
    }

    return { topEntries: top, recentEntries: recent, earlierEntries: earlier };
  }, [items]);

  // 滚动保持
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const pendingScrollTop = useRef<number | null>(null);
  const scrollRestoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getViewport = useCallback(
    () => scrollAreaRef.current?.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement | null,
    [],
  );

  useLayoutEffect(() => {
    pendingScrollTop.current = getViewport()?.scrollTop ?? 0;
    tree.rebuildTree();
  }, [nodeMap, tree]);

  useLayoutEffect(() => {
    const viewport = getViewport();
    if (pendingScrollTop.current !== null && viewport) {
      viewport.scrollTop = pendingScrollTop.current;
      if (scrollRestoreTimer.current) {
        clearTimeout(scrollRestoreTimer.current);
      }
      scrollRestoreTimer.current = setTimeout(() => {
        pendingScrollTop.current = null;
        scrollRestoreTimer.current = null;
      }, 200);
    }
  });

  // 新建文件夹输入框位置：始终插在文件夹段末尾（根级新建）
  const newFolderInsertInfo = useMemo(() => {
    if (creatingFolderAt === null) return null;

    if (creatingFolderAt === CONV_TREE_ROOT) {
      // 找到 top 段最后一个根级文件夹的索引；若无，则插在 top 段开头
      let insertAfterEntryIndex = -1;
      for (let i = 0; i < topEntries.length; i++) {
        const it = topEntries[i].item;
        if (it.getItemData().nodeType === 'folder' && it.getItemMeta().level === 0) {
          insertAfterEntryIndex = i;
        }
      }
      return { insertAfterEntryIndex, indent: 8 };
    }

    // 子文件夹下新建（保留接口能力，但 UI 入口现在不用）
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

  if (loadingConversations) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm">加载中...</p>
      </div>
    );
  }

  const hasAnyContent =
    topEntries.length > 0 || recentEntries.length > 0 || earlierEntries.length > 0;

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 justify-start gap-2"
          onClick={() => newConversation()}
        >
          <Plus className="w-4 h-4" />
          新建对话
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => setCreatingFolderAt(CONV_TREE_ROOT)}
          title="新建文件夹"
        >
          <FolderPlus className="w-4 h-4" />
        </Button>
      </div>

      <ScrollArea ref={scrollAreaRef} className="flex-1 overflow-hidden">
        {conversations.length === 0 && !creatingFolderAt ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <MessageSquare className="w-12 h-12 mb-4 opacity-50" />
            <p className="text-sm">暂无对话</p>
            <p className="text-xs mt-1">点击上方按钮开始</p>
          </div>
        ) : (
          <div {...tree.getContainerProps('对话列表')}>
            {/* 文件夹及其展开后的子项 */}
            {topEntries.map((entry, i) => (
              <React.Fragment key={entry.item.getId()}>
                <ConversationTreeItem
                  item={entry.item}
                  parentId={itemParentMap[entry.item.getId()] ?? CONV_TREE_ROOT}
                  folderOptions={folderOptions}
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

            {/* 「最近」分组 */}
            {recentEntries.length > 0 && (
              <>
                <GroupHeader
                  label={`最近 ${RECENT_DAYS} 天`}
                  count={recentEntries.length}
                  collapsed={recentCollapsed}
                  onToggle={() => setRecentCollapsed((v) => !v)}
                />
                {!recentCollapsed && recentEntries.map((entry) => (
                  <ConversationTreeItem
                    key={entry.item.getId()}
                    item={entry.item}
                    parentId={CONV_TREE_ROOT}
                    folderOptions={folderOptions}
                  />
                ))}
              </>
            )}

            {/* 「更早」分组（默认折叠） */}
            {earlierEntries.length > 0 && (
              <>
                <GroupHeader
                  label="更早"
                  count={earlierEntries.length}
                  collapsed={earlierCollapsed}
                  onToggle={() => setEarlierCollapsed((v) => !v)}
                />
                {!earlierCollapsed && earlierEntries.map((entry) => (
                  <ConversationTreeItem
                    key={entry.item.getId()}
                    item={entry.item}
                    parentId={CONV_TREE_ROOT}
                    folderOptions={folderOptions}
                  />
                ))}
              </>
            )}

            {!hasAnyContent && !creatingFolderAt && (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <MessageSquare className="w-10 h-10 mb-3 opacity-50" />
                <p className="text-xs">暂无对话</p>
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      <ArchiveFooterButton />
    </div>
  );
}

function ArchiveFooterButton() {
  const openArchive = useUIStore((s: any) => s.openArchivePanel);
  return (
    <div className="px-3 py-2 border-t">
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
        onClick={openArchive}
      >
        <Archive className="w-4 h-4" />
        归档
      </Button>
    </div>
  );
}
