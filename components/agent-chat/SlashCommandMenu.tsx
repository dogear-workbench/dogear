import { useEffect, useRef, useState } from 'react';
import { Command, Search, Trash2, PackageOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SlashCommandInfo } from '@/stores/slash-command-store';

interface SlashCommandMenuProps {
  commands: SlashCommandInfo[];
  isOpen: boolean;
  filterQuery: string;
  onSelect: (cmd: SlashCommandInfo) => void;
  onClose: () => void;
}

/** 命令图标映射 */
function getCommandIcon(name: string) {
  switch (name) {
    case 'compact':
      return <PackageOpen size={14} className="text-blue-500" />;
    case 'clear':
      return <Trash2 size={14} className="text-red-500" />;
    case 'search':
      return <Search size={14} className="text-green-500" />;
    default:
      return <Command size={14} className="text-muted-foreground" />;
  }
}

/**
 * 斜杠命令浮动菜单
 * 在输入框上方显示，支持键盘上下选择和回车确认
 */
export function SlashCommandMenu({
  commands,
  isOpen,
  filterQuery,
  onSelect,
  onClose,
}: SlashCommandMenuProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  // 过滤变化时重置选中索引
  useEffect(() => {
    setSelectedIndex(0);
  }, [filterQuery, commands.length]);

  // 键盘导航
  useEffect(() => {
    if (!isOpen || commands.length === 0) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev <= 0 ? commands.length - 1 : prev - 1));
          break;
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => (prev >= commands.length - 1 ? 0 : prev + 1));
          break;
        case 'Enter':
        case 'Tab':
          e.preventDefault();
          if (commands[selectedIndex]) {
            onSelect(commands[selectedIndex]);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, commands, selectedIndex, onSelect, onClose]);

  if (!isOpen || commands.length === 0) return null;

  return (
    <div
      ref={menuRef}
      className="absolute bottom-full left-0 right-0 mb-1 z-50"
    >
      <div className="bg-popover border border-border rounded-lg shadow-lg overflow-hidden max-h-[240px] overflow-y-auto">
        <div className="px-3 py-1.5 text-xs text-muted-foreground border-b border-border">
          斜杠命令
        </div>
        {commands.map((cmd, index) => (
          <button
            key={`${cmd.source}-${cmd.name}`}
            className={cn(
              'flex items-center gap-2.5 w-full px-3 py-2 text-left text-sm transition-colors',
              index === selectedIndex
                ? 'bg-accent text-accent-foreground'
                : 'hover:bg-accent/50'
            )}
            onClick={() => onSelect(cmd)}
            onMouseEnter={() => setSelectedIndex(index)}
          >
            {getCommandIcon(cmd.name)}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-medium">/{cmd.name}</span>
                {cmd.argumentHint && (
                  <span className="text-xs text-muted-foreground">{cmd.argumentHint}</span>
                )}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {cmd.description}
              </div>
            </div>
            <span className={cn(
              'text-[10px] px-1.5 py-0.5 rounded',
              cmd.source === 'sdk'
                ? 'bg-blue-50 text-blue-600 border border-blue-200'
                : 'bg-green-50 text-green-600 border border-green-200'
            )}>
              {cmd.source === 'sdk' ? 'SDK' : '自定义'}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
