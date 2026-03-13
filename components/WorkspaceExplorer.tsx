
import React, { useState, useCallback, useMemo, useEffect, useLayoutEffect, useRef } from 'react';
import {
  Globe, Folder, FolderOpen, File, BookOpen,
  ChevronRight, ChevronDown, FolderPlus, RefreshCw,
  Quote, Trash2, Pencil, ExternalLink,
} from 'lucide-react';
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent,
  ContextMenuItem, ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useArticleStore } from '@/stores/article-store';
import { useReferenceStore } from '@/stores/reference-store';
import type { WorkspaceFileNode } from '@/types/electron-api';
import type { ArticleMeta } from '@/types/article';

import { useTree } from '@headless-tree/react';
import {
  syncDataLoaderFeature,
  selectionFeature,
  hotkeysCoreFeature,
  dragAndDropFeature,
  renamingFeature,
  propMemoizationFeature,
} from '@headless-tree/core';
import type { ItemInstance, DragTarget } from '@headless-tree/core';

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

// ---- FlatNode 数据模型 ----

/** headless-tree 的扁平节点 */
interface FlatNode {
  id: string;
  name: string;
  isFolder: boolean;
  childrenIds: string[];
  nodeType: 'article' | 'file' | 'directory' | 'section-header';
  originalNode?: WorkspaceFileNode;
}

// 虚拟根节点和分区头 ID
const ROOT_ID = '__root__';
const ARTICLES_SECTION_ID = '__articles__';
const FILES_SECTION_ID = '__files__';

/**
 * 递归遍历 WorkspaceFileNode 树，构建扁平 Record
 * 同时统计叶子节点（文章/文件）数量
 */
function buildNodeMap(files: WorkspaceFileNode[]): {
  nodeMap: Record<string, FlatNode>;
  articleCount: number;
  fileCount: number;
} {
  const nodeMap: Record<string, FlatNode> = {};
  let articleCount = 0;
  let fileCount = 0;

  // 分离文章区和文件区
  const articleNodes = files.filter(f => isArticlePath(f.path));
  const fileNodes = files.filter(f => !isArticlePath(f.path));

  // 递归添加节点到 nodeMap
  function addNode(node: WorkspaceFileNode): void {
    const isDir = node.type === 'directory';
    const childIds: string[] = [];
    if (isDir && node.children) {
      for (const child of node.children) {
        childIds.push(child.path);
        addNode(child);
      }
    }
    // 统计叶子节点
    if (node.type === 'article') articleCount++;
    if (node.type === 'file') fileCount++;

    nodeMap[node.path] = {
      id: node.path,
      name: node.name,
      isFolder: isDir,
      childrenIds: childIds,
      nodeType: node.type === 'article' ? 'article' : (isDir ? 'directory' : 'file'),
      originalNode: node,
    };
  }

  // 构建文章区节点
  const articleChildIds: string[] = [];
  for (const node of articleNodes) {
    articleChildIds.push(node.path);
    addNode(node);
  }

  // 构建文件区节点
  const fileChildIds: string[] = [];
  for (const node of fileNodes) {
    fileChildIds.push(node.path);
    addNode(node);
  }

  // 文章分区头
  nodeMap[ARTICLES_SECTION_ID] = {
    id: ARTICLES_SECTION_ID,
    name: '文章',
    isFolder: true,
    childrenIds: articleChildIds,
    nodeType: 'section-header',
  };

  // 文件分区头
  nodeMap[FILES_SECTION_ID] = {
    id: FILES_SECTION_ID,
    name: '文件',
    isFolder: true,
    childrenIds: fileChildIds,
    nodeType: 'section-header',
  };

  // 虚拟根节点
  nodeMap[ROOT_ID] = {
    id: ROOT_ID,
    name: 'root',
    isFolder: true,
    childrenIds: [ARTICLES_SECTION_ID, FILES_SECTION_ID],
    nodeType: 'section-header',
  };

  return { nodeMap, articleCount, fileCount };
}

/** 判断节点是否属于文章分区 */
function isInArticleSection(itemId: string, nodeMap: Record<string, FlatNode>): boolean {
  if (itemId === ARTICLES_SECTION_ID) return true;
  const node = nodeMap[itemId];
  if (!node) return false;
  if (node.originalNode && isArticlePath(node.originalNode.path)) return true;
  return false;
}

/** 判断节点是否属于文件分区 */
function isInFileSection(itemId: string, nodeMap: Record<string, FlatNode>): boolean {
  if (itemId === FILES_SECTION_ID) return true;
  const node = nodeMap[itemId];
  if (!node) return false;
  if (node.originalNode && !isArticlePath(node.originalNode.path)) return true;
  return false;
}

