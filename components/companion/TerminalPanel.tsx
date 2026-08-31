import { SquareTerminal } from 'lucide-react';

export function TerminalPanel() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground select-none">
      <SquareTerminal className="w-6 h-6" />
      <span className="text-xs">该会话暂无命令执行</span>
    </div>
  );
}
