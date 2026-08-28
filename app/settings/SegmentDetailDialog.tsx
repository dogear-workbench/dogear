import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import type { SystemPromptSegment } from '@/types/system-prompt';

interface SegmentDetailDialogProps {
  segment: SystemPromptSegment | null;
  onClose: () => void;
}

export function SegmentDetailDialog({ segment, onClose }: SegmentDetailDialogProps) {
  return (
    <Dialog open={segment !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-3xl max-h-[80vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="flex-shrink-0 px-6 pt-6 pb-3 border-b">
          <DialogTitle>{segment?.label}</DialogTitle>
          <DialogDescription>
            {segment?.triggerDescription || '提示词段全文（只读）'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
          {segment && <MarkdownRenderer content={segment.template || '(空模板)'} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
