/**
 * 工作区切换浮窗（里程碑 1.5 Step A2.4）
 *
 * 基于 shadcn Command + Popover：
 * - 顶部导航栏的工作区名点击 → 打开浮窗
 * - 列出所有工作区，支持搜索筛选
 * - 选中即切换（调 workspace-store.setWorkspace）
 * - 底部"添加工作区"按钮 → 选择文件夹 → 创建 → 切过去
 *
 * 不在浮窗里做：
 * - 删除工作区 / 孤儿恢复 / 环境检查（搬到设置页的工作区管理 Tab，见 A2.7）
 */

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ChevronsUpDown, Plus, Check, FolderOpen, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import type { Workspace } from '@/types/electron-api';
import { useWorkspaceStore } from '@/stores/workspace-store';

export function WorkspaceSwitcherPopover() {
  const currentWorkspace = useWorkspaceStore((s) => s.workspace);
  const setWorkspace = useWorkspaceStore((s) => s.setWorkspace);

  const [open, setOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);

  // 浮窗打开时加载工作区列表（懒加载，避免启动时多余请求）
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const result = await client.getAll();
        if (!cancelled) {
          setWorkspaces(result.workspaces ?? []);
        }
      } catch (err) {
        console.error('加载工作区列表失败:', err);
        if (!cancelled) {
          toast.error('加载工作区列表失败', {
            description: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleSelect = async (workspace: Workspace) => {
    setOpen(false);
    if (workspace.id === currentWorkspace?.id) return;
    try {
      await setWorkspace(workspace);
    } catch (err) {
      console.error('切换工作区失败:', err);
      toast.error('切换工作区失败', {
        description: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleAddWorkspace = async () => {
    setAdding(true);
    try {
      const result = await client.selectFolder();
      if (result.canceled || !result.workspace) return;

      const folderPath = result.workspace.path;
      // 校验：SDK 会把中文或下划线转换成连字符导致历史会话路径错位
      if (/[一-龥_]/.test(folderPath)) {
        toast.warning('路径包含不支持的字符', {
          description: '工作区路径不能包含中文或下划线（_），请选择其他文件夹',
          duration: 6000,
        });
        return;
      }

      setOpen(false);
      // 直接切过去
      await setWorkspace(result.workspace);
      toast.success(`已切换到工作区「${result.workspace.name}」`);
    } catch (err) {
      console.error('添加工作区失败:', err);
      toast.error('添加工作区失败', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setAdding(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 h-8 max-w-[240px]"
          title="切换工作区"
        >
          <FolderOpen className="w-4 h-4 shrink-0" />
          <span className="truncate">
            {currentWorkspace?.name ?? '未选择工作区'}
          </span>
          <ChevronsUpDown className="w-3.5 h-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[320px] p-0" align="start">
        <Command>
          <CommandInput placeholder="搜索工作区..." />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                加载中...
              </div>
            ) : (
              <>
                <CommandEmpty>没有匹配的工作区</CommandEmpty>
                <CommandGroup heading="工作区">
                  {workspaces.map((ws) => {
                    const isActive = ws.id === currentWorkspace?.id;
                    return (
                      <CommandItem
                        key={ws.id}
                        value={`${ws.name} ${ws.path}`}
                        onSelect={() => handleSelect(ws)}
                      >
                        <Check
                          className={cn(
                            'w-4 h-4',
                            isActive ? 'opacity-100' : 'opacity-0',
                          )}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="truncate text-sm">{ws.name}</div>
                          <div className="truncate text-[11px] text-muted-foreground">
                            {ws.path}
                          </div>
                        </div>
                        {ws.isDefault && (
                          <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded shrink-0">
                            默认
                          </span>
                        )}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </>
            )}
          </CommandList>
          <CommandSeparator />
          <div className="p-1">
            <CommandItem
              value="__add__"
              onSelect={handleAddWorkspace}
              disabled={adding}
              className="cursor-pointer"
            >
              {adding ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              <span>添加工作区...</span>
            </CommandItem>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
