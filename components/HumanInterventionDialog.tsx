import { useState } from 'react';
import { KeyRound, LogIn, MousePointerClick, ShieldAlert } from 'lucide-react';
import { client } from '@/lib/client';
import { useBrowserStore } from '@/stores/browser-store';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type {
  HumanInterventionReason,
  InterventionResult,
} from '@/electron/main/services/browser/human-intervention';

const REASON_META: Record<HumanInterventionReason, { title: string; Icon: typeof LogIn }> = {
  login_required: { title: '需要登录', Icon: LogIn },
  verification_required: { title: '需要人工验证', Icon: ShieldAlert },
  guard_password: { title: '密码需手动填写', Icon: KeyRound },
  guard_submit: { title: '提交需确认', Icon: MousePointerClick },
};

interface DialogActionsProps {
  confirmMode: boolean;
  resolving: boolean;
  onResolve: (result?: InterventionResult) => void;
}

/** confirmMode 三按钮（确认执行/拒绝/已手动操作）；其余单按钮「完成后继续」（不传 result 走 approved 语义） */
function DialogActions({ confirmMode, resolving, onResolve }: DialogActionsProps) {
  if (!confirmMode) {
    return (
      <DialogFooter>
        <Button onClick={() => onResolve()} disabled={resolving}>
          完成后继续
        </Button>
      </DialogFooter>
    );
  }
  return (
    <DialogFooter className="flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex flex-col items-start gap-1">
        <Button
          variant="secondary"
          size="sm"
          className="text-muted-foreground"
          disabled={resolving}
          onClick={() => onResolve('manual')}
        >
          已手动操作
        </Button>
        <span className="text-xs text-muted-foreground">我已在浏览器中完成该操作</span>
      </div>
      <div className="flex gap-2 sm:justify-end">
        <Button
          size="sm"
          className="bg-emerald-600 text-white hover:bg-emerald-600/90"
          disabled={resolving}
          onClick={() => onResolve('approved')}
        >
          确认执行
        </Button>
        <Button size="sm" variant="destructive" disabled={resolving} onClick={() => onResolve('denied')}>
          拒绝
        </Button>
      </div>
    </DialogFooter>
  );
}

/** 应用级模态：人工等待直接打扰用户；只能通过按钮解除（遮罩/ESC 关闭被禁，防误触丢卡） */
export function HumanInterventionDialog() {
  const items = useBrowserStore((s) => s.humanInterventions);
  const [resolving, setResolving] = useState(false);
  const current = items[0];
  if (!current) return null;
  const { title, Icon } = REASON_META[current.reason];
  const confirmMode = current.reason === 'guard_submit' && current.confirmMode === true;

  const resolve = (result?: InterventionResult) => {
    if (resolving) return;
    setResolving(true);
    void client
      .resolveHumanIntervention(result ? { id: current.id, result } : { id: current.id })
      .finally(() => setResolving(false));
  };

  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
            {title}
          </DialogTitle>
          <DialogDescription className="pt-1 text-left whitespace-normal">{current.message}</DialogDescription>
        </DialogHeader>
        {current.url && (
          <p className="truncate text-xs text-muted-foreground/80" title={current.url}>
            {current.url}
          </p>
        )}
        <DialogActions confirmMode={confirmMode} resolving={resolving} onResolve={resolve} />
      </DialogContent>
    </Dialog>
  );
}
