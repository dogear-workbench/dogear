import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';

interface AbilityBlockRowProps {
  icon: LucideIcon;
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** 细选已选/总数展示（如 "2/6"），无细项时不传 */
  detailCount?: string;
  details?: ReactNode;
}

export function AbilityBlockRow({
  icon: Icon,
  title,
  description,
  checked,
  onCheckedChange,
  detailCount,
  details,
}: AbilityBlockRowProps) {
  return (
    <div className="p-2 rounded-md border bg-background">
      <div className="flex items-center gap-2.5">
        <Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">{description}</div>
        </div>
        {details && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="shrink-0 px-2 h-7 rounded-md border text-xs hover:bg-muted/50 transition-colors"
              >
                细选{detailCount ? ` · ${detailCount}` : ''}
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 max-h-72 overflow-y-auto space-y-1">
              {details}
            </PopoverContent>
          </Popover>
        )}
        <Switch
          className="shrink-0"
          checked={checked}
          onCheckedChange={onCheckedChange}
          aria-label={`${checked ? '关闭' : '开启'} ${title}`}
        />
      </div>
    </div>
  );
}

interface SkillCheckItemProps {
  name: string;
  title?: string;
  description?: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
}

export function SkillCheckItem({ name, title, description, checked, onToggle }: SkillCheckItemProps) {
  return (
    <label className="flex items-start gap-2 p-1 rounded cursor-pointer hover:bg-muted/30 transition-colors">
      <Checkbox
        className="mt-0.5"
        checked={checked}
        onCheckedChange={(v) => onToggle(v === true)}
        aria-label={title ?? name}
      />
      <div className="min-w-0">
        <div className="text-sm">
          {title ?? <span className="font-mono text-muted-foreground">{name}</span>}
        </div>
        {description && <div className="text-xs text-muted-foreground">{description}</div>}
      </div>
    </label>
  );
}

interface ChannelSwitchItemProps {
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export function ChannelSwitchItem({
  label,
  description,
  checked,
  onCheckedChange,
}: ChannelSwitchItemProps) {
  return (
    <div className="flex items-center gap-2 p-1 rounded hover:bg-muted/30 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="text-sm">{label}</div>
        <div className="text-xs text-muted-foreground">{description}</div>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label={`${checked ? '关闭' : '开启'} ${label}`}
      />
    </div>
  );
}
