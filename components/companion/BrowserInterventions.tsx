import { Hourglass, LogIn, ShieldAlert, KeyRound, MousePointerClick } from 'lucide-react';
import { client } from '@/lib/client';
import { useBrowserStore } from '@/stores/browser-store';
import type { HumanInterventionReason, HumanInterventionRequest } from '@/electron/main/services/browser/human-intervention';

const REASON_META: Record<HumanInterventionReason, { label: string; Icon: typeof Hourglass }> = {
  login_required: { label: '需要登录', Icon: LogIn },
  verification_required: { label: '需要人工验证', Icon: ShieldAlert },
  guard_password: { label: '密码需手动填写', Icon: KeyRound },
  guard_submit: { label: '提交需手动确认', Icon: MousePointerClick },
};

function InterventionCard({ request }: { request: HumanInterventionRequest }) {
  const { label, Icon } = REASON_META[request.reason];
  return (
    <div className="mx-3 my-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 p-2.5">
      <div className="flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
        <span className="text-xs font-medium text-amber-700 dark:text-amber-400">{label}</span>
        <span className="ml-auto shrink-0 text-[10px] text-muted-foreground/70 tabular-nums">
          {new Date(request.createdAt).toLocaleTimeString('zh-CN', { hour12: false })}
        </span>
      </div>
      <p className="mt-1 text-xs text-foreground/90 leading-4">{request.message}</p>
      {request.url && (
        <p className="mt-0.5 truncate text-[10px] text-muted-foreground/70" title={request.url}>{request.url}</p>
      )}
      <button
        className="mt-2 w-full rounded-md border border-amber-500/50 bg-background px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-500/10 dark:text-amber-400 transition-colors cursor-pointer"
        onClick={() => void client.resolveHumanIntervention({ id: request.id })}
      >
        我已完成，继续任务
      </button>
    </div>
  );
}

export function BrowserInterventions() {
  const items = useBrowserStore((s) => s.humanInterventions);
  if (items.length === 0) return null;
  return (
    <div className="border-b py-1 shrink-0">
      {items.map((item) => (
        <InterventionCard key={item.id} request={item} />
      ))}
    </div>
  );
}
