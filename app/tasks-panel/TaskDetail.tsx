import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Ban, Check, Play, RotateCcw, Trash2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { TaskStatusBadge, TaskExecProfileBadge } from './TaskStatusBadge';
import { NoteLoading } from '@/components/notes/NoteState';
import { useTaskStore } from '@/stores/task-store';
import { showConfirm } from '@/stores/confirm-store';
import { formatNoteTime } from '@/components/notes/NoteCardItem';
import type { ExecProfile, ReviewAction, TaskDetail as TaskDetailData } from '@/types/task';

interface TaskDetailProps {
  workspacePath: string;
  taskId: string;
  onBack: () => void;
}

// 父组件以 key={taskId} 挂载：换任务即重挂载，state 天然复位
export function TaskDetail({ workspacePath, taskId, onBack }: TaskDetailProps) {
  const [detail, setDetail] = useState<TaskDetailData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const groups = useTaskStore((s) => s.groups);
  const executeTask = useTaskStore((s) => s.executeTask);
  const completeTask = useTaskStore((s) => s.completeTask);
  const cancelTask = useTaskStore((s) => s.cancelTask);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const moveTask = useTaskStore((s) => s.moveTask);
  const updateExecProfile = useTaskStore((s) => s.updateExecProfile);
  const [executing, setExecuting] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // groups 引用变化（队列写回任务状态后 tasksChanged 广播 → 列表重拉）时重拉详情，状态流转实时可见
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const result = await client.getCollabTask({ workspacePath, taskId });
      if (cancelled) return;
      if ('detail' in result && result.detail) {
        setDetail(result.detail);
        setLoadError(null);
      } else {
        setLoadError(('error' in result && result.error) || '任务详情获取失败');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspacePath, taskId, groups]);

  // 打开详情是瞬时动作：仅挂载时清当下未读条目，驻留期间新写入的不清
  useEffect(() => {
    client.markTaskNotificationsRead({ taskId }).catch(() => {});
  }, [taskId]);

  const handleReview = useCallback(
    async (action: ReviewAction) => {
      if (reviewing) return;
      if (action === 'reject') {
        const ok = await showConfirm('打回任务', '任务将标记为已打回并结束审核；修改 plan 后可在会话中让 Agent 重新挂载。');
        if (!ok) return;
      }
      setReviewing(true);
      try {
        const result = await client.reviewCollabTask({ workspacePath, taskId, action });
        if ('task' in result) {
          setDetail((d) => (d ? { ...d, ...result.task } : d));
        } else {
          toast.error('操作失败', { description: result.error });
        }
      } catch (error) {
        toast.error('操作失败', { description: String(error) });
      } finally {
        setReviewing(false);
      }
    },
    [workspacePath, taskId, reviewing],
  );

  const handleExecute = useCallback(async () => {
    if (executing) return;
    setExecuting(true);
    try {
      const err = await executeTask(workspacePath, taskId);
      if (err) toast.error('执行失败', { description: err });
    } finally {
      setExecuting(false);
    }
  }, [workspacePath, taskId, executing, executeTask]);

  const handleComplete = useCallback(async () => {
    const ok = await showConfirm('手动完成', `确定把「${detail?.title ?? '该任务'}」标记为已完成？将跳过执行。`);
    if (!ok) return;
    const err = await completeTask(workspacePath, taskId);
    if (err) toast.error('操作失败', { description: err });
  }, [workspacePath, taskId, detail, completeTask]);

  const handleCancel = useCallback(async () => {
    if (cancelling) return;
    setCancelling(true);
    try {
      const err = await cancelTask(workspacePath, taskId);
      if (err) toast.error('取消失败', { description: err });
    } finally {
      setCancelling(false);
    }
  }, [workspacePath, taskId, cancelling, cancelTask]);

  const handleMove = useCallback(
    async (to: 'backlog' | 'plan') => {
      const err = await moveTask(workspacePath, taskId, to);
      if (err) toast.error('操作失败', { description: err });
    },
    [workspacePath, taskId, moveTask],
  );

  const handleToggleExecProfile = useCallback(async () => {
    const next: ExecProfile = (detail?.execProfile ?? 'default') === 'default' ? 'code-impl' : 'default';
    const err = await updateExecProfile(workspacePath, taskId, next);
    if (err) {
      toast.error('切换执行类型失败', { description: err });
      return;
    }
    setDetail((d) => (d ? { ...d, execProfile: next } : d));
  }, [workspacePath, taskId, detail, updateExecProfile]);

  const handleDelete = useCallback(async () => {
    const ok = await showConfirm('删除任务', `「${detail?.title ?? '该任务'}」将移入回收站，可在 归档·回收站 恢复。`);
    if (!ok) return;
    const err = await deleteTask(workspacePath, taskId);
    if (err) {
      toast.error('删除失败', { description: err });
      return;
    }
    onBack();
  }, [workspacePath, taskId, detail, deleteTask, onBack]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onBack();
    }
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-background" onKeyDown={handleKeyDown}>
      {loadError ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
          {loadError}
          <Button variant="outline" size="sm" onClick={onBack}>
            返回列表
          </Button>
        </div>
      ) : !detail ? (
        <NoteLoading />
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0">
          <div className="mx-auto flex w-full max-w-[900px] flex-col px-8 pt-8 pb-24">
            <div className="flex items-start justify-between gap-4">
              <h2 className="min-w-0 break-words text-2xl font-semibold leading-tight">{detail.title}</h2>
              <div className="mt-1.5 flex shrink-0 items-center gap-1.5">
                {detail.status === 'plan' || detail.status === 'backlog' ? (
                  <button
                    type="button"
                    onClick={() => void handleToggleExecProfile()}
                    title={`执行类型：${detail.execProfile ?? 'default'}，点击切换（排队后不可改）`}
                    className="cursor-pointer rounded-full outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <TaskExecProfileBadge execProfile={detail.execProfile} className="px-2 py-0.5 text-xs" />
                  </button>
                ) : (
                  <TaskExecProfileBadge execProfile={detail.execProfile} className="px-2 py-0.5 text-xs" />
                )}
                <TaskStatusBadge status={detail.status} className="px-2 py-0.5 text-xs" />
              </div>
            </div>

            <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
              <span title={`创建于 ${formatNoteTime(detail.createdAt)}`}>{formatNoteTime(detail.createdAt)}</span>
              <span className="flex-1" />
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => void handleDelete()}
                title="删除任务"
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
              <Button variant="ghost" size="icon-xs" onClick={onBack} title="返回列表（Esc）">
                <ArrowLeft className="w-3.5 h-3.5" />
              </Button>
            </div>

            {(detail.status === 'plan' || detail.status === 'rejected') && (
              <div className="mt-4 flex items-center gap-2">
                <Button size="sm" onClick={() => void handleMove('backlog')}>
                  <ArrowRight className="w-3.5 h-3.5" />
                  移到待办
                </Button>
                <Button size="sm" variant="outline" onClick={() => void handleComplete()}>
                  <Check className="w-3.5 h-3.5" />
                  手动完成
                </Button>
              </div>
            )}

            {detail.status === 'backlog' && (
              <div className="mt-4 flex items-center gap-2">
                <Button size="sm" disabled={executing} onClick={() => void handleExecute()}>
                  <Play className="w-3.5 h-3.5" />
                  执行
                </Button>
                <Button size="sm" variant="outline" onClick={() => void handleComplete()}>
                  <Check className="w-3.5 h-3.5" />
                  手动完成
                </Button>
              </div>
            )}

            {(detail.status === 'queued' || detail.status === 'running') && (
              <div className="mt-4 flex items-center gap-2">
                <Button size="sm" variant="outline" disabled={cancelling} onClick={() => void handleCancel()}>
                  <Ban className="w-3.5 h-3.5" />
                  取消
                </Button>
              </div>
            )}

            {detail.status === 'done' && (
              <div className="mt-4 flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => void handleMove('plan')}>
                  <Undo2 className="w-3.5 h-3.5" />
                  移回计划
                </Button>
              </div>
            )}

            {detail.status === 'review' && (
              <div className="mt-4 flex items-center gap-2">
                <Button size="sm" disabled={reviewing} onClick={() => void handleReview('approve')}>
                  <Check className="w-3.5 h-3.5" />
                  通过
                </Button>
                <Button size="sm" variant="outline" disabled={reviewing} onClick={() => void handleReview('reject')}>
                  <RotateCcw className="w-3.5 h-3.5" />
                  打回
                </Button>
              </div>
            )}

            {detail.status === 'interrupted' && (
              <div className="mt-4 flex items-center gap-2">
                <Button size="sm" disabled={executing} onClick={() => void handleExecute()}>
                  <Play className="w-3.5 h-3.5" />
                  重新入队
                </Button>
                <Button size="sm" variant="outline" onClick={() => void handleMove('plan')}>
                  <Undo2 className="w-3.5 h-3.5" />
                  移回计划
                </Button>
                <Button size="sm" variant="outline" onClick={() => void handleComplete()}>
                  <Check className="w-3.5 h-3.5" />
                  手动完成
                </Button>
              </div>
            )}

            {(detail.status === 'rejected' || detail.status === 'interrupted') && detail.result && (
              <div className="mt-4 rounded-md border bg-muted/20 p-4">
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                  {detail.status === 'rejected' ? '打回原因' : '中断原因'}
                </p>
                <MarkdownRenderer content={detail.result} className="text-sm" />
              </div>
            )}

            <div className="mt-6">
              <div className="mb-2 flex items-center gap-2 min-w-0">
                <p className="shrink-0 text-xs font-medium text-muted-foreground">计划文档</p>
                {detail.planPath && (
                  <span className="min-w-0 truncate text-[11px] text-muted-foreground/60" title={detail.planPath}>
                    {detail.planPath}
                  </span>
                )}
              </div>
              {detail.planContent ? (
                <MarkdownRenderer
                  content={detail.planContent}
                  workspacePath={workspacePath}
                  baseDir={detail.planPath ? detail.planPath.replace(/[\\/][^\\/]*$/, '') : undefined}
                />
              ) : detail.status === 'plan' ? (
                <p className="text-sm text-muted-foreground">
                  还没有计划文档。可在会话中让 Agent 为该任务挂载文档；若无需计划，可直接移到待办执行。
                </p>
              ) : (
                <p className="text-sm text-destructive">{detail.planError ?? 'plan 内容为空'}</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
