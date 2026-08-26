import { useState, useEffect } from 'react';
import { client } from '@/lib/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw } from 'lucide-react';

interface ParseHistoryEntry {
  timestamp?: string;
  articleId?: string;
  url?: string;
  platform?: string | null;
  trigger?: string;
  triggeredAi?: boolean;
  scriptUpdated?: string | null;
  articleSaved?: boolean;
  parseStatus?: string;
  durationMs?: number;
  error?: string;
  raw?: string;
}

export function ParseHistoryPanel() {
  const [entries, setEntries] = useState<ParseHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const res = await client.getParseHistory({ limit: 100 });
      setEntries((res as any).entries || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">文章解析历史</h2>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      </div>

      {entries.length === 0 && !loading ? (
        <p className="text-sm text-muted-foreground">暂无历史记录。</p>
      ) : (
        <div className="space-y-2">
          {entries.map((e, idx) => (
            <div key={e.articleId ?? idx} className="border rounded p-3 text-sm space-y-1">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-mono text-xs text-muted-foreground">
                  {e.timestamp ? new Date(e.timestamp).toLocaleString() : '-'}
                </span>
                <div className="flex gap-1">
                  {e.triggeredAi ? (
                    <Badge variant="secondary">🤖 AI 介入</Badge>
                  ) : (
                    <Badge variant="outline">⚡ 直出</Badge>
                  )}
                  {e.scriptUpdated && (
                    <Badge variant="outline">🔧 {e.scriptUpdated}</Badge>
                  )}
                </div>
              </div>
              <div className="truncate text-muted-foreground">
                <span className="font-medium text-foreground">{e.platform || '(通用)'}</span>
                <span className="mx-2">·</span>
                <span>{e.url || '-'}</span>
              </div>
              <div className="text-xs text-muted-foreground flex gap-3 flex-wrap">
                <span>状态: {e.parseStatus || '-'}</span>
                <span>触发: {e.trigger || '-'}</span>
                <span>耗时: {e.durationMs ?? 0}ms</span>
                {e.error && <span className="text-destructive">❌ {e.error}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
