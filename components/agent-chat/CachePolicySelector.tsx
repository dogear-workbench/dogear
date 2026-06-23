import { Clock } from 'lucide-react';
import { toast } from 'sonner';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { InputGroupButton } from '@/components/ui/input-group';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { useConversationStore } from '@/stores/conversation-store';
import { showConfirm } from '@/stores/confirm-store';
import type { PendingState } from './hooks/usePendingState';

interface Props {
  /** 当前对话的缓存策略，undefined 视为 '5m' */
  policy: '5m' | '1h' | undefined;
  /** SDK 会话 ID；null 表示对话尚未启动 SDK（仅写库不重启） */
  sessionId: string | null;
  /** 工作区 ID（IPC 必填） */
  workspaceId: string | null;
  /** 对话 ID */
  conversationId: string | null;
  /** 对话运行状态：非 idle 时禁用切换 */
  pendingState: PendingState;
}

const POLICY_LABEL: Record<'5m' | '1h', string> = {
  '5m': '5min',
  '1h': '1h',
};

export function CachePolicySelector({
  policy,
  sessionId,
  workspaceId,
  conversationId,
  pendingState,
}: Props) {
  const current: '5m' | '1h' = policy ?? '5m';
  const isLocked = pendingState !== 'idle';
  const triggerSessionRestart = useConversationStore((s) => s.triggerSessionRestart);
  const setConversationCachePolicy = useConversationStore((s) => s.setConversationCachePolicy);

  const handleChange = async (value: string) => {
    const next = value as '5m' | '1h';
    if (next === current) return;
    if (!conversationId || !workspaceId) return;

    // 无 active session（fresh 对话，未发送过消息）：只写库，无需重启
    if (!sessionId) {
      await setConversationCachePolicy(conversationId, next);
      return;
    }

    const confirmed = await showConfirm(
      '切换缓存策略',
      next === '1h'
        ? '将切换到 1h 缓存（缓存写入 2x 计费，命中读取相同），并重启当前会话以应用。'
        : '将切换回 5min 缓存（默认），并重启当前会话以应用。'
    );
    if (!confirmed) return;

    try {
      const res = await client.setSessionCachePolicy({
        sessionId,
        workspaceId,
        conversationId,
        policy: next,
      });
      if (!res.ok) {
        toast.error('切换缓存策略失败', { description: res.error });
        return;
      }
      // 同步本地镜像（IPC 已写库，但 store 不会自动 reload）
      await setConversationCachePolicy(conversationId, next);
      if (res.needsRestart) {
        triggerSessionRestart();
      }
    } catch (error) {
      toast.error('切换缓存策略失败', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={isLocked}>
        <InputGroupButton
          size="xs"
          className={cn(
            'gap-1',
            current === '1h' ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
          )}
          title={isLocked ? '对话进行中无法切换缓存策略' : `缓存策略：${POLICY_LABEL[current]}`}
        >
          <Clock size={14} />
          <span className="text-xs">{POLICY_LABEL[current]}</span>
        </InputGroupButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[200px]">
        <DropdownMenuLabel>提示缓存策略</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={current} onValueChange={handleChange}>
          <DropdownMenuRadioItem value="5m">5min（默认 · 1x 写入）</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="1h">1h（长对话省钱 · 2x 写入）</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
