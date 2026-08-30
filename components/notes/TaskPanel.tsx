import { useEffect, useMemo, useState } from 'react';
import { FileText, Play } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useTaskStore } from '@/stores/task-store';
import { useNotesStore } from '@/stores/notes-store';
import { useTaskFocusStore } from '@/stores/task-focus-store';
import { TaskDetail } from '@/components/notes/TaskDetail';
import { TaskStatusBadge } from '@/components/notes/TaskStatusBadge';
import { NoteEmpty, NoteLoading } from '@/components/notes/NoteState';
import { formatNoteTime } from '@/components/notes/NoteCardItem';
import type { Task, TaskStatus } from '@/types/task';

const TASK_GROUPS: Array<{ status: TaskStatus; label: string }> = [
  { status: 'backlog', label: '积压' },
  { status: 'queued', label: '排队中' },
  { status: 'running', label: '执行中' },
  { status: 'review', label: '待审核' },
  { status: 'done', label: '已完成' },
  { status: 'rejected', label: '已打回' },
];

interface TaskPanelProps {
  workspacePath: string;
  /** 顶栏分域搜索词，前端 title/plan 模糊过滤 */
  query?: string;
  listHidden: boolean;
  onToggleListHidden: () => void;
  onOpenNote: (noteId: string) => void;
}

export function TaskPanel({ workspacePath, query, listHidden, onToggleListHidden, onOpenNote }: TaskPanelProps) {
  const groups = useTaskStore((s) => s.groups);
  const loading = useTaskStore((s) => s.loading);
  const loadedWorkspacePath = useTaskStore((s) => s.loadedWorkspacePath);
  const loadTasks = useTaskStore((s) => s.loadTasks);
  const executeTask = useTaskStore((s) => s.executeTask);
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
    const ok = await executeTask(workspacePath, taskId);
    if (!ok) toast.error('执行失败', { description: '任务无法进入队列' });
  };

  const q = query?.trim().toLowerCase() ?? '';
  const filteredGroups = useMemo(() => {
    if (!groups) return null;
    if (!q) return groups;
    const match = (t: Task) =>
      t.title.toLowerCase().includes(q) || t.planPath.toLowerCase().includes(q);
    const out = { ...groups };
    for (const g of TASK_GROUPS) out[g.status] = groups[g.status].filter(match);
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
          <div className="px-4 pt-3 pb-1 text-[11px] font-medium text-muted-foreground">
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
                onOpenNote={onOpenNote}
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
  onOpenNote: (noteId: string) => void;
}

function TaskCardItem({ task, active, onOpen, onExecute, onOpenNote }: TaskCardItemProps) {
  const [executing, setExecuting] = useState(false);
  const noteTitle = useNotesStore((s) =>
    task.noteId ? (s.notes.find((n) => n.id === task.noteId)?.title ?? null) : null,
  );

  const handleExecute = () => {
    if (executing) return;
    setExecuting(true);
    void onExecute().finally(() => setExecuting(false));
  };

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
      <div className="flex items-center gap-2">
        <p className="flex-1 min-w-0 text-sm font-medium line-clamp-1">{task.title}</p>
        {task.status === 'backlog' && (
          <Button
            variant="secondary"
            size="xs"
            disabled={executing}
            className="opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity"
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
        <TaskStatusBadge status={task.status} />
      </div>
      {task.status === 'backlog' && (
        <div className="mt-1 flex items-center gap-2 text-xs">
          {task.noteId && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (noteTitle && task.noteId) onOpenNote(task.noteId);
              }}
              title={noteTitle ? `打开卡片：${noteTitle}` : '关联笔记在回收站或已删除'}
              className={cn(
                'flex items-center gap-1 min-w-0 max-w-28 rounded px-1 py-0.5 shrink-0',
                noteTitle ? 'text-primary hover:bg-muted' : 'text-muted-foreground/60 cursor-not-allowed',
              )}
            >
              <FileText className="w-3 h-3 shrink-0" />
              <span className="truncate">{noteTitle ?? '笔记缺失'}</span>
            </button>
          )}
          <span className="min-w-0 flex-1 truncate text-muted-foreground" title={task.planPath}>
            {task.planPath}
          </span>
        </div>
      )}
      <p className="mt-1 text-xs text-muted-foreground">{formatNoteTime(task.updatedAt)}</p>
    </div>
  );
}
