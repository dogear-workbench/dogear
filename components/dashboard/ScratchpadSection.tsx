import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useDashboardStore } from '@/stores/dashboard-store';

interface ScratchpadSectionProps {
  workspaceId: string;
}

export function ScratchpadSection({ workspaceId }: ScratchpadSectionProps) {
  const notesContent = useDashboardStore((s) => s.notesContent);
  const notesSaving = useDashboardStore((s) => s.notesSaving);
  const setNotesLocal = useDashboardStore((s) => s.setNotesLocal);
  const flushNotes = useDashboardStore((s) => s.flushNotes);

  const [value, setValue] = useState(notesContent);
  const [touched, setTouched] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setValue(notesContent);
    setTouched(false);
  }, [notesContent, workspaceId]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setValue(v);
    setTouched(true);
    setNotesLocal(v);
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      flushNotes(workspaceId);
    }, 800);
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-foreground">我的速记</h2>
        {touched && (
          <span className="text-xs text-muted-foreground">
            {notesSaving ? '保存中…' : '已保存'}
          </span>
        )}
      </div>
      <textarea
        value={value}
        onChange={handleChange}
        placeholder="随手记点什么…"
        className={cn(
          'w-full min-h-40 resize-y rounded-lg border border-input bg-background px-3 py-2',
          'text-sm text-foreground placeholder:text-muted-foreground',
          'focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring',
          'transition-colors',
        )}
      />
    </section>
  );
}