// ---- 新建文件夹内联输入组件 ----

interface NewFolderInputProps {
  onConfirm: (name: string) => void;
  onCancel: () => void;
  indent: number;
}

function NewFolderInput({ onConfirm, onCancel, indent }: NewFolderInputProps) {
  const [value, setValue] = useState('新文件夹');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = value.trim();
      if (trimmed) {
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
    // 如果用户没有修改默认名称，视为取消
    if (trimmed && trimmed !== '新文件夹') {
      onConfirm(trimmed);
    } else {
      onCancel();
    }
  };

  return (
    <div
      className="flex items-center gap-1 py-1 pr-2"
      style={{ paddingLeft: `${indent}px` }}
    >
      <FolderPlus className="w-4 h-4 shrink-0 text-blue-500" />
      <input
        ref={inputRef}
        className="flex-1 min-w-0 bg-background border border-primary rounded px-1 py-0 text-sm outline-none"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      />
    </div>
  );
}

// ---- 树节点行渲染组件 ----

interface TreeItemRowProps {
  item: ItemInstance<FlatNode>;
  articleCount: number;
  fileCount: number;
  onSetCreatingFolder: (parentPath: string | null) => void;
}

function TreeItemRow({
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
  const selectFile = useWorkspaceStore(s => s.selectFile);
  const selectArticle = useArticleStore(s => s.selectArticle);
  const toggleReferenceArticle = useReferenceStore(s => s.toggleReferenceArticle);
  const deleteItem = useWorkspaceStore(s => s.deleteItem);
  const openInExplorer = useWorkspaceStore(s => s.openInExplorer);

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
        {/* 文章分区的新建文件夹按钮 */}
        {isArticlesHeader && (
          <button
            className="ml-auto p-0.5 rounded hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onSetCreatingFolder('.dogear/articles');
            }}
            title="新建文章文件夹"
          >
            <FolderPlus className="w-3.5 h-3.5" />
          </button>
        )}
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
    if (isBookExt(originalNode.ext)) {
      return <BookOpen className="w-4 h-4 shrink-0 text-orange-500" />;
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
    if (articleMeta) toggleReferenceArticle(articleMeta);
  };
  const handleNewSubFolder = () => {
    onSetCreatingFolder(originalNode.path);
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

    // 文章目录下的文件夹
    if (isArticleFolder) {
      return (
        <ContextMenuContent>
          <ContextMenuItem onClick={handleNewSubFolder}>
            <FolderPlus className="w-4 h-4" />
            新建子文件夹
          </ContextMenuItem>
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
        <ContextMenuItem onClick={() => item.startRenaming()}>
          <Pencil className="w-4 h-4" />
          重命名
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

// ---- 主组件 ----

export function WorkspaceExplorer() {
  // Store 状态
  const files = useWorkspaceStore(s => s.files);
  const loadWorkspaceFiles = useWorkspaceStore(s => s.loadWorkspaceFiles);
  const createFolder = useWorkspaceStore(s => s.createFolder);
  const renameItem = useWorkspaceStore(s => s.renameItem);
  const moveItem = useWorkspaceStore(s => s.moveItem);
  const loadingFiles = useWorkspaceStore(s => s.loadingFiles);
  const selectFile = useWorkspaceStore(s => s.selectFile);
  const creatingFolderAt = useWorkspaceStore(s => s.creatingFolderAt);
  const setCreatingFolderAt = useWorkspaceStore(s => s.setCreatingFolderAt);
  const selectArticle = useArticleStore(s => s.selectArticle);

  // 构建扁平节点映射
  const { nodeMap, articleCount, fileCount } = useMemo(
    () => buildNodeMap(files),
    [files],
  );

  const totalCount = articleCount + fileCount;

  // 用 ref 保持最新的 nodeMap 引用，供回调使用
  const nodeMapRef = useRef(nodeMap);
  nodeMapRef.current = nodeMap;

  // 用 ref 保持最新的 store actions
  const moveItemRef = useRef(moveItem);
  moveItemRef.current = moveItem;
  const renameItemRef = useRef(renameItem);
  renameItemRef.current = renameItem;
  const loadWorkspaceFilesRef = useRef(loadWorkspaceFiles);
  loadWorkspaceFilesRef.current = loadWorkspaceFiles;
  const selectFileRef = useRef(selectFile);
  selectFileRef.current = selectFile;
  const selectArticleRef = useRef(selectArticle);
  selectArticleRef.current = selectArticle;

  // 稳定的 dataLoader（不依赖 nodeMap 的变化重建 tree）
  const dataLoader = useMemo(() => ({
    getItem: (itemId: string) => {
      return nodeMapRef.current[itemId] ?? {
        id: itemId,
        name: itemId,
        isFolder: false,
        childrenIds: [],
        nodeType: 'file' as const,
      };
    },
    getChildren: (itemId: string) => {
      return nodeMapRef.current[itemId]?.childrenIds ?? [];
    },
  }), []);

  // 稳定的回调
  const handleDrop = useCallback((items: ItemInstance<FlatNode>[], target: DragTarget<FlatNode>) => {
    const targetItem = target.item;
    const targetData = targetItem.getItemData();
    const targetId = targetItem.getId();

    // 确定目标路径：分区头映射到对应根目录
    let targetPath: string | null = null;
    if (targetId === ARTICLES_SECTION_ID) {
      targetPath = '.dogear/articles';
    } else if (targetId === FILES_SECTION_ID) {
      targetPath = '.';
    } else if (targetData.isFolder && targetData.originalNode) {
      targetPath = targetData.originalNode.path;
    }

    if (!targetPath) return;

    for (const draggedItem of items) {
      const draggedData = draggedItem.getItemData();
      if (draggedData.originalNode) {
        moveItemRef.current(draggedData.originalNode.path, targetPath);
      }
    }
  }, []);

  const handleRename = useCallback((item: ItemInstance<FlatNode>, value: string) => {
    const data = item.getItemData();
    if (data.originalNode) {
      renameItemRef.current(data.originalNode.path, value);
    }
  }, []);

  const handlePrimaryAction = useCallback((item: ItemInstance<FlatNode>) => {
    const data = item.getItemData();
    if (!data.originalNode) return;
    if (data.nodeType === 'article') {
      const articleMeta = buildArticleMeta(data.originalNode);
      if (articleMeta) selectArticleRef.current(articleMeta);
    } else if (data.nodeType === 'file') {
      selectFileRef.current(data.originalNode);
    }
    // directory 的展开/折叠由 headless-tree 自动处理
  }, []);

  const canDrag = useCallback((items: ItemInstance<FlatNode>[]) => {
    // 禁止拖拽分区头
    return items.every(i => i.getItemData().nodeType !== 'section-header');
  }, []);

  const canDrop = useCallback((items: ItemInstance<FlatNode>[], target: DragTarget<FlatNode>) => {
    const targetData = target.item.getItemData();
    const targetId = target.item.getId();

    // 虚拟根节点不可放置
    if (targetId === ROOT_ID) return false;

    // 分区头可以作为放置目标（代表移到该分区顶层）
    if (targetData.nodeType === 'section-header') {
      const currentMap = nodeMapRef.current;
      for (const draggedItem of items) {
        const draggedId = draggedItem.getId();
        // 检查同分区
        if (targetId === ARTICLES_SECTION_ID && !isInArticleSection(draggedId, currentMap)) return false;
        if (targetId === FILES_SECTION_ID && !isInFileSection(draggedId, currentMap)) return false;
      }
      return true;
    }

    // 禁止放到非文件夹上
    if (!targetData.isFolder) return false;

    // 禁止跨分区拖拽（文章区 ↔ 文件区）
    const currentMap = nodeMapRef.current;
    const targetInArticles = isInArticleSection(targetId, currentMap);
    const targetInFiles = isInFileSection(targetId, currentMap);

    for (const draggedItem of items) {
      const draggedId = draggedItem.getId();
      const draggedInArticles = isInArticleSection(draggedId, currentMap);
      const draggedInFiles = isInFileSection(draggedId, currentMap);

      // 跨分区检查
      if (draggedInArticles && targetInFiles) return false;
      if (draggedInFiles && targetInArticles) return false;

      // 禁止拖入自身子级
      if (target.item.isDescendentOf(draggedId)) return false;

      // 禁止拖入自身
      if (draggedId === targetId) return false;
    }

    return true;
  }, []);

  const canRename = useCallback((item: ItemInstance<FlatNode>) => {
    const data = item.getItemData();
    // 分区头不可重命名
    if (data.nodeType === 'section-header') return false;
    return true;
  }, []);

  // headless-tree 实例
  const tree = useTree<FlatNode>({
    rootItemId: ROOT_ID,
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
    canReorder: false,
    openOnDropDelay: 800,
    initialState: {
      expandedItems: [ARTICLES_SECTION_ID, FILES_SECTION_ID],
    },
    isItemFolder: (item) => item.getItemData().isFolder,
    getItemName: (item) => item.getItemData().name,
    onDrop: handleDrop,
    onRename: handleRename,
    onPrimaryAction: handlePrimaryAction,
    canDrag,
    canDrop,
    canRename,
  });

  // 滚动保持：通过 ScrollArea 的 Viewport 获取实际滚动容器
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const pendingScrollTop = useRef<number | null>(null);
  const scrollRestoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 获取 ScrollArea 内部的 Viewport 滚动容器 */
  const getViewport = () => scrollAreaRef.current?.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement | null;

  // 当 files 变化时重建树
  useLayoutEffect(() => {
    pendingScrollTop.current = getViewport()?.scrollTop ?? 0;
    tree.rebuildTree();
  }, [files, tree]);

  // 每次渲染后，如果有待恢复的滚动位置就恢复它
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

  // 新建文件夹操作：展开目标文件夹并显示输入框
  const handleSetCreatingFolder = useCallback((parentPath: string | null) => {
    if (parentPath === null) {
      setCreatingFolderAt(null);
      return;
    }
    // 展开目标节点以确保输入框可见
    for (const item of tree.getItems()) {
      const itemId = item.getId();
      const itemData = item.getItemData();
      const shouldExpand =
        (parentPath === '.dogear/articles' && itemId === ARTICLES_SECTION_ID) ||
        (parentPath === '.' && itemId === FILES_SECTION_ID) ||
        (itemData.originalNode?.path === parentPath && itemData.isFolder);
      if (shouldExpand && !item.isExpanded()) {
        item.expand();
      }
    }
    setCreatingFolderAt(parentPath);
  }, [tree]);

  // 工具栏操作
  const handleNewFolder = useCallback(() => {
    handleSetCreatingFolder('.');
  }, [handleSetCreatingFolder]);

  const handleRefresh = useCallback(() => {
    loadWorkspaceFiles();
  }, [loadWorkspaceFiles]);

  // 获取所有可见项
  const items = tree.getItems();

  // 计算 NewFolderInput 的插入位置和缩进
  const newFolderInsertInfo = useMemo(() => {
    if (creatingFolderAt === null) return null;

    // 查找目标父节点在扁平列表中的位置
    let parentIndex = -1;
    let parentLevel = 0;

    // 处理特殊情况：在分区头创建（如 .dogear/articles）
    // 或在 '.' (工作区根目录)创建
    for (let i = 0; i < items.length; i++) {
      const itemId = items[i].getId();
      const itemData = items[i].getItemData();
      const itemMeta = items[i].getItemMeta();

      // 匹配分区头
      if (creatingFolderAt === '.dogear/articles' && itemId === ARTICLES_SECTION_ID) {
        parentIndex = i;
        parentLevel = itemMeta.level;
        break;
      }
      if (creatingFolderAt === '.' && itemId === FILES_SECTION_ID) {
        parentIndex = i;
        parentLevel = itemMeta.level;
        break;
      }
      // 匹配具体文件夹路径
      if (itemData.originalNode?.path === creatingFolderAt && itemData.isFolder) {
        parentIndex = i;
        parentLevel = itemMeta.level;
        break;
      }
    }

    if (parentIndex === -1) return null;

    // 找到父节点最后一个子节点的位置（往后找，直到 level <= parentLevel）
    let insertAfterIndex = parentIndex;
    for (let i = parentIndex + 1; i < items.length; i++) {
      if (items[i].getItemMeta().level <= parentLevel) break;
      insertAfterIndex = i;
    }

    return {
      insertAfterIndex,
      indent: (parentLevel + 1) * 16 + 8,
    };
  }, [creatingFolderAt, items]);

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
      <ScrollArea ref={scrollAreaRef} className="flex-1 overflow-hidden">
        <div {...tree.getContainerProps('工作区文件树')}>
          {items.map((item, index) => (
            <React.Fragment key={item.getId()}>
              <TreeItemRow
                item={item}
                articleCount={articleCount}
                fileCount={fileCount}
                onSetCreatingFolder={handleSetCreatingFolder}
              />
              {/* 在正确位置插入新建文件夹输入框 */}
              {newFolderInsertInfo && index === newFolderInsertInfo.insertAfterIndex && (
                <NewFolderInput
                  indent={newFolderInsertInfo.indent}
                  onConfirm={async (name) => {
                    await createFolder(creatingFolderAt!, name);
                    setCreatingFolderAt(null);
                  }}
                  onCancel={() => setCreatingFolderAt(null)}
                />
              )}
            </React.Fragment>
          ))}

          {/* 拖拽线 */}
          <div
            style={tree.getDragLineStyle()}
            className="h-[2px] bg-blue-500 rounded pointer-events-none"
          />
        </div>

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
      </ScrollArea>
    </div>
  );
}
