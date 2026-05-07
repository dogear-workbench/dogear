import { useEffect, useState } from 'react';
import { ConversationList } from '@/components/BookConversationList';
import { AgentChat } from '@/components/AgentChat';
import { client } from '@/lib/client';
import { rendererEvents } from '@/lib/events';
import { Button } from '@/components/ui/button';
import { RefreshCw, Loader2, File as FileIcon, Plus, Activity, Trash2, Brain, CheckCircle2, XCircle, Sparkles, ExternalLink, Globe, Settings, TrendingUp, MessageCircle, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { WorkspaceExplorer } from '@/components/WorkspaceExplorer';
import { ArticlePreview } from '@/components/ArticlePreview';
import { PromptSidebar } from '@/components/PromptSidebar';
import { SubAgentPanel } from '@/components/agent-chat/SubAgentPanel';
import { WechatDialog } from '@/components/wechat/WechatDialog';
import { WorkspaceTabBar } from '@/components/WorkspaceTabBar';
import { WorkspaceSwitcherPopover } from '@/components/WorkspaceSwitcherPopover';
import { WelcomeFirstRun } from '@/components/WelcomeFirstRun';
import { EmptyFocusState } from '@/components/EmptyFocusState';

// Zustand stores
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useArticleStore } from '@/stores/article-store';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useConversationStore } from '@/stores/conversation-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useSessionStore } from '@/stores/session-store';
import { useUIStore } from '@/stores/ui-store';

