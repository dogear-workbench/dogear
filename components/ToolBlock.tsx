"use client";

import { Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSettingsStore } from '@/stores/settings-store';
import { CollapsibleBlock } from './agent-chat/CollapsibleBlock';
import { SearchHitBadge } from './agent-chat/SearchHitBadge';
import { useWorkspacePath } from './agent-chat/path-link';
import { useWorkspaceId } from './agent-chat/workspace-id-context';
import {
  ToolDetailShell,
  ToolSection,
  KeyValueList,
  OutputBox,
} from './agent-chat/tool-renderers/ToolDetailShell';
import {
  getSpecializedRenderer,
  getToolIcon,
  getToolTitleText,
  formatToolOutput,
  normalizeToolName,
  StatusIcon,
  ToolHeaderActionButton,
  type ToolStatus,
} from './agent-chat/tool-renderers/tool-dispatch';
import { buildPreviewAction, buildResultAction } from './agent-chat/tool-renderers/tool-actions';

interface ToolBlockProps {
  toolName: string;
  toolInput?: any;
  toolOutput?: any;
  toolUseId?: string;
  status?: ToolStatus;
  isError?: boolean;
  className?: string;
  /** 搜索命中本工具块：强制展开 + 卡片高亮 */
  searchHit?: boolean;
  /** 搜索命中本块时的块内命中总数（仅 searchHit 时显示徽标） */
  activeMatchCount?: number;
}

/**
 * 独立单工具卡（不满足分组的单个工具）
 * 使用 CollapsibleBlock 渐隐预览样式，无边框无背景色
 */
export function ToolBlock({
  toolName,
  toolInput,
  toolOutput,
  toolUseId,
  status = "success",
  isError = false,
  className,
  searchHit = false,
  activeMatchCount = 0,
}: ToolBlockProps) {
  const actualStatus: ToolStatus = isError ? "error" : status;
  const displayMode = useSettingsStore(s => s.settings?.ui?.messageDisplayMode ?? 'compact');
  const showHitBadge = searchHit && activeMatchCount > 0;
  const workspaceId = useWorkspaceId();
  const workspacePath = useWorkspacePath(workspaceId);
  const previewAction = actualStatus === 'success' && !isError
    ? buildPreviewAction({ toolName, toolInput, toolOutput, workspaceId, workspacePath })
    : null;
  const jumpAction = actualStatus === 'success' && !isError
    ? buildResultAction({ toolName, toolInput, toolOutput, workspaceId, workspacePath })
    : null;
  const titleText = getToolTitleText(toolName, toolInput);
  const formattedOutput = formatToolOutput(toolOutput);
  const iconSpec = getToolIcon(normalizeToolName(toolName));
  const { Icon: ToolIconComp, className: iconColor } = iconSpec;
  const iconNode = <ToolIconComp className={cn('w-4 h-4', iconColor)} />;

  return (
    <CollapsibleBlock
      icon={iconNode}
      title={titleText}
      titleClassName={cn(
        actualStatus === 'error' && 'text-red-600 dark:text-red-400',
        actualStatus === 'running' && 'text-sky-600 dark:text-sky-400',
      )}
      statusIcon={<StatusIcon status={actualStatus} />}
      headerActions={(showHitBadge || previewAction || jumpAction) && (
        <span className="inline-flex items-center gap-0.5">
          {showHitBadge && <SearchHitBadge count={activeMatchCount} />}
          {previewAction && (
            <ToolHeaderActionButton icon={Eye} tooltip={previewAction.tooltip} onOpen={previewAction.open} />
          )}
          {jumpAction && (
            <ToolHeaderActionButton icon={jumpAction.icon} tooltip={jumpAction.tooltip} onOpen={jumpAction.open} />
          )}
        </span>
      )}
      previewLines={0}
      defaultOpen={displayMode === 'detailed'}
      className={className}
      forceOpen={searchHit}
      highlighted={searchHit}
    >
      {getSpecializedRenderer({ toolName, toolInput, toolOutput, toolUseId, isError }) ?? (
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
