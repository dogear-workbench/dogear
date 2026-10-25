import { ExternalLink } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { toast } from 'sonner';
import { client } from '@/lib/client';
import { useMarkdownPreviewStore } from '@/stores/markdown-preview-store';
import { useSessionStore, NOTES_TAB_ID, TASKS_TAB_ID } from '@/stores/session-store';
import { useNotesStore } from '@/stores/notes-store';
import { useTaskFocusStore } from '@/stores/task-focus-store';
import { resolvePathInWorkspace } from '../path-link';
import { formatToolOutput, normalizeToolName } from './tool-dispatch';

export interface ToolPreviewAction {
  tooltip: string;
  open: () => void;
}

const READ_EDIT_PREVIEW_EXT_RE = /\.(md|markdown|txt|json)$/i;
const WRITE_PREVIEW_EXT_RE = /\.(md|markdown)$/i;

export function buildPreviewAction(opts: {
  toolName: string;
  toolInput?: any;
  toolOutput?: any;
  workspaceId: string | null;
  workspacePath: string | null;
}): ToolPreviewAction | null {
  const canonicalName = normalizeToolName(opts.toolName);
  const input = opts.toolInput;
  const outputText = typeof opts.toolOutput === 'string' ? opts.toolOutput : '';
  const path = input?.file_path ?? input?.path ?? '';
  const fileName = path.split(/[\\/]/).pop() || path;

  if (canonicalName === 'Read') {
    if (path && READ_EDIT_PREVIEW_EXT_RE.test(path) && outputText) {
      return {
        tooltip: `预览 ${fileName}`,
        open: () => useMarkdownPreviewStore.getState().openInline(fileName, outputText),
      };
    }
    return null;
  }

  if (canonicalName === 'Write') {
    const content = typeof input?.content === 'string' ? input.content : '';
    if (path && WRITE_PREVIEW_EXT_RE.test(path) && content) {
      return {
        tooltip: `预览 ${fileName}`,
        open: () => useMarkdownPreviewStore.getState().openInline(fileName, content),
      };
    }
    return null;
  }

  if (canonicalName === 'Edit') {
    const resolved = opts.workspacePath && path && READ_EDIT_PREVIEW_EXT_RE.test(path)
      ? resolvePathInWorkspace(path, opts.workspacePath)
      : null;
    if (opts.workspaceId && resolved) {
      return {
        tooltip: `预览 ${fileName}`,
        open: () => useMarkdownPreviewStore.getState().open(opts.workspaceId!, resolved, fileName),
      };
    }
    return null;
  }

  if (canonicalName === 'Skill') {
    const skillName = input?.name ?? input?.skill ?? 'Skill';
    if (outputText) {
      return {
        tooltip: `预览 ${skillName}`,
        open: () => useMarkdownPreviewStore.getState().openInline(`${skillName} · skill`, outputText),
      };
    }
    return null;
  }

  if (opts.toolName === 'dogear__ListGroupFiles') {
    const relPath = typeof input?.relPath === 'string' ? input.relPath : '';
    if (relPath && outputText) {
      return {
        tooltip: `预览 ${relPath}`,
        open: () => useMarkdownPreviewStore.getState().openInline(relPath, outputText),
      };
    }
    return null;
  }

  return null;
}

export interface ToolResultAction {
  icon: LucideIcon;
  tooltip: string;
  open: () => void;
}

function extractOutputId(outputText: string, re: RegExp): string {
  return outputText.match(re)?.[1] ?? '';
}

export function buildResultAction(opts: {
  toolName: string;
  toolInput?: any;
  toolOutput?: any;
  workspaceId: string | null;
  workspacePath: string | null;
}): ToolResultAction | null {
  const canonicalName = normalizeToolName(opts.toolName);
  const input = opts.toolInput;
  const outputText = formatToolOutput(opts.toolOutput);
  const workspaceId = opts.workspaceId;

  if (canonicalName === 'dogear__CreateNote' || canonicalName === 'dogear__UpdateNote' || canonicalName === 'dogear__AppendNote') {
    const noteId = (typeof input?.noteId === 'string' && input.noteId)
      || extractOutputId(outputText, /已创建卡片 ([^\s（「」"\\]+)/);
    if (!noteId || !workspaceId) return null;
    return {
      icon: ExternalLink,
      tooltip: '打开卡片',
      open: () => {
        void (async () => {
          const result = await client.getNote({ workspaceId, noteId }).catch(() => null);
          if (!result || !('note' in result) || !result.note) {
            toast.warning('卡片不存在或已删除');
            return;
          }
          useSessionStore.getState().switchTab(NOTES_TAB_ID);
          useNotesStore.getState().setActiveNoteId(noteId);
        })();
      },
    };
  }

  if (canonicalName === 'dogear__CreateTask' || canonicalName === 'dogear__ExecuteTask') {
    const workspacePath = opts.workspacePath;
    const taskId = (typeof input?.taskId === 'string' && input.taskId)
      || extractOutputId(outputText, /任务 ID: ([^\s"\\]+)/);
    if (!taskId || !workspacePath) return null;
    return {
      icon: ExternalLink,
      tooltip: '打开任务',
      open: () => {
        void (async () => {
          const result = await client.getCollabTask({ workspacePath, taskId }).catch(() => null);
          if (!result || !('detail' in result) || !result.detail) {
            toast.warning('任务不存在或已删除');
            return;
          }
          useSessionStore.getState().switchTab(TASKS_TAB_ID);
          useTaskFocusStore.getState().requestTaskFocus(taskId);
        })();
      },
    };
  }

  return null;
}
