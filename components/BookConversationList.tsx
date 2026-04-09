
import React, { useCallback, useMemo, useLayoutEffect, useRef, useState } from 'react';
import {
  MessageSquare, Plus, Trash2, GitBranch, Pencil, Quote,
  Folder, FolderOpen, FolderPlus, ChevronRight, ChevronDown, Bot,
} from 'lucide-react';
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent,
  ContextMenuItem, ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useConversationStore } from '@/stores/conversation-store';
import type { ConversationFlatNode } from '@/stores/conversation-store';
import { useReferenceStore } from '@/stores/reference-store';
import { useSessionStore } from '@/stores/session-store';
import { useDragAutoScroll } from '@/lib/use-drag-auto-scroll';

import { useTree } from '@headless-tree/react';
import {
  syncDataLoaderFeature,
  selectionFeature,
  hotkeysCoreFeature,
  dragAndDropFeature,
  renamingFeature,
  propMemoizationFeature,
  isOrderedDragTarget,
} from '@headless-tree/core';
import type { ItemInstance, DragTarget } from '@headless-tree/core';

/**
 * 对话接口（v5: 对话直接属于工作区，book_id 可选）
 */
export interface Conversation {
  id: string;
  book_id?: string;                  // 可选：关联的书籍ID
  workspace_id: string;              // 关联的工作区ID
  title: string;
  model: string;
  sdk_session_id?: string;
  parent_conversation_id?: string;   // 分叉对话的父对话 ID
  fork_message_sdk_uuid?: string;    // 分叉点的 assistant 消息 UUID
  persona_id?: string;               // 关联的人设 ID
  temp_prompt?: string;              // 临时提示词
  fork_pending?: boolean;            // 分叉已创建但 SDK 会话未建立
  created_at: number;
  updated_at: number;
}

// 保留 BookNode 导出以兼容可能的外部引用
export interface BookNode {
  book: { id?: string; title: string };
  conversations: Conversation[];
  expanded?: boolean;
}

const CONV_TREE_ROOT = '__root__';

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
// 树节点行渲染
// ============================================================

