import { useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useTaskStore } from '@/stores/task-store';
import { useTaskFocusStore } from '@/stores/task-focus-store';
import { TaskDetail } from '@/components/notes/TaskDetail';
import { TaskStatusBadge } from '@/components/notes/TaskStatusBadge';
import { NoteEmpty, NoteLoading } from '@/components/notes/NoteState';
import { formatNoteTime } from '@/components/notes/NoteCardItem';
import type { Task, TaskStatus } from '@/types/task';

const TASK_GROUPS: Array<{ status: TaskStatus; label: string }> = [
  { status: 'queued', label: '排队中' },
  { status: 'running', label: '执行中' },
  { status: 'review', label: '待审核' },
  { status: 'done', label: '已完成' },
  { status: 'rejected', label: '已打回' },
];

interface TaskPanelProps {
  workspacePath: string;
  listHidden: boolean;
  onToggleListHidden: () => void;
}

export function TaskPanel({ workspacePath, listHidden, onToggleListHidden }: TaskPanelProps) {
  const groups = useTaskStore((s) => s.groups);
  const loading = useTaskStore((s) => s.loading);
  const loadedWorkspacePath = useTaskStore((s) => s.loadedWorkspacePath);
  const loadTasks = useTaskStore((s) => s.loadTasks);
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

  const renderGroups = () => {
    if (!groups) return null;
    const total = TASK_GROUPS.reduce((n, g) => n + groups[g.status].length, 0);
    if (total === 0) return <NoteEmpty text="暂无任务，可在会话中让 Agent 创建" />;
    return TASK_GROUPS.map(({ status, label }) => {
      const tasks = groups[status];
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

function TaskCardItem({ task, active, onOpen }: { task: Task; active: boolean; onOpen: () => void }) {
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
        <TaskStatusBadge status={task.status} />
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{formatNoteTime(task.updatedAt)}</p>
    </div>
  );
}
