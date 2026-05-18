"use client";

import { Check, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { CollapsibleBlock } from './agent-chat/CollapsibleBlock';
import { useSettingsStore } from '@/stores/settings-store';
import { useToolRegistryStore } from '@/stores/tool-registry-store';

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

/**
 * 工具图标映射
 */
const TOOL_ICONS: Record<string, string> = {
  Read: "📄",
  Write: "📝",
  Edit: "✏️",
  Bash: "💻",
  Grep: "🔍",
  Glob: "📁",
  WebSearch: "🌐",
  WebFetch: "🔗",
  Task: "🤖",
  TodoWrite: "📋",
  AskUserQuestion: "❓",
  Skill: "⚡",  // Skill 类型图标
  default: "🔧",
};

/**
 * 获取工具图标
 */
function getToolIcon(toolName: string): string {
  // 检查是否是 MCP 工具
  if (toolName.startsWith("mcp__")) {
    return "🔌";  // MCP 工具图标
  }
  return TOOL_ICONS[toolName] || TOOL_ICONS.default;
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
 * 格式化工具输出用于显示
 */
function formatToolOutput(toolName: string, toolOutput?: any): string {
  if (!toolOutput) return "";

  if (typeof toolOutput === "string") {
    // 对于很长的输出，显示行数统计
    const lines = toolOutput.split("\n");
    if (lines.length > 100) {
      return toolOutput.substring(0, 5000) + `\n\n... (共 ${lines.length} 行)`;
    }
    return toolOutput.length > 5000
      ? toolOutput.substring(0, 5000) + "..."
      : toolOutput;
  }

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
  const icon = getToolIcon(toolName);
  const getCategoryLabel = useToolRegistryStore(s => s.getCategoryLabel);
  const categoryLabel = getCategoryLabel(toolName);

  // 优先级：具体工具名（去掉 mcp__server__ 前缀）> 类别名
  // 让用户能看出 Read/Edit/Bash 这种 SDK 工具的具体名称，而不是统一"SDK 内置工具"
  const niceName = toolName.startsWith('mcp__')
    ? toolName.split('__').slice(2).join('__') || categoryLabel
    : toolName;
  const headLabel = niceName || categoryLabel;
  const titleText = summary ? `${headLabel} · ${summary}` : headLabel;

  return (
    <CollapsibleBlock
      icon={
        <span className="flex items-center justify-center w-5 h-5 rounded border border-blue-200 bg-blue-50 text-xs">
          {icon}
        </span>
      }
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
      <div className="space-y-1.5 text-xs rounded-md bg-muted/20 px-2.5 py-2">
        {/* 输入参数：展平显示，去掉最外层 {} */}
        {toolInput && Object.keys(toolInput).length > 0 && (
          <div className="text-muted-foreground whitespace-pre-wrap break-all">
            {Object.entries(toolInput).map(([k, v]) => `"${k}": ${JSON.stringify(v)}`).join(',\n')}
          </div>
        )}
        {/* 执行结果 */}
        {toolOutput && (
          <div className={cn(
            "whitespace-pre-wrap break-all",
            toolInput && Object.keys(toolInput).length > 0 && "border-t border-border/30 pt-1.5 mt-1",
            isError ? "text-red-600" : "text-muted-foreground"
          )}>
            {isError && <span className="text-red-500/70 text-[10px] block mb-0.5">错误</span>}
            {formattedOutput}
          </div>
        )}
        {/* 引用 */}
        {citations && citations.length > 0 && (
          <div className="flex flex-wrap gap-1 pt-1">
            {citations.map((c, i) => (
              <span key={i} className="px-1.5 py-0.5 bg-muted rounded text-muted-foreground text-xs">
                {c.chapterTitle || `引用 ${i + 1}`}
              </span>
            ))}
          </div>
        )}
      </div>
    </CollapsibleBlock>
  );
}

export default ToolBlock;
