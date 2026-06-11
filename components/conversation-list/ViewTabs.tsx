import React from 'react';
import { Brain, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ListView = 'smart' | 'time';

export function ViewTabs({ value, onChange }: { value: ListView; onChange: (v: ListView) => void }) {
  return (
    <div className="flex items-center gap-1 px-2 py-1 border-y bg-muted/20">
      <Tab active={value === 'smart'} onClick={() => onChange('smart')} icon={<Brain className="w-3.5 h-3.5" />}>
        智能
      </Tab>
      <Tab active={value === 'time'} onClick={() => onChange('time')} icon={<Clock className="w-3.5 h-3.5" />}>
        时间
      </Tab>
    </div>
  );
}

function Tab({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {icon} {children}
    </button>
  );
}
