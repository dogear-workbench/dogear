import { useCallback, useEffect, useState } from 'react';
import { Loader2, Pencil, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';

interface RuleFileEditorProps {
  title: string;
  emptyHint: string;
  read: () => Promise<{ content?: string | null; error?: string }>;
  write: (content: string) => Promise<{ success?: boolean; error?: string }>;
  loadTemplate: () => Promise<{ content?: string; error?: string }>;
}

export function RuleFileEditor({ title, emptyHint, read, write, loadTemplate }: RuleFileEditorProps) {
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await read();
      if (res && 'error' in res && res.error) {
        toast.error(`读取${title}失败`, { description: res.error });
        return;
      }
      const text = res?.content ?? '';
      setContent(text);
      setSavedContent(text);
    } finally {
      setLoading(false);
    }
  }, [read, title]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = content !== savedContent;

  const startEdit = () => {
    setContent(savedContent);
    setEditing(true);
  };

  const handleCancel = () => {
    setContent(savedContent);
    setEditing(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await write(content);
      if (res && 'error' in res && res.error) {
        toast.error(`保存${title}失败`, { description: res.error });
        return;
      }
      setSavedContent(content);
      setEditing(false);
      toast.success(`已保存${title}`);
    } finally {
      setSaving(false);
    }
  };

  const handleRestoreTemplate = async () => {
    const res = await loadTemplate();
    if (res && 'error' in res && res.error) {
      toast.error('加载模板失败', { description: res.error });
      return;
    }
    setContent(res?.content ?? '');
  };

  if (loading) {
    return (
      <div className="space-y-2 flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{title}</span>
        </div>
        <div className="flex-1 min-h-[200px] rounded-md border flex items-center justify-center">
          <span className="text-sm text-muted-foreground">加载中…</span>
        </div>
      </div>
    );
  }

  if (!editing) {
    return (
      <div className="space-y-2 flex-1 min-h-0 flex flex-col">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{title}</span>
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={startEdit}>
            <Pencil className="w-3 h-3 mr-1" />
            编辑
          </Button>
        </div>
        <div className="flex-1 min-h-[200px] overflow-y-auto rounded-md border bg-muted/10 px-3 py-2 text-sm">
          {content.trim() ? (
            <MarkdownRenderer content={content} />
          ) : (
            <div className="text-sm text-muted-foreground whitespace-pre-wrap py-2">{emptyHint}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 flex-1 min-h-0 flex flex-col">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">
          {title}
          {dirty && <span className="ml-2 text-amber-600">● 未保存</span>}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={handleRestoreTemplate}>
            <RotateCcw className="w-3 h-3 mr-1" />
            恢复模板
          </Button>
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" disabled={saving} onClick={handleCancel}>
            取消
          </Button>
          <Button size="sm" className="h-7 px-2 text-xs" disabled={!dirty || saving} onClick={handleSave}>
            {saving && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
            {saving ? '保存中…' : '保存'}
          </Button>
        </div>
      </div>
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={emptyHint}
        className="flex-1 min-h-[200px] resize-none field-sizing-fixed font-mono text-sm"
      />
    </div>
  );
}
