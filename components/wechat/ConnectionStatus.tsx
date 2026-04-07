import { cn } from '@/lib/utils';
import type { WechatAuthState } from '@/types/wechat';

interface ConnectionStatusProps {
  authState: WechatAuthState;
  polling: boolean;
  botName?: string | null;
  connectionError?: string | null;
}

const stateConfig: Record<string, { dot: string; label: string }> = {
  connected_polling: { dot: 'bg-green-500', label: '已连接' },
  connected: { dot: 'bg-yellow-500', label: '已认证' },
  qr_pending: { dot: 'bg-yellow-500 animate-pulse', label: '等待扫码' },
  scanning: { dot: 'bg-yellow-500 animate-pulse', label: '已扫描' },
  expired: { dot: 'bg-red-500', label: '已过期' },
  disconnected: { dot: 'bg-muted-foreground', label: '未连接' },
};

export function ConnectionStatus({ authState, polling, botName, connectionError }: ConnectionStatusProps) {
  const key = authState === 'connected' && polling ? 'connected_polling' : authState;
  const config = stateConfig[key] || stateConfig.disconnected;

  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn('w-2 h-2 rounded-full shrink-0', config.dot)} />
      <span>{config.label}</span>
      {botName && authState === 'connected' && (
        <span className="text-foreground">({botName})</span>
      )}
      {connectionError && (
        <span className="text-destructive truncate max-w-40" title={connectionError}>
          {connectionError}
        </span>
      )}
    </div>
  );
}
