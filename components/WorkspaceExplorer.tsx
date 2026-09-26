/**
 * 工作区文件树主组件（拖放 / 快捷键 / 数据加载编排）
 */
import React, { useCallback, useMemo, useEffect, useLayoutEffect, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useMarkdownPreviewStore } from '@/stores/markdown-preview-store';
import { useArticleStore } from '@/stores/article-store';
import { useGitHistoryStore } from '@/stores/git-history-store';
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

import {
  buildNodeMap,
  buildArticleMeta,
  isInArticleSection,
  isInFileSection,
  ROOT_ID,
  ARTICLES_SECTION_ID,
  FILES_SECTION_ID,
} from './workspace-explorer/tree-model';
import type { FlatNode } from './workspace-explorer/tree-model';
import { NewFolderInput, ArticleUrlInput, ImportArticleGuide } from './workspace-explorer/inline-inputs';
import { TreeItemRow } from './workspace-explorer/TreeItemRow';

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
  const showArticleUrlInput = useArticleStore(s => s.showArticleUrlInput);

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
    if (isOrderedDragTarget(target)) {
      // 有序拖放：拖到兄弟节点之间，target.item 是父节点
      const parentId = target.item.getId();
      let targetPath: string | null = null;
      if (parentId === ARTICLES_SECTION_ID) {
        targetPath = '.dogear/articles';
      } else if (parentId === FILES_SECTION_ID) {
        targetPath = '.';
      } else {
        targetPath = target.item.getItemData().originalNode?.path ?? null;
      }
      if (!targetPath) return;

      // 文章区传 targetIndex 支持自定义排序，文件区不传（文件系统不支持排序）
      const isArticle = targetPath.startsWith('.dogear/articles');
      for (const draggedItem of items) {
        const draggedData = draggedItem.getItemData();
        if (draggedData.originalNode) {
          moveItemRef.current(
            draggedData.originalNode.path,
            targetPath,
            isArticle ? target.insertionIndex : undefined,
          );
        }
      }
      return;
    }

    // 无序拖放：直接拖到文件夹上
    const targetItem = target.item;
    const targetData = targetItem.getItemData();
    const targetId = targetItem.getId();

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
      const node = data.originalNode;
      const ext = node.ext?.toLowerCase();
      if (ext === '.md' || ext === '.markdown') {
        const ws = useWorkspaceStore.getState().workspace;
        if (ws) {
          useMarkdownPreviewStore.getState().open(ws.id, node.path, node.name);
          return;
        }
      }
      selectFileRef.current(node);
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

    // 有序拖放时 target.item 是父节点
    // 虚拟根节点不可放置（禁止在分区头之间排序）
    if (targetId === ROOT_ID) return false;

    // 分区头可以作为放置目标（代表分区内排序或移到分区顶层）
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
    canReorder: true,
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
  const getViewport = useCallback(
    () => scrollAreaRef.current?.querySelector('[data-slot="scroll-area-viewport"]') as HTMLElement | null,
    [],
  );

  // 拖拽靠近边缘时自动滚动
  useDragAutoScroll(getViewport);

  // git 能力检测（有缓存，挂载时拉一次）：决定右键菜单「历史」入口是否渲染
  const checkGitAvailable = useGitHistoryStore(s => s.checkGitAvailable);
  useEffect(() => {
    void checkGitAvailable();
  }, [checkGitAvailable]);

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
    <div className="flex flex-col flex-1 min-h-0">
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
              {/* 文章区头部下方：导入 URL 输入框 / 空态引导 */}
              {item.getId() === ARTICLES_SECTION_ID && (
                showArticleUrlInput ? (
                  <ArticleUrlInput indent={24} />
                ) : articleCount === 0 && !loadingFiles ? (
                  <ImportArticleGuide indent={24} />
                ) : null
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
