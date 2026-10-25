import { CircleCheckBig } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { useUserActionChecklist } from './hooks/useUserActionChecklist';
import { SearchHitBadge } from './SearchHitBadge';

interface Props {
  toolInput?: Record<string, any>;
  toolUseId?: string;
  /** 搜索激活命中落在本块：描边 + 徽标 */
  searchHit?: boolean;
  /** 本块命中总数（仅 searchHit 时显示徽标） */
  activeMatchCount?: number;
}

export function UserActionsCard({ toolInput, toolUseId, searchHit = false, activeMatchCount = 0 }: Props) {
  const actions: string[] = Array.isArray(toolInput?.actions)
    ? toolInput.actions.filter((a: unknown): a is string => typeof a === 'string' && a.trim().length > 0)
    : [];
  const { checked, toggle } = useUserActionChecklist(toolUseId);

  return (
    <div
      className={cn(
        'w-full my-2 rounded-r-lg border-l-[3px] border-l-emerald-500 px-3 py-2',
        searchHit
          ? 'outline-1 outline-offset-2 outline-sky-400/70 bg-sky-50/60 dark:bg-sky-950/30'
          : 'bg-emerald-50/70 dark:bg-emerald-950/20',
      )}
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CircleCheckBig className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
        <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 flex-shrink-0">
          待你完成
        </span>
        <span className="truncate">勾选标记完成，同组会话以对话确认为准</span>
        {searchHit && activeMatchCount > 0 && <SearchHitBadge count={activeMatchCount} />}
      </div>
      {actions.length === 0 ? (
        <div className="mt-1 text-xs text-muted-foreground/70">未提供有效事项</div>
      ) : (
        <div className="mt-1 space-y-0.5">
          {actions.map((action, index) => {
            const isChecked = checked.has(index);
            return (
              <label
                key={index}
                className="flex items-start gap-2 rounded px-1 py-1 -mx-1 cursor-pointer hover:bg-muted/50 transition-colors"
              >
                <Checkbox
                  className="mt-0.5"
                  checked={isChecked}
                  disabled={isChecked}
                  onCheckedChange={() => toggle(index)}
                />
                <span className="text-sm leading-5 break-all">{action}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
