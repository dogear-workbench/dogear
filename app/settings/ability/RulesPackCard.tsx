import { Globe, ScrollText } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RulesPackCardProps {
  workspaceRulesEnabled: boolean;
  globalRulesEnabled: boolean;
  onOpen: () => void;
}

const RULE_ITEMS = [
  { key: 'workspace-rules', label: '工作区', Icon: ScrollText },
  { key: 'global-rules', label: '全局', Icon: Globe },
] as const;

export function RulesPackCard({ workspaceRulesEnabled, globalRulesEnabled, onOpen }: RulesPackCardProps) {
  const enabledByKey: Record<string, boolean> = {
    'workspace-rules': workspaceRulesEnabled,
    'global-rules': globalRulesEnabled,
  };

  return (
    <button
      type="button"
      onClick={onOpen}
      className="rounded-lg border bg-background p-4 text-left transition-colors hover:border-primary/50 hover:bg-muted/20 flex flex-col gap-2"
      aria-label="打开规则详情"
    >
      <div className="flex items-start gap-3">
        <div className="rounded-md bg-muted/60 p-2 shrink-0">
          <ScrollText className="w-5 h-5 text-foreground/80" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold truncate">规则</span>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed mt-0.5 line-clamp-2">
            工作区与全局 agent.md 的编辑与开关，注入每个会话
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {RULE_ITEMS.map(({ key, label, Icon }) => {
          const enabled = enabledByKey[key];
          return (
            <span
              key={key}
              className={cn(
                'inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded',
                enabled
                  ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400'
                  : 'bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400',
              )}
            >
              <Icon className="w-3 h-3 shrink-0" />
              {label}规则{enabled ? '已启用' : '已关闭'}
            </span>
          );
        })}
      </div>
    </button>
  );
}
