import { useState, useEffect } from 'react';
import { RefreshCw, Square, ChevronDown, Sparkles, CheckCircle2, AlertCircle, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { client } from '@/lib/client';
import { cn } from '@/lib/utils';
import { useConfirmStore } from '@/stores/confirm-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import type { AppSettings, ModelSelection } from '@/types/settings';
import { DEFAULT_SETTINGS } from '@/types/settings';
import { ModelSelector } from '@/components/ModelSelector';

interface ReviewActivity {
  current: { workspaceId: string; startedAt: number; taskId: string } | null;
  queueDepth: number;
  recent: Array<{
    workspaceId: string;
    finishedAt: number;
    outcome: 'saved' | 'no-card' | 'error';
    tier?: string;
    profileName?: string;
    error?: string;
    durationMs: number;
  }>;
  lastScan: { at: number; dirtyCount: number } | null;
}

export function ReviewPanel() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const workspaceId = workspace?.id;
  const workspacePath = workspace?.path;
  const confirm = useConfirmStore((s) => s.confirm);
  const [selection, setSelection] = useState<ModelSelection | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [activity, setActivity] = useState<ReviewActivity | null>(null);
  const [prompt, setPrompt] = useState('');
  const [defaultPrompt, setDefaultPrompt] = useState('');
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptDirty, setPromptDirty] = useState(false);

  useEffect(() => {
    client.getReviewModelSelection().then((r) => {
      if ('selection' in r) setSelection(r.selection ?? null);
    });
    client.getSettings().then((s) => {
      if ('settings' in s && s.settings) setSettings(s.settings);
    });
    client.getReviewPrompt().then((r) => {
      if ('prompt' in r && r.prompt) setPrompt(r.prompt);
      if ('defaultPrompt' in r && r.defaultPrompt) setDefaultPrompt(r.defaultPrompt);
    });
  }, []);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const r = await client.getReviewActivity();
      if (alive && 'activity' in r && r.activity) setActivity(r.activity as ReviewActivity);
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const handleSelectionChange = async (next: ModelSelection | null) => {
    setSelection(next);
    await client.setReviewModelSelection({ selection: next });
  };
  const handleSavePrompt = async () => {
    await client.setReviewPrompt({ prompt });
    setPromptDirty(false);
  };
  const handleResetPrompt = () => {
    setPrompt(defaultPrompt);
    setPromptDirty(true);
  };
  const handleCancel = async (taskId: string) => {
    await client.cancelReview({ taskId });
  };
  const handleTriggerReview = async () => {
    if (!workspaceId || !workspacePath) return;
    await client.triggerReview({ workspaceId, workspacePath });
    await confirm({
      title: '已加入复盘队列',
      description: '将在后台综合本工作区的摘要卡，刷新复盘卡。回首页仪表盘查看结果。',
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
          <label className="text-sm text-muted-foreground whitespace-nowrap">复盘模型</label>
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
        <Button variant="outline" size="sm" onClick={handleTriggerReview}>
          <Sparkles className="w-4 h-4 mr-1" />
          立即复盘
        </Button>
      </div>

      {activity && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm space-y-2">
          <div className="flex items-center gap-2">
            {activity.current ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-primary" />
                <span>正在复盘 <code className="text-xs">{activity.current.workspaceId.slice(0, 12)}…</code></span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-destructive"
                  onClick={() => handleCancel(activity.current!.taskId)}
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
                上次扫描发现 {activity.lastScan.dirtyCount} 个待复盘 ·{' '}
                {new Date(activity.lastScan.at).toLocaleTimeString()}
              </span>
            )}
          </div>
          {activity.recent.length > 0 && (
            <ul className="space-y-1">
              {activity.recent.slice(0, 5).map((r, i) => (
                <li key={i} className="flex items-center gap-2 text-xs">
                  {r.outcome === 'saved' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  ) : r.outcome === 'no-card' ? (
                    <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-destructive shrink-0" />
                  )}
                  <code className="truncate max-w-[160px]">{r.workspaceId.slice(0, 12)}…</code>
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
          <span>复盘提示词</span>
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
    </div>
  );
}
