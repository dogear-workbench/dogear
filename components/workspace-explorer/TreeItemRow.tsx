/**
 * WorkspaceExplorer 树节点行渲染
 */
import React from 'react';
import {
  Globe, Folder, FolderOpen, File,
  ChevronRight, ChevronDown, FolderPlus,
  Quote, Trash2, Pencil, ExternalLink, Lock, History,
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
import { buildArticleMeta, isArticlePath } from './tree-model';
import { ARTICLES_SECTION_ID } from './tree-model';
import type { FlatNode } from './tree-model';

interface TreeItemRowProps {
  item: ItemInstance<FlatNode>;
  articleCount: number;
  fileCount: number;
  onSetCreatingFolder: (parentPath: string | null) => void;
}

export function TreeItemRow({
  item,
  articleCount,
  fileCount,
  onSetCreatingFolder,
}: TreeItemRowProps) {
  const data = item.getItemData();
  const meta = item.getItemMeta();

  // Store hooks
  const selectedFile = useWorkspaceStore(s => s.selectedFile);
  const selectedArticle = useArticleStore(s => s.selectedArticle);
  const showUrlInput = useArticleStore(s => s.showUrlInput);
  const toggleReferenceArticle = useReferenceStore(s => s.toggleReferenceArticle);
  const addReferencedFile = useReferenceStore(s => s.addReferencedFile);
  const deleteItem = useWorkspaceStore(s => s.deleteItem);
  const openInExplorer = useWorkspaceStore(s => s.openInExplorer);
  const gitAvailable = useGitHistoryStore(s => s.gitAvailable);
  const openHistory = useGitHistoryStore(s => s.openHistory);

  const originalNode = data.originalNode;

  // 判断是否选中
  const isSelected =
    (data.nodeType === 'article' && originalNode?.articleMeta && selectedArticle?.id === originalNode.articleMeta.id) ||
    (data.nodeType === 'file' && selectedFile?.path === originalNode?.path);

  // ---- 分区头渲染 ----
  if (data.nodeType === 'section-header') {
    const count = data.id === ARTICLES_SECTION_ID ? articleCount : fileCount;
    const isArticlesHeader = data.id === ARTICLES_SECTION_ID;

    return (
      <div
        {...item.getProps()}
        className={cn(
          'flex items-center gap-1 py-1 px-3 cursor-pointer select-none',
          'hover:bg-muted/50 transition-colors',
          item.isFocused() && 'ring-1 ring-primary/30',
        )}
      >
        {item.isExpanded()
          ? <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
          : <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />
        }
        <span className="text-xs font-medium text-muted-foreground">{data.name}</span>
        {count > 0 && (
          <span className="text-xs text-muted-foreground bg-muted rounded-full px-1.5 py-0.5 ml-1">
            {count}
          </span>
        )}
        {/* 分区头操作按钮：文章区有导入，两区都有新建文件夹 */}
        <div className="ml-auto flex items-center gap-0.5">
          {isArticlesHeader && (
            <button
              className="p-0.5 rounded hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                showUrlInput();
              }}
              title="导入文章"
            >
              <Globe className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            className="p-0.5 rounded hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onSetCreatingFolder(isArticlesHeader ? '.dogear/articles' : '.');
            }}
            title={isArticlesHeader ? '新建文章文件夹' : '新建文件夹'}
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  // ---- 普通节点渲染 ----
  if (!originalNode) return null;

  const isArticleFolder = data.nodeType === 'directory' && isArticlePath(originalNode.path);

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
  const handleQuoteToChat = () => {
    const articleMeta = buildArticleMeta(originalNode);
    if (!articleMeta) return;
    // 文章 tab 等哨兵场景无焦点会话：锚定回退到最近活跃会话
    const anchorId = requireReferenceAnchorId();
    if (!anchorId) return;
    const already = useReferenceStore.getState().referencedArticles.some(a => a.id === articleMeta.id);
    toggleReferenceArticle(articleMeta, anchorId);
    toast.success(already ? `已取消引用 ${originalNode.name}` : `已引用文章 ${originalNode.name}`);
  };
  const handleNewSubFolder = () => {
    onSetCreatingFolder(originalNode.path);
  };
  const handleShowHistory = () => {
    openHistory({ name: originalNode.name, path: originalNode.path, isFolder: data.nodeType === 'directory' });
  };

  // 构建右键菜单
  const renderContextMenuContent = () => {
    // 文章节点
    if (data.nodeType === 'article') {
      return (
        <ContextMenuContent>
          <ContextMenuItem onClick={handleQuoteToChat}>
            <Quote className="w-4 h-4" />
            引用到对话
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={handleDelete}>
            <Trash2 className="w-4 h-4" />
            删除
          </ContextMenuItem>
        </ContextMenuContent>
      );
    }

    // 文章目录下的文件夹（只允许一层，不提供新建子文件夹）
    if (isArticleFolder) {
      return (
        <ContextMenuContent>
          <ContextMenuItem onClick={() => item.startRenaming()}>
            <Pencil className="w-4 h-4" />
            重命名
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={handleDelete}>
            <Trash2 className="w-4 h-4" />
            删除
          </ContextMenuItem>
        </ContextMenuContent>
      );
    }

    // 普通文件/文件夹
    return (
      <ContextMenuContent>
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
          <ContextMenuItem onClick={() => {
            if (!guardReferenceIntoFocus()) return;
            const anchorId = requireReferenceAnchorId();
            if (!anchorId) return;
            addReferencedFile({ name: originalNode.name, path: originalNode.path }, anchorId);
            toast.success(`已引用 ${originalNode.name}`);
          }}>
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
    );
  };

  // 缩进计算：level * indent（headless-tree 已设置 indent=16），加上基础 padding
  const paddingLeft = meta.level * 16 + 8;

  // 拖放目标高亮
  const isDragTarget = item.isDragTarget() && item.isFolder();

  // 提取 headless-tree 的 props，分离 ref 以避免与 ContextMenuTrigger 冲突
  const { ref: itemRef, ...itemProps } = item.getProps();

  return (
    <ContextMenu>
      <ContextMenuTrigger
        ref={itemRef}
        className={cn(
          'flex items-center gap-1 py-1 pr-2 cursor-pointer select-none',
          'hover:bg-muted/50 transition-colors',
          isSelected && 'bg-primary/20',
          isDragTarget && 'bg-blue-500/20 ring-1 ring-blue-500/50',
          item.isFocused() && 'ring-1 ring-primary/30',
        )}
        style={{ paddingLeft: `${paddingLeft}px` }}
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
            <div className="text-sm truncate">{data.name}</div>
            {/* 文章显示站点名和相对时间 */}
            {data.nodeType === 'article' && originalNode.articleMeta && (
              <div className="text-xs text-muted-foreground truncate">
                {originalNode.articleMeta.parseStatus === 'need_login' && (
                  <span title="需要登录" className="inline-flex items-center mr-1 align-[-2px]">
                    <Lock className="w-3 h-3 text-orange-500" />
                  </span>
                )}
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
      {renderContextMenuContent()}
    </ContextMenu>
  );
}
