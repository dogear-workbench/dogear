import { Archive } from 'lucide-react';

interface CollapseControlBarProps {
  count: number;
  onCollapse: () => void;
}

export function CollapseControlBar({ count, onCollapse }: CollapseControlBarProps) {
  return (
    <button
      onClick={onCollapse}
      className="flex items-center gap-2 w-full px-3 py-2 my-2 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors cursor-pointer"
    >
      <Archive size={14} />
      <span>折叠 {count} 条历史消息</span>
    </button>
  );
}
