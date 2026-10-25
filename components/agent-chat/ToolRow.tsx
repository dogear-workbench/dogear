"use client";

import { Eye, MessageSquareQuote, PictureInPicture2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMarkdownPreviewStore } from '@/stores/markdown-preview-store';
import { useReferenceStore } from '@/stores/reference-store';
import { useSettingsStore } from '@/stores/settings-store';
import { CollapsibleBlock } from './CollapsibleBlock';
import { SearchHitBadge } from './SearchHitBadge';
import { useConversationId } from './conversation-id-context';
import { useWorkspaceId } from './workspace-id-context';
import { useWorkspacePath } from './path-link';
import {
  ToolDetailShell,
  ToolSection,
  KeyValueList,
  OutputBox,
} from './tool-renderers/ToolDetailShell';
import {
  getSpecializedRenderer,
  getToolIcon,
  getToolTitleText,
  formatToolOutput,
  normalizeToolName,
  StatusIcon,
  ToolHeaderActionButton,
  type ToolStatus,
} from './tool-renderers/tool-dispatch';
import { buildPreviewAction, buildResultAction } from './tool-renderers/tool-actions';

const QUOTE_TEXT_MAX_CHARS = 2000;

interface ToolRowProps {
  toolName: string;
  toolInput?: any;
  toolOutput?: any;
  toolUseId?: string;
  status?: ToolStatus;
  isError?: boolean;
  /** 搜索命中本行：强制展开 + 行高亮 */
  searchHit?: boolean;
  /** 搜索命中本行时的命中总数（仅 searchHit 时显示徽标） */
  activeMatchCount?: number;
}

/**
 * 一行式工具行（组卡扁平列表用）
 * 标题行（图标+摘要+状态+headerActions）+ 点击原地展开详情；错误行与 detailed 模式默认展开
 */
export function ToolRow({
  toolName,
  toolInput,
  toolOutput,
  toolUseId,
  status = "success",
  isError = false,
  searchHit = false,
  activeMatchCount = 0,
}: ToolRowProps) {
  const actualStatus: ToolStatus = isError ? "error" : status;
  const displayMode = useSettingsStore(s => s.settings?.ui?.messageDisplayMode ?? 'compact');
  const conversationId = useConversationId();
  const workspaceId = useWorkspaceId();
  const workspacePath = useWorkspacePath(workspaceId);
  const showHitBadge = searchHit && activeMatchCount > 0;

  const titleText = getToolTitleText(toolName, toolInput);
  const formattedOutput = formatToolOutput(toolOutput);
  const iconSpec = getToolIcon(normalizeToolName(toolName));

  const previewAction = actualStatus === 'success' && !isError
    ? buildPreviewAction({ toolName, toolInput, toolOutput, workspaceId, workspacePath })
    : null;
  const jumpAction = actualStatus === 'success' && !isError
    ? buildResultAction({ toolName, toolInput, toolOutput, workspaceId, workspacePath })
    : null;

  const quoteToolCall = () => {
    if (!conversationId) return;
    const parts = [`工具调用: ${titleText}`];
    if (formattedOutput) {
      const output = formattedOutput.length > QUOTE_TEXT_MAX_CHARS
        ? `${formattedOutput.slice(0, QUOTE_TEXT_MAX_CHARS)}\n…（已截断）`
        : formattedOutput;
      parts.push(`输出: ${output}`);
    }
    useReferenceStore.getState().addMessageSnippet({ text: parts.join('\n'), timestamp: Date.now() }, conversationId);
  };

  const openOutputOverlay = () => {
    useMarkdownPreviewStore.getState().openInline(titleText, formattedOutput);
  };

  const { Icon: ToolIconComp, className: iconColor } = iconSpec;
  const iconNode = <ToolIconComp className={cn('w-4 h-4', iconColor)} />;
  const hasDetailOutput = toolOutput !== undefined && toolOutput !== null && toolOutput !== '';
  const hasHeaderActions = showHitBadge || !!previewAction || !!jumpAction || !!conversationId;

  return (
    <CollapsibleBlock
      icon={iconNode}
      title={titleText}
      titleClassName={cn(
        actualStatus === 'error' && 'text-red-600 dark:text-red-400',
        actualStatus === 'running' && 'text-sky-600 dark:text-sky-400',
      )}
      statusIcon={<StatusIcon status={actualStatus} />}
      headerActions={hasHeaderActions && (
        <span className="inline-flex items-center gap-0.5">
          {conversationId && (
            <ToolHeaderActionButton icon={MessageSquareQuote} tooltip="引用此工具调用到输入框" onOpen={quoteToolCall} />
          )}
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
      defaultOpen={isError || displayMode === 'detailed'}
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
          {hasDetailOutput && (
            <ToolSection label={isError ? '错误' : '输出'}>
              <div className="relative">
                <OutputBox content={formattedOutput} isError={isError} />
                <button
                  type="button"
                  title="浮窗查看完整输出"
                  onClick={openOutputOverlay}
                  className="absolute top-1.5 right-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-background/85 border border-border text-muted-foreground hover:text-sky-600 hover:border-sky-300 dark:hover:border-sky-700 transition-colors cursor-pointer"
                >
                  <PictureInPicture2 className="w-3 h-3" />
                  浮窗查看
                </button>
              </div>
            </ToolSection>
          )}
        </ToolDetailShell>
      )}
    </CollapsibleBlock>
  );
}

export default ToolRow;
