/**
 * 工作区文件树主组件（拖放 / 快捷键 / 数据加载编排）
 */
import React, { useCallback, useMemo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { File, Folder, FolderPlus, Globe, RefreshCw, ChevronsDownUp } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';
import { PanelSearchBox } from '@/components/ui/search-dropdown';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useMarkdownPreviewStore } from '@/stores/markdown-preview-store';
import { useArticleStore } from '@/stores/article-store';
import { useGitHistoryStore } from '@/stores/git-history-store';
import { useDragAutoScroll } from '@/lib/use-drag-auto-scroll';
import type { WorkspaceSearchHit } from '@/types/electron-api';

import { useTree } from '@headless-tree/react';
import {
  asyncDataLoaderFeature,
  selectionFeature,
  hotkeysCoreFeature,
  dragAndDropFeature,
  renamingFeature,
  propMemoizationFeature,
} from '@headless-tree/core';
import type { ItemInstance, DragTarget, TreeInstance } from '@headless-tree/core';

import {
  buildNodeMap,
  buildArticleMeta,
  mergeDirChildren,
  isLazyDirectory,
  isArticlePath,
  ROOT_ID,
  UNTRACKED_GROUP_ID,
  TRACKED_GROUP_ID,
} from './workspace-explorer/tree-model';
import type { FlatNode } from './workspace-explorer/tree-model';
import { NewFolderInput, ArticleUrlInput, ImportArticleGuide } from './workspace-explorer/inline-inputs';
import { TreeItemRow } from './workspace-explorer/TreeItemRow';

