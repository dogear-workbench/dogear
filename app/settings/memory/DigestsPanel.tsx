import { useState, useEffect, useCallback } from 'react';
import { FileText, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { client } from '@/lib/client';
import { useConfirmStore } from '@/stores/confirm-store';

interface Props {
  workspaceId: string;
  workspacePath: string;
}

interface DigestSummary {
  sessionId: string;
  conversationId?: string;
  title: string;
  createdAt: string;
  turnCount: number;
}

interface DigestItem {
  kind: string;
  text: string;
  uuid: string;
}

interface DigestCard {
  sessionId: string;
  conversationId?: string;
  title: string;
  createdAt: string;
  sourceMtime: number;
  turnCount: number;
  summary: string;
  items: DigestItem[];
}

type Tier = 'haiku' | 'sonnet' | 'opus';

const KIND_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  决策: 'default',
  想法: 'secondary',
  注意: 'outline',
  搁置: 'outline',
};

export function DigestsPanel({ workspaceId, workspacePath }: Props) {
  const confirm = useConfirmStore((s) => s.confirm);
  const [list, setList] = useState<DigestSummary[]>([]);
  const [selected, setSelected] = useState<DigestCard | null>(null);
  const [tier, setTier] = useState<Tier>('haiku');
  const [loading, setLoading] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const result = await client.listDigests({ workspaceId });
      if ('digests' in result && result.digests) setList(result.digests as DigestSummary[]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    loadList();
    client.getDigestModelTier().then((r) => {
      if ('tier' in r && r.tier) setTier(r.tier as Tier);
    });
  }, [loadList]);

  const selectCard = async (sessionId: string) => {
    const result = await client.readDigest({ workspaceId, sessionId });
    if ('card' in result && result.card) setSelected(result.card as DigestCard);
  };

  const handleTierChange = async (next: Tier) => {
    setTier(next);
    await client.setDigestModelTier({ tier: next });
  };

  const handleReDigest = async (sessionId: string) => {
    await client.triggerDigest({ workspaceId, workspacePath, sdkSessionId: sessionId });
    await confirm({
      title: '已加入提炼队列',
      description: '该会话将在后台重新提炼，稍后点「刷新」查看更新。',
      buttons: [{ label: '知道了', value: 'ok' }],
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted-foreground whitespace-nowrap">提炼模型</label>
          <select
            className="h-9 px-3 text-sm border rounded bg-background"
            value={tier}
            onChange={(e) => handleTierChange(e.target.value as Tier)}
          >
            <option value="haiku">Haiku（便宜，默认）</option>
            <option value="sonnet">Sonnet</option>
            <option value="opus">Opus</option>
          </select>
        </div>
        <Button variant="outline" size="sm" onClick={loadList} disabled={loading}>
          <RefreshCw className={loading ? 'w-4 h-4 mr-1 animate-spin' : 'w-4 h-4 mr-1'} />
          刷新
        </Button>
      </div>

      <div className="flex gap-6">
        {/* 左侧：摘要卡列表 */}
        <div className="w-64 shrink-0 space-y-1 max-h-[60vh] overflow-y-auto">
          {list.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">
              <FileText className="w-8 h-8 mx-auto opacity-40 mb-2" />
              暂无会话摘要
            </div>
          ) : (
            list.map((d) => (
              <button
                key={d.sessionId}
                onClick={() => selectCard(d.sessionId)}
                className={`w-full text-left px-3 py-2 rounded text-sm transition-colors ${
                  selected?.sessionId === d.sessionId
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-muted'
                }`}
              >
                <div className="font-medium truncate">{d.title || '(无标题)'}</div>
                <div className="text-xs text-muted-foreground">
                  {new Date(d.createdAt).toLocaleString()} · {d.turnCount} 轮
                </div>
              </button>
            ))
          )}
        </div>

        {/* 右侧：摘要卡正文 */}
        <div className="flex-1 min-w-0">
          {!selected ? (
            <div className="text-sm text-muted-foreground py-16 text-center">
              选择左侧一张摘要卡查看详情
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold">{selected.title}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5 font-mono break-all">
                    {selected.sessionId}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => handleReDigest(selected.sessionId)}
                >
                  <Sparkles className="w-4 h-4 mr-1" />
                  重新提炼
                </Button>
              </div>

              <div>
                <h4 className="text-sm font-medium mb-1">概述</h4>
                <MarkdownRenderer content={selected.summary} />
              </div>

              {selected.items.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium mb-2">想法 / 注意 / 决策</h4>
                  <ul className="space-y-2">
                    {selected.items.map((it, i) => (
                      <li key={i} className="text-sm flex flex-col gap-0.5">
                        <div className="flex items-start gap-2">
                          <Badge variant={KIND_VARIANT[it.kind] ?? 'outline'} className="shrink-0">
                            {it.kind}
                          </Badge>
                          <span>{it.text}</span>
                        </div>
                        <span
                          className="text-[11px] text-muted-foreground font-mono break-all pl-1"
                          title="出处消息 uuid（用于回溯原会话）"
                        >
                          ⟶ {it.uuid}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
