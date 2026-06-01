import type { ConversationUsage, ConversationUsageEntry } from '@/types/usage';
import type { ContextInfo } from './usage-utils';
import { UsageSummaryHeader } from './UsageSummaryHeader';
import { UsageContextBreakdown } from './UsageContextBreakdown';
import { UsageByModel } from './UsageByModel';
import { UsageByTool } from './UsageByTool';
import { UsageEntryList } from './UsageEntryList';

interface Props {
  usage: ConversationUsage;
  context: ContextInfo;
  lastEntry: ConversationUsageEntry;
}

/** HoverCard 主容器：组合头部摘要 / 上下文构成 / 按模型 / 按工具 / 明细列表 */
export function UsageHoverCard({ usage, context, lastEntry }: Props) {
  return (
    <div className="divide-y">
      <UsageSummaryHeader usage={usage} context={context} lastEntry={lastEntry} />
      <UsageContextBreakdown latestContext={usage.latestContext} />
      <div className="grid grid-cols-2 divide-x">
        <UsageByModel usage={usage} />
        <UsageByTool usage={usage} />
      </div>
      <UsageEntryList usage={usage} />
    </div>
  );
}