export function WorkspaceExplorer() {
  // Store 状态
  const files = useWorkspaceStore(s => s.files);
  const dirChildren = useWorkspaceStore(s => s.dirChildren);
  const workspaceId = useWorkspaceStore(s => s.workspace?.id);
  const loadWorkspaceFiles = useWorkspaceStore(s => s.loadWorkspaceFiles);
  const reloadDir = useWorkspaceStore(s => s.reloadDir);
  const createFolder = useWorkspaceStore(s => s.createFolder);
  const renameItem = useWorkspaceStore(s => s.renameItem);
  const moveItem = useWorkspaceStore(s => s.moveItem);
  const loadingFiles = useWorkspaceStore(s => s.loadingFiles);
  const selectFile = useWorkspaceStore(s => s.selectFile);
  const creatingFolderAt = useWorkspaceStore(s => s.creatingFolderAt);
  const setCreatingFolderAt = useWorkspaceStore(s => s.setCreatingFolderAt);
  const selectArticle = useArticleStore(s => s.selectArticle);
  const showArticleUrlInput = useArticleStore(s => s.showArticleUrlInput);

  // 根层+已加载层合成完整树
  const mergedFiles = useMemo(() => mergeDirChildren(files, dirChildren), [files, dirChildren]);

  const { nodeMap, articleCount } = useMemo(() => buildNodeMap(mergedFiles), [mergedFiles]);
  // 用 ref 保持最新的 nodeMap 引用，供回调使用
  const nodeMapRef = useRef(nodeMap);
  nodeMapRef.current = nodeMap;
  const dirChildrenRef = useRef(dirChildren);
  dirChildrenRef.current = dirChildren;

  // 用 ref 保持最新的 store actions
  const moveItemRef = useRef(moveItem);
  moveItemRef.current = moveItem;
  const renameItemRef = useRef(renameItem);
  renameItemRef.current = renameItem;
  const reloadDirRef = useRef(reloadDir);
  reloadDirRef.current = reloadDir;
  const selectFileRef = useRef(selectFile);
  selectFileRef.current = selectFile;
  const selectArticleRef = useRef(selectArticle);
  selectArticleRef.current = selectArticle;
  const treeRef = useRef<TreeInstance<FlatNode> | null>(null);

  // 稳定的 dataLoader：已加载层从 nodeMap 同步返回；未加载的文件区目录先拉层再返回
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
    getChildrenWithData: async (itemId: string) => {
      let entry = nodeMapRef.current[itemId];
      if (!entry) return [];
      if (entry.childrenIds.length === 0 && isLazyDirectory(entry) && entry.originalNode) {
        const dirPath = entry.originalNode.path;
        try {
          await reloadDirRef.current(dirPath);
        } catch {
          // 拉层失败不向 headless-tree 抛（内部不 catch，会成 unhandled rejection）
        }
        entry = nodeMapRef.current[itemId];
        if (!entry) return [];
        // 拉取后仍无缓存（IPC 失败）：删 async loader 缓存避免空数组死缓存，下次展开重试
        if (entry.childrenIds.length === 0 && dirChildrenRef.current[dirPath] === undefined) {
          const cached = treeRef.current?.getDataRef<{ childrenIds: Record<string, string[]> }>();
          if (cached) delete cached.current.childrenIds[itemId];
        }
      }
      return entry.childrenIds
        .map(id => ({ id, data: nodeMapRef.current[id] }))
        .filter(d => !!d.data);
    },
  }), []);

  // 稳定的回调
  const handleDrop = useCallback((items: ItemInstance<FlatNode>[], target: DragTarget<FlatNode>) => {
    const targetItem = target.item;
    const targetData = targetItem.getItemData();
    const targetId = targetItem.getId();

    let targetPath: string | null = null;
    if (targetId === UNTRACKED_GROUP_ID || targetId === TRACKED_GROUP_ID) {
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

  // ---- 文件树搜索（下拉不碰树；文章库内 md 可搜到，点选时按路径识别文章模式） ----
  const [fileHits, setFileHits] = useState<{ results: WorkspaceSearchHit[]; total: number; truncated: boolean }>({ results: [], total: 0, truncated: false });
  const fileSearchAbortRef = useRef<AbortController | null>(null);
  const [highlightPath, setHighlightPath] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleFileQueryChange = useCallback((query: string) => {
    fileSearchAbortRef.current?.abort();
    if (query.trim() === '') {
      setFileHits({ results: [], total: 0, truncated: false });
      return;
    }
    const ws = useWorkspaceStore.getState().workspace;
    if (!ws) return;
    const controller = new AbortController();
    fileSearchAbortRef.current = controller;
    client.searchWorkspaceFiles({ workspaceId: ws.id, query, limit: 50 })
      .then((res) => {
        if (controller.signal.aborted) return;
        if ('error' in res) {
          setFileHits({ results: [], total: 0, truncated: false });
          return;
        }
        setFileHits({ results: res.results, total: res.total, truncated: res.truncated });
      })
      .catch(() => {});
  }, []);

  useEffect(() => () => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
  }, []);

  // 切工作区：清残留搜索结果与定位高亮，防下拉残留旧工作区条目
  useEffect(() => {
    setFileHits({ results: [], total: 0, truncated: false });
    setHighlightPath(null);
  }, [workspaceId]);

  const markHighlight = useCallback((path: string) => {
    setHighlightPath(path);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightPath(null), 2500);
  }, []);

  // 等目标节点进入 nodeMap（dirChildren 预拉 → React 渲染 → 镜像 effect 校准 dataRef，之后 expand 才安全）
  const waitForNode = useCallback((id: string): Promise<boolean> => {
    if (nodeMapRef.current[id]) return Promise.resolve(true);
    return new Promise((resolve) => {
      const start = Date.now();
      const timer = setInterval(() => {
        if (nodeMapRef.current[id] || Date.now() - start > 2000) {
          clearInterval(timer);
          resolve(!!nodeMapRef.current[id]);
        }
      }, 30);
    });
  }, []);

  // 搜索点选定位：祖先链逐层预拉+逐级展开+滚动居中+临时高亮；路径链与目录段一致
  const locateInTree = useCallback(async (targetPath: string, isDir: boolean) => {
    const chain: string[] = [];
    let prefix = '';
    for (const seg of targetPath.split('/').filter(Boolean)) {
      prefix = prefix ? `${prefix}/${seg}` : seg;
      chain.push(prefix);
    }
    const dirChain = isDir ? chain : chain.slice(0, -1);
    await Promise.all(dirChain.map(dir =>
      dirChildrenRef.current[dir] !== undefined ? null : reloadDirRef.current(dir).catch(() => {}),
    ));
    const targetId = chain[chain.length - 1];
    if (!targetId || !(await waitForNode(targetId))) return;
    for (const id of chain) {
      const item = treeRef.current?.getItemInstance(id);
      if (item && !item.isExpanded()) item.expand();
    }
    markHighlight(targetPath);
    const item = treeRef.current?.getItemInstance(targetId);
    if (item) {
      await Promise.race([
        item.scrollTo({ block: 'center' }),
        new Promise(resolve => setTimeout(resolve, 1500)),
      ]).catch(() => {});
    }
  }, [markHighlight, waitForNode]);

  // 搜索点选语义对齐树双击：文章库内 md 按路径识别文章模式（识别失败降级普通预览）、
  // 其他 .md→预览、其他→selectFile、目录→只定位；全部定位展开供建立上下文
  const handleSelectFileHit = useCallback((hit: WorkspaceSearchHit) => {
    if (hit.isDir) {
      void locateInTree(hit.path, true);
      return;
    }
    const dot = hit.name.lastIndexOf('.');
    const ext = dot > 0 ? hit.name.slice(dot).toLowerCase() : undefined;
    if (ext === '.md' || ext === '.markdown') {
      void openMdHit(hit);
    } else {
      selectFileRef.current({ name: hit.name, path: hit.path, type: 'file', ext });
    }
    void locateInTree(hit.path, false);
  }, [locateInTree]);

  const openMdHit = useCallback(async (hit: WorkspaceSearchHit) => {
    const ws = useWorkspaceStore.getState().workspace;
    if (!ws) return;
    if (isArticlePath(hit.path)) {
      try {
        const r = await client.getArticleByPath({ workspaceId: ws.id, relPath: hit.path });
        if (!r.error && r.article) {
          selectArticleRef.current({ ...r.article, title: r.article.title || hit.name, path: hit.path });
          return;
        }
      } catch {
        // 识别失败降级普通预览
      }
    }
    useMarkdownPreviewStore.getState().open(ws.id, hit.path, hit.name);
  }, []);

  const canDrag = useCallback((items: ItemInstance<FlatNode>[]) => {
    // 禁止拖拽分组头
    return items.every(i => i.getItemData().nodeType !== 'group-header');
  }, []);

  const canDrop = useCallback((items: ItemInstance<FlatNode>[], target: DragTarget<FlatNode>) => {
    const targetData = target.item.getItemData();
    const targetId = target.item.getId();

    // 虚拟根节点不可放置
    if (targetId === ROOT_ID) return false;

    // 分组头可作为放置目标（移到根层）
    if (targetData.nodeType === 'group-header') return true;

    // 禁止放到非文件夹上
    if (!targetData.isFolder) return false;

    for (const draggedItem of items) {
      const draggedId = draggedItem.getId();
      // 禁止拖入自身子级
      if (target.item.isDescendentOf(draggedId)) return false;
      // 禁止拖入自身
      if (draggedId === targetId) return false;
    }

    return true;
  }, []);

  const canRename = useCallback((item: ItemInstance<FlatNode>) => {
    return item.getItemData().nodeType !== 'group-header';
  }, []);

  // headless-tree 实例
  const tree = useTree<FlatNode>({
    rootItemId: ROOT_ID,
    dataLoader,
    indent: 16,
    features: [
      asyncDataLoaderFeature,
      selectionFeature,
      hotkeysCoreFeature,
      dragAndDropFeature,
      renamingFeature,
      propMemoizationFeature,
    ],
    openOnDropDelay: 800,
    initialState: {
      expandedItems: [UNTRACKED_GROUP_ID, TRACKED_GROUP_ID],
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
  treeRef.current = tree;

  // 整树收起=回根层（分组头保持展开）；已加载层缓存保留，再展开秒开
  const handleCollapseTree = useCallback(() => {
    tree.applySubStateUpdate('expandedItems', [UNTRACKED_GROUP_ID, TRACKED_GROUP_ID]);
    tree.rebuildTree();
  }, [tree]);

  // 滚动保持：ref 直接指向原生滚动容器
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  const pendingScrollTop = useRef<number | null>(null);
  const scrollRestoreTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getViewport = useCallback(() => scrollAreaRef.current, []);

  // 拖拽靠近边缘时自动滚动
  useDragAutoScroll(getViewport);

  // git 能力检测（有缓存，挂载时拉一次）：决定右键菜单「历史」入口是否渲染
  const checkGitAvailable = useGitHistoryStore(s => s.checkGitAvailable);
  useEffect(() => {
    void checkGitAvailable();
  }, [checkGitAvailable]);

  // 快照排除清单：右键排除/恢复走专用 IPC 仅落盘不广播，本地状态只能靠这里的主动拉取保持新鲜；
  // 设置页直改清单与恢复默认（restoreSnapshotDefaults 落盘后广播）经 settingsChanged 可跟上
  const [excludedPaths, setExcludedPaths] = useState<Set<string>>(new Set());

  const refreshExclusions = useCallback(async () => {
    const ws = useWorkspaceStore.getState().workspace;
    if (!ws) {
      setExcludedPaths(new Set());
      return;
    }
    const res = await client.getSnapshotExclusions({ workspaceId: ws.id });
    if ('paths' in res) setExcludedPaths(new Set(res.paths));
  }, []);

  useEffect(() => {
    void refreshExclusions();
  }, [workspaceId, refreshExclusions]);

  useEffect(() => {
    const unsub = rendererEvents.settingsChanged.listen(() => {
      void refreshExclusions();
    });
    return unsub;
  }, [refreshExclusions]);

  // 右键排除/恢复：树扫描不再消费排除清单，仅更新本地清单（EyeOff 标记与右键菜单态）
  const handleExcludeFolder = useCallback(async (path: string, name: string) => {
    const ws = useWorkspaceStore.getState().workspace;
    if (!ws) return;
    const res = await client.addSnapshotExcludedPath({ workspaceId: ws.id, relPath: path });
    if ('error' in res) {
      toast.error(res.error);
      return;
    }
    setExcludedPaths(new Set(res.paths));
    toast.success(`已排除 ${name} 的快照保护，右键该目录可恢复`);
  }, []);

  const handleRestoreFolder = useCallback(async (path: string, name: string) => {
    const ws = useWorkspaceStore.getState().workspace;
    if (!ws) return;
    const res = await client.removeSnapshotExcludedPath({ workspaceId: ws.id, relPath: path });
    if ('error' in res) {
      toast.error(res.error);
      return;
    }
    setExcludedPaths(new Set(res.paths));
    toast.success(`已恢复 ${name} 的快照保护`);
  }, []);

  // 重载全部已展开且已加载过的文件区目录（watcher 与手动刷新共用）
  const refreshExpandedDirs = useCallback(async () => {
    const targets = tree.getState().expandedItems.filter(id => {
      const entry = nodeMapRef.current[id];
      return !!entry && isLazyDirectory(entry) && dirChildrenRef.current[id] !== undefined;
    });
    await Promise.all(targets.map(id => reloadDirRef.current(id)));
  }, [tree]);

  useEffect(() => {
    const unsub = rendererEvents.workspaceFilesChanged.listen((data) => {
      const ws = useWorkspaceStore.getState().workspace;
      if (ws?.id !== data.workspaceId) return;
      void refreshExpandedDirs();
    });
    return unsub;
  }, [refreshExpandedDirs]);

  // 解析状态回写 frontmatter 不触发 watcher（change 事件被忽略）：广播到达时重扫已展开目录层，树行徽章实时跟上
  useEffect(() => {
    const unsub = rendererEvents.articleParseStatusChanged.listen((data) => {
      const ws = useWorkspaceStore.getState().workspace;
      if (ws?.id !== data.workspaceId) return;
      void refreshExpandedDirs();
    });
    return unsub;
  }, [refreshExpandedDirs]);

  // files/dirChildren 变化：校准 headless-tree async loader 的内部缓存（镜像 nodeMap + 清残留）后重建树
  useLayoutEffect(() => {
    pendingScrollTop.current = getViewport()?.scrollTop ?? 0;
    const dataRef = tree.getDataRef<{ itemData: Record<string, FlatNode>; childrenIds: Record<string, string[]> }>();
    // async loader 的 itemData/childrenIds 是库内惰性初始化字段，首挂载渲染零节点时尚未创建
    const itemData = dataRef.current.itemData ??= {};
    const childrenIds = dataRef.current.childrenIds ??= {};
    const validItems = new Set<string>();
    const validChildren = new Set<string>();
    for (const [id, entry] of Object.entries(nodeMapRef.current)) {
      itemData[id] = entry;
      validItems.add(id);
      // 未加载目录不写 childrenIds 缓存，留给 async loader 拉取；已加载空目录需显式写空数组避免反复拉
      const loaded = entry.childrenIds.length > 0 || !isLazyDirectory(entry) || dirChildrenRef.current[id] !== undefined;
      if (loaded) {
        childrenIds[id] = entry.childrenIds;
        validChildren.add(id);
      }
    }
    for (const id of Object.keys(itemData)) {
      if (!validItems.has(id)) delete itemData[id];
    }
    for (const id of Object.keys(childrenIds)) {
      if (!validChildren.has(id)) delete childrenIds[id];
    }
    tree.rebuildTree();
  }, [nodeMap, dirChildren, tree]);

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

  // 新建文件夹操作：展开目标文件夹并显示输入框（根层 '.' 无需展开）
  const handleSetCreatingFolder = useCallback((parentPath: string | null) => {
    if (parentPath === null) {
      setCreatingFolderAt(null);
      return;
    }
    for (const item of tree.getItems()) {
      const itemData = item.getItemData();
      if (itemData.originalNode?.path === parentPath && itemData.isFolder && !item.isExpanded()) {
        item.expand();
      }
    }
    setCreatingFolderAt(parentPath);
  }, [tree]);

  const handleRefresh = useCallback(() => {
    loadWorkspaceFiles();
    void refreshExpandedDirs();
  }, [loadWorkspaceFiles, refreshExpandedDirs]);

  // 获取所有可见项
  const items = tree.getItems();

  // 计算 NewFolderInput 的插入位置和缩进（根层 '.' → 树末尾；具体文件夹 → 最后一个子节点后）
  const newFolderInsertInfo = useMemo(() => {
    if (creatingFolderAt === null) return null;

    if (creatingFolderAt === '.') {
      return { insertAfterIndex: items.length - 1, indent: 8 };
    }

    // 查找目标父节点在扁平列表中的位置
    let parentIndex = -1;
    let parentLevel = 0;
    for (let i = 0; i < items.length; i++) {
      const itemData = items[i].getItemData();
      if (itemData.originalNode?.path === creatingFolderAt && itemData.isFolder) {
        parentIndex = i;
        parentLevel = items[i].getItemMeta().level;
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

  const newFolderInput = newFolderInsertInfo ? (
    <NewFolderInput
      indent={newFolderInsertInfo.indent}
      onConfirm={async (name) => {
        const parent = creatingFolderAt!;
        await createFolder(parent, name);
        setCreatingFolderAt(null);
      }}
      onCancel={() => setCreatingFolderAt(null)}
    />
  ) : null;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* 工具栏 */}
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <span className="text-sm font-medium">工作区</span>
        <div className="flex items-center gap-1">
          <button
            className="p-1 rounded hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => handleSetCreatingFolder('.')}
            title="新建文件夹"
          >
            <FolderPlus className="w-4 h-4" />
          </button>
          <button
            className="p-1 rounded hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
            onClick={handleCollapseTree}
            title="收起全部"
          >
            <ChevronsDownUp className="w-4 h-4" />
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

      {/* 树头部：URL 导入框（临时位，任务面板接管后撤）与空库引导 */}
      {showArticleUrlInput ? (
        <div className="px-3 pt-2">
          <ArticleUrlInput indent={8} />
        </div>
      ) : articleCount === 0 && !loadingFiles ? (
        <div className="px-3 pt-2">
          <ImportArticleGuide indent={8} />
        </div>
      ) : null}

      {/* 搜索框（下拉结果不碰树；文章库内 md 可搜到，点选时按路径识别文章模式） */}
      <div className="px-3 py-1.5">
        <PanelSearchBox
          results={fileHits.results}
          total={fileHits.total}
          truncated={fileHits.truncated}
          onSelect={handleSelectFileHit}
          renderItem={(hit) => (
            <div className="flex items-center gap-2 px-2 py-1">
              {hit.isDir ? (
                <Folder className="w-4 h-4 shrink-0 text-blue-500" />
              ) : isArticlePath(hit.path) ? (
                <Globe className="w-4 h-4 shrink-0 text-green-500" />
              ) : (
                <File className="w-4 h-4 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{hit.name}</div>
                <div className="truncate text-xs text-muted-foreground">{hit.path}</div>
              </div>
            </div>
          )}
          getKey={(hit) => hit.path}
          placeholder="搜索文件"
          onQueryChange={handleFileQueryChange}
        />
      </div>

      {/* 可滚动的文件树区域 */}
      <div ref={scrollAreaRef} className="flex-1 min-h-0 overflow-y-auto">
        <div {...tree.getContainerProps('工作区文件树')}>
          {items.map((item, index) => (
            <React.Fragment key={item.getId()}>
              <TreeItemRow
                item={item}
                highlightPath={highlightPath}
                onSetCreatingFolder={handleSetCreatingFolder}
                excludedPaths={excludedPaths}
                onExcludeFolder={handleExcludeFolder}
                onRestoreFolder={handleRestoreFolder}
              />
              {/* 在正确位置插入新建文件夹输入框 */}
              {newFolderInput && index === newFolderInsertInfo!.insertAfterIndex && newFolderInput}
            </React.Fragment>
          ))}
          {/* 空树时的新建文件夹输入框兜底 */}
          {newFolderInput && items.length === 0 && newFolderInput}
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
      </div>
    </div>
  );
}
