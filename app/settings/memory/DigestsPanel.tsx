import { useState, useEffect, useCallback } from 'react';
import { FileText, RefreshCw, Sparkles, Square, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MarkdownRenderer } from '@/components/MarkdownRenderer';
import { client } from '@/lib/client';
import { cn } from '@/lib/utils';
import { useConfirmStore } from '@/stores/confirm-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import type { AppSettings, ModelSelection } from '@/types/settings';
import { DEFAULT_SETTINGS } from '@/types/settings';
import { ModelSelector } from '@/components/ModelSelector';

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

interface DigestActivity {
  current: { workspaceId: string; sessionId: string; startedAt: number; taskId: string } | null;
  queueDepth: number;
  recent: Array<{
    sessionId: string;
    finishedAt: number;
    outcome: 'saved' | 'no-card' | 'error';
    tier?: string;
    profileName?: string;
    error?: string;
    durationMs: number;
  }>;
  lastScan: { at: number; dirtyCount: number } | null;
}

const KIND_VARIANT: Record<string, 'default' | 'secondary' | 'outline'> = {
  决策: 'default',
  想法: 'secondary',
  注意: 'outline',
  搁置: 'outline',
};

export function DigestsPanel() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const workspaceId = workspace?.id;
  const workspacePath = workspace?.path;
  const confirm = useConfirmStore((s) => s.confirm);
  const [list, setList] = useState<DigestSummary[]>([]);
  const [selected, setSelected] = useState<DigestCard | null>(null);
  const [loading, setLoading] = useState(false);
  const [selection, setSelection] = useState<ModelSelection | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [activity, setActivity] = useState<DigestActivity | null>(null);
  const [prompt, setPrompt] = useState('');
  const [defaultPrompt, setDefaultPrompt] = useState('');
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptDirty, setPromptDirty] = useState(false);

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
    client.getDigestModelSelection().then((r) => {
      if ('selection' in r) setSelection(r.selection);
    });
    client.getSettings().then((s) => {
      if ('settings' in s && s.settings) setSettings(s.settings);
    });
    client.getDigestPrompt().then((r) => {
      if ('prompt' in r && r.prompt) setPrompt(r.prompt);
      if ('defaultPrompt' in r && r.defaultPrompt) setDefaultPrompt(r.defaultPrompt);
    });
  }, [loadList]);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const r = await client.getDigestActivity();
      if (alive && 'activity' in r && r.activity) setActivity(r.activity as DigestActivity);
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const selectCard = async (sessionId: string) => {
    const result = await client.readDigest({ workspaceId, sessionId });
    if ('card' in result && result.card) setSelected(result.card as DigestCard);
  };

  const handleSelectionChange = async (next: ModelSelection | null) => {
    setSelection(next);
    await client.setDigestModelSelection({ selection: next });
  };

  const handleSavePrompt = async () => {
    await client.setDigestPrompt({ prompt });
    setPromptDirty(false);
  };
  const handleResetPrompt = () => {
    setPrompt(defaultPrompt);
    setPromptDirty(true);
  };
  const handleCancelDigest = async (taskId: string) => {
    await client.cancelDigest({ taskId });
  };

  const handleReDigest = async (sessionId: string) => {
    await client.triggerDigest({ workspaceId, workspacePath, sdkSessionId: sessionId });
    await confirm({
      title: '已加入提炼队列',
      description: '该会话将在后台重新提炼，稍后点「刷新」查看更新。',
      buttons: [{ label: '知道了', value: 'ok' }],
    });
  };

  if (!workspaceId || !workspacePath) {
    return <div className="text-sm text-muted-foreground py-8 text-center">请先选择一个工作区</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-1">
          <label className="text-sm text-muted-foreground whitespace-nowrap">提炼模型</label>
          <div className="min-w-[240px]">
            <ModelSelector
              settings={settings}
              value={selection}
              onChange={handleSelectionChange}
              allowUnset={true}
              triggerVariant="block"
            />
          </div>
          <span className="text-xs text-muted-foreground">选「不指定」时回退到默认模型</span>
        </div>
        <Button variant="outline" size="sm" onClick={loadList} disabled={loading}>
          <RefreshCw className={loading ? 'w-4 h-4 mr-1 animate-spin' : 'w-4 h-4 mr-1'} />
          刷新
        </Button>
      </div>

      {activity && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm space-y-2">
          <div className="flex items-center gap-2">
            {activity.current ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-primary" />
                <span>正在提炼 <code className="text-xs">{activity.current.sessionId.slice(0, 12)}…</code></span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-destructive"
                  onClick={() => handleCancelDigest(activity.current!.taskId)}
                >
                  <Square className="w-3 h-3 mr-1" />
                  停止
                </Button>
              </>
            ) : (
              <span className="text-muted-foreground">空闲</span>
            )}
            {activity.queueDepth > 0 && (
              <Badge variant="secondary">队列 {activity.queueDepth}</Badge>
            )}
            {activity.lastScan && (
              <span className="ml-auto text-xs text-muted-foreground">
                上次扫描发现 {activity.lastScan.dirtyCount} 个待提炼 ·{' '}
                {new Date(activity.lastScan.at).toLocaleTimeString()}
              </span>
            )}
          </div>
          {activity.recent.length > 0 && (
            <ul className="space-y-1">
              {activity.recent.slice(0, 5).map((r, i) => (
                <li key={i} className="flex items-center gap-2 text-xs">
                  <span>
                    {r.outcome === 'saved' ? '✅' : r.outcome === 'no-card' ? '⚠️' : '❌'}
                  </span>
                  <code className="truncate max-w-[160px]">{r.sessionId.slice(0, 12)}…</code>
                  {r.tier && <span className="text-muted-foreground">{r.tier}</span>}
                  {r.outcome === 'no-card' && <span className="text-muted-foreground">未产卡</span>}
                  {r.error && <span className="text-destructive truncate max-w-[200px]" title={r.error}>{r.error}</span>}
                  <span className="ml-auto text-muted-foreground">
                    {new Date(r.finishedAt).toLocaleTimeString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="rounded-md border">
        <button
          className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium hover:bg-muted/50"
          onClick={() => setPromptOpen((v) => !v)}
        >
          <span>提炼提示词</span>
          <ChevronDown className={cn('w-4 h-4 transition-transform', promptOpen && 'rotate-180')} />
        </button>
        {promptOpen && (
          <div className="p-3 space-y-2 border-t">
            <textarea
              className="w-full min-h-[200px] px-3 py-2 text-sm border rounded-md bg-background font-mono resize-y"
              value={prompt}
              onChange={(e) => { setPrompt(e.target.value); setPromptDirty(true); }}
            />
            <div className="flex items-center gap-2">
              <Button size="sm" disabled={!promptDirty} onClick={handleSavePrompt}>保存提示词</Button>
              <Button size="sm" variant="outline" onClick={handleResetPrompt}>恢复默认</Button>
            </div>
          </div>
        )}
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
