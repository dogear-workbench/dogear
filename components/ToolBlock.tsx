"use client";

import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronRight, Check, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

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
  toolUseId?: string;
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
 * 格式化工具名称（用于显示）
 * 将 mcp__xxx__YyyZzz 格式转换为更友好的显示
 */
function formatToolName(toolName: string): string {
  if (toolName.startsWith("mcp__")) {
    // 格式: mcp__server-name__ToolName
    const parts = toolName.split("__");
    if (parts.length >= 3) {
      const serverName = parts[1];
      const methodName = parts.slice(2).join("__");
      return `${serverName}: ${methodName}`;
    }
  }
  return toolName;
}

/**
 * 获取工具摘要信息
 * 根据不同工具类型提取关键信息作为摘要显示
 */
function getToolSummary(
  toolName: string,
  toolInput?: any,
  toolOutput?: any
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
        <div className="w-4 h-4 rounded-full border-2 border-gray-300 border-t-gray-500 animate-spin" />
      );
    case "running":
      return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
    case "success":
      return <Check className="w-4 h-4 text-green-600" />;
    case "error":
      return <X className="w-4 h-4 text-red-600" />;
  }
}

/**
 * 工具块组件
 * 显示工具调用信息，支持折叠展开详细内容
 */
export function ToolBlock({
  toolName,
  toolInput,
  toolOutput,
  toolUseId,
  status = "success",
  isError = false,
  citations,
  className,
}: ToolBlockProps) {
  const [isOpen, setIsOpen] = useState(false);

  // 确定实际状态
  const actualStatus: ToolStatus = isError ? "error" : status;

  // 获取工具摘要
  const summary = getToolSummary(toolName, toolInput, toolOutput);

  // 格式化输出
  const formattedOutput = formatToolOutput(toolName, toolOutput);

  // 是否有可展开的内容
  const hasExpandableContent = toolInput || toolOutput;

  // 状态相关的样式
  const statusStyles: Record<ToolStatus, { bg: string; border: string; text: string }> = {
    pending: {
      bg: "bg-gray-50",
      border: "border-gray-200",
      text: "text-gray-700",
    },
    running: {
      bg: "bg-blue-50",
      border: "border-blue-200",
      text: "text-blue-700",
    },
    success: {
      bg: "bg-green-50",
      border: "border-green-200",
      text: "text-green-700",
    },
    error: {
      bg: "bg-red-50",
      border: "border-red-200",
      text: "text-red-700",
    },
  };

  const styles = statusStyles[actualStatus];

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div
        className={cn(
          "rounded-lg border",
          styles.bg,
          styles.border,
          className
        )}
      >
        {/* 工具头部 - 总是显示 */}
        <CollapsibleTrigger
          className={cn(
            "w-full flex items-center gap-2 p-3 text-left",
            "hover:bg-opacity-80 transition-colors",
            hasExpandableContent && "cursor-pointer"
          )}
          disabled={!hasExpandableContent}
        >
          {/* 展开/折叠图标 */}
          {hasExpandableContent && (
            <ChevronRight
              className={cn(
                "w-4 h-4 transition-transform duration-200",
                styles.text,
                isOpen && "rotate-90"
              )}
            />
          )}

          {/* 工具图标 */}
          <span className="text-base">{getToolIcon(toolName)}</span>

          {/* 工具名称 */}
          <span className={cn("font-medium text-sm", styles.text)}>
            {formatToolName(toolName)}
          </span>

          {/* 摘要信息 */}
          {summary && (
            <span className="text-xs text-gray-500 truncate flex-1 ml-1">
              {summary}
            </span>
          )}

          {/* 状态图标 */}
          <div className="ml-auto">
            <StatusIcon status={actualStatus} />
          </div>
        </CollapsibleTrigger>

        {/* 可折叠内容 */}
        <CollapsibleContent>
          <div className="px-3 pb-3 space-y-2">
            {/* 分隔线 */}
            <div className={cn("border-t", styles.border)} />

            {/* 工具输入 */}
            {toolInput && Object.keys(toolInput).length > 0 && (
              <div>
                <div className="text-xs font-medium text-gray-500 mb-1">
                  输入参数
                </div>
                <pre className="text-xs bg-white/50 rounded p-2 overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap break-all">
                  {JSON.stringify(toolInput, null, 2)}
                </pre>
              </div>
            )}

            {/* 工具输出 */}
            {toolOutput && (
              <div>
                <div className="text-xs font-medium text-gray-500 mb-1">
                  执行结果 {isError && <span className="text-red-500">(错误)</span>}
                </div>
                <pre
                  className={cn(
                    "text-xs rounded p-2 overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap break-all",
                    isError ? "bg-red-100/50" : "bg-white/50"
                  )}
                >
                  {formattedOutput}
                </pre>
              </div>
            )}

            {/* 引用信息 */}
            {citations && citations.length > 0 && (
              <div>
                <div className="text-xs font-medium text-gray-500 mb-1">
                  引用来源
                </div>
                <div className="flex flex-wrap gap-1">
                  {citations.map((citation, idx) => (
                    <span
                      key={idx}
                      className="inline-flex items-center px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs"
                    >
                      {citation.chapterTitle || `引用 ${idx + 1}`}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

/**
 * 工具结果块组件
 * 用于显示工具执行结果（与工具调用配对）
 */
export function ToolResultBlock({
  toolUseId,
  toolOutput,
  isError = false,
  className,
}: {
  toolUseId?: string;
  toolOutput?: any;
  isError?: boolean;
  className?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);

  // 格式化输出
  const formattedOutput =
    typeof toolOutput === "string"
      ? toolOutput
      : JSON.stringify(toolOutput, null, 2);

  // 输出摘要
  const outputSummary =
    typeof toolOutput === "string"
      ? toolOutput.split("\n")[0].substring(0, 50)
      : "查看结果";

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div
        className={cn(
          "rounded-lg border",
          isError
            ? "bg-red-50 border-red-200"
            : "bg-green-50 border-green-200",
          className
        )}
      >
        <CollapsibleTrigger className="w-full flex items-center gap-2 p-2 text-left hover:bg-opacity-80 transition-colors cursor-pointer">
          <ChevronRight
            className={cn(
              "w-4 h-4 transition-transform duration-200",
              isError ? "text-red-600" : "text-green-600",
              isOpen && "rotate-90"
            )}
          />

          <span className={cn("text-sm", isError ? "text-red-700" : "text-green-700")}>
            {isError ? "❌ 执行失败" : "✅ 执行成功"}
          </span>

          <span className="text-xs text-gray-500 truncate flex-1">
            {outputSummary}
          </span>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="px-3 pb-3">
            <div className={cn("border-t mb-2", isError ? "border-red-200" : "border-green-200")} />
            <pre
              className={cn(
                "text-xs rounded p-2 overflow-x-auto max-h-60 overflow-y-auto whitespace-pre-wrap break-all",
                isError ? "bg-red-100/50" : "bg-white/50"
              )}
            >
              {formattedOutput}
            </pre>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export default ToolBlock;
