"use client";

import { Check, X, Loader2, FileText, FolderSearch, Search, Zap, Wrench, Terminal, PenLine, FileEdit, Eye } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMarkdownPreviewStore } from '@/stores/markdown-preview-store';
import { CollapsibleBlock } from './agent-chat/CollapsibleBlock';
import { resolvePathInWorkspace, useWorkspacePath } from './agent-chat/path-link';
import { useWorkspaceId } from './agent-chat/workspace-id-context';
import {
  ToolDetailShell,
  ToolSection,
  KeyValueList,
  OutputBox,
} from './agent-chat/tool-renderers/ToolDetailShell';
import { ReadRenderer } from './agent-chat/tool-renderers/ReadRenderer';
import { GlobRenderer } from './agent-chat/tool-renderers/GlobRenderer';
import { GrepRenderer } from './agent-chat/tool-renderers/GrepRenderer';
import { SkillRenderer } from './agent-chat/tool-renderers/SkillRenderer';
import { FileChangeRenderer, formatByteSize, getEditLineStats } from './agent-chat/tool-renderers/FileChangeRenderer';

/**
 * 工具调用状态
 */
type ToolStatus = "pending" | "running" | "success" | "error";

/**
 * 工具块属性
 */
interface ToolBlockProps {
  toolName: string;
  toolInput?: any;
  toolOutput?: any;
  status?: ToolStatus;
  isError?: boolean;
  className?: string;
}

interface ToolIconSpec {
  Icon: LucideIcon;
  className: string;
}

const TOOL_ICONS: Record<string, ToolIconSpec> = {
  Read: { Icon: FileText, className: 'text-sky-600' },
  Write: { Icon: PenLine, className: 'text-emerald-600' },
  Edit: { Icon: FileEdit, className: 'text-orange-600' },
  Bash: { Icon: Terminal, className: 'text-green-600' },
  Glob: { Icon: FolderSearch, className: 'text-indigo-600' },
  Grep: { Icon: Search, className: 'text-violet-600' },
  Skill: { Icon: Zap, className: 'text-amber-600' },
};

// pi-agent-core 基础工具名是小写（read/bash），旧 SDK 会话历史是大写，统一归一化到大写再匹配
const TOOL_NAME_ALIASES: Record<string, string> = {
  read: 'Read',
  write: 'Write',
  edit: 'Edit',
  bash: 'Bash',
};

function normalizeToolName(toolName: string): string {
  return TOOL_NAME_ALIASES[toolName] ?? toolName;
}

function getToolIcon(toolName: string): ToolIconSpec {
  if (TOOL_ICONS[toolName]) return TOOL_ICONS[toolName];
  return { Icon: Wrench, className: 'text-slate-600' };
}

interface ToolPreviewAction {
  tooltip: string;
  open: () => void;
}

const READ_EDIT_PREVIEW_EXT_RE = /\.(md|markdown|txt|json)$/i;
const WRITE_PREVIEW_EXT_RE = /\.(md|markdown)$/i;

