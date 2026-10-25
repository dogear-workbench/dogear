import type { ComponentType, ReactNode } from 'react';
import { Check, X, Loader2, FileText, FolderSearch, Search, Zap, Wrench, Terminal, PenLine, FileEdit, Brain, StickyNote, ListTodo, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ReadRenderer } from './ReadRenderer';
import { MemoryCardRenderer } from './MemoryCardRenderer';
import { NoteCardRenderer } from './NoteCardRenderer';
import { TaskCardRenderer } from './TaskCardRenderer';
import { GlobRenderer } from './GlobRenderer';
import { GrepRenderer } from './GrepRenderer';
import { SkillRenderer } from './SkillRenderer';
import { FileChangeRenderer, getEditLineStats } from './FileChangeRenderer';

export type ToolStatus = "pending" | "running" | "success" | "error";

export interface ToolIconSpec {
  Icon: LucideIcon;
  className: string;
}

const TOOL_ICONS: Record<string, ToolIconSpec> = {
  Read: { Icon: FileText, className: 'text-sky-600 dark:text-sky-400' },
  Write: { Icon: PenLine, className: 'text-emerald-600 dark:text-emerald-400' },
  Edit: { Icon: FileEdit, className: 'text-orange-600 dark:text-orange-400' },
  Bash: { Icon: Terminal, className: 'text-green-600 dark:text-green-400' },
  Glob: { Icon: FolderSearch, className: 'text-indigo-600 dark:text-indigo-400' },
  Grep: { Icon: Search, className: 'text-violet-600 dark:text-violet-400' },
  Skill: { Icon: Zap, className: 'text-amber-600 dark:text-amber-400' },
};

// pi-agent-core 基础工具名是小写（read/bash），旧 SDK 会话历史是大写，统一归一化到大写再匹配
const TOOL_NAME_ALIASES: Record<string, string> = {
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  bash: 'Bash',
};

const DOGEAR_TOOL_ICONS: Record<string, ToolIconSpec> = {
  dogear__SaveMemory: { Icon: Brain, className: 'text-teal-600 dark:text-teal-400' },
  dogear__ForgetMemory: { Icon: Brain, className: 'text-teal-600 dark:text-teal-400' },
  dogear__CreateNote: { Icon: StickyNote, className: 'text-amber-600 dark:text-amber-400' },
  dogear__UpdateNote: { Icon: StickyNote, className: 'text-amber-600 dark:text-amber-400' },
  dogear__AppendNote: { Icon: StickyNote, className: 'text-amber-600 dark:text-amber-400' },
  dogear__CreateTask: { Icon: ListTodo, className: 'text-blue-600 dark:text-blue-400' },
  dogear__UpdateTask: { Icon: PenLine, className: 'text-blue-600 dark:text-blue-400' },
  dogear__DeleteTask: { Icon: Trash2, className: 'text-red-600 dark:text-red-400' },
  dogear__ExecuteTask: { Icon: ListTodo, className: 'text-blue-600 dark:text-blue-400' },
};

export function normalizeToolName(toolName: string): string {
  return TOOL_NAME_ALIASES[toolName] ?? toolName;
}

export function getToolIcon(toolName: string): ToolIconSpec {
  if (TOOL_ICONS[toolName]) return TOOL_ICONS[toolName];
  if (DOGEAR_TOOL_ICONS[toolName]) return DOGEAR_TOOL_ICONS[toolName];
  return { Icon: Wrench, className: 'text-slate-600 dark:text-slate-400' };
}

export interface CardRendererProps {
  toolInput?: Record<string, any>;
  toolOutput?: any;
  toolUseId?: string;
  isError?: boolean;
}

export interface DogearCardTitle {
  label: string;
  detail: string;
}

