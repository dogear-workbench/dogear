import { Archive } from 'lucide-react';

interface CollapsedHistoryBannerProps {
  count: number;
  onExpand: () => void;
}

export function CollapsedHistoryBanner({ count, onExpand }: CollapsedHistoryBannerProps) {
  return (
    <button
      onClick={onExpand}
      className="flex items-center gap-2 w-full px-3 py-2 my-2 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors cursor-pointer"
    >
      <Archive size={14} />
      <span>查看 {count} 条历史消息</span>
    </button>
  );
}
