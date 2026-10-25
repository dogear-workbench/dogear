/**
 * WorkspaceExplorer 树节点行渲染
 */
import React from 'react';
import {
  Globe, Folder, FolderOpen, File,
  ChevronRight, ChevronDown, FolderPlus,
  Quote, Trash2, Pencil, ExternalLink, History, EyeOff, Eye,
} from 'lucide-react';
import {
  ContextMenu, ContextMenuTrigger,
  ContextMenuContent, ContextMenuItem, ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useArticleStore } from '@/stores/article-store';
import { useReferenceStore } from '@/stores/reference-store';
import { useGitHistoryStore } from '@/stores/git-history-store';
import { guardReferenceIntoFocus, requireReferenceAnchorId } from '@/lib/reference-guard';
import { getRelativeTime } from '@/components/conversation-list/utils';
import type { ItemInstance } from '@headless-tree/core';
import { findExclusionEntry } from './tree-model';
import type { FlatNode } from './tree-model';

interface TreeItemRowProps {
  item: ItemInstance<FlatNode>;
  /** 搜索点选定位后的临时高亮（目录/.md 无 isSelected 机制，2.5s 自动清除） */
  highlightPath?: string | null;
  onSetCreatingFolder: (parentPath: string | null) => void;
  excludedPaths: ReadonlySet<string>;
  onExcludeFolder: (path: string, name: string) => void;
  onRestoreFolder: (path: string, name: string) => void;
}

