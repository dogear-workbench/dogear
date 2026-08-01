import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuItem,
  DropdownMenuGroup,
} from '@/components/ui/dropdown-menu';
import { Cpu, ChevronRight } from 'lucide-react';
import { InputGroupButton } from '@/components/ui/input-group';
import { cn } from '@/lib/utils';
import { dedupeProfileTiers, sameSelection } from '@/lib/model-selection';
import type { AppSettings, ModelSelection, ModelTier } from '@/types/settings';

interface Props {
  settings: AppSettings;
  value: ModelSelection | null;
  onChange: (v: ModelSelection | null) => void;
  allowUnset?: boolean;
  triggerVariant?: 'inline' | 'block';
  disabled?: boolean;
}

function tierToModelKey(tier: ModelTier): 'haikuModel' | 'sonnetModel' | 'opusModel' {
  return `${tier}Model` as 'haikuModel' | 'sonnetModel' | 'opusModel';
}

function resolveCurrentLabel(settings: AppSettings, value: ModelSelection): string {
  const profile = settings.profiles[value.profileId];
  if (!profile) return '已删除的模型';
  if (profile.apiFormat === 'pi') {
    return (profile.piModels ?? []).includes(value.tier) ? value.tier : '已删除的模型';
  }
  return profile[tierToModelKey(value.tier as ModelTier)] ?? '已删除的模型';
}

export function ModelSelector({
  settings,
  value,
  onChange,
  allowUnset = false,
  triggerVariant = 'inline',
  disabled,
}: Props) {
  const profiles = Object.values(settings.profiles);
  const currentLabel = value
    ? resolveCurrentLabel(settings, value)
    : (allowUnset ? '不指定' : '请选择模型');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        {triggerVariant === 'inline' ? (
          <InputGroupButton
            size="xs"
            className={cn('gap-1', value ? 'text-primary' : 'text-destructive')}
            title="模型"
          >
            <Cpu size={14} />
            <span className="text-xs max-w-[160px] truncate">{currentLabel}</span>
            <ChevronRight size={12} className="rotate-90" />
          </InputGroupButton>
        ) : (
          <button
            type="button"
            className="h-9 w-full px-3 text-sm border rounded bg-background flex items-center justify-between"
          >
            <span className={cn(value ? '' : 'text-muted-foreground')}>{currentLabel}</span>
            <ChevronRight size={14} className="rotate-90" />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[240px] max-h-[400px] overflow-y-auto">
        {allowUnset && (
          <>
            <DropdownMenuItem
              onSelect={() => onChange(null)}
              className={cn(!value && 'font-semibold')}
            >
              不指定
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        {profiles.map(profile => {
          const items = dedupeProfileTiers(profile);
          if (items.length === 0) return null;
          return (
            <DropdownMenuGroup key={profile.id}>
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                {profile.name}
              </DropdownMenuLabel>
              {items.map(({ tier, modelId }) => {
                const isActive = sameSelection(value, { profileId: profile.id, tier });
                return (
                  <DropdownMenuItem
                    key={`${profile.id}-${tier}`}
                    onSelect={() => onChange({ profileId: profile.id, tier })}
                    className={cn(isActive && 'font-semibold bg-accent')}
                  >
                    {modelId}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuGroup>
          );
        })}
        {profiles.length === 0 && (
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            尚未配置模型方案
          </DropdownMenuLabel>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
