import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { SystemPromptSegment } from '@/types/system-prompt';

interface SegmentDetailDialogProps {
  segment: SystemPromptSegment | null;
  onClose: () => void;
}

export function SegmentDetailDialog({ segment, onClose }: SegmentDetailDialogProps) {
  return (
    <Dialog open={segment !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{segment?.label}</DialogTitle>
          <DialogDescription>
            {segment?.triggerDescription || '提示词段模板全文（只读）'}
          </DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto" style={{ maxHeight: '80vh' }}>
          {segment && (
            <pre className="text-xs bg-muted p-3 rounded whitespace-pre-wrap font-mono leading-relaxed">
              {segment.template || '(空模板)'}
            </pre>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
