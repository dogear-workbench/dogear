import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { Checkbox } from '@/components/ui/checkbox';
import { useConversationId } from '../conversation-id-context';
import { useWorkspaceId } from '../workspace-id-context';
import { useConversationStore } from '@/stores/conversation-store';
import { ToolDetailShell, ToolSection, KeyValueList } from './ToolDetailShell';

interface Props {
  toolInput?: Record<string, any>;
  toolOutput?: any;
  toolUseId?: string;
  isError?: boolean;
}

function storageKey(conversationId: string | null, toolUseId?: string): string | null {
  if (!conversationId || !toolUseId) return null;
  return `user-action:${conversationId}:${toolUseId}`;
}

function readCheckedIndices(key: string | null): number[] {
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0))].sort((a, b) => a - b);
  } catch {
    return [];
  }
}

export function TrackUserActionsRenderer({ toolInput, toolUseId }: Props) {
  const actions: string[] = Array.isArray(toolInput?.actions)
    ? toolInput.actions.filter((a: unknown): a is string => typeof a === 'string' && a.trim().length > 0)
    : [];
  const conversationId = useConversationId();
  const workspaceId = useWorkspaceId();
  const groupId = useConversationStore((s) =>
    conversationId ? s.conversations.find((c) => c.id === conversationId)?.groupId : undefined,
  );
  const key = storageKey(conversationId, toolUseId);
  const [checked, setChecked] = useState<Set<number>>(() => new Set(readCheckedIndices(key)));
  const [busyIndex, setBusyIndex] = useState<number | null>(null);

  useEffect(() => {
    setChecked(new Set(readCheckedIndices(key)));
  }, [key]);

  if (actions.length === 0) {
    return (
      <ToolDetailShell>
        {toolInput && Object.keys(toolInput).length > 0 && (
          <ToolSection label="输入">
            <KeyValueList data={toolInput} />
          </ToolSection>
        )}
      </ToolDetailShell>
    );
  }

  const toggle = async (index: number, text: string) => {
    if (busyIndex !== null || checked.has(index)) return;
    if (!key || !workspaceId || !groupId) {
      toast.warning('会话不属于话题组，无法记录到状态卡');
      return;
    }
    setBusyIndex(index);
    setChecked((prev) => new Set(prev).add(index));
    try {
      const r = await client.appendStateUserEntry({ workspaceId, groupId, category: 'completed', text });
      if (r.error) {
        toast.error('记入状态卡失败', { description: r.error });
        setChecked((prev) => {
          const rollback = new Set(prev);
          rollback.delete(index);
          return rollback;
        });
        return;
      }
      const indices = readCheckedIndices(key);
      if (!indices.includes(index)) indices.push(index);
      localStorage.setItem(key, JSON.stringify(indices));
    } catch (e) {
      toast.error('记入状态卡失败', { description: e instanceof Error ? e.message : String(e) });
      setChecked((prev) => {
        const rollback = new Set(prev);
        rollback.delete(index);
        return rollback;
      });
    } finally {
      setBusyIndex(null);
    }
  };

  return (
    <div className="space-y-1 py-0.5">
      <div className="text-[11px] text-muted-foreground">勾选完成后自动记入话题状态卡「已完成」</div>
      {actions.map((action, index) => {
        const isChecked = checked.has(index);
        return (
          <label
            key={index}
            className={cn(
              'flex items-start gap-2 rounded px-1 py-1 -mx-1 cursor-pointer hover:bg-muted/50 transition-colors',
              busyIndex === index && 'opacity-60 cursor-wait',
            )}
          >
            <Checkbox
              className="mt-0.5"
              checked={isChecked}
              disabled={isChecked || busyIndex !== null}
              onCheckedChange={() => { void toggle(index, action); }}
            />
            <span className={cn('text-sm leading-5 break-all', isChecked && 'line-through text-muted-foreground')}>
              {action}
            </span>
          </label>
        );
      })}
    </div>
  );
}
