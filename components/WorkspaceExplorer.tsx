'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Globe, Folder, FolderOpen, File, BookOpen,
  ChevronRight, ChevronDown, FolderPlus, RefreshCw,
  Quote, Trash2, Pencil, Move, Copy, ExternalLink,
} from 'lucide-react';
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent,
  ContextMenuItem, ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useArticleStore } from '@/stores/article-store';
import { useReferenceStore } from '@/stores/reference-store';
import type { WorkspaceFileNode } from '@/types/electron-api';
import type { ArticleMeta } from '@/types/article';

// ---- 工具函数 ----

/** 将时间戳转换为相对时间描述 */
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

/** 判断路径是否属于文章目录 */
function isArticlePath(path: string): boolean {
  return path.startsWith('.dogear/articles');
}

/** 判断文件扩展名是否为电子书格式 */
function isBookExt(ext?: string): boolean {
  if (!ext) return false;
  return ['.epub', '.pdf', '.txt'].includes(ext.toLowerCase());
}

/** 从 WorkspaceFileNode 构建 ArticleMeta 对象 */
function buildArticleMeta(node: WorkspaceFileNode): ArticleMeta | null {
  if (node.type !== 'article' || !node.articleMeta) return null;
  return {
    id: node.articleMeta.id,
    url: node.articleMeta.url,
    title: node.name,
    author: null,
    siteName: node.articleMeta.siteName,
    excerpt: null,
    wordCount: node.articleMeta.wordCount,
    fetchedAt: node.articleMeta.fetchedAt,
    language: null,
  };
}

/** 统计树中所有叶子节点（文件/文章）的总数 */
function countNodes(nodes: WorkspaceFileNode[]): number {
  let count = 0;
  for (const node of nodes) {
    if (node.type === 'file' || node.type === 'article') {
      count++;
    }
    if (node.children) {
      count += countNodes(node.children);
    }
  }
  return count;
}

// ---- 内联重命名输入框 ----

interface InlineRenameProps {
  initialValue: string;
  onConfirm: (newName: string) => void;
  onCancel: () => void;
}

