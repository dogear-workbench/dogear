import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { useConfirmStore } from '@/stores/confirm-store';

/**
 * 全局确认弹窗，在 App 根级渲染一次即可。
 * 通过 useConfirmStore.confirm() 触发。
 */
export function ConfirmDialog() {
  const open = useConfirmStore((s) => s.open);
  const title = useConfirmStore((s) => s.title);
  const description = useConfirmStore((s) => s.description);
  const buttons = useConfirmStore((s) => s.buttons);
  const close = useConfirmStore((s) => s.close);

  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!v) close(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          {buttons.map((btn) => (
            <Button
              key={btn.value}
              variant={btn.variant ?? 'outline'}
              onClick={() => close(btn.value)}
            >
              {btn.label}
            </Button>
          ))}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