export function TreeItemRow({
  item,
  highlightPath,
  onSetCreatingFolder,
  excludedPaths,
  onExcludeFolder,
  onRestoreFolder,
}: TreeItemRowProps) {
  const data = item.getItemData();
  const meta = item.getItemMeta();

  // Store hooks
  const selectedFile = useWorkspaceStore(s => s.selectedFile);
  const selectedArticle = useArticleStore(s => s.selectedArticle);
  const addReferencedFile = useReferenceStore(s => s.addReferencedFile);
  const removeReferencedFile = useReferenceStore(s => s.removeReferencedFile);
  const deleteItem = useWorkspaceStore(s => s.deleteItem);
  const openInExplorer = useWorkspaceStore(s => s.openInExplorer);
  const gitAvailable = useGitHistoryStore(s => s.gitAvailable);
  const openHistory = useGitHistoryStore(s => s.openHistory);

  const originalNode = data?.originalNode;

  // loading 态占位无意义不渲染（null 防护必须在全部 hooks 之后，避免 hooks 数量不一致）
  if (!data) return null;

  // 判断是否选中
  const isSelected =
    (data.nodeType === 'article' && originalNode?.articleMeta && selectedArticle?.id === originalNode.articleMeta.id) ||
    (data.nodeType === 'file' && selectedFile?.path === originalNode?.path);
  const isHighlightTarget = !!highlightPath && originalNode?.path === highlightPath
    && (data.nodeType === 'directory' || data.nodeType === 'file');

  // ---- 分组头渲染（根层新生产/仓库文件，也是根层拖放目标） ----
  if (data.nodeType === 'group-header') {
    const isGroupDragTarget = item.isDragTarget() && item.isFolder();
    return (
      <div
        {...item.getProps()}
        className={cn(
          'flex items-center gap-1 py-0.5 pr-2 select-none',
          isGroupDragTarget && 'bg-blue-500/20 ring-1 ring-blue-500/50',
        )}
        style={{ paddingLeft: meta.level * 16 + 8 }}
      >
        <button
          className="shrink-0 text-muted-foreground/60"
          onClick={(e) => {
            e.stopPropagation();
            if (item.isExpanded()) item.collapse();
            else item.expand();
          }}
        >
          {item.isExpanded()
            ? <ChevronDown className="w-3.5 h-3.5" />
            : <ChevronRight className="w-3.5 h-3.5" />
          }
        </button>
        <span className="text-[11px] text-muted-foreground/70">{data.name}</span>
        {data.count != null && data.count > 0 && (
          <span className="text-[11px] text-muted-foreground/50">{data.count}</span>
        )}
      </div>
    );
  }

  // ---- 普通节点渲染 ----
  if (!originalNode) return null;

  // 图标
  const renderIcon = () => {
    if (data.nodeType === 'article') {
      return <Globe className="w-4 h-4 shrink-0 text-green-500" />;
    }
    if (data.nodeType === 'directory') {
      return item.isExpanded()
        ? <FolderOpen className="w-4 h-4 shrink-0 text-blue-500" />
        : <Folder className="w-4 h-4 shrink-0 text-blue-500" />;
    }
    return <File className="w-4 h-4 shrink-0 text-muted-foreground" />;
  };

  // 展开箭头
  const renderChevron = () => {
    if (data.nodeType !== 'directory') {
      return <span className="w-4 h-4 shrink-0" />;
    }
    return item.isExpanded()
      ? <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
      : <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />;
  };

  // 右键菜单操作
  const handleDelete = () => deleteItem(originalNode.path);
  const handleOpenInExplorer = () => openInExplorer(originalNode.path);
  const handleQuoteArticleToChat = () => {
    // 文章引用并入文件引用链路（path 形态发送，agent 直接 Read）
    if (!guardReferenceIntoFocus()) return;
    const anchorId = requireReferenceAnchorId();
    if (!anchorId) return;
    const already = useReferenceStore.getState().referencedFiles.some(f => f.path === originalNode.path);
    if (already) {
      removeReferencedFile(originalNode.path);
      toast.success(`已取消引用 ${originalNode.name}`);
    } else {
      addReferencedFile({ name: originalNode.name, path: originalNode.path }, anchorId);
      toast.success(`已引用文章 ${originalNode.name}`);
    }
  };
  const handleQuoteFileToChat = () => {
    if (!guardReferenceIntoFocus()) return;
    const anchorId = requireReferenceAnchorId();
    if (!anchorId) return;
    addReferencedFile({ name: originalNode.name, path: originalNode.path }, anchorId);
    toast.success(`已引用 ${originalNode.name}`);
  };
  const handleNewSubFolder = () => {
    onSetCreatingFolder(originalNode.path);
  };
  const handleShowHistory = () => {
    openHistory({ name: originalNode.name, path: originalNode.path, isFolder: data.nodeType === 'directory' });
  };

  // 三分支判定：null 未命中 → 可排除；精确命中 → 可恢复；前缀覆盖 → 只读提示
  const exclusionEntry = data.nodeType === 'directory' && gitAvailable
    ? findExclusionEntry(originalNode.path, excludedPaths)
    : null;

  // 提取 headless-tree 的 props，分离 ref 以避免与 ContextMenuTrigger 冲突
  const { ref: itemRef, ...itemProps } = item.getProps();

  return (
    <ContextMenu>
      <ContextMenuTrigger
        ref={itemRef}
        className={cn(
          'flex items-center gap-1 py-1 pr-2 cursor-pointer select-none',
          'hover:bg-muted/50 transition-colors',
          (isSelected || isHighlightTarget) && 'bg-primary/20',
          item.isDragTarget() && item.isFolder() && 'bg-blue-500/20 ring-1 ring-blue-500/50',
          item.isFocused() && 'ring-1 ring-primary/30',
        )}
        style={{ paddingLeft: `${meta.level * 16 + 8}px` }}
        {...itemProps}
      >
        {renderChevron()}
        {renderIcon()}

        {item.isRenaming() ? (
          <input
            {...item.getRenameInputProps()}
            className="flex-1 min-w-0 bg-background border border-primary rounded px-1 py-0 text-sm outline-none"
          />
        ) : (
          <div className="flex-1 min-w-0 ml-1">
            <div className="text-sm truncate flex items-center gap-1">
              <span className="truncate">{data.name}</span>
              {data.nodeType === 'directory' && excludedPaths.has(originalNode.path) && (
                <span title="该目录已排除出自动快照" className="inline-flex shrink-0 text-muted-foreground">
                  <EyeOff className="w-3 h-3" />
                </span>
              )}
            </div>
            {/* 文章显示站点名和相对时间 */}
            {data.nodeType === 'article' && originalNode.articleMeta && (
              <div className="text-xs text-muted-foreground truncate">
                {originalNode.articleMeta.siteName && (
                  <span>{originalNode.articleMeta.siteName}</span>
                )}
                {originalNode.articleMeta.siteName && originalNode.articleMeta.fetchedAt && (
                  <span> · </span>
                )}
                {originalNode.articleMeta.fetchedAt && (
                  <span>{getRelativeTime(originalNode.articleMeta.fetchedAt)}</span>
                )}
              </div>
            )}
          </div>
        )}
      </ContextMenuTrigger>
      <ContextMenuContent>
        {data.nodeType === 'article' && (
          <ContextMenuItem onClick={handleQuoteArticleToChat}>
            <Quote className="w-4 h-4" />
            引用到对话
          </ContextMenuItem>
        )}
        {data.nodeType === 'directory' && (
          <ContextMenuItem onClick={handleNewSubFolder}>
            <FolderPlus className="w-4 h-4" />
            新建文件夹
          </ContextMenuItem>
        )}
        {data.nodeType === 'directory' && (
          <ContextMenuItem onClick={() => {
            if (!guardReferenceIntoFocus()) return;
            const anchorId = requireReferenceAnchorId();
            if (!anchorId) return;
            addReferencedFile({ name: originalNode.name, path: originalNode.path, type: 'folder' }, anchorId);
            toast.success(`已引用文件夹 ${originalNode.name}`);
          }}>
            <Quote className="w-4 h-4" />
            引用文件夹到对话
          </ContextMenuItem>
        )}
        {data.nodeType === 'file' && (
          <ContextMenuItem onClick={handleQuoteFileToChat}>
            <Quote className="w-4 h-4" />
            引用到对话
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={() => item.startRenaming()}>
          <Pencil className="w-4 h-4" />
          重命名
        </ContextMenuItem>
        {gitAvailable && (
          <ContextMenuItem onClick={handleShowHistory}>
            <History className="w-4 h-4" />
            历史
          </ContextMenuItem>
        )}
        {data.nodeType === 'directory' && gitAvailable && (
          exclusionEntry === null ? (
            <ContextMenuItem onClick={() => onExcludeFolder(originalNode.path, originalNode.name)}>
              <EyeOff className="w-4 h-4" />
              从快照排除
            </ContextMenuItem>
          ) : exclusionEntry === originalNode.path ? (
            <ContextMenuItem onClick={() => onRestoreFolder(originalNode.path, originalNode.name)}>
              <Eye className="w-4 h-4" />
              恢复快照保护
            </ContextMenuItem>
          ) : (
            <ContextMenuItem disabled>
              <EyeOff className="w-4 h-4" />
              已被 {exclusionEntry} 排除
            </ContextMenuItem>
          )
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handleOpenInExplorer}>
          <ExternalLink className="w-4 h-4" />
          在文件管理器中打开
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={handleDelete}>
          <Trash2 className="w-4 h-4" />
          删除
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
