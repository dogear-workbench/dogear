import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Ban, Check, MessageSquare, Play, RotateCcw, Trash2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { client } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { TaskStatusBadge } from '@/components/notes/TaskStatusBadge';
import { NoteLoading } from '@/components/notes/NoteState';
import { useTaskStore } from '@/stores/task-store';
import { jumpToSourceConversation } from '@/lib/reference-guard';
import { showConfirm } from '@/stores/confirm-store';
import { formatNoteTime } from '@/components/notes/NoteCardItem';
import type { ReviewAction, TaskDetail as TaskDetailData } from '@/types/task';

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
      const ok = await executeTask(workspacePath, taskId);
      if (!ok) toast.error('执行失败', { description: '任务无法进入队列' });
    } finally {
      setExecuting(false);
    }
  }, [workspacePath, taskId, executing, executeTask]);

  const handleComplete = useCallback(async () => {
    const ok = await showConfirm('手动完成', `确定把「${detail?.title ?? '该任务'}」标记为已完成？将跳过执行。`);
    if (!ok) return;
    const done = await completeTask(workspacePath, taskId);
    if (!done) toast.error('操作失败', { description: '任务未能标记完成' });
  }, [workspacePath, taskId, detail, completeTask]);

  const handleCancel = useCallback(async () => {
    if (cancelling) return;
    setCancelling(true);
    try {
      const ok = await cancelTask(workspacePath, taskId);
      if (!ok) toast.error('取消失败', { description: '任务未能取消' });
    } finally {
      setCancelling(false);
    }
  }, [workspacePath, taskId, cancelling, cancelTask]);

  const handleMove = useCallback(
    async (to: 'backlog' | 'plan') => {
      const ok = await moveTask(workspacePath, taskId, to);
      if (!ok) toast.error('操作失败', { description: '任务状态未变更' });
    },
    [workspacePath, taskId, moveTask],
  );

  const handleDelete = useCallback(async () => {
    const ok = await showConfirm('删除任务', `确定删除「${detail?.title ?? '该任务'}」？删除后可在回收站恢复。`);
    if (!ok) return;
    const done = await deleteTask(workspacePath, taskId);
    if (!done) {
      toast.error('删除失败', { description: '任务删除失败' });
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
          <div className="mx-auto flex w-full max-w-[760px] flex-col px-8 pt-8 pb-24">
            <div className="flex items-start justify-between gap-4">
              <h2 className="min-w-0 break-words text-2xl font-semibold leading-tight">{detail.title}</h2>
              <TaskStatusBadge status={detail.status} className="mt-1.5 px-2 py-0.5 text-xs" />
            </div>

            <div className="mt-1.5 flex items-center gap-3 text-xs text-muted-foreground">
              <span title={`创建于 ${formatNoteTime(detail.createdAt)}`}>{formatNoteTime(detail.createdAt)}</span>
              {detail.planPath ? (
                <span className="min-w-0 truncate" title={detail.planPath}>
                  {detail.planPath}
                </span>
              ) : (
                <span className="italic">尚无计划文档</span>
              )}
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

            {detail.execSessionId && (
              <button
                onClick={() =>
                  void jumpToSourceConversation({
                    conversationId: detail.execSessionId!,
                    title: `任务: ${detail.title}`,
                  })
                }
                title="打开执行会话，查看实施过程"
                className="mt-4 inline-flex cursor-pointer items-center gap-1.5 self-start text-sm text-primary hover:underline"
              >
                <MessageSquare className="w-3.5 h-3.5" />
                查看执行会话
              </button>
            )}

            {detail.result && (
              <div className="mt-4 rounded-md border bg-muted/20 p-4">
                <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                  {detail.status === 'rejected' ? '打回原因' : '结果摘要'}
                </p>
                <MarkdownRenderer content={detail.result} className="text-sm" />
              </div>
            )}

            <div className="mt-6">
              <p className="mb-2 text-xs font-medium text-muted-foreground">计划文档</p>
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
