'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Globe, User, Calendar, ExternalLink, FileText, Quote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import type { Article } from '@/types/article';

interface ArticlePreviewProps {
  /** 文章完整数据（含正文），null 表示未选中 */
  article: Article | null;
  /** 加载中状态 */
  loading: boolean;
  /** 引用选中文字到对话回调 */
  onQuoteSnippet?: (params: { articleId: string; articleTitle: string; text: string }) => void;
}

/**
 * 选中文字后的浮动引用按钮
 */
function SelectionTooltip({
  position,
  onQuote,
}: {
  position: { top: number; left: number };
  onQuote: () => void;
}) {
  return (
    <div
      className="absolute z-50 animate-in fade-in zoom-in-95 duration-150"
      style={{ top: position.top, left: position.left }}
    >
      <button
        onMouseDown={(e) => {
          // 用 mousedown 而非 click，避免点击时选区被清除
          e.preventDefault();
          e.stopPropagation();
          onQuote();
        }}
        className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 text-white text-xs rounded-lg shadow-lg hover:bg-purple-700 transition-colors"
      >
        <Quote className="w-3 h-3" />
        引用到对话
      </button>
    </div>
  );
}

/**
 * 文章内容预览组件
 * 展示文章元数据和 Markdown 正文
 */
export function ArticlePreview({ article, loading, onQuoteSnippet }: ArticlePreviewProps) {
  // 浮动按钮状态
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);
  const [selectedText, setSelectedText] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);

  /**
   * 监听鼠标抬起事件，检测文字选中
   * 使用 mouseup 而非 selectionchange，确保选区稳定后再显示按钮
   */
  const handleMouseUp = useCallback(() => {
    if (!onQuoteSnippet || !contentRef.current) return;

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      setTooltipPos(null);
      setSelectedText('');
      return;
    }

    const text = selection.toString().trim();
    if (!text) {
      setTooltipPos(null);
      setSelectedText('');
      return;
    }

    // 确保选区在文章内容区域内
    const range = selection.getRangeAt(0);
    if (!contentRef.current.contains(range.commonAncestorContainer)) {
      setTooltipPos(null);
      setSelectedText('');
      return;
    }

    // 计算浮动按钮位置（相对于 contentRef 容器）
    const rangeRect = range.getBoundingClientRect();
    const containerRect = contentRef.current.getBoundingClientRect();

    setSelectedText(text);
    setTooltipPos({
      top: rangeRect.top - containerRect.top - 36, // 在选区上方
      left: rangeRect.left - containerRect.left + rangeRect.width / 2 - 50, // 居中
    });
  }, [onQuoteSnippet]);

  /**
   * 点击其他区域时隐藏浮动按钮
   */
  const handleMouseDown = useCallback((e: MouseEvent) => {
    // 如果点击的是浮动按钮本身，不隐藏（由按钮的 onMouseDown 处理）
    const target = e.target as HTMLElement;
    if (target.closest('[data-quote-tooltip]')) return;

    setTooltipPos(null);
    setSelectedText('');
  }, []);

  useEffect(() => {
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [handleMouseDown]);

  /**
   * 处理引用操作
   */
  const handleQuote = useCallback(() => {
    if (!article || !selectedText || !onQuoteSnippet) return;

    onQuoteSnippet({
      articleId: article.id,
      articleTitle: article.title,
      text: selectedText,
    });

    // 清除选区和浮动按钮
    window.getSelection()?.removeAllRanges();
    setTooltipPos(null);
    setSelectedText('');
  }, [article, selectedText, onQuoteSnippet]);

  // 切换文章时清除浮动按钮
  useEffect(() => {
    setTooltipPos(null);
    setSelectedText('');
  }, [article?.id]);

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
      <div className="p-4 relative" ref={contentRef} onMouseUp={handleMouseUp}>
        <MarkdownRenderer content={article.content} />

        {/* 浮动引用按钮 */}
        {tooltipPos && (
          <div data-quote-tooltip>
            <SelectionTooltip position={tooltipPos} onQuote={handleQuote} />
          </div>
        )}
      </div>
    </div>
  );
}
