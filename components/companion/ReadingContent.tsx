import { useEffect, useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { client } from '@/lib/client';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { useReferenceStore } from '@/stores/reference-store';
import { QuotableContent } from './QuotableContent';
import type { ReadingTarget } from '@/stores/markdown-preview-store';

export function ReadingContent({ target }: { target: ReadingTarget }) {
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const addFileSnippet = useReferenceStore((s) => s.addFileSnippet);
  const file = target.kind === 'file' ? target : null;

  const handleQuote = useCallback((text: string, anchorId: string) => {
    addFileSnippet({ fileName: target.fileName, text, timestamp: Date.now() }, anchorId);
  }, [addFileSnippet, target.fileName]);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    setContent(null);
    setError(null);
    client.readFile({ workspaceId: file.workspaceId, path: file.filePath, groupId: file.groupId ?? undefined })
      .then((res) => {
        if (!cancelled) setContent(res.content);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [file]);

  // inline 非 md 目标（如平台脚本 .py）不能走 MarkdownRenderer：# 注释会被渲染成标题、缩进被打散，按纯代码文本呈现
  if (target.kind === 'inline') {
    if (target.fileName.endsWith('.md')) {
      return (
        <QuotableContent onQuote={handleQuote}>
          <MarkdownRenderer content={target.content} />
        </QuotableContent>
      );
    }
    return (
      <QuotableContent onQuote={handleQuote}>
        <pre className="rounded-lg border border-border bg-[var(--code-background)] p-3.5 text-sm font-mono whitespace-pre-wrap break-words">{target.content}</pre>
      </QuotableContent>
    );
  }
  if (error) return <div className="text-red-600 text-sm py-4">{error}</div>;
  if (content === null) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin mr-2" />
        加载中...
      </div>
    );
  }
  return (
    <QuotableContent onQuote={handleQuote}>
      <MarkdownRenderer content={content} />
    </QuotableContent>
  );
}
