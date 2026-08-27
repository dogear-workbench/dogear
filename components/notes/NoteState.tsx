import { Loader2 } from 'lucide-react';

export function NoteLoading() {
  return (
    <div className="h-full flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
    </div>
  );
}

export function NoteEmpty({ text }: { text: string }) {
  return (
    <div className="h-full flex items-center justify-center text-sm text-muted-foreground">{text}</div>
  );
}
