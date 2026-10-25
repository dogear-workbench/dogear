import { useEffect } from 'react';
import { client } from '@/lib/client';
import { TaskDetail } from './TaskDetail';
import { useSchedulerStore } from '@/stores/scheduler-store';
import { useTaskStore } from '@/stores/task-store';
import { useTasksPanelStore } from '@/stores/tasks-panel-store';
import { useUIStore } from '@/stores/ui-store';
import { useVisiblePolling } from '@/hooks/use-visible-polling';
import { cn } from '@/lib/utils';
import { applyStoredTasksListWidth, useTasksListDrag } from '@/hooks/use-panel-linkage';
import { useSettingsStore } from '@/stores/settings-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { ScheduledTaskEditor } from './ScheduledTaskEditor';
import { ScheduledTaskSection } from './ScheduledTaskSection';
import { CollabTaskSection } from './CollabTaskSection';
import { ParseHistorySection } from './ParseHistorySection';
import { SessionHistoryView } from './SessionHistoryView';
import { TasksSearchProvider } from './TasksSearchProvider';

const ACTIVITY_POLL_MS = 10_000;

// 既有任务编辑不会触发新建回调，占位保持 Props 必填签名
const noop = () => {};

function TasksPanelEmpty() {
  return (
    <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
      选择左侧任务查看详情
    </div>
  );
}

/** 任务面板：左栏三区（定时任务/协作任务/解析记录）+ 右栏编辑详情 / 协作任务详情 / 只读会话历史 */
export default function TasksPanelPage() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const selection = useTasksPanelStore((s) => s.selection);
  const select = useTasksPanelStore((s) => s.select);
  const editing = useTasksPanelStore((s) => s.editing);
  const closeEditor = useTasksPanelStore((s) => s.closeEditor);
  const historyView = useTasksPanelStore((s) => s.historyView);
  const closeHistory = useTasksPanelStore((s) => s.closeHistory);
  const storeWorkspaces = useTasksPanelStore((s) => s.workspaces);
  const setWorkspaces = useTasksPanelStore((s) => s.setWorkspaces);
  // 编辑器契约只要 { id, name }，工作区快照仅存 store 一份
  const workspaces = storeWorkspaces.map(({ id, name }) => ({ id, name }));

  const schedulerTasks = useSchedulerStore((s) => s.tasks);
  const loadSchedulerTasks = useSchedulerStore((s) => s.loadTasks);
  const refreshActivity = useSchedulerStore((s) => s.refreshActivity);

  const loadedWorkspacePath = useTaskStore((s) => s.loadedWorkspacePath);
  const loadCollabTasks = useTaskStore((s) => s.loadTasks);

  const settingsLoaded = useSettingsStore((s) => s.loaded);
  const storedTasksListWidth = useSettingsStore((s) => s.settings.ui?.tasksListWidth);
  const tasksListWidth = useUIStore((s) => s.tasksListWidth);
  const tasksListHidden = useUIStore((s) => s.tasksListHidden);
  const widthDrag = useTasksListDrag();

  // 详情与只读历史归属特定工作区的任务/会话，切工作区时关闭，避免跨区 id 悬空
  const workspaceId = workspace?.id ?? null;
  useEffect(() => {
    select(null);
    closeEditor();
    closeHistory();
  }, [workspaceId, select, closeEditor, closeHistory]);

  useEffect(() => {
    void loadSchedulerTasks();
  }, [loadSchedulerTasks]);

  useVisiblePolling(() => refreshActivity(), ACTIVITY_POLL_MS);

  // 协作任务与笔记面板共享 task-store，惰性加载去重一致
  useEffect(() => {
    if (!workspace?.path || loadedWorkspacePath === workspace.path) return;
    void loadCollabTasks(workspace.path);
  }, [workspace?.path, loadedWorkspacePath, loadCollabTasks]);

  useEffect(() => {
    client.getAll()
      .then((r) =>
        setWorkspaces((r.workspaces ?? []).map((w) => ({ id: w.id, name: w.name, isDefault: w.isDefault }))),
      )
      .catch((e) => console.error('加载工作区列表失败:', e));
  }, [setWorkspaces]);

  // 设置加载后初始化左栏宽度（clamp 220~560），后续设置变化同步跟进
  useEffect(() => {
    if (settingsLoaded) {
      applyStoredTasksListWidth(storedTasksListWidth);
    }
  }, [settingsLoaded, storedTasksListWidth]);

  const selectedPlan = selection?.kind === 'scheduled'
    ? schedulerTasks.find((t) => t.id === selection.planId)
    : undefined;

  return (
    <div className="h-full flex min-h-0">
      <TasksSearchProvider />
      <aside
        className={cn(
          'relative flex flex-col min-h-0 shrink-0 overflow-hidden border-r transition-[width] duration-200',
          widthDrag.dragging && 'transition-none',
          tasksListHidden && 'border-r-0',
        )}
        style={{ width: tasksListHidden ? 0 : tasksListWidth }}
      >
        <div className="flex-1 overflow-x-hidden overflow-y-auto min-h-0 py-1">
          <ScheduledTaskSection />
          <CollabTaskSection />
          <ParseHistorySection />
        </div>
        {!tasksListHidden && (
          <div
            className="absolute right-0 top-0 bottom-0 w-[3px] z-10 cursor-col-resize hover:bg-primary/40"
            onMouseDown={widthDrag.startDrag}
          />
        )}
      </aside>

      <section className="flex-1 min-w-0 min-h-0 flex flex-col">
        {historyView ? (
          <SessionHistoryView key={`${historyView.source}:${historyView.conversationId}`} view={historyView} />
        ) : editing === 'new' ? (
          <ScheduledTaskEditor
            key="new"
            task="new"
            workspaces={workspaces}
            defaultWorkspaceId={workspace?.id}
            onExit={closeEditor}
            onCreated={(planId) => select({ kind: 'scheduled', planId })}
          />
        ) : selection?.kind === 'scheduled' && selectedPlan ? (
          <ScheduledTaskEditor
            key={selection.planId}
            task={selectedPlan}
            workspaces={workspaces}
            onExit={() => select(null)}
            onCreated={noop}
          />
        ) : selection?.kind === 'collab' && workspace?.path ? (
          <TaskDetail
            key={selection.taskId}
            workspacePath={workspace.path}
            taskId={selection.taskId}
            onBack={() => select(null)}
          />
        ) : (
          <TasksPanelEmpty />
        )}
      </section>
    </div>
  );
}
