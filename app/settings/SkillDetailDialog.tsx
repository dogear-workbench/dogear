import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { client } from '@/lib/client';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';

interface SkillDetailDialogProps {
  skill: { name: string; description?: string } | null;
  onClose: () => void;
}

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

export function SkillDetailDialog({ skill, onClose }: SkillDetailDialogProps) {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!skill) {
      setContent('');
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    client
      .getSkillContent({ name: skill.name })
      .then((res: any) => {
        if (cancelled) return;
        if (res && typeof res === 'object' && 'error' in res) {
          setError(String((res as any).error));
          setContent('');
        } else {
          setContent(((res as any)?.content ?? '').replace(FRONTMATTER_RE, ''));
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [skill]);

  return (
    <Dialog open={skill !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-5xl max-h-[80vh] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="flex-shrink-0 px-6 pt-6 pb-3 border-b">
          <DialogTitle className="font-mono">{skill?.name}</DialogTitle>
          <DialogDescription>{skill?.description || 'SKILL.md 全文（只读）'}</DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
          {loading && (
            <div className="text-sm text-muted-foreground py-8 text-center">
              加载中...
            </div>
          )}
          {!loading && error && (
            <div className="p-3 rounded border border-destructive/40 bg-destructive/5 text-xs text-destructive font-mono whitespace-pre-wrap break-all">
              {error}
            </div>
          )}
          {!loading && !error && (
            <MarkdownRenderer
              content={content || '(空文件)'}
              className="[&_h1]:text-xl [&_h1]:mt-3 [&_h1]:mb-2"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
