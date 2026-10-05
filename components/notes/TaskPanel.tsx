import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Ban, Check, MoreHorizontal, Play, Trash2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTaskStore } from '@/stores/task-store';
import { useTaskFocusStore } from '@/stores/task-focus-store';
import { showConfirm } from '@/stores/confirm-store';
import { TaskDetail } from '@/components/notes/TaskDetail';
import { TaskExecProfileBadge } from '@/components/notes/TaskStatusBadge';
import { NoteEmpty, NoteLoading } from '@/components/notes/NoteState';
import { formatNoteTime } from '@/components/notes/NoteCardItem';
import type { Task, TaskStatus } from '@/types/task';

const TASK_GROUPS: Array<{ status: TaskStatus; label: string }> = [
  { status: 'plan', label: '计划' },
  { status: 'backlog', label: '待办' },
  { status: 'queued', label: '排队中' },
  { status: 'running', label: '执行中' },
  { status: 'review', label: '待审核' },
  { status: 'done', label: '已完成' },
];

interface TaskPanelProps {
  workspacePath: string;
  /** 顶栏分域搜索词，前端 title/plan 模糊过滤 */
  query?: string;
  listHidden: boolean;
  onToggleListHidden: () => void;
}

export function TaskPanel({ workspacePath, query, listHidden, onToggleListHidden }: TaskPanelProps) {
  const groups = useTaskStore((s) => s.groups);
  const loading = useTaskStore((s) => s.loading);
  const loadedWorkspacePath = useTaskStore((s) => s.loadedWorkspacePath);
  const loadTasks = useTaskStore((s) => s.loadTasks);
  const executeTask = useTaskStore((s) => s.executeTask);
  const completeTask = useTaskStore((s) => s.completeTask);
  const cancelTask = useTaskStore((s) => s.cancelTask);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const moveTask = useTaskStore((s) => s.moveTask);
  const activeTaskId = useTaskStore((s) => s.activeTaskId);
  const setActiveTaskId = useTaskStore((s) => s.setActiveTaskId);
  const focusReq = useTaskFocusStore((s) => s.focusReq);

  // 详情归属特定工作区的任务，切工作区时关闭，避免跨区 id 悬空
  useEffect(() => {
    setActiveTaskId(null);
  }, [workspacePath, setActiveTaskId]);

  // 惰性加载；NotesPanel 激活时已拉过则跳过（loadedWorkspacePath 去重）
  useEffect(() => {
    if (loadedWorkspacePath === workspacePath) return;
    void loadTasks(workspacePath);
  }, [workspacePath, loadedWorkspacePath, loadTasks]);

  // 通知深链：选中指定任务
  useEffect(() => {
    if (focusReq) setActiveTaskId(focusReq.taskId);
  }, [focusReq, setActiveTaskId]);

  const handleExecute = async (taskId: string) => {
    const err = await executeTask(workspacePath, taskId);
    if (err) toast.error('执行失败', { description: err });
  };

  const handleCancel = async (taskId: string) => {
    const err = await cancelTask(workspacePath, taskId);
    if (err) toast.error('取消失败', { description: err });
  };

  const handleComplete = async (task: Task) => {
    const ok = await showConfirm('手动完成', `确定把「${task.title}」标记为已完成？将跳过执行。`);
    if (!ok) return;
    const err = await completeTask(workspacePath, task.id);
    if (err) toast.error('操作失败', { description: err });
  };

  const handleDelete = async (task: Task) => {
    const ok = await showConfirm('删除任务', `确定删除「${task.title}」？删除后可在回收站恢复。`);
    if (!ok) return;
    const err = await deleteTask(workspacePath, task.id);
    if (err) toast.error('删除失败', { description: err });
    else if (activeTaskId === task.id) setActiveTaskId(null);
  };

  const handleMove = async (taskId: string, to: 'backlog' | 'plan') => {
    const err = await moveTask(workspacePath, taskId, to);
    if (err) toast.error('操作失败', { description: err });
  };

  const q = query?.trim().toLowerCase() ?? '';
  const filteredGroups = useMemo(() => {
    if (!groups) return null;
    const match = (t: Task) =>
      t.title.toLowerCase().includes(q) || t.planPath?.toLowerCase().includes(q);
    const out = { ...groups };
    for (const g of TASK_GROUPS) out[g.status] = groups[g.status].filter(match);
    out.plan = [...out.plan, ...groups.rejected.filter(match), ...groups.interrupted.filter(match)];
    return out;
  }, [groups, q]);

  const renderGroups = () => {
    if (!filteredGroups) return null;
    const total = TASK_GROUPS.reduce((n, g) => n + filteredGroups[g.status].length, 0);
    if (total === 0) return <NoteEmpty text={q ? '无匹配任务' : '暂无任务，可在会话中让 Agent 创建'} />;
    return TASK_GROUPS.map(({ status, label }) => {
      const tasks = filteredGroups[status];
      if (tasks.length === 0) return null;
      return (
        <div key={status}>
          <div className="px-4 pt-3 pb-1 text-sm font-semibold text-foreground">
            {label} · {tasks.length}
          </div>
          <div className="divide-y">
            {tasks.map((task) => (
              <TaskCardItem
                key={task.id}
                task={task}
                active={task.id === activeTaskId}
                onOpen={() => setActiveTaskId(task.id)}
                onExecute={() => handleExecute(task.id)}
                onCancel={() => handleCancel(task.id)}
                onComplete={() => handleComplete(task)}
                onDelete={() => handleDelete(task)}
                onMove={(to) => handleMove(task.id, to)}
              />
            ))}
          </div>
        </div>
      );
    });
  };

  return (
    <div className="flex-1 flex min-h-0">
      <aside
        className={cn(
          'flex flex-col min-h-0 shrink-0 overflow-hidden transition-[width] duration-200',
          listHidden ? 'w-0 border-r-0' : 'w-[300px] border-r',
        )}
      >
        <div className="flex-1 overflow-y-auto min-h-0">
          {loading && !groups ? <NoteLoading /> : renderGroups()}
        </div>
      </aside>

      <div
        className="w-1 shrink-0 cursor-col-resize group/sep relative flex items-center justify-center"
        onDoubleClick={onToggleListHidden}
        title="双击隐藏/显示列表（Ctrl+\）"
      >
        <div className="w-px h-full bg-border group-hover/sep:bg-primary/50 transition-colors" />
      </div>

      <section className="flex-1 min-w-0 min-h-0 flex flex-col">
        {activeTaskId ? (
          <TaskDetail
            key={activeTaskId}
            workspacePath={workspacePath}
            taskId={activeTaskId}
            onBack={() => setActiveTaskId(null)}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            选择左侧任务查看详情
          </div>
        )}
      </section>
    </div>
  );
}

