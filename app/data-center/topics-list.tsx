import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { TopicIndexEntry } from './memory-types';

interface Props {
  topics: TopicIndexEntry[];
  selectedSlug: string | null;
  hasDraft: boolean;
  onCreate: () => void;
  onSelect: (slug: string) => void;
}

export function TopicsList({ topics, selectedSlug, hasDraft, onCreate, onSelect }: Props) {
  return (
    <div className="w-64 flex-shrink-0 space-y-2">
      <Button variant="outline" size="sm" className="w-full" onClick={onCreate}>
        <Plus className="w-4 h-4 mr-1" />
        新建主题
      </Button>

      <div className="h-[500px] overflow-y-auto">
        <div className="space-y-1 pr-2">
          {topics.length === 0 && !hasDraft && (
            <p className="text-xs text-muted-foreground text-center py-8">
              还没有主题记忆，点击上方按钮创建
            </p>
          )}
          {hasDraft && (
            <div className="px-3 py-2 rounded-md text-sm bg-accent text-accent-foreground italic">
              （新建草稿）
            </div>
          )}
          {topics.map((t) => (
            <div
              key={t.slug}
              className={cn(
                'group px-3 py-2 rounded-md cursor-pointer text-sm',
                selectedSlug === t.slug
                  ? 'bg-accent text-accent-foreground'
                  : 'hover:bg-muted/50',
              )}
              onClick={() => onSelect(t.slug)}
            >
              <div className="font-medium truncate">{t.title}</div>
              <div className="text-xs text-muted-foreground truncate font-mono">{t.slug}</div>
              {t.keywords.length > 0 && (
                <div className="text-xs text-muted-foreground truncate mt-0.5">
                  {t.keywords.slice(0, 4).join(' · ')}
                  {t.keywords.length > 4 && ' ...'}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
