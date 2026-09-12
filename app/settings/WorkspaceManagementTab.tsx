/**
 * 工作区管理 Tab（里程碑 1.5 Step A2.7）
 *
 * 职责：
 * - 完整工作区列表（展示元数据：名称、路径、是否默认）
 * - 删除工作区（二次确认，不删文件夹内容）
 * - 孤儿恢复（从 Agent SDK 历史目录扫描 "丢失的会话"，合并到目标工作区）
 * - 环境依赖检查（Python / Python 包）+ 一键安装
 *
 * 以上三个功能原在 workspace-selector.tsx（全屏欢迎页），本步迁到设置页。
 * 顶部 Popover 只管 "选择 / 添加"，这里只管 "管理"。
 */

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Download,
  Home,
  Import,
  Loader2,
  RefreshCw,
  Trash2,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { showConfirm } from '@/stores/confirm-store';
import { client } from '@/lib/client';
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

interface DepInfo {
  name: string;
  version: string | null;
  installed: boolean;
  required: boolean;
  description?: string;
  installable?: boolean;
}

export function WorkspaceManagementTab() {
  const currentWorkspace = useWorkspaceStore((s) => s.workspace);
  const clearWorkspace = useWorkspaceStore((s) => s.clearWorkspace);

  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(false);

  // 孤儿恢复
  const [scanning, setScanning] = useState(false);
  const [orphans, setOrphans] = useState<OrphanWorkspace[]>([]);
  const [orphansLoaded, setOrphansLoaded] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);

  // 环境依赖检查
  const [envOpen, setEnvOpen] = useState(false);
  const [envChecking, setEnvChecking] = useState(false);
  const [envChecked, setEnvChecked] = useState(false);
  const [envDeps, setEnvDeps] = useState<DepInfo[]>([]);
  const [installing, setInstalling] = useState(false);

  const loadWorkspaces = useCallback(async () => {
    setLoading(true);
    try {
      const result = await client.getAll();
      setWorkspaces(result.workspaces ?? []);
    } catch (err) {
      console.error('加载工作区列表失败:', err);
      toast.error('加载失败', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadWorkspaces();
  }, [loadWorkspaces]);

  const handleDelete = async (ws: Workspace) => {
    const ok = await showConfirm(
      '删除工作区',
      `确定要移除工作区「${ws.name}」吗？（不会删除文件夹内容）`,
    );
    if (!ok) return;
    try {
      await client.deleteWorkspace({ workspaceId: ws.id });
      // 如果删除的是当前激活工作区，清空当前
      if (currentWorkspace?.id === ws.id) {
        clearWorkspace();
      }
      await loadWorkspaces();
      toast.success(`已删除工作区「${ws.name}」`);
    } catch (err) {
      console.error('删除工作区失败:', err);
      toast.error('删除失败', {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleScanOrphans = async () => {
    setScanning(true);
    try {
      const result = (await client.scanOrphanWorkspaces()) as OrphanWorkspace[];
      setOrphans(result);
      setOrphansLoaded(true);
    } catch (err) {
      console.error('扫描孤儿失败:', err);
      toast.error('扫描失败', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setScanning(false);
    }
  };

  const handleImportOrphan = async (orphan: OrphanWorkspace) => {
    if (!currentWorkspace) {
      toast.warning('需要先激活一个工作区作为导入目标', {
        description: '回到主界面从顶部工作区切换器选一个，再回来导入',
      });
      return;
    }
    setImportingId(orphan.id);
    try {
      const result = (await client.importOrphanWorkspace({
        orphanId: orphan.id,
        targetWorkspaceId: currentWorkspace.id,
        deleteAfterImport: true,
      })) as { importedCount: number };
      toast.success(
        `已导入 ${result.importedCount} 个会话到「${currentWorkspace.name}」`,
      );
      setOrphans((prev) => prev.filter((o) => o.id !== orphan.id));
    } catch (err) {
      console.error('导入孤儿失败:', err);
      toast.error('导入失败', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setImportingId(null);
    }
  };

  const checkEnvironment = useCallback(async () => {
    setEnvChecking(true);
    try {
      const result = await client.checkEnvironment();
      setEnvDeps(result.dependencies as DepInfo[]);
      setEnvChecked(true);
    } catch (err) {
      console.error('环境检测失败:', err);
      toast.error('环境检测失败', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setEnvChecking(false);
    }
  }, []);

  const handleInstallPythonDeps = async () => {
    setInstalling(true);
    try {
      const result = (await client.installPythonDeps()) as {
        success?: boolean;
        error?: string;
      };
      if (result.error) {
        toast.error('安装失败', { description: result.error });
      } else {
        toast.success('Python 依赖安装完成');
        await checkEnvironment();
      }
    } catch (err) {
      console.error('安装失败:', err);
      toast.error('安装失败', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setInstalling(false);
    }
  };

  const pythonInstalled = envDeps.some((d) => d.name === 'Python' && d.installed);
  const missingPythonPkgs = envDeps.filter((d) => d.installable && !d.installed);

  return (
    <div className="max-w-3xl mx-auto py-6 px-6 space-y-8">
      <div>
        <h2 className="text-lg font-semibold mb-1">工作区管理</h2>
        <p className="text-sm text-muted-foreground">
          删除、恢复丢失的会话、检查环境依赖。
        </p>
      </div>

      {/* 工作区列表 */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">所有工作区 ({workspaces.length})</label>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={loadWorkspaces}
            disabled={loading}
            title="重新加载"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          </Button>
        </div>

        <div className="rounded-md border divide-y">
          {workspaces.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              还没有工作区。回主界面从顶部切换器添加。
            </div>
          ) : (
            workspaces.map((ws) => {
              const isActive = currentWorkspace?.id === ws.id;
              return (
                <div
                  key={ws.id}
                  className="px-3 py-2.5 flex items-center gap-3 hover:bg-muted/40 transition-colors"
                >
                  <div className="w-8 h-8 bg-primary/10 rounded flex items-center justify-center shrink-0">
                    <Home className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium truncate">{ws.name}</span>
                      {isActive && (
                        <span className="text-xs bg-emerald-500/10 text-emerald-600 px-1.5 py-0.5 rounded shrink-0">
                          当前
                        </span>
                      )}
                      {ws.is_default === 1 && (
                        <span className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded shrink-0">
                          默认
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate" title={ws.path}>
                      {ws.path}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                    onClick={() => handleDelete(ws)}
                    title="移除工作区"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* 孤儿恢复 */}
      <section className="space-y-3">
        <div>
          <label className="text-sm font-medium">导入丢失的会话</label>
          <p className="text-xs text-muted-foreground mt-0.5">
            扫描 Agent SDK 历史目录里的未关联会话，把它们合并到当前工作区。
          </p>
        </div>

        <div className="rounded-md border p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleScanOrphans}
              disabled={scanning}
            >
              {scanning ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Import className="w-3.5 h-3.5 mr-1.5" />
              )}
              扫描孤儿会话
            </Button>
            {currentWorkspace ? (
              <span className="text-xs text-muted-foreground">
                目标工作区：
                <span className="text-foreground font-medium">{currentWorkspace.name}</span>
              </span>
            ) : (
              <span className="text-xs text-amber-600">
                当前未激活工作区，导入前请先回主界面选一个
              </span>
            )}
          </div>

          {orphansLoaded && (
            <div className="pt-2">
              {orphans.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">
                  没有找到丢失的会话数据
                </p>
              ) : (
                <div className="space-y-1.5 max-h-80 overflow-y-auto">
                  {orphans.map((orphan) => (
                    <button
                      key={orphan.id}
                      className="w-full text-left p-2.5 rounded border hover:bg-muted/50 cursor-pointer transition-colors disabled:opacity-60"
                      onClick={() => handleImportOrphan(orphan)}
                      disabled={!currentWorkspace || importingId === orphan.id}
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-xs font-medium truncate">
                          {orphan.sourceName || `未知来源 (${orphan.id.slice(0, 8)}...)`}
                        </span>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-muted-foreground">
                            {orphan.conversationCount} 个对话
                          </span>
                          {importingId === orphan.id && (
                            <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
                          )}
                        </div>
                      </div>
                      {orphan.sourcePath && (
                        <div className="text-xs text-muted-foreground truncate">
                          原路径: {orphan.sourcePath}
                        </div>
                      )}
                      {orphan.sampleTitles.length > 0 && (
                        <div className="text-xs text-muted-foreground mt-0.5 truncate">
                          {orphan.sampleTitles.join('、')}
                          {orphan.conversationCount > 5 ? '...' : ''}
                        </div>
                      )}
                      {orphan.lastUpdated && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          最后更新: {new Date(orphan.lastUpdated).toLocaleDateString()}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* 环境依赖检查 */}
      <section className="space-y-3">
        <Collapsible
          open={envOpen}
          onOpenChange={(open) => {
            setEnvOpen(open);
            if (open && !envChecked && !envChecking) {
              checkEnvironment();
            }
          }}
        >
          <CollapsibleTrigger className="flex items-center gap-2 w-full text-sm font-medium hover:text-foreground/80 transition-colors cursor-pointer">
            <ChevronRight
              className={cn('w-4 h-4 transition-transform', envOpen && 'rotate-90')}
            />
            <span>环境依赖</span>
            {envChecked && (
              <span className="text-xs text-muted-foreground ml-auto">
                {envDeps.filter((d) => d.installed).length}/{envDeps.length} 已安装
              </span>
            )}
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <div className="rounded-md border">
              {!envChecked && envChecking ? (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  检测中...
                </div>
              ) : envChecked ? (
                <>
                  <div className="divide-y">
                    {envDeps.map((dep) => (
                      <div
                        key={dep.name}
                        className="flex items-center gap-3 px-3 py-2.5"
                      >
                        {dep.installed ? (
                          <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />
                        ) : dep.required ? (
                          <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0" />
                        )}
                        <span className="text-sm font-medium w-20 shrink-0">
                          {dep.name}
                        </span>
                        <span className="text-xs text-muted-foreground w-24 shrink-0">
                          {dep.installed ? dep.version : '未安装'}
                        </span>
                        <span
                          className={cn(
                            'text-xs px-1.5 py-0.5 rounded-full shrink-0',
                            dep.required
                              ? 'bg-primary/10 text-primary'
                              : 'bg-muted text-muted-foreground',
                          )}
                        >
                          {dep.required ? '必需' : '可选'}
                        </span>
                        {dep.description && (
                          <span className="text-xs text-muted-foreground ml-auto truncate">
                            {dep.description}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2 px-3 py-2 border-t">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={checkEnvironment}
                      disabled={envChecking}
                    >
                      {envChecking ? (
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3 h-3 mr-1" />
                      )}
                      刷新
                    </Button>
                    {missingPythonPkgs.length > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleInstallPythonDeps}
                        disabled={installing || !pythonInstalled}
                        title={!pythonInstalled ? '请先安装 Python' : undefined}
                      >
                        {installing ? (
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        ) : (
                          <Download className="w-3 h-3 mr-1" />
                        )}
                        一键安装 Python 依赖
                      </Button>
                    )}
                  </div>
                </>
              ) : null}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </section>
    </div>
  );
}
