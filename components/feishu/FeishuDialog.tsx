import { useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useFeishuStore } from '@/stores/feishu-store';
import { FeishuSetupGuide } from './FeishuSetupGuide';
import { FeishuControlPanel } from './FeishuControlPanel';

interface FeishuDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FeishuDialog({ open, onOpenChange }: FeishuDialogProps) {
  const configExists = useFeishuStore((s) => s.configExists);
  const initialize = useFeishuStore((s) => s.initialize);

  // 启动自动连接场景主进程不推 autoInit，打开 Dialog 时主动拉全量状态
  useEffect(() => {
    if (open) {
      initialize();
    }
  }, [open, initialize]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>飞书 Bot 控制</DialogTitle>
        </DialogHeader>
        {configExists ? <FeishuControlPanel /> : <FeishuSetupGuide />}
      </DialogContent>
    </Dialog>
  );
}
