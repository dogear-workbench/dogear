import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MarkdownRenderer } from './MarkdownRenderer';
import { useMarkdownPreviewStore } from '@/stores/markdown-preview-store';
import { client } from '@/lib/client';
import { Loader2 } from 'lucide-react';

export function MarkdownFileDialog() {
  const { isOpen, workspaceId, filePath, fileName, inlineContent, close } = useMarkdownPreviewStore();
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setContent('');
      setError(null);
      return;
    }
    // inline 模式：直接渲染传入内容，不读盘
    if (inlineContent !== null) {
      setContent(inlineContent);
      setLoading(false);
      setError(null);
      return;
    }
    if (!workspaceId || !filePath) return;
    setLoading(true);
    setError(null);
    setContent('');
    client.readFile({ workspaceId, path: filePath })
      .then(res => setContent(res.content))
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [isOpen, workspaceId, filePath, inlineContent]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="sm:max-w-6xl h-[80vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="flex-shrink-0 px-6 pt-6 pb-3 border-b">
          <DialogTitle className="truncate pr-8">{fileName ?? '预览'}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
          {loading && (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              加载中...
            </div>
          )}
          {error && <div className="text-red-600 text-sm py-4">{error}</div>}
          {!loading && !error && <MarkdownRenderer content={content} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
