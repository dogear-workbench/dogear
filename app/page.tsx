'use client';

import { useState, useCallback, useEffect } from 'react';
import { WorkspaceSelector } from '@/components/workspace-selector';
import { BookConversationList, type BookNode, type Conversation } from '@/components/BookConversationList';
import { AgentChat } from '@/components/AgentChat';
import { Button } from '@/components/ui/button';
import { FolderOpen, RefreshCw, Loader2, File as FileIcon, Plus, Activity, Trash2, Brain, CheckCircle2, XCircle, Sparkles, ExternalLink } from 'lucide-react';
import type { Workspace, WorkspaceFileNode } from '@/types/electron-api';
import type { Book } from '@/types';

// 分析进度状态类型
interface AnalysisProgress {
  status: 'idle' | 'analyzing' | 'completed' | 'failed';
  taskId?: string;
  currentTool?: string;
  message?: string;
  chapterCount?: number;
  currentChapter?: string;
  error?: string;
}

export default function Home() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [files, setFiles] = useState<WorkspaceFileNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<WorkspaceFileNode | null>(null);
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [importing, setImporting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 工作区文件路径状态
  const [workspaceFilePath, setWorkspaceFilePath] = useState<string | null>(null);

  // 分析相关状态
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress>({ status: 'idle' });

  // 对话相关状态 (v3 新增)
  const [bookNodes, setBookNodes] = useState<BookNode[]>([]);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const [loadingConversations, setLoadingConversations] = useState(false);

  // 当工作区选中后加载文件列表
  useEffect(() => {
    if (workspace) {
      loadWorkspaceFiles();
    }
  }, [workspace]);

  // 加载书籍和对话数据
  const loadBooksWithConversations = async () => {
    if (!workspace) return;

    try {
      setLoadingConversations(true);
      const result = await window.electronAPI.conversations.getBooksWithConversations(workspace.id);

      if (result.error) {
        console.error('加载对话列表失败:', result.error);
        return;
      }

      setBookNodes(result.booksWithConversations);
    } catch (error) {
      console.error('加载对话列表失败:', error);
    } finally {
      setLoadingConversations(false);
    }
  };

  // 当工作区选中后加载对话列表
  useEffect(() => {
    if (workspace) {
      loadBooksWithConversations();
    }
  }, [workspace]);

  const loadWorkspaceFiles = async () => {
    if (!workspace) return;

    try {
      setLoadingFiles(true);
      const result = await window.electronAPI.workspace.getFiles(workspace.id);
      if (result.files) {
        setFiles(result.files);
      }
    } catch (error) {
      console.error('加载工作区文件失败:', error);
    } finally {
      setLoadingFiles(false);
    }
  };

  const handleWorkspaceSelected = (selectedWorkspace: Workspace) => {
    setWorkspace(selectedWorkspace);
  };

  const handleFileSelect = useCallback(async (file: WorkspaceFileNode) => {
    setSelectedFile(file);
    setWorkspaceFilePath(null);
    // 加载对应的书籍信息
    try {
      // 如果文件节点有 bookId 属性（已导入的书籍），优先使用 bookId
      const bookId = (file as any).bookId;
      if (bookId) {
        const book = await window.electronAPI.book.getBookByFilePath(bookId);
        setSelectedBook(book || null);
        // 获取工作区中的文件路径
        if (book) {
          const pathResult = await window.electronAPI.book.getWorkspaceFilePath(bookId);
          if (pathResult.path) {
            setWorkspaceFilePath(pathResult.path);
          }
        }
      } else {
        setSelectedBook(null);
      }
    } catch (error) {
      console.error('获取书籍信息失败:', error);
      setSelectedBook(null);
    }
  }, []);

  const handleRefreshFiles = () => {
    loadWorkspaceFiles();
  };

  // 导入书籍
  const handleImport = async () => {
    if (!workspace) return;

    try {
      setImporting(true);
      const filePath = await window.electronAPI.file.selectFile();
      if (filePath) {
        // 传递当前工作区 ID
        await window.electronAPI.file.importBook(filePath, workspace.id);
        // 导入成功后同时刷新文件列表和书籍对话列表
        loadWorkspaceFiles();
        loadBooksWithConversations();
      }
    } catch (error) {
      console.error('导入失败:', error);
      alert(`导入失败: ${(error as Error).message}`);
    } finally {
      setImporting(false);
    }
  };

  // 打开 Agent 监控窗口
  const handleOpenMonitor = async () => {
    try {
      await window.electronAPI.agent.openMonitorWindow();
    } catch (error) {
      console.error('打开监控窗口失败:', error);
    }
  };

  // 删除书籍
  const handleDeleteBook = async () => {
    if (!selectedBook || !selectedBook.id) return;

    if (!confirm(`确定要删除《${selectedBook.title}》吗？此操作不可恢复。`)) {
      return;
    }

    try {
      setDeleting(true);
      await window.electronAPI.db.deleteBook(selectedBook.id);
      // 删除成功后清除选择并刷新
      setSelectedBook(null);
      setSelectedFile(null);
      loadWorkspaceFiles();
    } catch (error) {
      console.error('删除失败:', error);
      alert(`删除失败: ${(error as Error).message}`);
    } finally {
      setDeleting(false);
    }
  };

  // 开始分析书籍
  const handleAnalyzeBook = async () => {
    if (!selectedBook?.id) return;

    try {
      setAnalyzing(true);
      setAnalysisProgress({ status: 'analyzing' });

      // 启动分析
      const result = await window.electronAPI.book.analyze(selectedBook.id);

      if (result.error) {
        setAnalysisProgress({ status: 'failed', error: result.error });
        setAnalyzing(false);
        return;
      }

      if (result.taskId) {
        setAnalysisProgress(prev => ({ ...prev, taskId: result.taskId }));

        // 注册分析进度监听
        const unsubscribe = window.electronAPI.book.onAnalysisUpdate((data) => {
          if (data.bookId === selectedBook.id) {
            setAnalysisProgress(prev => ({
              ...prev,
              currentTool: data.toolName,
              message: data.message || data.statusMessage,
              currentChapter: data.chapterTitle,
            }));

            // 检查是否完成
            if (data.status === 'completed') {
              setAnalysisProgress({ status: 'completed' });
              setAnalyzing(false);
              // 刷新书籍信息（非异步）
              window.electronAPI.book.getBookByFilePath(selectedBook.id).then((updatedBook) => {
                setSelectedBook(updatedBook || null);
              });
              unsubscribe();
            } else if (data.error) {
              setAnalysisProgress({ status: 'failed', error: data.error });
              setAnalyzing(false);
              unsubscribe();
            }
          }
        });

        // 保存取消订阅函数到状态中，以便组件卸载时清理
        (window as any).__analysisUnsubscribe = unsubscribe;
      }
    } catch (error) {
      console.error('启动分析失败:', error);
      setAnalysisProgress({ status: 'failed', error: (error as Error).message });
      setAnalyzing(false);
    }
  };

  // 清理监听器
  useEffect(() => {
    return () => {
      if ((window as any).__analysisUnsubscribe) {
        (window as any).__analysisUnsubscribe();
        delete (window as any).__analysisUnsubscribe;
      }
    };
  }, []);

  // 重置分析进度当切换书籍时
  useEffect(() => {
    if (selectedBook) {
      // 如果书籍已分析，显示已完成状态
      if (selectedBook.analysis_status === 'analyzed') {
        setAnalysisProgress({ status: 'completed' });
      } else if (selectedBook.analysis_status === 'analyzing') {
        setAnalysisProgress({ status: 'analyzing' });
        setAnalyzing(true);
      } else {
        setAnalysisProgress({ status: 'idle' });
        setAnalyzing(false);
      }
    } else {
      setAnalysisProgress({ status: 'idle' });
      setAnalyzing(false);
    }
  }, [selectedBook?.id]);

  // 打开文件所在目录
  const handleOpenInFolder = async () => {
    if (!selectedBook?.id) return;
    try {
      await window.electronAPI.book.openInFolder(selectedBook.id);
    } catch (error) {
      console.error('打开文件失败:', error);
    }
  };

  // ==================== 对话相关处理函数 (v3 新增) ====================

  // 处理对话选择
  const handleConversationSelect = useCallback(async (conversation: Conversation) => {
    setSelectedConversation(conversation);

    // 加载对应的书籍信息
    try {
      const book = await window.electronAPI.book.getBookByFilePath(conversation.book_id);
      setSelectedBook(book || null);
    } catch (error) {
      console.error('获取书籍信息失败:', error);
    }
  }, []);

  // 处理新增对话
  const handleNewConversation = async (bookId: string) => {
    try {
      const result = await window.electronAPI.conversations.create(bookId);

      if (result.error || !result.conversationId) {
        alert(`创建对话失败: ${result.error || '未知错误'}`);
        return;
      }

      // 重新加载对话列表
      await loadBooksWithConversations();

      // 选中新创建的对话
      const newConversation = await window.electronAPI.conversations.getById(result.conversationId);
      if (newConversation.conversation) {
        handleConversationSelect(newConversation.conversation);
      }
    } catch (error) {
      console.error('创建对话失败:', error);
      alert(`创建对话失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // 处理删除对话
  const handleDeleteConversation = async (conversationId: string) => {
    if (!confirm('确定要删除这个对话吗？此操作不可恢复。')) {
      return;
    }

    try {
      const result = await window.electronAPI.conversations.delete(conversationId);

      if (result.error) {
        alert(`删除失败: ${result.error}`);
        return;
      }

      // 如果删除的是当前选中的对话，清除选中状态
      if (selectedConversation?.id === conversationId) {
        setSelectedConversation(null);
      }

      // 重新加载对话列表
      await loadBooksWithConversations();
    } catch (error) {
      console.error('删除对话失败:', error);
      alert(`删除失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // 处理消息更新（当有新消息保存时）
  const handleMessagesUpdate = useCallback(async () => {
    // 重新加载对话列表以更新时间戳
    await loadBooksWithConversations();
  }, []);

  // 如果没有工作区，显示工作区选择界面
  if (!workspace) {
    return <WorkspaceSelector onWorkspaceSelected={handleWorkspaceSelected} />;
  }

  return (
    <main className="h-screen flex flex-col">
      {/* 顶部导航栏 */}
      <header className="h-12 border-b flex items-center justify-between px-4 bg-background">
        <div className="flex items-center gap-4">
          <h1 className="font-semibold">Dogear</h1>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <FolderOpen className="w-4 h-4" />
            <span>{workspace.name}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleOpenMonitor}>
            <Activity className="w-4 h-4 mr-2" />
            Agent 监控
          </Button>
          <Button variant="outline" size="sm" onClick={handleRefreshFiles} disabled={loadingFiles}>
            {loadingFiles ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
          </Button>
          <Button size="sm" onClick={handleImport} disabled={importing}>
            <Plus className="w-4 h-4 mr-2" />
            {importing ? '导入中...' : '导入书籍'}
          </Button>
        </div>
      </header>

      {/* 主内容区域：三栏布局 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧：书籍列表 */}
        <aside className="w-64 border-r bg-muted/30 flex flex-col">
          <div className="p-3 border-b">
            <h2 className="text-sm font-semibold">书籍列表</h2>
          </div>
          <div className="flex-1 overflow-hidden">
            {loadingConversations ? (
              <div className="h-full flex items-center justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <BookConversationList
                books={bookNodes}
                selectedConversationId={selectedConversation?.id || null}
                onConversationSelect={handleConversationSelect}
                onNewConversation={handleNewConversation}
                onDeleteConversation={handleDeleteConversation}
                loading={loadingConversations}
              />
            )}
          </div>
        </aside>

        {/* 中间：对话窗口 */}
        <section className="flex-1 flex flex-col min-w-0">
          <div className="p-3 border-b">
            <h2 className="text-sm font-semibold">AI 助手</h2>
          </div>
          <div className="flex-1 overflow-hidden">
            <AgentChat
              context={{
                bookId: selectedBook?.id,
                chapterId: undefined,
                selectedText: undefined,
              }}
              conversationId={selectedConversation?.id || null}
              onMessagesUpdate={handleMessagesUpdate}
              placeholder="我可以帮你分析书籍内容、回答问题..."
              showStatusHint={false}
            />
          </div>
        </section>

        {/* 右侧：书籍预览 */}
        <aside className="w-96 border-l flex flex-col bg-background">
          <div className="p-3 border-b flex items-center justify-between">
            <h2 className="text-sm font-semibold">书籍预览</h2>
            {selectedBook && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleDeleteBook}
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
          <div className="flex-1 overflow-y-auto p-4">
            {selectedFile ? (
              <div className="space-y-4">
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
                            onClick={handleOpenInFolder}
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
                          onClick={handleAnalyzeBook}
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
                          onClick={handleAnalyzeBook}
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
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <FileIcon className="w-12 h-12 mb-4 opacity-50" />
                <p className="text-sm text-center">从左侧选择一本书籍</p>
                <p className="text-xs mt-1">预览内容和分析结果</p>
              </div>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

