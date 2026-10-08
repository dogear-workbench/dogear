import { Hourglass, LogIn, ShieldAlert, KeyRound, MousePointerClick, Check, X, PlugZap } from 'lucide-react';
import { client } from '@/lib/client';
import { useBrowserStore } from '@/stores/browser-store';
import type { HumanInterventionReason, HumanInterventionRequest, InterventionResult } from '@/electron/main/services/browser/human-intervention';

const REASON_META: Record<HumanInterventionReason, { label: string; Icon: typeof Hourglass }> = {
  login_required: { label: '需要登录', Icon: LogIn },
  verification_required: { label: '需要人工验证', Icon: ShieldAlert },
  guard_password: { label: '密码需手动填写', Icon: KeyRound },
  guard_submit: { label: '提交需确认', Icon: MousePointerClick },
  extension_wait: { label: '等待浏览器扩展连接', Icon: PlugZap },
};

/** 置顶横幅形态（替代旧独立卡片区块）：页面呈现时人工等待动作不离开视野 */
function InterventionBanner({ request }: { request: HumanInterventionRequest }) {
  const { label, Icon } = REASON_META[request.reason];
  const resolve = (result?: InterventionResult) =>
    void client.resolveHumanIntervention(result ? { id: request.id, result } : { id: request.id });
  const resolveAction = (actionKey: string) =>
    void client.resolveHumanIntervention({ id: request.id, actionKey });
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border-b border-amber-500/30 last:border-b-0">
      <Icon className="w-3.5 h-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
      <span className="shrink-0 text-xs font-medium text-amber-700 dark:text-amber-400">{label}</span>
      <span className="flex-1 min-w-0 truncate text-xs text-foreground/90" title={request.message}>{request.message}</span>
      {request.url && (
        <span
          className="hidden sm:block shrink-0 max-w-44 truncate text-[10px] text-muted-foreground/70"
          title={request.url}
        >
          {request.url}
        </span>
      )}
      <span className="shrink-0 text-[10px] text-muted-foreground/70 tabular-nums">
        {new Date(request.createdAt).toLocaleTimeString('zh-CN', { hour12: false })}
      </span>
      {request.actions && request.actions.length > 0 ? (
        request.actions.map((action) => (
          <button
            key={action.key}
            className={`shrink-0 inline-flex items-center gap-1 rounded-md border bg-background px-2 py-0.5 text-[11px] font-medium transition-colors cursor-pointer ${
              action.tone === 'destructive'
                ? 'border-red-500/50 text-red-700 hover:bg-red-500/10 dark:text-red-400'
                : 'border-emerald-500/50 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400'
            }`}
            onClick={() => resolveAction(action.key)}
          >
            {action.tone === 'destructive' ? <X className="w-3 h-3" /> : <Check className="w-3 h-3" />}
            {action.label}
          </button>
        ))
      ) : request.reason === 'guard_submit' && request.confirmMode ? (
        <>
          <button
            className="shrink-0 inline-flex items-center gap-1 rounded-md border border-emerald-500/50 bg-background px-2 py-0.5 text-[11px] font-medium text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400 transition-colors cursor-pointer"
            onClick={() => resolve('approved')}
          >
            <Check className="w-3 h-3" />
            确认提交
          </button>
          <button
            className="shrink-0 inline-flex items-center gap-1 rounded-md border border-red-500/50 bg-background px-2 py-0.5 text-[11px] font-medium text-red-700 hover:bg-red-500/10 dark:text-red-400 transition-colors cursor-pointer"
            onClick={() => resolve('denied')}
          >
            <X className="w-3 h-3" />
            拒绝
          </button>
        </>
      ) : (
        <button
          className="shrink-0 rounded-md border border-amber-500/50 bg-background px-2 py-0.5 text-[11px] font-medium text-amber-700 hover:bg-amber-500/10 dark:text-amber-400 transition-colors cursor-pointer"
          onClick={() => resolve()}
        >
          完成后继续
        </button>
      )}
    </div>
  );
}

export function BrowserInterventions() {
  const items = useBrowserStore((s) => s.humanInterventions);
  if (items.length === 0) return null;
  return (
    <div className="shrink-0">
      {items.map((item) => (
        <InterventionBanner key={item.id} request={item} />
      ))}
    </div>
  );
}
