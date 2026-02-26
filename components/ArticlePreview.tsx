'use client';

import { Globe, User, Calendar, ExternalLink, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import type { Article } from '@/types/article';

interface ArticlePreviewProps {
  /** 文章完整数据（含正文），null 表示未选中 */
  article: Article | null;
  /** 加载中状态 */
  loading: boolean;
}

/**
 * 文章内容预览组件
 * 展示文章元数据和 Markdown 正文
 */
export function ArticlePreview({ article, loading }: ArticlePreviewProps) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm">加载文章内容...</p>
      </div>
    );
  }

  if (!article) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <FileText className="w-12 h-12 mb-4 opacity-50" />
        <p className="text-sm text-center">选择文章查看内容</p>
      </div>
    );
  }

  const fetchedDate = new Date(article.fetchedAt);

  return (
    <div className="h-full overflow-y-auto">
      {/* 元数据区域 */}
      <div className="p-4 border-b space-y-3">
        <h3 className="font-semibold text-lg leading-tight">{article.title}</h3>

        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {article.author && (
            <div className="flex items-center gap-1">
              <User className="w-3 h-3" />
              <span>{article.author}</span>
            </div>
          )}
          {article.siteName && (
            <div className="flex items-center gap-1">
              <Globe className="w-3 h-3" />
              <span>{article.siteName}</span>
            </div>
          )}
          <div className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            <span>{fetchedDate.toLocaleDateString('zh-CN')}</span>
          </div>
          <span>{article.wordCount.toLocaleString()} 字</span>
        </div>

        {article.excerpt && (
          <p className="text-sm text-muted-foreground bg-muted/50 rounded px-3 py-2">
            {article.excerpt}
          </p>
        )}

        <Button
          variant="outline"
          size="sm"
          onClick={() => window.open(article.url, '_blank')}
        >
          <ExternalLink className="w-3 h-3 mr-1" />
          查看原文
        </Button>
      </div>

      {/* Markdown 正文区域 */}
      <div className="p-4">
        <MarkdownRenderer content={article.content} />
      </div>
    </div>
  );
}
