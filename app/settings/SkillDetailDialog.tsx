import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { client } from '@/lib/client';

interface SkillDetailDialogProps {
  name: string | null;
  onClose: () => void;
}

export function SkillDetailDialog({ name, onClose }: SkillDetailDialogProps) {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!name) {
      setContent('');
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    client
      .getSkillContent({ name })
      .then((res: any) => {
        if (cancelled) return;
        if (res && typeof res === 'object' && 'error' in res) {
          setError(String((res as any).error));
          setContent('');
        } else {
          setContent((res as any)?.content ?? '');
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
  }, [name]);

  return (
    <Dialog open={name !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono">{name}</DialogTitle>
          <DialogDescription>SKILL.md 模板源全文（只读）</DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto" style={{ maxHeight: '80vh' }}>
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
            <pre className="text-xs bg-muted p-3 rounded whitespace-pre-wrap font-mono leading-relaxed">
              {content || '(空文件)'}
            </pre>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