function InlineRenameInput({ initialValue, onConfirm, onCancel }: InlineRenameProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // 聚焦并选中文件名（不含扩展名）
    if (inputRef.current) {
      inputRef.current.focus();
      const dotIdx = initialValue.lastIndexOf('.');
      if (dotIdx > 0) {
        inputRef.current.setSelectionRange(0, dotIdx);
      } else {
        inputRef.current.select();
      }
    }
  }, [initialValue]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = value.trim();
      if (trimmed && trimmed !== initialValue) {
        onConfirm(trimmed);
      } else {
        onCancel();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  const handleBlur = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== initialValue) {
      onConfirm(trimmed);
    } else {
      onCancel();
    }
  };

  return (
    <input
      ref={inputRef}
      className="flex-1 min-w-0 bg-background border border-primary rounded px-1 py-0 text-sm outline-none"
      value={value}
      onChange={e => setValue(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
    />
  );
}

// ---- ExplorerNode 子组件 ----

interface ExplorerNodeProps {
  node: WorkspaceFileNode;
  level: number;
  renamingPath: string | null;
  onStartRename: (path: string, currentName: string) => void;
  onConfirmRename: (path: string, newName: string) => void;
  onCancelRename: () => void;
  onRequestNewFolder?: (parentPath: string) => void;
  onRequestMove?: (sourcePath: string) => void;
  onRequestCopy?: (sourcePath: string) => void;
}

function ExplorerNode({
  node,
  level,
  renamingPath,
  onStartRename,
  onConfirmRename,
  onCancelRename,
  onRequestNewFolder,
  onRequestMove,
  onRequestCopy,
}: ExplorerNodeProps) {
  const expandedPaths = useWorkspaceStore(s => s.expandedPaths);
  const selectedFile = useWorkspaceStore(s => s.selectedFile);
  const selectedArticle = useArticleStore(s => s.selectedArticle);
  const toggleExpand = useWorkspaceStore(s => s.toggleExpand);
  const selectFile = useWorkspaceStore(s => s.selectFile);
  const selectArticle = useArticleStore(s => s.selectArticle);
  const toggleReferenceArticle = useReferenceStore(s => s.toggleReferenceArticle);
  const deleteItem = useWorkspaceStore(s => s.deleteItem);
  const moveItem = useWorkspaceStore(s => s.moveItem);
  const copyItem = useWorkspaceStore(s => s.copyItem);
  const createFolder = useWorkspaceStore(s => s.createFolder);
  const openInExplorer = useWorkspaceStore(s => s.openInExplorer);

  const isExpanded = expandedPaths.includes(node.path);
  const isRenaming = renamingPath === node.path;

  // 判断是否选中
  const isSelected =
    (node.type === 'article' && selectedArticle?.id === node.articleMeta?.id) ||
    (node.type !== 'article' && selectedFile?.path === node.path);

  // 是否属于文章目录下的文件夹
  const isArticleFolder = node.type === 'directory' && isArticlePath(node.path);

  // 点击处理
  const handleClick = useCallback(() => {
    if (isRenaming) return;
    if (node.type === 'article') {
      const meta = buildArticleMeta(node);
      if (meta) selectArticle(meta);
    } else if (node.type === 'directory') {
      toggleExpand(node.path);
    } else if (node.type === 'file') {
      selectFile(node);
    }
  }, [node, isRenaming, selectArticle, selectFile, toggleExpand]);

  // 图标渲染
  const renderIcon = () => {
    if (node.type === 'article') {
      return <Globe className="w-4 h-4 shrink-0 text-green-500" />;
    }
    if (node.type === 'directory') {
      return isExpanded
        ? <FolderOpen className="w-4 h-4 shrink-0 text-blue-500" />
        : <Folder className="w-4 h-4 shrink-0 text-blue-500" />;
    }
    // file 类型
    if (isBookExt(node.ext)) {
      return <BookOpen className="w-4 h-4 shrink-0 text-orange-500" />;
    }
    return <File className="w-4 h-4 shrink-0 text-muted-foreground" />;
  };

  // 展开/折叠箭头
  const renderChevron = () => {
    if (node.type !== 'directory') {
      // 占位保持对齐
      return <span className="w-4 h-4 shrink-0" />;
    }
    return isExpanded
      ? <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />
      : <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground" />;
  };

  // 右键菜单操作
  const handleRename = () => onStartRename(node.path, node.name);
  const handleDelete = () => deleteItem(node.path);

  const handleMoveTo = () => {
    if (onRequestMove) onRequestMove(node.path);
  };

  const handleCopy = () => {
    if (onRequestCopy) onRequestCopy(node.path);
  };

  const handleNewSubFolder = () => {
    if (onRequestNewFolder) onRequestNewFolder(node.path);
  };

  const handleOpenInExplorer = () => openInExplorer(node.path);

  const handleQuoteToChat = () => {
    const meta = buildArticleMeta(node);
    if (meta) toggleReferenceArticle(meta);
  };

  // 构建右键菜单内容
  const renderContextMenuContent = () => {
    // 文章节点
    if (node.type === 'article') {
      return (
        <ContextMenuContent>
          <ContextMenuItem onClick={handleQuoteToChat}>
            <Quote className="w-4 h-4" />
            引用到对话
          </ContextMenuItem>
          <ContextMenuItem onClick={handleMoveTo}>
            <Move className="w-4 h-4" />
            移动到...
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onClick={handleDelete}>
            <Trash2 className="w-4 h-4" />
            删除
          </ContextMenuItem>
        </ContextMenuContent>
      );
    }

    // 文章目录下的文件夹
    if (isArticleFolder) {
      return (
        <ContextMenuContent>
          <ContextMenuItem onClick={handleNewSubFolder}>
            <FolderPlus className="w-4 h-4" />
            新建子文件夹
          </ContextMenuItem>
          <ContextMenuItem onClick={handleRename}>
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
        {node.type === 'directory' && (
          <ContextMenuItem onClick={handleNewSubFolder}>
            <FolderPlus className="w-4 h-4" />
            新建文件夹
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={handleRename}>
          <Pencil className="w-4 h-4" />
          重命名
        </ContextMenuItem>
        <ContextMenuItem onClick={handleMoveTo}>
          <Move className="w-4 h-4" />
          移动到...
        </ContextMenuItem>
        <ContextMenuItem onClick={handleCopy}>
          <Copy className="w-4 h-4" />
          复制
        </ContextMenuItem>
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

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              'flex items-center gap-1 py-1 pr-2 cursor-pointer select-none',
              'hover:bg-muted/50 transition-colors',
              isSelected && 'bg-primary/20',
            )}
            style={{ paddingLeft: `${level * 16 + 8}px` }}
            onClick={handleClick}
          >
            {renderChevron()}
            {renderIcon()}

            {isRenaming ? (
              <InlineRenameInput
                initialValue={node.name}
                onConfirm={(newName) => onConfirmRename(node.path, newName)}
                onCancel={onCancelRename}
              />
            ) : (
              <div className="flex-1 min-w-0 ml-1">
                <div className="text-sm truncate">{node.name}</div>
                {/* 文章显示站点名和相对时间 */}
                {node.type === 'article' && node.articleMeta && (
                  <div className="text-xs text-muted-foreground truncate">
                    {node.articleMeta.siteName && (
                      <span>{node.articleMeta.siteName}</span>
                    )}
                    {node.articleMeta.siteName && node.articleMeta.fetchedAt && (
                      <span> · </span>
                    )}
                    {node.articleMeta.fetchedAt && (
                      <span>{getRelativeTime(node.articleMeta.fetchedAt)}</span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </ContextMenuTrigger>
        {renderContextMenuContent()}
      </ContextMenu>

      {/* 递归渲染子节点 */}
      {node.type === 'directory' && isExpanded && node.children?.map(child => (
        <ExplorerNode
          key={child.path}
          node={child}
          level={level + 1}
          renamingPath={renamingPath}
          onStartRename={onStartRename}
          onConfirmRename={onConfirmRename}
          onCancelRename={onCancelRename}
          onRequestNewFolder={onRequestNewFolder}
          onRequestMove={onRequestMove}
          onRequestCopy={onRequestCopy}
        />
      ))}
    </>
  );
}

// ---- 主组件 ----

export function WorkspaceExplorer() {
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  // 新建文件夹：parentPath 表示在哪个目录下新建
  const [creatingFolderAt, setCreatingFolderAt] = useState<string | null>(null);
  // 移动/复制目标输入
  const [movingPath, setMovingPath] = useState<string | null>(null);
  const [copyingPath, setCopyingPath] = useState<string | null>(null);

  const files = useWorkspaceStore(s => s.files);
  const loadWorkspaceFiles = useWorkspaceStore(s => s.loadWorkspaceFiles);
  const createFolder = useWorkspaceStore(s => s.createFolder);
  const renameItem = useWorkspaceStore(s => s.renameItem);
  const loadingFiles = useWorkspaceStore(s => s.loadingFiles);

  // 拆分文章区和文件区
  const articleNodes = files.filter(f => isArticlePath(f.path));
  const fileNodes = files.filter(f => !isArticlePath(f.path));
  const totalCount = countNodes(files);

  // 重命名操作
  const handleStartRename = useCallback((path: string, _currentName: string) => {
    setRenamingPath(path);
  }, []);

  const handleConfirmRename = useCallback(async (path: string, newName: string) => {
    setRenamingPath(null);
    await renameItem(path, newName);
  }, [renameItem]);

  const handleCancelRename = useCallback(() => {
    setRenamingPath(null);
  }, []);

  // 工具栏操作
  const handleNewFolder = useCallback(() => {
    setCreatingFolderAt('.');
  }, []);

  const handleRefresh = useCallback(() => {
    loadWorkspaceFiles();
  }, [loadWorkspaceFiles]);

  // 子节点请求操作的回调
  const handleRequestNewFolder = useCallback((parentPath: string) => {
    setCreatingFolderAt(parentPath);
  }, []);

  const handleRequestMove = useCallback((sourcePath: string) => {
    setMovingPath(sourcePath);
  }, []);

  const handleRequestCopy = useCallback((sourcePath: string) => {
    setCopyingPath(sourcePath);
  }, []);

  const moveItem = useWorkspaceStore(s => s.moveItem);
  const copyItem = useWorkspaceStore(s => s.copyItem);

  return (
    <div className="flex flex-col h-full">
      {/* 工具栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">工作区</span>
          {totalCount > 0 && (
            <span className="text-xs text-muted-foreground bg-muted rounded-full px-1.5 py-0.5">
              {totalCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            className="p-1 rounded hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
            onClick={handleNewFolder}
            title="新建文件夹"
          >
            <FolderPlus className="w-4 h-4" />
          </button>
          <button
            className={cn(
              'p-1 rounded hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors',
              loadingFiles && 'animate-spin',
            )}
            onClick={handleRefresh}
            title="刷新"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 可滚动的文件树区域 */}
      <div className="flex-1 overflow-y-auto">
        {/* 文章区 */}
        {articleNodes.length > 0 && (
          <>
            <div className="px-3 py-1 text-xs text-muted-foreground font-medium">
              文章
            </div>
            {articleNodes.map(node => (
              <ExplorerNode
                key={node.path}
                node={node}
                level={0}
                renamingPath={renamingPath}
                onStartRename={handleStartRename}
                onConfirmRename={handleConfirmRename}
                onCancelRename={handleCancelRename}
                onRequestNewFolder={handleRequestNewFolder}
                onRequestMove={handleRequestMove}
                onRequestCopy={handleRequestCopy}
              />
            ))}
          </>
        )}

        {/* 分隔线（两个区域都有内容时显示） */}
        {articleNodes.length > 0 && fileNodes.length > 0 && (
          <div className="my-1 mx-3 border-t" />
        )}

        {/* 文件区 */}
        {fileNodes.length > 0 && (
          <>
            <div className="px-3 py-1 text-xs text-muted-foreground font-medium">
              文件
            </div>
            {fileNodes.map(node => (
              <ExplorerNode
                key={node.path}
                node={node}
                level={0}
                renamingPath={renamingPath}
                onStartRename={handleStartRename}
                onConfirmRename={handleConfirmRename}
                onCancelRename={handleCancelRename}
                onRequestNewFolder={handleRequestNewFolder}
                onRequestMove={handleRequestMove}
                onRequestCopy={handleRequestCopy}
              />
            ))}
          </>
        )}

        {/* 内联新建文件夹输入 */}
        {creatingFolderAt !== null && (
          <div className="flex items-center gap-1 px-3 py-1">
            <FolderPlus className="w-4 h-4 shrink-0 text-blue-500" />
            <InlineRenameInput
              initialValue="新文件夹"
              onConfirm={async (name) => {
                await createFolder(creatingFolderAt, name);
                setCreatingFolderAt(null);
              }}
              onCancel={() => setCreatingFolderAt(null)}
            />
          </div>
        )}

        {/* 内联移动目标输入 */}
        {movingPath !== null && (
          <div className="flex items-center gap-1 px-3 py-1 bg-muted/30">
            <Move className="w-4 h-4 shrink-0 text-muted-foreground" />
            <span className="text-xs text-muted-foreground shrink-0">移动到:</span>
            <InlineRenameInput
              initialValue=""
              onConfirm={async (target) => {
                await moveItem(movingPath, target);
                setMovingPath(null);
              }}
              onCancel={() => setMovingPath(null)}
            />
          </div>
        )}

        {/* 内联复制目标输入 */}
        {copyingPath !== null && (
          <div className="flex items-center gap-1 px-3 py-1 bg-muted/30">
            <Copy className="w-4 h-4 shrink-0 text-muted-foreground" />
            <span className="text-xs text-muted-foreground shrink-0">复制到:</span>
            <InlineRenameInput
              initialValue=""
              onConfirm={async (target) => {
                await copyItem(copyingPath, target);
                setCopyingPath(null);
              }}
              onCancel={() => setCopyingPath(null)}
            />
          </div>
        )}

        {/* 空状态 */}
        {files.length === 0 && !loadingFiles && (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            暂无内容
          </div>
        )}

        {/* 加载中状态 */}
        {files.length === 0 && loadingFiles && (
          <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
            加载中...
          </div>
        )}
      </div>
    </div>
  );
}
