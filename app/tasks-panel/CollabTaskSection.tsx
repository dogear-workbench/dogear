import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { MessageSquare } from 'lucide-react';
import { client } from '@/lib/client';
import { useTaskStore } from '@/stores/task-store';
import { useTaskFocusStore } from '@/stores/task-focus-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useTasksPanelStore } from '@/stores/tasks-panel-store';
import { showConfirm } from '@/stores/confirm-store';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { TaskCardItem } from './TaskCardItem';
import { ChildSessionFold } from './ChildSessionList';
import { referenceConversationToMain } from './reference-to-main';
import { NoteEmpty, NoteLoading } from '@/components/notes/NoteState';
import { ListSectionHeader } from '@/components/ui/list-section-header';
import { CollapsibleSection } from '@/components/notes/CollapsibleSection';
import { currentMonthKey, groupByMonth, monthKey } from '@/components/notes/month-grouping';
import { SectionHeader } from './SectionHeader';
import type { ReviewAction, Task, TaskStatus } from '@/types/task';

const TASK_GROUPS: Array<{ status: TaskStatus; label: string }> = [
  { status: 'plan', label: '计划' },
  { status: 'backlog', label: '待办' },
  { status: 'queued', label: '排队中' },
  { status: 'running', label: '执行中' },
  { status: 'review', label: '待审核' },
  { status: 'done', label: '已完成' },
];