function buildPreviewAction(opts: {
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


/**
 * 获取工具摘要信息
 * 根据不同工具类型提取关键信息作为摘要显示
 */
function getToolSummary(
  toolName: string,
  toolInput?: any,
  _toolOutput?: any
): string {
  const canonicalName = normalizeToolName(toolName);
  if (!toolInput) return "";

  switch (canonicalName) {
    case "Read":
      const filePath = toolInput.file_path || toolInput.path || "";
      const fileName = filePath.split("/").pop() || filePath;
      if (toolInput.offset && toolInput.limit) {
        return `${fileName} (行 ${toolInput.offset}-${toolInput.offset + toolInput.limit})`;
      }
      return fileName;

    case "Write": {
      const writeFile = toolInput.file_path || toolInput.path || "";
      const writeName = writeFile.split(/[\\/]/).pop() || writeFile;
      const writeContent = typeof toolInput.content === "string" ? toolInput.content : "";
      return `${writeName} · 写入 ${formatByteSize(writeContent)}`;
    }

    case "Edit": {
      const editFile = toolInput.file_path || toolInput.path || "";
      const editName = editFile.split(/[\\/]/).pop() || editFile;
      const { added, removed } = getEditLineStats(toolInput);
      return `${editName} · +${added} −${removed} 行`;
    }

    case "Bash":
      const cmd = toolInput.command || "";
      // 截断过长的命令
      return cmd.length > 50 ? cmd.substring(0, 50) + "..." : cmd;

    case "Grep":
      const pattern = toolInput.pattern || "";
      const grepPath = toolInput.path || ".";
      return `"${pattern}" in ${grepPath}`;

    case "Glob":
      return toolInput.pattern || "";

    case "Skill":
      // pi 的 Skill 工具参数是 name，旧 SDK 会话历史是 skill
      return toolInput.name || toolInput.skill || "";

    default:
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

/**
 * 格式化工具输出用于显示（不截断，由 OutputBox 的 max-h 滚动）
 */
function formatToolOutput(_toolName: string, toolOutput?: any): string {
  if (toolOutput === undefined || toolOutput === null) return "";
  if (typeof toolOutput === "string") return toolOutput;
  return JSON.stringify(toolOutput, null, 2);
}

/**
 * 状态图标组件
 */
function StatusIcon({ status }: { status: ToolStatus }) {
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

/**
 * 工具块组件
 * 使用 CollapsibleBlock 渐隐预览样式，无边框无背景色
 */
export function ToolBlock({
  toolName,
  toolInput,
  toolOutput,
  status = "success",
  isError = false,
  className,
}: ToolBlockProps) {
  const actualStatus: ToolStatus = isError ? "error" : status;
  const workspaceId = useWorkspaceId();
  const workspacePath = useWorkspacePath(workspaceId);
  const previewAction = actualStatus === 'success' && !isError
    ? buildPreviewAction({ toolName, toolInput, toolOutput, workspaceId, workspacePath })
    : null;
  const summary = getToolSummary(toolName, toolInput, toolOutput);
  const formattedOutput = formatToolOutput(toolName, toolOutput);
  const canonicalName = normalizeToolName(toolName);
  const iconSpec = getToolIcon(canonicalName);
  const titleText = summary ? `${canonicalName} · ${summary}` : canonicalName;

  // Tier 1 专属渲染器
  const specializedRenderer = (() => {
    if (canonicalName === 'Write' || canonicalName === 'Edit') {
      return <FileChangeRenderer kind={canonicalName === 'Write' ? 'write' : 'edit'} toolInput={toolInput} toolOutput={toolOutput} isError={isError} />;
    }
    if (canonicalName === 'Read') {
      return <ReadRenderer toolInput={toolInput} toolOutput={toolOutput} isError={isError} />;
    }
    if (canonicalName === 'Glob') {
      return <GlobRenderer toolInput={toolInput} toolOutput={toolOutput} isError={isError} />;
    }
    if (canonicalName === 'Grep') {
      return <GrepRenderer toolInput={toolInput} toolOutput={toolOutput} isError={isError} />;
    }
    if (canonicalName === 'Skill') {
      return <SkillRenderer toolInput={toolInput} toolOutput={toolOutput} isError={isError} />;
    }
    return null;
  })();

  const { Icon: ToolIconComp, className: iconColor } = iconSpec;
  const iconNode = <ToolIconComp className={cn('w-4 h-4', iconColor)} />;

  return (
    <CollapsibleBlock
      icon={iconNode}
      title={titleText}
      titleClassName={cn(
        actualStatus === 'error' && 'text-red-600',
        actualStatus === 'running' && 'text-sky-600',
      )}
      statusIcon={<StatusIcon status={actualStatus} />}
      headerActions={previewAction && (
        <span
          role="button"
          tabIndex={0}
          title={previewAction.tooltip}
          onClick={(e) => {
            e.stopPropagation();
            previewAction.open();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              previewAction.open();
            }
          }}
          className="flex-shrink-0 inline-flex items-center justify-center p-0.5 rounded text-muted-foreground/40 hover:text-sky-600 hover:bg-sky-50 transition-colors cursor-pointer"
        >
          <Eye className="w-3.5 h-3.5" />
        </span>
      )}
      previewLines={0}
      defaultOpen={false}
      className={className}
    >
      {specializedRenderer ?? (
        <ToolDetailShell>
          {toolInput && Object.keys(toolInput).length > 0 && (
            <ToolSection label="输入">
              <KeyValueList data={toolInput} />
            </ToolSection>
          )}
          {toolOutput !== undefined && toolOutput !== null && toolOutput !== '' && (
            <ToolSection label={isError ? '错误' : '输出'}>
              <OutputBox content={formattedOutput} isError={isError} />
            </ToolSection>
          )}
        </ToolDetailShell>
      )}
    </CollapsibleBlock>
  );
}

export default ToolBlock;
