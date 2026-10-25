import { Loader2, RefreshCw, Sparkles, CheckCircle2, AlertTriangle, XCircle, Zap, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useArticleStore } from '@/stores/article-store';
import type { ArticleParseStatus } from '@/types/article';

/** 解析状态 Badge 的展示配置 */
const PARSE_STATUS_CONFIG: Record<ArticleParseStatus, {
  label: string;
  title: string;
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
export function ParseStatusBadge({ status }: { status: ArticleParseStatus }) {
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

/** 解析层说明文案（与 Badge 六态一一对应） */
const PARSE_LAYER_DESC: Record<ArticleParseStatus, string> = {
  script_ok: '平台脚本解析，未经 AI',
  fixed: '固定解析（Readability），质量达标',
  ai_parsing: 'AI 正在后台检查/改进解析结果',
  ai_enhanced: 'AI 已改进解析结果',
  quality_warning: '解析质量不达标，AI 未能改善，可重试',
  failed: '解析失败，可重试',
};

/** 元数据区的解析信息行：解析层说明 + 失败态重试入口（重试走既有 parseArticle 管线） */
export function ParseInfoLine({ status }: { status: ArticleParseStatus }) {
  const retrying = useArticleStore((s) => s.retryingArticle);
  const retryParse = useArticleStore((s) => s.retryParse);
  const showRetry = status === 'failed' || status === 'quality_warning';
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <BookOpen className="w-3 h-3 shrink-0" />
      <span>{PARSE_LAYER_DESC[status]}</span>
      {showRetry && (
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-xs gap-1"
          disabled={retrying}
          onClick={() => void retryParse()}
        >
          <RefreshCw className={'w-3 h-3' + (retrying ? ' animate-spin' : '')} />
          {retrying ? '重试中...' : '重试解析'}
        </Button>
      )}
    </div>
  );
}
