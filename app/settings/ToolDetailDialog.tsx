import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';

interface ToolDetailDialogProps {
  tool: { name: string; description: string } | null;
  onClose: () => void;
}

export function ToolDetailDialog({ tool, onClose }: ToolDetailDialogProps) {
  return (
    <Dialog open={tool !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono">{tool?.name}</DialogTitle>
          <DialogDescription>工具完整说明（给 Agent 的描述全文）</DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto" style={{ maxHeight: '80vh' }}>
          {tool && (
            <div className="text-xs leading-relaxed prose prose-sm dark:prose-invert max-w-none">
              <MarkdownRenderer content={tool.description || '(无描述)'} />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
