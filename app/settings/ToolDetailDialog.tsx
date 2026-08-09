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
      <DialogContent className="sm:max-w-5xl h-[80vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="flex-shrink-0 px-6 pt-6 pb-3 border-b">
          <DialogTitle className="font-mono">{tool?.name}</DialogTitle>
          <DialogDescription>工具完整说明（给 Agent 的描述全文）</DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
          {tool && (
            <div className="rounded-lg border bg-background p-4">
              <div className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none">
                <MarkdownRenderer content={tool.description || '(无描述)'} />
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
