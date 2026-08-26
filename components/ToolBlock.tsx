"use client";

import { Check, X, Loader2, FileText, FolderSearch, Search, Zap, Wrench, Terminal, PenLine, FileEdit } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { CollapsibleBlock } from './agent-chat/CollapsibleBlock';
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
import { FileChangeRenderer, formatByteSize, getEditCount } from './agent-chat/tool-renderers/FileChangeRenderer';

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
      return `${editName} · 替换 ${getEditCount(toolInput)} 处`;
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
