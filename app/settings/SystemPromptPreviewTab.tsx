import { useEffect, useState } from 'react';
import { Card, CardHeader, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import type { SystemPromptSegment } from '@/types/system-prompt';

type Category = SystemPromptSegment['category'];

const CATEGORY_META: Record<Category, { label: string; className: string }> = {
  'tool-guide': {
    label: '工具',
    className: 'border-transparent bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  },
  reference: {
    label: '引用',
    className: 'border-transparent bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300',
  },
  group: {
    label: '组',
    className: 'border-transparent bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',
  },
  notes: {
    label: '记录',
    className: 'border-transparent bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  },
  'sub-agent': {
    label: '子会话',
    className: 'border-transparent bg-gray-200 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  },
};

const CATEGORY_ORDER: Category[] = ['tool-guide', 'reference', 'group', 'notes', 'sub-agent'];

const CATEGORY_SECTION_TITLE: Record<Category, string> = {
  'tool-guide': '工具包引导',
  reference: '引用注入',
  group: '组上下文',
  notes: '共享区记录',
  'sub-agent': '子会话契约',
};

export function SystemPromptPreviewTab() {
  const [segments, setSegments] = useState<SystemPromptSegment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await client.getSystemPromptSegments();
        if (cancelled) return;
        if ('error' in result) {
          setError(result.error);
          setSegments(null);
        } else {
          setSegments(result.segments);
          setError(null);
        }
      } catch (e) {
        if (cancelled) return;
        setError(String(e));
        setSegments(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const grouped = new Map<Category, SystemPromptSegment[]>();
  if (segments) {
    for (const seg of segments) {
      const list = grouped.get(seg.category) ?? [];
      list.push(seg);
      grouped.set(seg.category, list);
    }
  }

  return (
    <div className="max-w-3xl py-6 px-6">
      <h2 className="text-lg font-semibold mb-1">系统提示词</h2>
      <p className="text-sm text-muted-foreground mb-6">
        以下是 dogear 会自动附加到系统提示词的段落。这些内容根据会话上下文自动注入，不可编辑；如需修改用户段（默认提示词/人设等）请前往对应 Tab。
      </p>

      {loading && (
        <div className="text-sm text-muted-foreground py-8 text-center">加载中...</div>
      )}

      {!loading && error && (
        <div className="p-4 rounded-lg border border-destructive/40 bg-destructive/5 text-sm text-destructive">
          <div className="font-medium mb-1">加载失败</div>
          <div className="font-mono text-xs whitespace-pre-wrap break-all">{error}</div>
        </div>
      )}

      {!loading && !error && segments && segments.length === 0 && (
        <div className="text-sm text-muted-foreground py-8 text-center">暂无内容</div>
      )}

      {!loading && !error && segments && segments.length > 0 && (
        <div className="space-y-8">
          {CATEGORY_ORDER.filter((cat) => grouped.has(cat)).map((cat) => (
            <section key={cat} className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground/80 uppercase tracking-wide">
                {CATEGORY_SECTION_TITLE[cat]}
              </h3>
              <div className="space-y-4">
                {grouped.get(cat)!.map((seg) => (
                  <SegmentCard key={seg.key} segment={seg} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function SegmentCard({ segment }: { segment: SystemPromptSegment }) {
  const meta = CATEGORY_META[segment.category];
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2 flex-wrap">
          <h4 className="text-base font-semibold">{segment.label}</h4>
          <Badge className={cn('text-[10px]', meta.className)}>{meta.label}</Badge>
          {segment.isDynamic && (
            <Badge variant="outline" className="text-[10px]">动态</Badge>
          )}
          <code className="text-[10px] text-muted-foreground ml-auto font-mono">{segment.key}</code>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{segment.triggerDescription}</p>
        <pre className="text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap font-mono">
          {segment.template}
        </pre>
      </CardContent>
    </Card>
  );
}