interface TaskCardItemProps {
  task: Task;
  active: boolean;
  onOpen: () => void;
  onExecute: () => Promise<void>;
  onCancel: () => Promise<void>;
  onComplete: () => Promise<void>;
  onDelete: () => Promise<void>;
  onMove: (to: 'backlog' | 'plan') => Promise<void>;
}

function TaskCardItem({ task, active, onOpen, onExecute, onCancel, onComplete, onDelete, onMove }: TaskCardItemProps) {
  const [executing, setExecuting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [moving, setMoving] = useState(false);

  const handleExecute = () => {
    if (executing) return;
    setExecuting(true);
    void onExecute().finally(() => setExecuting(false));
  };

  const handleCancel = () => {
    if (cancelling) return;
    setCancelling(true);
    void onCancel().finally(() => setCancelling(false));
  };

  const handleMove = (to: 'backlog' | 'plan') => {
    if (moving) return;
    setMoving(true);
    void onMove(to).finally(() => setMoving(false));
  };

  const hoverBtn = 'opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className={cn(
        'group w-full text-left px-4 py-3 hover:bg-muted/30 cursor-pointer focus-visible:outline-none',
        active && 'bg-muted/50',
      )}
    >
      <p className="text-sm font-medium line-clamp-1">{task.title}</p>
      <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground min-w-0">
        <TaskExecProfileBadge execProfile={task.execProfile} />
        <span className="shrink-0" title={`更新于 ${formatNoteTime(task.updatedAt)}`}>
          {formatNoteTime(task.updatedAt)}
        </span>
        <span className={cn('ml-auto flex items-center gap-0.5 shrink-0', hoverBtn)}>
          {(task.status === 'plan' || task.status === 'rejected') && (
            <Button
              variant="secondary"
              size="xs"
              disabled={moving}
              onClick={(e) => {
                e.stopPropagation();
                handleMove('backlog');
              }}
              title="确认计划，移到待办"
            >
              <ArrowRight className="w-3 h-3" />
              移到待办
            </Button>
          )}
          {task.status === 'backlog' && (
            <Button
              variant="secondary"
              size="xs"
              disabled={executing}
              onClick={(e) => {
                e.stopPropagation();
                handleExecute();
              }}
              title="进入队列执行"
            >
              <Play className="w-3 h-3" />
              执行
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                className="h-6 w-6"
                onClick={(e) => e.stopPropagation()}
                title="更多操作"
              >
                <MoreHorizontal className="w-3.5 h-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[140px]">
              {(task.status === 'queued' || task.status === 'running') && (
                <DropdownMenuItem disabled={cancelling} onClick={handleCancel}>
                  <Ban className="w-3.5 h-3.5" />
                  取消
                </DropdownMenuItem>
              )}
              {task.status === 'done' && (
                <DropdownMenuItem disabled={moving} onClick={() => handleMove('plan')}>
                  <Undo2 className="w-3.5 h-3.5" />
                  移回计划
                </DropdownMenuItem>
              )}
              {task.status === 'backlog' && (
                <DropdownMenuItem onClick={() => void onComplete()}>
                  <Check className="w-3.5 h-3.5" />
                  手动完成
                </DropdownMenuItem>
              )}
              <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => void onDelete()}>
                <Trash2 className="w-3.5 h-3.5" />
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
    </div>
  );
}
