import { useEffect, useCallback, useRef } from 'react';
import { Globe, User, Calendar, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { useArticleStore } from '@/stores/article-store';
import { useReferenceStore } from '@/stores/reference-store';
import type { FileReadingTarget } from '@/stores/markdown-preview-store';
import { ParseStatusBadge, ParseInfoLine } from './article-parse-status';
import { QuotableContent } from './QuotableContent';
import { ReadingContent } from './ReadingContent';
import { openExternalUrl } from '@/lib/open-external';

/**
 * 阅读 tab 的文章视图（dogear/articles 内 file 目标）：按路径加载详情，元数据 + 正文 + 选字引用。
 * 路径在库内但 frontmatter 缺损/已删时降级普通 md 预览
 */
export function ArticleReadingView({ target }: { target: FileReadingTarget }) {
  const article = useArticleStore((s) =>
    s.selectedArticle?.path === target.filePath ? s.selectedArticle : null,
  );
  const loading = useArticleStore((s) => s.loadingArticleDetail);
  const loadArticleDetailByPath = useArticleStore((s) => s.loadArticleDetailByPath);
  const addQuotedSnippet = useReferenceStore((s) => s.addQuotedSnippet);
  // 已尝试加载的路径：加载失败（文章已删/损坏）不再重发请求，防 effect 无限重试
  const attemptedPathRef = useRef<string | null>(null);

  // 从最近列表恢复或切换文章目标时按需加载详情
  useEffect(() => {
    if (article === null && !loading && attemptedPathRef.current !== target.filePath) {
      attemptedPathRef.current = target.filePath;
      void loadArticleDetailByPath(target.workspaceId, target.filePath);
    }
  }, [target.workspaceId, target.filePath, article, loading, loadArticleDetailByPath]);

  const handleQuote = useCallback((text: string, anchorId: string) => {
    if (!article?.path) return;
    addQuotedSnippet({
      articlePath: article.path,
      articleTitle: article.title,
      text,
    }, anchorId);
  }, [article, addQuotedSnippet]);

  // 库内路径但文章识别失败：普通 md 预览降级，不阻断阅读
  if (!loading && article === null) {
    return (
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
        <ReadingContent target={target} />
      </div>
    );
  }

  if (loading && article === null) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm">加载文章内容...</p>
      </div>
    );
  }

  if (article === null) return null;

  const fetchedDate = new Date(article.fetchedAt);

  return (
    <div className="h-full overflow-y-auto">
      {/* 元数据区域 */}
      <div className="p-4 border-b space-y-3">
        <div className="flex items-start gap-2">
          <h3 className="font-semibold text-lg leading-tight flex-1">{article.title}</h3>
          {article.parseStatus && (
            <ParseStatusBadge status={article.parseStatus} />
          )}
        </div>

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

        {article.parseStatus && <ParseInfoLine status={article.parseStatus} />}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => openExternalUrl(article.url)}
          >
            <ExternalLink className="w-3 h-3 mr-1" />
            查看原文
          </Button>
        </div>
      </div>

      {/* Markdown 正文区域 */}
      <QuotableContent className="p-4" onQuote={handleQuote}>
        <MarkdownRenderer content={article.content} className="font-reading" />
      </QuotableContent>
    </div>
  );
}