function firstLineTitle(content: string): string {
  return content.split('\n')[0]?.replace(/^#{1,6}\s*/, '').trim() ?? '';
}

const DOGEAR_CARD_TITLES: Record<string, (input?: Record<string, any>) => DogearCardTitle> = {
  dogear__SaveMemory: (input) => ({ label: '保存记忆', detail: input?.title ?? '' }),
  dogear__ForgetMemory: (input) => ({ label: '删除记忆', detail: input?.slug ?? '' }),
  dogear__CreateNote: (input) => ({
    label: '创建笔记',
    detail: typeof input?.content === 'string' ? firstLineTitle(input.content) : '',
  }),
  dogear__UpdateNote: (input) => ({ label: '更新笔记', detail: input?.noteId ?? '' }),
  dogear__AppendNote: (input) => ({ label: '追加笔记', detail: input?.noteId ?? '' }),
  dogear__CreateTask: (input) => ({ label: '挂载任务', detail: input?.title ?? '' }),
  dogear__UpdateTask: (input) => ({ label: '更新任务', detail: input?.taskId ?? '' }),
  dogear__DeleteTask: (input) => ({ label: '删除任务', detail: input?.taskId ?? '' }),
  dogear__ExecuteTask: (input) => ({ label: '执行任务', detail: input?.taskId ?? '' }),
  dogear__TrackUserActions: (input) => ({
    label: '待你完成',
    detail: `${Array.isArray(input?.actions) ? input.actions.length : '?'} 项`,
  }),
};

const DOGEAR_CARD_RENDERERS: Record<string, ComponentType<CardRendererProps>> = {
  dogear__SaveMemory: MemoryCardRenderer,
  dogear__ForgetMemory: MemoryCardRenderer,
  dogear__CreateNote: NoteCardRenderer,
  dogear__UpdateNote: NoteCardRenderer,
  dogear__AppendNote: NoteCardRenderer,
  dogear__CreateTask: TaskCardRenderer,
  dogear__ExecuteTask: TaskCardRenderer,
};

export function getDogearCardTitle(canonicalName: string, toolInput?: Record<string, any>): DogearCardTitle | undefined {
  return DOGEAR_CARD_TITLES[canonicalName]?.(toolInput);
}

/**
 * 获取工具摘要信息
 * 根据不同工具类型提取关键信息作为摘要显示
 */
export function getToolSummary(toolName: string, toolInput?: any): string {
  const canonicalName = normalizeToolName(toolName);
  const dogearTitle = DOGEAR_CARD_TITLES[canonicalName];
  if (dogearTitle) return dogearTitle(toolInput).detail;
  if (!toolInput) return "";

  switch (canonicalName) {
    case "Read": {
      const filePath = toolInput.file_path || toolInput.path || "";
      const fileName = filePath.split("/").pop() || filePath;
      if (toolInput.offset && toolInput.limit) {
        return `${fileName} (行 ${toolInput.offset}-${toolInput.offset + toolInput.limit})`;
      }
      return fileName;
    }

    case "Write": {
      const writeFile = toolInput.file_path || toolInput.path || "";
      const writeName = writeFile.split(/[\\/]/).pop() || writeFile;
      const writeContent = typeof toolInput.content === "string" ? toolInput.content : "";
      return writeContent
        ? `${writeName} · 写入 ${writeContent.split("\n").length} 行`
        : writeName;
    }

    case "Edit": {
      const editFile = toolInput.file_path || toolInput.path || "";
      const editName = editFile.split(/[\\/]/).pop() || editFile;
      const { added, removed } = getEditLineStats(toolInput);
      return `${editName} · +${added} −${removed} 行`;
    }

    case "Bash": {
      const cmd = toolInput.command || "";
      return cmd.length > 50 ? cmd.substring(0, 50) + "..." : cmd;
    }

    case "Grep": {
      const pattern = toolInput.pattern || "";
      const grepPath = toolInput.path || ".";
      return `"${pattern}" in ${grepPath}`;
    }

    case "Glob":
      return toolInput.pattern || "";

    case "Skill":
      // pi 的 Skill 工具参数是 name，旧 SDK 会话历史是 skill
      return toolInput.name || toolInput.skill || "";

    default: {
      // 对于未知工具，尝试提取第一个字符串属性
      const keys = Object.keys(toolInput);
      if (keys.length > 0) {
        const firstValue = toolInput[keys[0]];
        if (typeof firstValue === "string") {
          return firstValue.length > 40
            ? firstValue.substring(0, 40) + "..."
            : firstValue;
        }
      }
      return "";
    }
  }
}

/**
 * 格式化工具输出用于显示（不截断，由 OutputBox 的 max-h 滚动）
 */
export function formatToolOutput(toolOutput?: any): string {
  if (toolOutput === undefined || toolOutput === null) return "";
  if (typeof toolOutput === "string") return toolOutput;
  return JSON.stringify(toolOutput, null, 2);
}

export function getToolTitleText(toolName: string, toolInput?: any): string {
  const canonicalName = normalizeToolName(toolName);
  const dogearCard = getDogearCardTitle(canonicalName, toolInput);
  if (dogearCard) {
    return `${dogearCard.label}${dogearCard.detail ? ` · ${dogearCard.detail}` : ''}`;
  }
  const summary = getToolSummary(toolName, toolInput);
  return summary ? `${canonicalName} · ${summary}` : canonicalName;
}

export function getSpecializedRenderer(opts: CardRendererProps & { toolName: string }): ReactNode {
  const canonicalName = normalizeToolName(opts.toolName);
  if (canonicalName === 'Write' || canonicalName === 'Edit') {
    return <FileChangeRenderer kind={canonicalName === 'Write' ? 'write' : 'edit'} toolInput={opts.toolInput} toolOutput={opts.toolOutput} isError={opts.isError} />;
  }
  if (canonicalName === 'Read') {
    return <ReadRenderer toolInput={opts.toolInput} toolOutput={opts.toolOutput} isError={opts.isError} />;
  }
  if (canonicalName === 'Glob') {
    return <GlobRenderer toolInput={opts.toolInput} toolOutput={opts.toolOutput} isError={opts.isError} />;
  }
  if (canonicalName === 'Grep') {
    return <GrepRenderer toolInput={opts.toolInput} toolOutput={opts.toolOutput} isError={opts.isError} />;
  }
  if (canonicalName === 'Skill') {
    return <SkillRenderer toolInput={opts.toolInput} toolOutput={opts.toolOutput} isError={opts.isError} />;
  }
  const DogearCard = DOGEAR_CARD_RENDERERS[canonicalName];
  if (DogearCard) {
    return <DogearCard toolInput={opts.toolInput} toolOutput={opts.toolOutput} toolUseId={opts.toolUseId} isError={opts.isError} />;
  }
  return null;
}

export function StatusIcon({ status }: { status: ToolStatus }) {
  switch (status) {
    case "pending":
      return (
        <div className="w-4 h-4 rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground animate-spin" />
      );
    case "running":
      return <Loader2 className="w-4 h-4 text-sky-500 animate-spin" />;
    case "success":
      return <Check className="w-4 h-4 text-muted-foreground" />;
    case "error":
      return <X className="w-4 h-4 text-red-500" />;
  }
}

export function ToolHeaderActionButton({ icon: Icon, tooltip, onOpen }: {
  icon: LucideIcon;
  tooltip: string;
  onOpen: () => void;
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      title={tooltip}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onOpen();
        }
      }}
      className="flex-shrink-0 inline-flex items-center justify-center p-0.5 rounded text-muted-foreground/40 hover:text-sky-600 hover:bg-sky-50 dark:hover:text-sky-400 dark:hover:bg-sky-950 transition-colors cursor-pointer"
    >
      <Icon className="w-3.5 h-3.5" />
    </span>
  );
}
