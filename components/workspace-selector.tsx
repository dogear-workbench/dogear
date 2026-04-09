
import { toast } from 'sonner';
import { client } from '@/lib/client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { FolderOpen, Home, Loader2, Plus, Trash2, Import, X } from 'lucide-react';
import { showConfirm } from '@/stores/confirm-store';
import type { Workspace } from '@/types/electron-api';
import { useWorkspaceStore } from '@/stores/workspace-store';

interface OrphanWorkspace {
  id: string;
  sourceName?: string;
  sourcePath?: string;
  conversationCount: number;
  sampleTitles: string[];
  lastUpdated: string | null;
}

export function WorkspaceSelector() {
  const setWorkspaceToStore = useWorkspaceStore((s) => s.setWorkspace);
  const [loading, setLoading] = useState(true);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null);
  const [showRecovery, setShowRecovery] = useState(false);
  const [orphans, setOrphans] = useState<OrphanWorkspace[]>([]);
  const [scanningOrphans, setScanningOrphans] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);

  useEffect(() => {
    loadWorkspaces();
  }, []);

  // 加载所有工作区列表
  const loadWorkspaces = async () => {
    try {
      setLoading(true);
      const result = await client.getAll();
      const list = result.workspaces ?? [];
      setWorkspaces(list);
      if (list.length > 0) {
        // 默认选中第一个工作区
        setSelectedWorkspace(list[0]);
      } else {
        setSelectedWorkspace(null);
      }
    } catch (error) {
      console.error('加载工作区列表失败:', error);
    } finally {
      setLoading(false);
    }
  };

  // 选择新文件夹创建工作区
  const handleSelectFolder = async () => {
    try {
      const result = await client.selectFolder();
      if (result.workspace && !result.canceled) {
        const { path: folderPath } = result.workspace;
        // 校验路径：不能含中文字符或下划线（SDK 会将其处理成连字符）
        if (/[\u4e00-\u9fa5_]/.test(folderPath)) {
          toast.warning('路径包含不支持的字符', {
            description: '工作区路径不能包含中文或下划线（_），SDK 会将其转换为连字符导致识别异常，请选择其他文件夹。',
            duration: 6000,
          });
          return;
        }
        // 重新加载工作区列表
        await loadWorkspaces();
        setSelectedWorkspace(result.workspace);
      }
    } catch (error) {
      console.error('选择工作区失败:', error);
      toast.error('选择工作区失败', { description: (error as Error).message });
    }
  };

  // 选择工作区
  const handleSelectWorkspace = (workspace: Workspace) => {
    setSelectedWorkspace(workspace);
  };

  // 删除工作区
  const handleDeleteWorkspace = async (workspace: Workspace, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!await showConfirm('删除工作区', `确定要移除工作区「${workspace.name}」吗？（不会删除文件夹内容）`)) return;
    try {
      await client.deleteWorkspace({ workspaceId: workspace.id });
      if (selectedWorkspace?.id === workspace.id) {
        setSelectedWorkspace(null);
      }
      await loadWorkspaces();
    } catch (error) {
      toast.error('删除工作区失败', { description: (error as Error).message });
    }
  };

  // 扫描孤儿工作区
  const handleScanOrphans = async () => {
    setScanningOrphans(true);
    try {
      const result = await client.scanOrphanWorkspaces();
      setOrphans(result as OrphanWorkspace[]);
      setShowRecovery(true);
    } catch (error) {
      toast.error('扫描失败', { description: (error as Error).message });
    } finally {
      setScanningOrphans(false);
    }
  };

  // 导入孤儿工作区的会话到当前选中的工作区
  const handleImportOrphan = async (orphan: OrphanWorkspace) => {
    if (!selectedWorkspace) {
      toast.error('请先选择一个目标工作区');
      return;
    }
    setImportingId(orphan.id);
    try {
      const result = await client.importOrphanWorkspace({
        orphanId: orphan.id,
        targetWorkspaceId: selectedWorkspace.id,
        deleteAfterImport: true,
      }) as { importedCount: number };
      toast.success(`已导入 ${result.importedCount} 个会话到「${selectedWorkspace.name}」`);
      setOrphans(prev => prev.filter(o => o.id !== orphan.id));
      if (orphans.length <= 1) setShowRecovery(false);
    } catch (error) {
      toast.error('导入失败', { description: (error as Error).message });
    } finally {
      setImportingId(null);
    }
  };

  // 进入选中的工作区
  const handleEnterWorkspace = () => {
    if (selectedWorkspace) {
      setWorkspaceToStore(selectedWorkspace);
    }
  };

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-8 h-8 mx-auto animate-spin" />
          <div className="text-muted-foreground">正在检查工作区...</div>
        </div>
      </div>
    );
  }

  // 没有任何工作区
  if (workspaces.length === 0) {
    return (
      <div className="h-screen flex items-center justify-center">
        <div className="text-center space-y-6 max-w-md">
          <div className="w-16 h-16 mx-auto bg-primary/10 rounded-full flex items-center justify-center">
            <FolderOpen className="w-8 h-8 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-semibold mb-2">欢迎使用 Dogear</h2>
            <p className="text-muted-foreground">请选择一个文件夹作为您的工作区，用于存放书籍和相关数据</p>
          </div>
          <Button onClick={handleSelectFolder} size="lg">
            <FolderOpen className="w-4 h-4 mr-2" />
            选择工作区文件夹
          </Button>
        </div>
      </div>
    );
  }

  // 有工作区，显示列表供选择
  return (
    <div className="h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-2xl space-y-6 px-8">
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-semibold">选择工作区</h2>
          <p className="text-muted-foreground">选择一个工作区来管理您的书籍</p>
        </div>

        {/* 工作区列表 */}
        <div className="border rounded-lg divide-y max-h-80 overflow-y-auto">
          {workspaces.map((workspace) => (
            <div
              key={workspace.id}
              onClick={() => handleSelectWorkspace(workspace)}
              className={`p-4 cursor-pointer transition-colors flex items-center gap-3 ${
                selectedWorkspace?.id === workspace.id
                  ? 'bg-primary/10 border-l-4 border-l-primary'
                  : 'hover:bg-muted/50'
              }`}
            >
              <div className="w-10 h-10 bg-primary/10 rounded flex items-center justify-center">
                <Home className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{workspace.name}</div>
                <div className="text-sm text-muted-foreground truncate">{workspace.path}</div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {workspace.is_default === 1 && (
                  <span className="text-xs bg-primary/10 text-primary px-2 py-1 rounded">
                    默认
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                  onClick={(e) => handleDeleteWorkspace(workspace, e)}
                  title="移除工作区"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-3 justify-center flex-wrap">
          <Button variant="outline" onClick={handleSelectFolder}>
            <Plus className="w-4 h-4 mr-2" />
            新建工作区
          </Button>
          <Button onClick={handleEnterWorkspace} disabled={!selectedWorkspace}>
            <FolderOpen className="w-4 h-4 mr-2" />
            进入工作区
          </Button>
          <Button variant="ghost" onClick={handleScanOrphans} disabled={scanningOrphans} className="text-muted-foreground">
            {scanningOrphans ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Import className="w-4 h-4 mr-2" />}
            导入丢失的会话
          </Button>
        </div>

        {/* 孤儿工作区恢复弹窗 */}
        {showRecovery && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
            <div className="bg-background rounded-lg border shadow-lg w-full max-w-lg mx-4">
              <div className="flex items-center justify-between p-4 border-b">
                <div>
                  <div className="font-semibold">导入丢失的会话</div>
                  <div className="text-sm text-muted-foreground mt-0.5">
                    找到以下未关联的历史会话数据，点击可将其导入到当前选中的工作区
                  </div>
                </div>
                <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setShowRecovery(false)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <div className="p-4 max-h-96 overflow-y-auto space-y-2">
                {orphans.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">没有找到丢失的会话数据</p>
                ) : (
                  orphans.map(orphan => (
                    <div
                      key={orphan.id}
                      className="p-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
                      onClick={() => handleImportOrphan(orphan)}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium">
                          {orphan.sourceName || `未知来源 (${orphan.id.slice(0, 8)}...)`}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">{orphan.conversationCount} 个对话</span>
                          {orphan.sourceName && (
                            <span className="text-xs px-1.5 py-0.5 bg-orange-50 border border-orange-200 rounded text-orange-600">
                              可能匹配
                            </span>
                          )}
                          {importingId === orphan.id && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
                        </div>
                      </div>
                      {orphan.sourcePath && (
                        <div className="text-xs text-muted-foreground truncate">原路径: {orphan.sourcePath}</div>
                      )}
                      {orphan.sampleTitles.length > 0 && (
                        <div className="text-xs text-muted-foreground mt-1 truncate">
                          {orphan.sampleTitles.join('、')}{orphan.conversationCount > 5 ? '...' : ''}
                        </div>
                      )}
                      {orphan.lastUpdated && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          最后更新: {new Date(orphan.lastUpdated).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
              {selectedWorkspace && (
                <div className="px-4 pb-3 text-xs text-muted-foreground">
                  将导入到工作区：<span className="text-foreground font-medium">{selectedWorkspace.name}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
