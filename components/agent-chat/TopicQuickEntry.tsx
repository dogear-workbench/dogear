import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CircleCheckBig, PenLine } from 'lucide-react';
import { client } from '@/lib/client';
import { cn } from '@/lib/utils';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { InputGroupButton } from '@/components/ui/input-group';
import { useWorkspaceId } from './workspace-id-context';

type TopicCardCategory = 'completed' | 'inProgress' | 'decisions' | 'blockers' | 'nextSteps' | 'openQuestions';

const NOTE_CATEGORIES: Array<{ value: TopicCardCategory; label: string }> = [
  { value: 'openQuestions', label: '想法' },
  { value: 'inProgress', label: '进行中' },
  { value: 'blockers', label: '阻碍' },
  { value: 'nextSteps', label: '下一步' },
];

function QuickEntryPopover({
  workspaceId,
  groupId,
  category,
  placeholder,
  trigger,
  successLabel,
}: {
  workspaceId: string;
  groupId: string;
  category: TopicCardCategory | null;
  placeholder: string;
  successLabel: string;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [selected, setSelected] = useState<TopicCardCategory>('openQuestions');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setText('');
      setSelected('openQuestions');
      inputRef.current?.focus();
    }
  }, [open]);

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const r = await client.appendStateUserEntry({
        workspaceId,
        groupId,
        category: category ?? selected,
        text: trimmed,
      });
      if (r.error) {
        toast.error('记入状态卡失败', { description: r.error });
        return;
      }
      toast.success(successLabel);
      setOpen(false);
    } catch (e) {
      toast.error('记入状态卡失败', { description: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        className="w-72 p-2"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {category === null && (
          <div className="mb-2 flex gap-1">
            {NOTE_CATEGORIES.map((c) => (
              <button
                key={c.value}
                type="button"
                disabled={busy}
                onClick={() => setSelected(c.value)}
                className={cn(
                  'rounded-full px-2 py-0.5 text-xs transition-colors',
                  selected === c.value
                    ? 'bg-primary/15 text-primary font-medium'
                    : 'bg-muted text-muted-foreground hover:text-foreground',
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
        <Input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder={placeholder}
          className="h-8 text-xs"
          disabled={busy}
        />
      </PopoverContent>
    </Popover>
  );
}

export function TopicQuickEntry({ groupId }: { groupId: string }) {
  const workspaceId = useWorkspaceId();
  if (!workspaceId) return null;

  return (
    <>
      <QuickEntryPopover
        workspaceId={workspaceId}
        groupId={groupId}
        category="completed"
        placeholder="完成了什么？回车记入状态卡"
        successLabel="已记入「已完成」"
        trigger={
          <InputGroupButton
            size="xs"
            className="gap-1 text-muted-foreground hover:text-foreground"
            title="记入话题状态卡：已完成"
          >
            <CircleCheckBig size={14} />
            <span className="text-xs">这事做完了</span>
          </InputGroupButton>
        }
      />
      <QuickEntryPopover
        workspaceId={workspaceId}
        groupId={groupId}
        category={null}
        placeholder="记点什么？回车记入状态卡"
        successLabel="已记入状态卡"
        trigger={
          <InputGroupButton
            size="xs"
            className="gap-1 text-muted-foreground hover:text-foreground"
            title="记入话题状态卡：可选类别"
          >
            <PenLine size={14} />
            <span className="text-xs">记一笔</span>
          </InputGroupButton>
        }
      />
    </>
  );
}
