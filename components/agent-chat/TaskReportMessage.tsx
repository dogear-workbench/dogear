import { ExternalLink, ListTodo, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { useSessionStore, NOTES_TAB_ID } from '@/stores/session-store';
import { useTaskFocusStore } from '@/stores/task-focus-store';
import { useWorkspaceId } from './workspace-id-context';
import { useWorkspacePath } from './path-link';

interface Props {
  toolInput?: Record<string, any>;
  toolOutput?: any;
  isError?: boolean;
}

const REPORT_STATUS_LABELS: Record<string, string> = {
  plan: '计划',
  backlog: '待办',
  queued: '排队中',
  running: '执行中',
  review: '待审核',
  done: '已完成',
  rejected: '已打回',
  interrupted: '已中断',
};

function statusBadgeClass(status: string): string {
  switch (status) {
    case 'done':
      return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300';
    case 'rejected':
      return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300';
    case 'interrupted':
      return 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300';
    case 'review':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
    default:
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';
  }
}

function toOutputText(toolOutput: unknown): string {
  if (typeof toolOutput === 'string') return toolOutput;
  return toolOutput != null ? JSON.stringify(toolOutput, null, 2) : '';
}

// 输出格式随主进程文案变动，解析不出就省略对应元素，不影响正文渲染
function extractReportMeta(outputText: string): { taskId: string; taskTitle: string; status: string } {
  const taskId = outputText.match(/任务 ID[:：]\s*([^\s"'，。；（(\\]+)/)?.[1] ?? '';
  const taskTitle = outputText.match(/标题[:：]\s*(.+)/)?.[1]?.trim()
    ?? outputText.match(/任务《(.+?)》/)?.[1]
    ?? '';
  const statusRaw = outputText.match(/状态[:：]\s*(\S+)/)?.[1]?.trim()
    ?? outputText.match(/当前状态\s*([a-z]+)/i)?.[1]
    ?? '';
  return { taskId, taskTitle, status: statusRaw.split(/[（(]/)[0].trim() };
}

export function TaskReportMessage({ toolInput, toolOutput, isError }: Props) {
  const workspaceId = useWorkspaceId();
  const workspacePath = useWorkspacePath(workspaceId);
  const summary = typeof toolInput?.result === 'string' ? toolInput.result.trim() : '';
  const running = toolOutput === undefined;
  const outputText = toOutputText(toolOutput);
  const { taskId, taskTitle, status } = extractReportMeta(outputText);
  const canOpen = !running && !!taskId && !!workspacePath;

  const openTask = async () => {
    if (!workspacePath) return;
    const result = await client.getCollabTask({ workspacePath, taskId }).catch(() => null);
    if (!result || !('detail' in result) || !result.detail) {
      toast.warning('任务不存在或已删除');
      return;
    }
    useSessionStore.getState().switchTab(NOTES_TAB_ID);
    useTaskFocusStore.getState().requestTaskFocus(taskId);
  };

  return (
    <div className="w-full my-2 rounded-r-lg border-l-[3px] border-l-blue-500 bg-blue-50/70 dark:bg-blue-950/20 px-3 py-2">
      <div className="flex items-center gap-1.5 text-xs flex-wrap">
        <ListTodo className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
        <span className="px-1.5 py-0.5 rounded text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 flex-shrink-0">
          任务申报
        </span>
        {running ? (
          <span className="inline-flex items-center gap-1 text-[10px] text-sky-600 dark:text-sky-400">
            <Loader2 className="w-3 h-3 animate-spin" />
            申报中
          </span>
        ) : isError ? (
          <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
            申报失败
          </span>
        ) : status ? (
          <span className={cn('px-1.5 py-0.5 rounded text-[10px]', statusBadgeClass(status))}>
            {REPORT_STATUS_LABELS[status] ?? status}
          </span>
        ) : null}
        {taskTitle && <span className="truncate min-w-0 text-foreground/80">《{taskTitle}》</span>}
        {canOpen && (
          <button
            type="button"
            onClick={() => void openTask()}
            className="inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400 hover:underline flex-shrink-0 cursor-pointer"
          >
            打开任务
            <ExternalLink className="w-3 h-3" />
          </button>
        )}
      </div>
      {summary ? (
        <MarkdownRenderer content={summary} className="text-sm mt-1.5" />
      ) : !running ? (
        <div className="mt-1 text-xs text-muted-foreground/70">（无申报摘要）</div>
      ) : null}
      {isError && outputText && (
        <pre className="mt-1.5 text-xs text-red-600 dark:text-red-400 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
          {outputText}
        </pre>
      )}
    </div>
  );
}
