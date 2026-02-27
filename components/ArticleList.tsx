'use client';

import { Globe, Trash2, FileText, Quote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useArticleStore } from '@/stores/article-store';
import { useReferenceStore } from '@/stores/reference-store';

/**
 * 获取相对时间文本
 */
function getRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (days < 7) return `${days}天前`;

  const date = new Date(timestamp);
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

/**
 * 文章列表组件
 * 直接从 store 获取数据，无需外部 props
 */
export function ArticleList() {
  const articles = useArticleStore((s) => s.articles);
  const selectedArticle = useArticleStore((s) => s.selectedArticle);
  const loadingArticles = useArticleStore((s) => s.loadingArticles);
  const selectArticle = useArticleStore((s) => s.selectArticle);
  const deleteArticle = useArticleStore((s) => s.deleteArticle);

  const referencedArticles = useReferenceStore((s) => s.referencedArticles);
  const toggleReferenceArticle = useReferenceStore((s) => s.toggleReferenceArticle);

  const referencedArticleIds = new Set(referencedArticles.map((a) => a.id));
  const selectedArticleId = selectedArticle?.id || null;

  if (loadingArticles) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-2" />
        <p className="text-xs">加载中...</p>
      </div>
    );
  }

  if (articles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <FileText className="w-8 h-8 mb-2 opacity-50" />
        <p className="text-xs">暂无文章</p>
      </div>
    );
  }

  return (
    <div className="py-1">
      {articles.map((article) => {
        const isSelected = selectedArticleId === article.id;

        return (
          <div
            key={article.id}
            className={`flex items-start gap-2 py-2 px-3 mx-1 rounded cursor-pointer transition-colors group ${
              isSelected ? 'bg-green-100 dark:bg-green-900/30' : 'hover:bg-muted/30'
            }`}
            onClick={() => selectArticle(article)}
          >
            <Globe className={`w-4 h-4 flex-shrink-0 mt-0.5 ${
              isSelected ? 'text-green-600' : 'text-muted-foreground'
            }`} />

            <div className="flex-1 min-w-0">
              <div className={`text-sm truncate ${
                isSelected ? 'text-green-700 dark:text-green-300 font-medium' : 'text-foreground'
              }`}>
                {article.title}
              </div>
              {/* 站点名和时间 */}
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                {article.siteName && (
                  <>
                    <span className="truncate max-w-[80px]">{article.siteName}</span>
                    <span>·</span>
                  </>
                )}
                <span>{getRelativeTime(article.fetchedAt)}</span>
              </div>
              {/* 摘要 */}
              {article.excerpt && (
                <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                  {article.excerpt}
                </div>
              )}
            </div>

            {/* 操作按钮组 */}
            <div className="flex items-center gap-0.5 flex-shrink-0">
              {/* 引用按钮 */}
              <Button
                variant="ghost"
                size="sm"
                className={`h-6 w-6 p-0 transition-opacity flex-shrink-0 ${
                  referencedArticleIds.has(article.id)
                    ? 'opacity-100 text-blue-600'
                    : 'opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-blue-600'
                }`}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleReferenceArticle(article);
                }}
                title={referencedArticleIds.has(article.id) ? '已引用到对话' : '引用到对话'}
              >
                <Quote className="w-3 h-3" />
              </Button>
              {/* 删除按钮 */}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive flex-shrink-0"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteArticle(article.id);
                }}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
