import { useEffect } from 'react';
import { CalendarClock, MessageSquare, SquareCheckBig } from 'lucide-react';
import { client } from '@/lib/client';
import { TASKS_TAB_ID, useSessionStore } from '@/stores/session-store';
import { useSchedulerStore } from '@/stores/scheduler-store';
import { useTaskStore } from '@/stores/task-store';
import { useTaskFocusStore } from '@/stores/task-focus-store';
import { useUIStore } from '@/stores/ui-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { registerProvider, unregisterProvider, type SearchHit, type SearchProvider } from '@/stores/search-store';
import { resolveTaskWorkspaceId, useTasksPanelStore } from '@/stores/tasks-panel-store';
import { describeTrigger } from './utils';
import { STATUS_META, formatTokenCount } from './history-utils';
import { formatDateTimeShort, formatDuration } from '@/app/data-center/history-utils';
import type { RunHistoryEntry } from '@/types/scheduler';
import type { Task } from '@/types/task';

const MAX_TASK_HITS = 4;
const MAX_RUN_HITS = 4;
const RUN_PAGE_LIMIT = 100;
const SNIPPET_RADIUS = 24;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function snippet(text: string, words: string[]): string | undefined {
  const word = words.find((w) => text.toLowerCase().includes(w));
  if (!word) return undefined;
  const m = new RegExp(escapeRegExp(word), 'i').exec(text);
  if (!m) return undefined;
  const start = Math.max(0, m.index - SNIPPET_RADIUS);
  const end = Math.min(text.length, m.index + m[0].length + SNIPPET_RADIUS);
  const body = text.slice(start, end).replace(/\s+/g, ' ').trim();
  if (!body) return undefined;
  return `${start > 0 ? '…' : ''}${body}${end < text.length ? '…' : ''}`;
}

function matchesAll(haystacks: Array<string | undefined>, words: string[]): boolean {
  return words.every((w) => haystacks.some((h) => h?.toLowerCase().includes(w)));
}

async function scheduledTaskHits(words: string[]): Promise<SearchHit[]> {
  const tasks = useSchedulerStore.getState().tasks;
  return tasks
    .filter((t) => matchesAll([
      t.name,
      t.triggers.map((tr) => describeTrigger(tr, (id) => tasks.find((x) => x.id === id)?.name)).join('；'),
    ], words))
    .slice(0, MAX_TASK_HITS)
    .map((t) => ({
      id: `tasks-scheduled:${t.id}`,
      title: t.name,
      subtitle: '定时任务',
      description: t.triggers.length > 0
        ? t.triggers.map((tr) => describeTrigger(tr, (id) => tasks.find((x) => x.id === id)?.name)).join('；')
        : undefined,
      icon: CalendarClock,
      onSelect: () => {
        const ui = useUIStore.getState();
        if (ui.tasksListHidden) ui.toggleTasksListHidden();
        useTasksPanelStore.getState().select({ kind: 'scheduled', planId: t.id });
      },
    }));
}

async function collabTaskHits(words: string[]): Promise<SearchHit[]> {
  const workspace = useWorkspaceStore.getState().workspace;
  if (!workspace?.path) return [];
  const taskState = useTaskStore.getState();
  let groups = taskState.loadedWorkspacePath === workspace.path ? taskState.groups : null;
  if (!groups) {
    await taskState.loadTasks(workspace.path);
    groups = useTaskStore.getState().groups;
  }
  if (!groups) return [];
  const all: Task[] = [
    ...groups.plan, ...groups.backlog, ...groups.queued, ...groups.running,
    ...groups.review, ...groups.done, ...groups.rejected, ...groups.interrupted,
  ];
  return all
    .filter((t) => matchesAll([t.title, t.result], words))
    .slice(0, MAX_TASK_HITS)
    .map((t) => ({
      id: `tasks-collab:${t.id}`,
      title: t.title,
      subtitle: '协作任务',
      description: t.result ? snippet(t.result, words) : undefined,
      icon: SquareCheckBig,
      onSelect: () => {
        useTaskFocusStore.getState().requestTaskFocus(t.id);
      },
    }));
}

function runEntryTexts(entry: RunHistoryEntry): Array<string | undefined> {
  const start = entry.startedAt ?? entry.ts;
  return [
    entry.planName,
    STATUS_META[entry.status].label,
    entry.summary,
    entry.error,
    formatDateTimeShort(start),
    entry.tokens ? formatTokenCount(entry.tokens.inputTokens + entry.tokens.outputTokens) : undefined,
  ];
}

async function runHistoryHits(words: string[]): Promise<SearchHit[]> {
  try {
    const r = await client.listRunHistory({ limit: RUN_PAGE_LIMIT });
    if ('error' in r) return [];
    return r.entries
      .filter((e) => e.conversationId)
      .filter((e) => matchesAll(runEntryTexts(e), words))
      .slice(0, MAX_RUN_HITS)
      .map((entry) => {
        const start = entry.startedAt ?? entry.ts;
        return {
          id: `tasks-run:${entry.id}`,
          title: `${entry.planName} · ${formatDateTimeShort(start)}`,
          subtitle: `${STATUS_META[entry.status].label}${entry.endedAt !== undefined ? ` · 耗时 ${formatDuration(entry.endedAt - start)}` : ''}`,
          description: entry.summary ? snippet(entry.summary, words) : (entry.error ?? undefined),
          icon: MessageSquare,
          onSelect: () => {
            const { workspaces, openHistory } = useTasksPanelStore.getState();
            const task = useSchedulerStore.getState().tasks.find((t) => t.id === entry.planId);
            const workspaceId = resolveTaskWorkspaceId(task?.workspaceId, workspaces);
            if (!workspaceId || !entry.conversationId) return;
            openHistory({
              conversationId: entry.conversationId,
              workspaceId,
              source: 'scheduled',
              taskId: entry.planId,
            });
          },
        } satisfies SearchHit;
      });
  } catch {
    return [];
  }
}

export function TasksSearchProvider() {
  useEffect(() => {
    const provider: SearchProvider = {
      id: 'tasks',
      placeholder: '搜索任务与运行记录',
      isActive: () => useSessionStore.getState().activeTabId === TASKS_TAB_ID,
      search: async (query) => {
        const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
        if (words.length === 0) return [];
        const [scheduled, collab, runs] = await Promise.all([
          scheduledTaskHits(words),
          collabTaskHits(words),
          runHistoryHits(words),
        ]);
        return [...scheduled, ...collab, ...runs];
      },
    };
    registerProvider(provider);
    return () => unregisterProvider(provider.id);
  }, []);
  return null;
}
