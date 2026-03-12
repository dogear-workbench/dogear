import { Citation } from '@/types/electron-api';
import { client } from '@/lib/client';
import { Button } from '@/components/ui/button';

/**
 * 引用徽章组件
 * 显示引用来源，支持点击跳转到原文位置
 */
export function CitationBadge({ citation }: { citation: Citation }) {
  const handleClick = async () => {
    try {
      await client.jumpToPosition({
        chapterId: citation.chapterId,
        position: citation.position,
      });
    } catch (error) {
      console.error('跳转失败:', error);
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleClick}
      className="h-7 px-2 text-xs text-blue-700 border-blue-200 bg-blue-50 hover:bg-blue-100"
      title={`点击跳转到: ${citation.chapterTitle}`}
    >
      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
      </svg>
      <span className="font-medium">{citation.chapterTitle}</span>
      {citation.position && (
        <span className="text-gray-400">: {citation.position.start}-{citation.position.end}</span>
      )}
    </Button>
  );
}
