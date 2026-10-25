import { Check, X, LogIn, ShieldAlert, KeyRound, MousePointerClick, Hourglass, Globe, PlugZap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { client } from '@/lib/client';
import type { HumanInterventionAction, HumanInterventionReason } from '../../electron/main/services/browser/human-intervention';
import type { ContentBlock } from './types';

const REASON_META: Record<HumanInterventionReason, { label: string; Icon: typeof Hourglass }> = {
  login_required: { label: '需要登录', Icon: LogIn },
  verification_required: { label: '需要人工验证', Icon: ShieldAlert },
  guard_password: { label: '密码需手动填写', Icon: KeyRound },
  guard_submit: { label: '提交需确认', Icon: MousePointerClick },
  extension_wait: { label: '等待浏览器扩展连接', Icon: PlugZap },
};

/** 无显式 actions 时的缺省按钮组（与伴随面板横幅行为一致） */
const DEFAULT_ACTIONS: Partial<Record<HumanInterventionReason, HumanInterventionAction[]>> = {
  guard_submit: [
    { key: 'approved', label: '确认执行', tone: 'primary' },
    { key: 'denied', label: '拒绝', tone: 'destructive' },
  ],
};

const OUTCOME_TEXT: Record<string, string> = {
  approved: '已确认，任务继续',
  denied: '已拒绝，本次操作未执行',
  manual: '已在浏览器手动处理',
  done: '已确认，任务继续',
  auto: '已继续',
  timeout: '等待超时，已跳过',
  missing: '请求已失效',
  unattended: '用户不在，已自动跳过',
};

export function InterventionCard({ block, readOnly = false }: { block: ContentBlock; readOnly?: boolean }) {
  const requestId = block.interventionRequestId;
  const reason = (block.interventionReason ?? 'guard_submit') as HumanInterventionReason;
  const { label, Icon } = REASON_META[reason] ?? REASON_META.guard_submit;
  const isResolved = !!block.interventionResolved;
  const outcome = block.interventionResult ?? '';

  const resolve = (actionKey: string) => {
    if (readOnly || !requestId || isResolved) return;
    void client.resolveHumanIntervention({ id: requestId, actionKey }).catch(() => {});
  };

  const actions = block.interventionActions ?? DEFAULT_ACTIONS[reason] ?? [];

  return (
    <div className="py-2">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={16} className={isResolved ? 'text-muted-foreground/50' : 'text-amber-500 dark:text-amber-400'} />
        <span className={`text-sm font-medium ${isResolved ? 'text-muted-foreground/60' : 'text-foreground'}`}>
          {isResolved ? (OUTCOME_TEXT[outcome] ?? '已处理') : label}
        </span>
      </div>

      {block.interventionMessage && (
        <div className="mb-2 text-xs text-muted-foreground bg-muted rounded p-2 whitespace-pre-wrap break-all">
          {block.interventionMessage}
        </div>
      )}

      {block.interventionUrl && (
        <div className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground/80 min-w-0">
          <Globe size={12} className="shrink-0" />
          <span className="truncate" title={block.interventionUrl}>{block.interventionUrl}</span>
        </div>
      )}

      {!isResolved && !readOnly && actions.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap mt-2">
          {actions.map((action) => (
            <Button
              key={action.key}
              size="sm"
              variant={action.tone === 'destructive' ? 'outline' : 'default'}
              className={action.tone === 'destructive' ? 'text-destructive hover:bg-destructive/10' : undefined}
              onClick={() => resolve(action.key)}
            >
              {action.tone === 'destructive' ? <X size={12} /> : <Check size={12} />}
              {action.label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