export default function Home() {
  const openSettings = useUIStore((s) => s.openSettings);
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel);
  const openRightPanel = useUIStore((s) => s.openRightPanel);
  const rightPanelTab = useUIStore((s) => s.rightPanelTab);
  const setRightPanelTab = useUIStore((s) => s.setRightPanelTab);
  const leftPanelTab = useUIStore((s) => s.leftPanelTab);
  const setLeftPanelTab = useUIStore((s) => s.setLeftPanelTab);
  const leftPanelOpen = useUIStore((s) => s.leftPanelOpen);
  const toggleLeftPanel = useUIStore((s) => s.toggleLeftPanel);

  // 应用启动时加载设置
  const settingsLoaded = useSettingsStore((s) => s.loaded);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  useEffect(() => {
    if (!settingsLoaded) {
      loadSettings();
    }
  }, [settingsLoaded, loadSettings]);

  // 工作区状态
  const workspace = useWorkspaceStore((s) => s.workspace);
  const setWorkspace = useWorkspaceStore((s) => s.setWorkspace);
  const [loadingDefaultWs, setLoadingDefaultWs] = useState(true);
  // 总工作区数量（用于区分 "零工作区首次启动" vs "有工作区但未选" 两种场景）
  const [totalWorkspaceCount, setTotalWorkspaceCount] = useState<number | null>(null);

  // 启动时自动加载默认工作区
  useEffect(() => {
    if (!workspace) {
      (async () => {
        try {
          const [defaultWs, allResult] = await Promise.all([
            client.getDefault(),
            client.getAll(),
          ]);
          setTotalWorkspaceCount(allResult.workspaces?.length ?? 0);
          if (defaultWs) {
            setWorkspace(defaultWs);
          }
        } catch (err) {
          console.error(err);
        } finally {
          setLoadingDefaultWs(false);
        }
      })();
    } else {
      setLoadingDefaultWs(false);
    }
  }, []);
  const selectedFile = useWorkspaceStore((s) => s.selectedFile);
  const selectedBook = useWorkspaceStore((s) => s.selectedBook);
  const workspaceFilePath = useWorkspaceStore((s) => s.workspaceFilePath);
  const loadingFiles = useWorkspaceStore((s) => s.loadingFiles);
  const importing = useWorkspaceStore((s) => s.importing);
  const deleting = useWorkspaceStore((s) => s.deleting);
  const loadWorkspaceFiles = useWorkspaceStore((s) => s.loadWorkspaceFiles);
  const importBook = useWorkspaceStore((s) => s.importBook);
  const deleteBook = useWorkspaceStore((s) => s.deleteBook);
  const openBookInFolder = useWorkspaceStore((s) => s.openBookInFolder);
  const openMonitorWindow = useWorkspaceStore((s) => s.openMonitorWindow);
  const openStockWindow = useWorkspaceStore((s) => s.openStockWindow);
  const [wechatDialogOpen, setWechatDialogOpen] = useState(false);

  // 文章状态
  const selectedArticle = useArticleStore((s) => s.selectedArticle);
  const showArticleUrlInput = useArticleStore((s) => s.showArticleUrlInput);
  const articleUrlInput = useArticleStore((s) => s.articleUrlInput);
  const parsingArticle = useArticleStore((s) => s.parsingArticle);
  const showUrlInput = useArticleStore((s) => s.showUrlInput);
  const hideUrlInput = useArticleStore((s) => s.hideUrlInput);
  const setArticleUrlInput = useArticleStore((s) => s.setArticleUrlInput);
  const submitArticleUrl = useArticleStore((s) => s.submitArticleUrl);

  // 子代理列表的过滤由 SubAgentPanel 通过 sdkSessionId prop 完成

  // 选中文章或书籍时自动展开右侧预览面板
  useEffect(() => {
    if (selectedArticle || selectedBook) {
      openRightPanel();
    }
  }, [selectedArticle?.id, selectedBook?.id, openRightPanel]);

  // 多标签页状态（Tab 栏 UI 已抽取到 WorkspaceTabBar；这里只留内容区渲染需要的字段）
  const allTabs = useSessionStore((s) => s.tabs);
  const activeTabId = useSessionStore((s) => s.activeTabId);
  const openTab = useSessionStore((s) => s.openTab);
  const removeSessionWindow = useSessionStore((s) => s.removeSessionWindow);
  const sessionWindowIds = useSessionStore((s) => s.sessionWindowIds);

  // 监听独立窗口关闭事件，恢复 Tab 到主窗口
  // 独立窗口关闭时：主进程 detachByWebContentsId 释放独立窗口的 attachment，
  // 然后 removeSessionWindow 使标签页重新可见（AgentChat 一直挂载，attachment 一直在）
  useEffect(() => {
    const unsub = rendererEvents.sessionWindowClosed.listen((data) => {
      removeSessionWindow(data.conversationId);
      // 如果 allTabs 中不存在该 tab（用户在弹出前就关闭了标签页），重新打开
      const exists = useSessionStore.getState().tabs.some(t => t.conversationId === data.conversationId);
      if (!exists) {
        openTab(data.conversationId, data.title, data.workspaceId);
      }
    });
    return () => unsub();
  }, [openTab, removeSessionWindow]);

  // 分析状态
  const analyzing = useAnalysisStore((s) => s.analyzing);
  const analysisProgress = useAnalysisStore((s) => s.analysisProgress);
  const analyzeBook = useAnalysisStore((s) => s.analyzeBook);
  const resetForBook = useAnalysisStore((s) => s.resetForBook);
  const cleanupAnalysis = useAnalysisStore((s) => s.cleanup);

  // 切换书籍时重置分析状态
  useEffect(() => {
    resetForBook(selectedBook);
  }, [selectedBook?.id, resetForBook]);

  // 清理分析事件监听器
  useEffect(() => {
    return () => cleanupAnalysis();
  }, [cleanupAnalysis]);

  // 正在加载默认工作区时显示加载状态
  if (loadingDefaultWs) {
    return (
      <div className="h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // 无工作区时：
  // - 首次启动（没有任何工作区）→ 显示欢迎引导
  // - 有工作区但用户主动 "clearWorkspace"（清空默认）→ 同样走欢迎引导，
  //   让用户重新从 Popover 选择（A2.7 设置页的工作区管理 Tab 提供完整列表/删除/恢复）
  if (!workspace) {
    if (totalWorkspaceCount === 0) {
      return <WelcomeFirstRun />;
    }
    // 有历史工作区但当前未激活 → 简单提示并提供 Popover 入口
    return (
      <div className="h-screen flex items-center justify-center bg-muted/20">
        <div className="max-w-md w-full bg-background rounded-xl border shadow-lg p-8 space-y-4 text-center">
          <h2 className="text-lg font-semibold">请选择一个工作区继续</h2>
          <p className="text-sm text-muted-foreground">
            检测到 {totalWorkspaceCount ?? 0} 个已有工作区，点击下方选择。
          </p>
          <div className="flex justify-center">
            <WorkspaceSwitcherPopover />
          </div>
        </div>
      </div>
    );
  }

  return (
    <main className="h-screen flex flex-col">
      {/* 顶部导航栏 */}
      <header className="h-12 border-b flex items-center justify-between px-4 bg-background">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={toggleLeftPanel}
            title={leftPanelOpen ? '折叠左侧面板' : '展开左侧面板'}
          >
            {leftPanelOpen ? (
              <PanelLeftClose className="w-4 h-4" />
            ) : (
              <PanelLeftOpen className="w-4 h-4" />
            )}
          </Button>
          <h1 className="font-semibold">Dogear</h1>
          <WorkspaceSwitcherPopover />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={openSettings}>
            <Settings className="w-4 h-4 mr-2" />
            设置
          </Button>
          <Button variant="outline" size="sm" onClick={openMonitorWindow}>
            <Activity className="w-4 h-4 mr-2" />
            Agent 监控
          </Button>
          <Button variant="outline" size="sm" onClick={openStockWindow}>
            <TrendingUp className="w-4 h-4 mr-2" />
            自选股
          </Button>
          <Button variant="outline" size="sm" onClick={() => setWechatDialogOpen(true)}>
            <MessageCircle className="w-4 h-4 mr-2" />
            微信
          </Button>
          <Button variant="outline" size="sm" onClick={() => loadWorkspaceFiles()} disabled={loadingFiles}>
            {loadingFiles ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </Button>
          {showArticleUrlInput ? (
            <div className="flex items-center gap-1">
              <input
                type="url"
                className="h-8 px-2 text-sm border rounded bg-background w-64 focus:outline-none focus:ring-1 focus:ring-ring"
                placeholder="输入文章 URL..."
                value={articleUrlInput}
                onChange={(e) => setArticleUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitArticleUrl();
                  if (e.key === 'Escape') hideUrlInput();
                }}
                disabled={parsingArticle}
                autoFocus
              />
              <Button size="sm" onClick={submitArticleUrl} disabled={parsingArticle || !articleUrlInput.trim()}>
                {parsingArticle ? <Loader2 className="w-4 h-4 animate-spin" /> : '解析'}
              </Button>
              <Button size="sm" variant="ghost" onClick={hideUrlInput} disabled={parsingArticle}>
                取消
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={showUrlInput}>
              <Globe className="w-4 h-4 mr-2" />
              导入文章
            </Button>
          )}
          <Button size="sm" onClick={importBook} disabled={importing}>
            <Plus className="w-4 h-4 mr-2" />
            {importing ? '导入中...' : '导入书籍'}
          </Button>
        </div>
      </header>

      {/* 主内容区域：三栏布局 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧：Tab 分页（对话列表 / 文件树），可折叠（里程碑 1.5 Step A2.5） */}
        <aside
          className={cn(
            'border-r bg-muted/30 flex flex-col transition-all duration-200 overflow-hidden',
            leftPanelOpen ? 'w-64' : 'w-0 border-r-0',
          )}
        >
          {/* Tab 切换栏 */}
          <div className="flex border-b flex-shrink-0">
            <button
              onClick={() => setLeftPanelTab('conversations')}
              className={`flex-1 py-2 text-xs font-medium text-center transition-colors ${
                leftPanelTab === 'conversations'
                  ? 'text-foreground border-b-2 border-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              对话
            </button>
            <button
              onClick={() => setLeftPanelTab('explorer')}
              className={`flex-1 py-2 text-xs font-medium text-center transition-colors ${
                leftPanelTab === 'explorer'
                  ? 'text-foreground border-b-2 border-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              文件
            </button>
          </div>

          {/* Tab 内容 */}
          <div className="flex-1 overflow-hidden">
            {leftPanelTab === 'conversations' ? (
              <ConversationList />
            ) : (
              <WorkspaceExplorer />
            )}
          </div>
        </aside>

        {/* 中间：对话窗口 */}
        <section className="flex-1 flex flex-col min-w-0">
          {/* 标签页头（抽取为独立组件：里程碑 1.5 Step A2.3） */}
          <WorkspaceTabBar />

          {/* 标签页内容：用 allTabs 渲染以保持 AgentChat 挂载（弹出到独立窗口期间 display:none 但不卸载，sessionWindowReady 后才 closeTab 卸载） */}
          {allTabs.length > 0 ? (
            <div className="flex-1 overflow-hidden relative">
              {allTabs.map((tab) => (
                <div
                  key={tab.conversationId}
                  className="absolute inset-0"
                  style={{ display: activeTabId === tab.conversationId && !sessionWindowIds.has(tab.conversationId) ? 'block' : 'none' }}
                >
                  <AgentChat
                    placeholder="我可以帮你分析书籍内容、回答问题..."
                    showStatusHint={false}
                    conversationIdOverride={tab.conversationId}
                    rightPanelToggle={{ open: rightPanelOpen, onToggle: toggleRightPanel }}
                  />
                </div>
              ))}
            </div>
          ) : (
            <EmptyFocusState />
          )}
        </section>

        {/* 右侧：预览（书籍/文章）+ 子代理面板，通过 tab 切换 */}
        <aside className={cn(
          "border-l flex flex-col bg-background transition-all duration-200 overflow-hidden",
          rightPanelOpen ? 'w-96' : 'w-0 border-l-0'
        )}>
          {/* Tab 切换栏 */}
          <div className="flex border-b shrink-0">
            <button
              onClick={() => setRightPanelTab('preview')}
              className={cn(
                'flex-1 px-3 py-2 text-xs font-medium transition-colors',
                rightPanelTab === 'preview'
                  ? 'border-b-2 border-primary text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              预览
            </button>
            <button
              onClick={() => setRightPanelTab('subagents')}
              className={cn(
                'flex-1 px-3 py-2 text-xs font-medium transition-colors',
                rightPanelTab === 'subagents'
                  ? 'border-b-2 border-primary text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              子代理
            </button>
          </div>

          {/* Tab 内容 */}
          {rightPanelTab === 'subagents' ? (
            /* 子代理列表面板 */
            <SubAgentPanel conversationId={activeTabId || undefined} />
          ) : (
            /* 原有的预览内容 */
            <>
              <div className="p-3 border-b flex items-center justify-between">
                <h2 className="text-sm font-semibold">
                  {selectedArticle ? '文章预览' : '书籍预览'}
                </h2>
                {selectedBook && !selectedArticle && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={deleteBook}
                    disabled={deleting}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    {deleting ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </Button>
                )}
              </div>
              <ScrollArea className="flex-1 overflow-hidden">
                {/* 文章预览模式 */}
                {selectedArticle ? (
                  <ArticlePreview />
                ) : selectedFile ? (
                  <div className="p-4 space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-16 bg-muted rounded flex items-center justify-center">
                        <span className="text-xs text-muted-foreground">{selectedFile.ext?.slice(1).toUpperCase()}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium truncate">{selectedFile.name}</h3>
                        <p className="text-sm text-muted-foreground truncate">{selectedFile.path}</p>
                      </div>
                    </div>

                    {selectedBook ? (
                      <div className="pt-4 border-t space-y-3">
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">书名</p>
                          <p className="text-sm font-medium">{selectedBook.title}</p>
                        </div>
                        {selectedBook.author && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">作者</p>
                            <p className="text-sm">{selectedBook.author}</p>
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">章节数</p>
                            <p className="text-sm">{selectedBook.total_chapters || 0}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">字符数</p>
                            <p className="text-sm">{(selectedBook.total_characters || 0).toLocaleString()}</p>
                          </div>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">状态</p>
                          <p className="text-sm">
                            {selectedBook.processing_status === 'completed' ? (
                              <span className="text-green-600">已处理</span>
                            ) : selectedBook.processing_status === 'processing' ? (
                              <span className="text-yellow-600">处理中...</span>
                            ) : selectedBook.processing_status === 'failed' ? (
                              <span className="text-red-600">处理失败</span>
                            ) : (
                              <span className="text-muted-foreground">未处理</span>
                            )}
                          </p>
                        </div>

                        {/* 工作区文件路径 */}
                        {workspaceFilePath && (
                          <div>
                            <p className="text-xs text-muted-foreground mb-1">文件路径</p>
                            <div className="flex items-center gap-2">
                              <p className="text-xs text-muted-foreground flex-1 truncate" title={workspaceFilePath}>{workspaceFilePath}</p>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2"
                                onClick={openBookInFolder}
                                title="在文件系统中打开"
                              >
                                <ExternalLink className="w-3 h-3" />
                              </Button>
                            </div>
                          </div>
                        )}

                        {/* AI 分析区域 */}
                        <div className="pt-3 border-t space-y-3">
                          <div className="flex items-center justify-between">
                            <p className="text-xs text-muted-foreground">AI 分析</p>
                            {analysisProgress.status === 'completed' ? (
                              <CheckCircle2 className="w-4 h-4 text-green-600" />
                            ) : analysisProgress.status === 'failed' ? (
                              <XCircle className="w-4 h-4 text-red-600" />
                            ) : analyzing ? (
                              <Loader2 className="w-4 h-4 text-blue-600 animate-spin" />
                            ) : null}
                          </div>

                          {/* 分析进度显示 */}
                          {analyzing && (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                <Brain className="w-3 h-3 text-blue-500" />
                                <span>正在分析...</span>
                              </div>
                              {analysisProgress.currentTool && (
                                <div className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1">
                                  执行: {analysisProgress.currentTool}
                                </div>
                              )}
                              {analysisProgress.currentChapter && (
                                <div className="text-xs text-blue-600 bg-blue-50 dark:bg-blue-950/30 rounded px-2 py-1">
                                  章节: {analysisProgress.currentChapter}
                                </div>
                              )}
                              {analysisProgress.message && (
                                <div className="text-xs text-muted-foreground truncate">
                                  {analysisProgress.message}
                                </div>
                              )}
                            </div>
                          )}

                          {/* 分析完成显示 */}
                          {analysisProgress.status === 'completed' && !analyzing && (
                            <div className="text-xs text-green-600 bg-green-50 dark:bg-green-950/30 rounded px-2 py-1.5">
                              分析完成！可以基于分析结果进行问答
                            </div>
                          )}

                          {/* 分析失败显示 */}
                          {analysisProgress.status === 'failed' && (
                            <div className="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 rounded px-2 py-1.5">
                              分析失败: {analysisProgress.error || '未知错误'}
                            </div>
                          )}

                          {/* 分析按钮 */}
                          {!analyzing && analysisProgress.status !== 'completed' && (
                            <Button
                              size="sm"
                              onClick={() => selectedBook?.id && analyzeBook(selectedBook.id)}
                              disabled={!selectedBook || selectedBook.processing_status !== 'completed'}
                              className="w-full"
                            >
                              <Sparkles className="w-4 h-4 mr-2" />
                              开始 AI 分析
                            </Button>
                          )}

                          {/* 重新分析按钮 */}
                          {!analyzing && analysisProgress.status === 'completed' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => selectedBook?.id && analyzeBook(selectedBook.id)}
                              className="w-full"
                            >
                              <RefreshCw className="w-4 h-4 mr-2" />
                              重新分析
                            </Button>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="pt-4 border-t">
                        <p className="text-sm text-muted-foreground mb-3">
                          该文件尚未导入到数据库。
                        </p>
                        <Button size="sm" variant="outline" onClick={() => {/* TODO: 导入该文件 */}}>
                          导入书籍
                        </Button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-4">
                    <FileIcon className="w-12 h-12 mb-4 opacity-50" />
                    <p className="text-sm text-center">导入书籍或文章后可在此预览</p>
                    <p className="text-xs mt-1">选择左侧文章或书籍查看详情</p>
                  </div>
                )}
              </ScrollArea>
            </>
          )}
        </aside>
      </div>

      {/* 系统提示侧边栏 */}
      <PromptSidebar />

      {/* 微信 Bot 控制 Dialog */}
      <WechatDialog open={wechatDialogOpen} onOpenChange={setWechatDialogOpen} />
    </main>
  );
}