/** 协作任务区：复用笔记面板任务卡片渲染；6 组分类 + 已完成折叠按月分段（照迁移前 TaskPanel） */
export function CollabTaskSection() {
  const workspacePath = useWorkspaceStore((s) => s.workspace?.path);
  const workspaceId = useWorkspaceStore((s) => s.workspace?.id);
  const groups = useTaskStore((s) => s.groups);
  const loading = useTaskStore((s) => s.loading);
  const loadedWorkspacePath = useTaskStore((s) => s.loadedWorkspacePath);
  const loadTasks = useTaskStore((s) => s.loadTasks);
  const executeTask = useTaskStore((s) => s.executeTask);
  const completeTask = useTaskStore((s) => s.completeTask);
  const cancelTask = useTaskStore((s) => s.cancelTask);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const moveTask = useTaskStore((s) => s.moveTask);
  const selection = useTasksPanelStore((s) => s.selection);
  const select = useTasksPanelStore((s) => s.select);
  const openHistory = useTasksPanelStore((s) => s.openHistory);

  const [doneExpanded, setDoneExpanded] = useState(false);
  const [monthOverrides, setMonthOverrides] = useState<Record<string, boolean>>({});
  const listRef = useRef<HTMLDivElement>(null);
  const processedFocusSeq = useRef(0);
  const pendingFocusId = useRef<string | null>(null);

  useEffect(() => {
    if (!workspacePath || loadedWorkspacePath === workspacePath) return;
    void loadTasks(workspacePath);
  }, [workspacePath, loadedWorkspacePath, loadTasks]);

  // 任务通知深链：seq 去重登记，groups 就绪后选中（含完成区展开与滚动定位）
  const focusReq = useTaskFocusStore((s) => s.focusReq);
  useEffect(() => {
    if (!focusReq || processedFocusSeq.current === focusReq.seq) return;
    processedFocusSeq.current = focusReq.seq;
    pendingFocusId.current = focusReq.taskId;
  }, [focusReq]);

  useEffect(() => {
    const taskId = pendingFocusId.current;
    if (!taskId || !groups) return;
    pendingFocusId.current = null;
    select({ kind: 'collab', taskId });
    const doneTask = groups.done.find((t) => t.id === taskId);
    if (doneTask) {
      setDoneExpanded(true);
      setMonthOverrides((m) => ({ ...m, [monthKey(doneTask.updatedAt)]: true }));
    }
    const timer = window.setTimeout(() => {
      listRef.current
        ?.querySelector(`[data-task-id="${CSS.escape(taskId)}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    }, doneTask ? 80 : 0);
    return () => window.clearTimeout(timer);
  }, [groups, focusReq, select]);

  // rejected/interrupted 并入计划段展示（status 粒度不单列分组）
  const viewGroups = useMemo(() => {
    if (!groups) return null;
    return { ...groups, plan: [...groups.plan, ...groups.rejected, ...groups.interrupted] };
  }, [groups]);

  if (!workspacePath) {
    return (
      <section>
        <SectionHeader label="协作任务" />
        <p className="px-3 py-3 text-xs text-muted-foreground">请先选择工作区</p>
      </section>
    );
  }

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
    const ok = await showConfirm('删除任务', `「${task.title}」将移入回收站，可在 归档·回收站 恢复。`);
    if (!ok) return;
    const err = await deleteTask(workspacePath, task.id);
    if (err) toast.error('删除失败', { description: err });
    else if (selection?.kind === 'collab' && selection.taskId === task.id) select(null);
  };

  const handleMove = async (taskId: string, to: 'backlog' | 'plan') => {
    const err = await moveTask(workspacePath, taskId, to);
    if (err) toast.error('操作失败', { description: err });
  };

  const handleReview = async (task: Task, action: ReviewAction) => {
    if (action === 'reject') {
      const ok = await showConfirm('打回任务', '任务将标记为已打回并结束审核；修改 plan 后可在会话中让 Agent 重新挂载。');
      if (!ok) return;
    }
    const result = await client.reviewCollabTask({ workspacePath, taskId: task.id, action });
    if ('error' in result) toast.error('操作失败', { description: result.error });
  };

  const renderTask = (task: Task) => (
    <div key={task.id}>
      <TaskCardItem
        task={task}
        active={selection?.kind === 'collab' && selection.taskId === task.id}
        onOpen={() => select({ kind: 'collab', taskId: task.id })}
        onExecute={() => handleExecute(task.id)}
        onCancel={() => handleCancel(task.id)}
        onComplete={() => handleComplete(task)}
        onDelete={() => handleDelete(task)}
        onMove={(to) => handleMove(task.id, to)}
        onReview={(action) => handleReview(task, action)}
      />
      {task.execSessionId && workspaceId && (
        <ChildSessionFold
          parentConversationId={task.execSessionId}
          workspaceId={workspaceId}
          onOpen={(conversationId) =>
            openHistory({ conversationId, workspaceId, source: 'collab', taskId: task.id })
          }
        >
          {(toggle) => (
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <button
                  type="button"
                  onClick={() =>
                    openHistory({
                      conversationId: task.execSessionId!,
                      workspaceId,
                      source: 'collab',
                      taskId: task.id,
                    })
                  }
                  title="查看执行过程"
                  className="flex items-center gap-2 w-full pl-6 pr-2 py-1.5 text-xs text-muted-foreground text-left hover:text-foreground transition-colors"
                >
                  {toggle}
                  <MessageSquare className="w-3 h-3 shrink-0" />
                  <span className="truncate">执行会话</span>
                </button>
              </ContextMenuTrigger>
              <ContextMenuContent onCloseAutoFocus={(event) => event.preventDefault()}>
                <ContextMenuItem
                  onClick={() => void referenceConversationToMain(task.execSessionId!, workspaceId)}
                >
                  引用到主会话
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          )}
        </ChildSessionFold>
      )}
    </div>
  );

  const renderGroups = () => {
    if (!viewGroups) return null;
    const total = TASK_GROUPS.reduce((n, g) => n + viewGroups[g.status].length, 0);
    if (total === 0) return <NoteEmpty text="暂无任务，可在会话中让 Agent 创建" />;
    return TASK_GROUPS.map(({ status, label }) => {
      const tasks = viewGroups[status];
      if (tasks.length === 0) return null;
      if (status === 'done') {
        const currentKey = currentMonthKey();
        const months = groupByMonth(tasks, (t) => t.updatedAt);
        return (
          <div key={status}>
            <ListSectionHeader
              label={label}
              count={tasks.length}
              expanded={doneExpanded}
              onToggle={() => setDoneExpanded((v) => !v)}
              className="pt-3 pb-1"
            />
            {doneExpanded &&
              months.map((month) => {
                const collapsed = monthOverrides[month.key] ?? month.key !== currentKey;
                return (
                  <CollapsibleSection
                    key={month.key}
                    label={month.label}
                    count={month.items.length}
                    collapsed={collapsed}
                    onToggle={() =>
                      setMonthOverrides((m) => ({ ...m, [month.key]: !(m[month.key] ?? month.key !== currentKey) }))
                    }
                  >
                    {month.items.map(renderTask)}
                  </CollapsibleSection>
                );
              })}
          </div>
        );
      }
      return (
        <div key={status}>
          <ListSectionHeader label={label} count={tasks.length} className="pt-3 pb-1" />
          <div>{tasks.map(renderTask)}</div>
        </div>
      );
    });
  };

  const total = viewGroups ? TASK_GROUPS.reduce((n, g) => n + viewGroups[g.status].length, 0) : 0;

  return (
    <section>
      <SectionHeader label="协作任务" count={viewGroups ? total : undefined} />
      {loading && !groups ? <NoteLoading /> : <div ref={listRef}>{renderGroups()}</div>}
    </section>
  );
}
