import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FilterInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export function FilterInput({ value, onChange, placeholder, className }: FilterInputProps) {
  return (
    <div className={cn('relative flex items-center', className)}>
      <Search className="pointer-events-none absolute left-2 w-3 h-3 text-muted-foreground" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-7 w-full min-w-0 rounded-sm border border-input bg-transparent pl-7 pr-6 text-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[2px] focus-visible:ring-ring/50"
      />
      {value && (
        <button
          type="button"
          title="清空"
          className="absolute right-1 flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          onClick={() => onChange('')}
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
