import type { ConversationUsage, ConversationUsageEntry } from '@/types/usage';
import { UsageSummaryHeader } from './UsageSummaryHeader';
import { UsageByModel } from './UsageByModel';
import { UsageByTool } from './UsageByTool';
import { UsageEntryList } from './UsageEntryList';

interface Props {
  usage: ConversationUsage;
  contextLimit: { limit: number; label: string };
  lastEntry: ConversationUsageEntry;
}

/** HoverCard 主容器：组合头部摘要 / 按模型 / 按工具 / 明细列表四块 */
export function UsageHoverCard({ usage, contextLimit, lastEntry }: Props) {
  return (
    <div className="divide-y">
      <UsageSummaryHeader usage={usage} contextLimit={contextLimit} lastEntry={lastEntry} />
      <div className="grid grid-cols-2 divide-x">
        <UsageByModel usage={usage} />
        <UsageByTool usage={usage} />
      </div>
      <UsageEntryList usage={usage} />
    </div>
  );
}
