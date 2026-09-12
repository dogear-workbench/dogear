import { ArrowLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { AbilitySystemBehaviorView } from '../../../electron/main/tipc/ability';
import { SYSTEM_BEHAVIOR_ICON } from './pack-meta';

interface SystemBehaviorDetailProps {
  behaviors: AbilitySystemBehaviorView[];
  onBack: () => void;
}

export function SystemBehaviorDetail({ behaviors, onBack }: SystemBehaviorDetailProps) {
  const Icon = SYSTEM_BEHAVIOR_ICON;

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex items-center gap-2 border-b px-4 py-2 shrink-0">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-1" />
          返回
        </Button>
        <span className="text-sm text-muted-foreground">能力</span>
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-sm font-medium">系统行为</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-muted/60 p-2 shrink-0">
            <Icon className="w-5 h-5 text-foreground/80" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-semibold">系统行为</h3>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
              框架结构性注入的提示词段：不可关闭、不受能力包开关影响，只读展示全文。
            </p>
          </div>
        </div>

        {behaviors.map((behavior) => (
          <div key={behavior.key} className="rounded-md border overflow-hidden flex flex-col min-h-0">
            <div className="px-3 py-2 bg-muted/30 border-b space-y-0.5 shrink-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold">{behavior.label}</span>
                <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground">系统 · 只读</span>
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">{behavior.triggerDescription}</p>
            </div>
            <pre className="overflow-auto max-h-96 px-3 py-2 text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-words text-foreground/90">
              {behavior.segment.template || '（模板为空）'}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}