function ConversationTreeItem({ item }: { item: ItemInstance<ConversationFlatNode> }) {
  const data = item.getItemData();
  const meta = item.getItemMeta();
  const selectedConversation = useConversationStore((s) => s.selectedConversation);
  const selectConversation = useConversationStore((s) => s.selectConversation);
  const deleteConversation = useConversationStore((s) => s.deleteConversation);
  const deleteFolder = useConversationStore((s) => s.deleteFolder);
  const renameFolder = useConversationStore((s) => s.renameFolder);
  const openTab = useSessionStore((s) => s.openTab);

  const paddingLeft = meta.level * 16 + 8;
  const { ref, ...props } = item.getProps();

  if (data.nodeType === 'folder') {
    // 文件夹渲染
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={ref}
            {...props}
            className={cn(
              'flex items-center gap-1.5 py-1.5 pr-2 cursor-pointer select-none group',
              'hover:bg-muted/50 transition-colors rounded-sm mx-1',
              item.isDragTarget() && 'bg-blue-500/20 ring-1 ring-blue-500/50',
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

  // 对话渲染
  const conv = data.conversation;
  if (!conv) return null;

  const isSelected = selectedConversation?.id === conv.id;
  const isFork = !!conv.parent_conversation_id;

  // 对话运行状态（从 conversation-store 读取，主进程广播，bot 操作也会更新）
  const runningIds = useConversationStore((s) => s.runningConversationIds);
  const isRunning = runningIds.has(conv.id);
  const pendingIds = useConversationStore((s) => s.pendingActionConversationIds);
  const isPending = pendingIds.has(conv.id);
  const botBoundId = useConversationStore((s) => s.botBoundConversationId);
  const isBotBound = conv.id === botBoundId;

  // 标题编辑状态
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const updateConversationTitle = useConversationStore((s) => s.updateConversationTitle);
  const editInputRef = useRef<HTMLInputElement>(null);

  /** 进入编辑模式 */
  const startEditing = useCallback(() => {
    setEditTitle(getConversationTitle(conv));
    setIsEditing(true);
    // 下一帧聚焦并全选
    setTimeout(() => {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }, 0);
  }, [conv]);

  /** 保存标题 */
  const saveTitle = useCallback(() => {
    const trimmed = editTitle.trim();
    // 空标题回退为默认标题
    const finalTitle = trimmed || getConversationTitle(conv);
    updateConversationTitle(conv.id, finalTitle);
    setIsEditing(false);
  }, [editTitle, conv, updateConversationTitle]);

  /** 取消编辑 */
  const cancelEditing = useCallback(() => {
    setIsEditing(false);
  }, []);

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
            selectConversation(conv);
            openTab(conv.id, getConversationTitle(conv));
          }}
        >
          {isRunning ? (
            isPending ? (
              // 需要用户确认 → 蓝色脉冲
              <span className="relative flex w-4 h-4 items-center justify-center flex-shrink-0">
                <span className="absolute w-2.5 h-2.5 rounded-full bg-blue-400 animate-pulse" />
                <span className="w-2 h-2 rounded-full bg-blue-500" />
              </span>
            ) : (
              // 正常运行 → 橙色脉冲
              <span className="relative flex w-4 h-4 items-center justify-center flex-shrink-0">
                <span className="absolute w-2.5 h-2.5 rounded-full bg-orange-400 animate-pulse" />
                <span className="w-2 h-2 rounded-full bg-orange-500" />
              </span>
            )
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
                  <Bot className="w-3 h-3 flex-shrink-0 text-green-500" title="Bot 已绑定" />
                )}
              </div>
            )}
            <div className="text-xs text-muted-foreground">
              {getRelativeTime(conv.updated_at)}
            </div>
          </div>
          {/* 引用按钮 */}
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
          {/* 编辑按钮 */}
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
          {/* 删除按钮 */}
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
  const selectedConversation = useConversationStore((s) => s.selectedConversation);
  const loadingConversations = useConversationStore((s) => s.loadingConversations);
  const newConversation = useConversationStore((s) => s.newConversation);
  const createFolder = useConversationStore((s) => s.createFolder);
  const moveItem = useConversationStore((s) => s.moveItem);
  const renameFolder = useConversationStore((s) => s.renameFolder);
  const selectConversation = useConversationStore((s) => s.selectConversation);

  // 新建文件夹状态
  const [creatingFolderAt, setCreatingFolderAt] = useState<string | null>(null);

  // nodeMapRef 避免 dataLoader 闭包过期
  const nodeMapRef = useRef(nodeMap);
  nodeMapRef.current = nodeMap;

  // 稳定的 dataLoader
  const dataLoader = useMemo(() => ({
    getItem: (itemId: string) => nodeMapRef.current[itemId] ?? {
      id: itemId, name: itemId, isFolder: false, childrenIds: [], nodeType: 'conversation' as const,
    },
    getChildren: (itemId: string) => nodeMapRef.current[itemId]?.childrenIds ?? [],
  }), []);

  // 拖放回调
  const handleDrop = useCallback((items: ItemInstance<ConversationFlatNode>[], target: DragTarget<ConversationFlatNode>) => {
    if (isOrderedDragTarget(target)) {
      // 有序拖放：拖到兄弟节点之间，target.item 是父节点
      const parentId = target.item.getId();
      for (const item of items) {
        moveItem(item.getId(), parentId, target.insertionIndex);
      }
      return;
    }

    // 无序拖放：直接拖到文件夹上
    const targetId = target.item.getId();
    const targetData = target.item.getItemData();
    const parentId = targetData.isFolder ? targetId : CONV_TREE_ROOT;
    for (const item of items) {
      moveItem(item.getId(), parentId);
    }
  }, [moveItem]);

  // 重命名回调（仅文件夹）
  const handleRename = useCallback((item: ItemInstance<ConversationFlatNode>, value: string) => {
    const data = item.getItemData();
    if (data.nodeType === 'folder' && value.trim()) {
      renameFolder(item.getId(), value.trim());
    }
  }, [renameFolder]);

  // 主操作：点击对话选中，文件夹展开/折叠
  const openTabFromList = useSessionStore((s) => s.openTab);
  const handlePrimaryAction = useCallback((item: ItemInstance<ConversationFlatNode>) => {
    const data = item.getItemData();
    if (data.nodeType === 'conversation' && data.conversation) {
      selectConversation(data.conversation);
      openTabFromList(data.conversation.id, getConversationTitle(data.conversation));
    }
  }, [selectConversation, openTabFromList]);

  const canDrag = useCallback((items: ItemInstance<ConversationFlatNode>[]) => {
    return items.every(i => i.getId() !== CONV_TREE_ROOT);
  }, []);

  const canDrop = useCallback((items: ItemInstance<ConversationFlatNode>[], target: DragTarget<ConversationFlatNode>) => {
    const targetId = target.item.getId();
    // 可以拖到根
    if (targetId === CONV_TREE_ROOT) return true;
    const targetData = target.item.getItemData();
    // 只能拖到文件夹
    if (!targetData.isFolder) return false;
    for (const item of items) {
      // 不能拖到自身
      if (item.getId() === targetId) return false;
      // 不能拖到自身子级
      if (target.item.isDescendentOf(item.getId())) return false;
    }
    return true;
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
      dragAndDropFeature,
      renamingFeature,
      propMemoizationFeature,
    ],
    canReorder: true,
    openOnDropDelay: 800,
    isItemFolder: (item) => item.getItemData().isFolder,
    getItemName: (item) => item.getItemData().name,
    onDrop: handleDrop,
    onRename: handleRename,
    onPrimaryAction: handlePrimaryAction,
    canDrag,
    canDrop,
    canRename,
  });

  const items = tree.getItems();

  // 滚动保持：通过 ScrollArea 的 Viewport 获取实际滚动容器
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const pendingScrollTop = useRef<number | null>(null);
  const scrollRestoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 获取 ScrollArea 内部的 Viewport 滚动容器 */
  const getViewport = useCallback(
    () => scrollAreaRef.current?.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement | null,
    [],
  );

  // 拖拽靠近边缘时自动滚动
  useDragAutoScroll(getViewport);

  // nodeMap 变化时重建树
  useLayoutEffect(() => {
    pendingScrollTop.current = getViewport()?.scrollTop ?? 0;
    tree.rebuildTree();
  }, [nodeMap, tree]);

  // 恢复滚动位置
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

  // 新建文件夹输入框位置计算
  const newFolderInsertInfo = useMemo(() => {
    if (creatingFolderAt === null) return null;

    // 在根级别末尾插入
    let insertAfterIndex = items.length - 1;
    const indent = 8; // 根级别缩进

    if (creatingFolderAt !== CONV_TREE_ROOT) {
      // 在指定父文件夹下插入
      let parentIndex = -1;
      let parentLevel = 0;
      for (let i = 0; i < items.length; i++) {
        if (items[i].getId() === creatingFolderAt) {
          parentIndex = i;
          parentLevel = items[i].getItemMeta().level;
          break;
        }
      }
      if (parentIndex === -1) return null;

      // 找到父节点的最后一个子节点
      insertAfterIndex = parentIndex;
      for (let i = parentIndex + 1; i < items.length; i++) {
        if (items[i].getItemMeta().level <= parentLevel) break;
        insertAfterIndex = i;
      }

      return {
        insertAfterIndex,
        indent: (parentLevel + 1) * 16 + 8,
      };
    }

    return { insertAfterIndex, indent };
  }, [creatingFolderAt, items]);

  if (loadingConversations) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm">加载中...</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* 工具栏 */}
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

      {/* 对话树 */}
      <ScrollArea ref={scrollAreaRef} className="flex-1 overflow-hidden">
        {conversations.length === 0 && !creatingFolderAt ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <MessageSquare className="w-12 h-12 mb-4 opacity-50" />
            <p className="text-sm">暂无对话</p>
            <p className="text-xs mt-1">点击上方按钮开始</p>
          </div>
        ) : (
          <div {...tree.getContainerProps('对话列表')}>
            {items.map((item, index) => (
              <React.Fragment key={item.getId()}>
                <ConversationTreeItem item={item} />
                {/* 在正确位置插入新建文件夹输入框 */}
                {newFolderInsertInfo && index === newFolderInsertInfo.insertAfterIndex && (
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

            {/* 树为空时也显示新建文件夹输入框 */}
            {items.length === 0 && newFolderInsertInfo && (
              <NewFolderInput
                indent={newFolderInsertInfo.indent}
                onConfirm={async (name) => {
                  await createFolder(name, creatingFolderAt === CONV_TREE_ROOT ? undefined : creatingFolderAt!);
                  setCreatingFolderAt(null);
                }}
                onCancel={() => setCreatingFolderAt(null)}
              />
            )}

            {/* 拖拽线 */}
            <div
              style={tree.getDragLineStyle()}
              className="h-[2px] bg-blue-500 rounded pointer-events-none"
            />
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

// 保留旧名导出以兼容
export const BookConversationList = ConversationList;
