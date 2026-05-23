"use client";

import { Check, X, Loader2, FileText, FolderSearch, Search, Globe, Link2, Bot, ClipboardList, HelpCircle, Zap, Wrench, Plug } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { CollapsibleBlock } from './agent-chat/CollapsibleBlock';
import { useSettingsStore } from '@/stores/settings-store';
import { useToolRegistryStore } from '@/stores/tool-registry-store';
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
  citations?: any[];
  className?: string;
}

interface ToolIconSpec {
  Icon: LucideIcon;
  className: string;
  bg: string;
}

const TOOL_ICONS: Record<string, ToolIconSpec> = {
  Read: { Icon: FileText, className: 'text-sky-600', bg: 'border-sky-200 bg-sky-50' },
  Glob: { Icon: FolderSearch, className: 'text-indigo-600', bg: 'border-indigo-200 bg-indigo-50' },
  Grep: { Icon: Search, className: 'text-violet-600', bg: 'border-violet-200 bg-violet-50' },
  WebSearch: { Icon: Globe, className: 'text-cyan-600', bg: 'border-cyan-200 bg-cyan-50' },
  WebFetch: { Icon: Link2, className: 'text-cyan-600', bg: 'border-cyan-200 bg-cyan-50' },
  Task: { Icon: Bot, className: 'text-purple-600', bg: 'border-purple-200 bg-purple-50' },
  TodoWrite: { Icon: ClipboardList, className: 'text-amber-600', bg: 'border-amber-200 bg-amber-50' },
  TaskList: { Icon: ClipboardList, className: 'text-amber-600', bg: 'border-amber-200 bg-amber-50' },
  TaskGet: { Icon: ClipboardList, className: 'text-amber-600', bg: 'border-amber-200 bg-amber-50' },
  AskUserQuestion: { Icon: HelpCircle, className: 'text-blue-600', bg: 'border-blue-200 bg-blue-50' },
  Skill: { Icon: Zap, className: 'text-amber-600', bg: 'border-amber-200 bg-amber-50' },
};

function getToolIcon(toolName: string): ToolIconSpec {
  if (TOOL_ICONS[toolName]) return TOOL_ICONS[toolName];
  if (toolName.startsWith('mcp__')) {
    return { Icon: Plug, className: 'text-teal-600', bg: 'border-teal-200 bg-teal-50' };
  }
  return { Icon: Wrench, className: 'text-slate-600', bg: 'border-slate-200 bg-slate-50' };
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
  if (!toolInput) return "";

  switch (toolName) {
    case "Read":
      const filePath = toolInput.file_path || toolInput.path || "";
      const fileName = filePath.split("/").pop() || filePath;
      if (toolInput.offset && toolInput.limit) {
        return `${fileName} (行 ${toolInput.offset}-${toolInput.offset + toolInput.limit})`;
      }
      return fileName;

    case "Write":
      const writeFile = toolInput.file_path || "";
      return writeFile.split("/").pop() || writeFile;

    case "Edit":
      const editFile = toolInput.file_path || "";
      return editFile.split("/").pop() || editFile;

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

    case "WebSearch":
      return toolInput.query || "";

    case "WebFetch":
      const url = toolInput.url || "";
      try {
        const hostname = new URL(url).hostname;
        return hostname;
      } catch {
        return url.substring(0, 30) + "...";
      }

    case "Task":
      return toolInput.description || toolInput.prompt?.substring(0, 40) || "";

    case "TodoWrite":
      const todos = toolInput.todos || [];
      return `${todos.length} 个任务`;

    case "TaskCreate":
      return toolInput.subject || "";

    case "TaskUpdate":
      return toolInput.taskId
        ? `${toolInput.taskId}${toolInput.status ? ` → ${toolInput.status}` : ''}`
        : "";

    case "TaskGet":
      return toolInput.taskId || "";

    case "TaskList":
      return "查询任务列表";

    case "AskUserQuestion":
      const questions = toolInput.questions || [];
      return `${questions.length} 个问题`;

    case "Skill":
      // Skill 工具：显示调用的 skill 名称
      const skillName = toolInput.skill || "";
      const skillArgs = toolInput.args || "";
      return skillArgs ? `${skillName} ${skillArgs}` : skillName;

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
  citations,
  className,
}: ToolBlockProps) {
  const displayMode = useSettingsStore(s => s.settings?.ui?.messageDisplayMode ?? 'compact');
  const actualStatus: ToolStatus = isError ? "error" : status;
  const summary = getToolSummary(toolName, toolInput, toolOutput);
  const formattedOutput = formatToolOutput(toolName, toolOutput);
  const iconSpec = getToolIcon(toolName);
  const getCategoryLabel = useToolRegistryStore(s => s.getCategoryLabel);
  const categoryLabel = getCategoryLabel(toolName);

  // 优先级：具体工具名（去掉 mcp__server__ 前缀）> 类别名
  // 让用户能看出 Read/Edit/Bash 这种 SDK 工具的具体名称，而不是统一"SDK 内置工具"
  const niceName = toolName.startsWith('mcp__')
    ? toolName.split('__').slice(2).join('__') || categoryLabel
    : toolName;
  const headLabel = niceName || categoryLabel;
  const titleText = summary ? `${headLabel} · ${summary}` : headLabel;

  // Tier 1 专属渲染器
  const specializedRenderer = (() => {
    if (toolName === 'Read') {
      return <ReadRenderer toolInput={toolInput} toolOutput={toolOutput} isError={isError} />;
    }
    if (toolName === 'Glob') {
      return <GlobRenderer toolInput={toolInput} toolOutput={toolOutput} isError={isError} />;
    }
    if (toolName === 'Grep') {
      return <GrepRenderer toolInput={toolInput} toolOutput={toolOutput} isError={isError} />;
    }
    if (toolName === 'Skill') {
      return <SkillRenderer toolInput={toolInput} toolOutput={toolOutput} isError={isError} />;
    }
    return null;
  })();

  const { Icon: ToolIconComp, className: iconColor, bg: iconBg } = iconSpec;
  const iconNode = (
    <span className={cn('flex items-center justify-center w-5 h-5 rounded border', iconBg)}>
      <ToolIconComp className={cn('w-3 h-3', iconColor)} />
    </span>
  );

  return (
    <CollapsibleBlock
      icon={iconNode}
      title={titleText}
      titleClassName={cn(
        actualStatus === 'error' && 'text-red-600',
        actualStatus === 'running' && 'text-sky-600',
      )}
      statusIcon={<StatusIcon status={actualStatus} />}
      previewLines={displayMode === 'compact' ? 0 : 2}
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
          {citations && citations.length > 0 && (
            <ToolSection label="引用">
              <div className="flex flex-wrap gap-1">
                {citations.map((c, i) => (
                  <span key={i} className="px-1.5 py-0.5 bg-muted rounded text-muted-foreground text-xs">
                    {c.chapterTitle || `引用 ${i + 1}`}
                  </span>
                ))}
              </div>
            </ToolSection>
          )}
        </ToolDetailShell>
      )}
    </CollapsibleBlock>
  );
}

export default ToolBlock;
