
import { useState, useEffect, useRef, useCallback } from 'react';
import { Globe, User, Calendar, ExternalLink, FileText, Quote, Loader2, Sparkles, CheckCircle2, AlertTriangle, XCircle, Zap, Lock, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { useArticleStore } from '@/stores/article-store';
import { useReferenceStore } from '@/stores/reference-store';
import { requireReferenceAnchorId } from '@/lib/reference-guard';
import { useSessionStore } from '@/stores/session-store';
import { useInputFocusStore } from '@/stores/input-focus-store';
import type { ArticleParseStatus } from '@/types/article';

/** 解析状态 Badge 的展示配置 */
const PARSE_STATUS_CONFIG: Record<ArticleParseStatus, {
  label: string;
  title: string;  // tooltip（浏览器默认 title）
  className: string;
  Icon: typeof CheckCircle2;
}> = {
  script_ok: {
    label: '脚本解析',
    title: '平台脚本直接解析成功，零 AI',
    className: 'bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-50',
    Icon: Zap,
  },
  fixed: {
    label: '已解析',
    title: '固定解析成功，质量达标',
    className: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50',
    Icon: CheckCircle2,
  },
  need_login: {
    label: '需要登录',
    title: '该页面需要登录后才能读取，登录后可点击重试',
    className: 'bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-50',
    Icon: Lock,
  },
  ai_parsing: {
    label: 'AI 检查中',
    title: 'AI 正在后台检查解析质量',
    className: 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-50',
    Icon: Loader2,
  },
  ai_enhanced: {
    label: 'AI 增强',
    title: 'AI 已改进解析结果',
    className: 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-50',
    Icon: Sparkles,
  },
  quality_warning: {
    label: '质量警告',
    title: '固定解析质量不达标，AI 也未能改善',
    className: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50',
    Icon: AlertTriangle,
  },
  failed: {
    label: '解析失败',
    title: '解析失败',
    className: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-50',
    Icon: XCircle,
  },
};

/** 文章解析状态 Badge 组件 */
function ParseStatusBadge({ status }: { status: ArticleParseStatus }) {
  const cfg = PARSE_STATUS_CONFIG[status];
  const isSpinning = status === 'ai_parsing';
  return (
    <Badge
      variant="outline"
      className={cfg.className + ' gap-1 font-normal'}
      title={cfg.title}
    >
      <cfg.Icon className={'w-3 h-3' + (isSpinning ? ' animate-spin' : '')} />
      <span>{cfg.label}</span>
    </Badge>
  );
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
 * 直接从 store 获取数据，无需外部 props
 */
export function ArticlePreview() {
  const article = useArticleStore((s) => s.selectedArticle);
  const loading = useArticleStore((s) => s.loadingArticleDetail);
  const parsingArticle = useArticleStore((s) => s.parsingArticle);
  const retryAfterLogin = useArticleStore((s) => s.retryAfterLogin);
  const addQuotedSnippet = useReferenceStore((s) => s.addQuotedSnippet);

  // 浮动按钮状态
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number } | null>(null);
  const [selectedText, setSelectedText] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);

  /**
   * 监听鼠标抬起事件，检测文字选中
   */
  const handleMouseUp = useCallback(() => {
    if (!contentRef.current) return;

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
  }, []);

  /**
   * 点击其他区域时隐藏浮动按钮
   */
  const handleMouseDown = useCallback((e: MouseEvent) => {
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
    if (!article || !selectedText) return;
    // 文章 tab 是哨兵 tab，无焦点会话：锚定回退到最近活跃会话
    const anchorId = requireReferenceAnchorId();
    if (!anchorId) return;

    addQuotedSnippet({
      articleId: article.id,
      articleTitle: article.title,
      text: selectedText,
    }, anchorId);

    // 清除选区和浮动按钮
    window.getSelection()?.removeAllRanges();
    setTooltipPos(null);
    setSelectedText('');

    // 主窗口文章 tab 场景：切回目标会话让引用可见；独立窗口右栏引用留在原会话
    if (!window.location.hash.startsWith('#/session-window/')) {
      useSessionStore.getState().switchTab(anchorId);
      useInputFocusStore.getState().requestFocus(anchorId);
    }
  }, [article, selectedText, addQuotedSnippet]);

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
    <ScrollArea className="h-full overflow-hidden">
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

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open(article.url, '_blank')}
          >
            <ExternalLink className="w-3 h-3 mr-1" />
            查看原文
          </Button>
          {article.parseStatus === 'need_login' && (
            <Button
              variant="outline"
              size="sm"
              disabled={parsingArticle}
              onClick={() => void retryAfterLogin()}
            >
              {parsingArticle
                ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                : <RefreshCw className="w-3 h-3 mr-1" />}
              我已登录，重试
            </Button>
          )}
        </div>
      </div>

      {/* Markdown 正文区域 */}
      <div className="p-4 relative" ref={contentRef} onMouseUp={handleMouseUp}>
        <MarkdownRenderer content={article.content} className="font-reading" />

        {/* 浮动引用按钮 */}
        {tooltipPos && (
          <div data-quote-tooltip>
            <SelectionTooltip position={tooltipPos} onQuote={handleQuote} />
          </div>
        )}
      </div>
    </ScrollArea>
  );
}
