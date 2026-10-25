// components/agent-chat/ToolGroupBlock.tsx
import { Boxes } from 'lucide-react';
import { CollapsibleBlock } from './CollapsibleBlock';
import { ToolRow } from './ToolRow';
import { ThinkingBlock } from './ThinkingBlock';
import { isBlockActive } from './highlight';
import { useToolRegistryStore } from '@/stores/tool-registry-store';
import { useSettingsStore } from '@/stores/settings-store';
import { getToolSummary, normalizeToolName, StatusIcon } from './tool-renderers/tool-dispatch';
import type { ContentBlock } from './types';
import { cn } from '@/lib/utils';

interface ToolGroupBlockProps {
  blocks: ContentBlock[];
  /** 子块对应的原始 contentBlocks 索引（与 blocks 同序）；缺省退化为组内序号 */
  childOriginalIndices?: number[];
  searchQuery?: string;
  activeMatchId?: string | null;
  activeBlockMatchCount?: number;
  messageId?: string;
}

/**
 * 连续工具调用分组容器
 * - 标题：大类去重 · N 个工具 · ⚠ N 个失败 · 正在执行 <running 摘要>
 * - 展开区为扁平一行式列表（tool_use → ToolRow，thinking → ThinkingBlock），中间层不限高
 */
export function ToolGroupBlock({
  blocks,
  childOriginalIndices,
  searchQuery,
  activeMatchId,
  activeBlockMatchCount,
  messageId,
}: ToolGroupBlockProps) {
  const getCategoryLabel = useToolRegistryStore(s => s.getCategoryLabel);
  const displayMode = useSettingsStore(s => s.settings?.ui?.messageDisplayMode ?? 'compact');

  const toolBlocks = blocks.filter(b => b.type === 'tool_use');
  const toolCount = toolBlocks.length;

  // 去重的大类列表（保留首次出现顺序）
  const categorySet = new Set<string>();
  const categories: string[] = [];
  for (const b of toolBlocks) {
    const label = getCategoryLabel(b.toolName || '');
    if (!categorySet.has(label)) {
      categorySet.add(label);
      categories.push(label);
    }
  }

  // 组内聚合状态：running 不自动展开组卡（避免流式布局跳动），标题摘要即可
  const runningBlock = toolBlocks.find(b => b.toolOutput === undefined);
  const errorCount = toolBlocks.filter(b => b.isError).length;
  const status: 'running' | 'error' | 'success' =
    runningBlock ? 'running' : errorCount > 0 ? 'error' : 'success';

  const runningSummary = runningBlock
    ? getToolSummary(runningBlock.toolName || '', runningBlock.toolInput)
    : '';
  const suffixParts = [
    errorCount > 0 ? `⚠ ${errorCount} 个失败` : '',
    runningBlock ? `正在执行 ${runningSummary || normalizeToolName(runningBlock.toolName || '')}` : '',
  ].filter(Boolean);
  const title = `${categories.join('、')} · ${toolCount} 个工具${suffixParts.map(s => ` · ${s}`).join('')}`;

  // 搜索命中组内任一子块时强制展开组卡（命中行自身的展开/高亮由行组件处理）
  const groupHit = !!activeMatchId && !!messageId && (childOriginalIndices ?? blocks.map((_, i) => i))
    .some(idx => isBlockActive(activeMatchId, messageId, idx));

  return (
    <CollapsibleBlock
      icon={<Boxes size={14} className="text-muted-foreground/70" />}
      title={title}
      titleClassName={cn(
        status === 'running' && 'text-sky-600 dark:text-sky-400',
        status === 'error' && 'text-red-600 dark:text-red-400',
      )}
      statusIcon={<StatusIcon status={status} />}
      previewLines={0}
      defaultOpen={displayMode === 'detailed'}
      forceOpen={groupHit}
    >
      <div className="space-y-0.5">
        {blocks.map((child, idx) => {
          const originalIndex = childOriginalIndices?.[idx] ?? idx;
          if (child.type === 'tool_use') {
            return (
              <ToolRow
                key={idx}
                toolName={child.toolName || '未知工具'}
                toolInput={child.toolInput}
                toolOutput={child.toolOutput}
                toolUseId={child.toolUseId}
                status={child.toolOutput !== undefined ? (child.isError ? 'error' : 'success') : 'running'}
                isError={child.isError}
                searchHit={isBlockActive(activeMatchId, messageId, originalIndex)}
                activeMatchCount={activeBlockMatchCount}
              />
            );
          }
          if (child.type === 'thinking') {
            return (
              <ThinkingBlock
                key={idx}
                block={child}
                searchQuery={searchQuery}
                activeMatchId={activeMatchId}
                matchIdPrefix={messageId !== undefined ? `${messageId}-${originalIndex}` : undefined}
              />
            );
          }
          return null;
        })}
      </div>
    </CollapsibleBlock>
  );
}
