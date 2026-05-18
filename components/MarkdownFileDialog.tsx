import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MarkdownRenderer } from './MarkdownRenderer';
import { useMarkdownPreviewStore } from '@/stores/markdown-preview-store';
import { client } from '@/lib/client';
import { Loader2 } from 'lucide-react';

export function MarkdownFileDialog() {
  const { isOpen, workspaceId, filePath, fileName, close } = useMarkdownPreviewStore();
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !workspaceId || !filePath) {
      setContent('');
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    setContent('');
    client.readFile({ workspaceId, path: filePath })
      .then(res => setContent(res.content))
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [isOpen, workspaceId, filePath]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="truncate">{fileName ?? '预览'}</DialogTitle>
        </DialogHeader>
        <ScrollArea className="flex-1 -mx-6 px-6">
          {loading && (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              加载中...
            </div>
          )}
          {error && <div className="text-red-600 text-sm py-4">{error}</div>}
          {!loading && !error && <MarkdownRenderer content={content} />}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
