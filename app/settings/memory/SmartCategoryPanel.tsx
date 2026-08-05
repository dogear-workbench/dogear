import { useState, useEffect } from 'react';
import { RefreshCw, Square, ChevronDown, Sparkles, Brain, Tag, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { client } from '@/lib/client';
import { cn } from '@/lib/utils';
import { useConfirmStore } from '@/stores/confirm-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSmartCategoryStore } from '@/stores/smart-category-store';
import type { AppSettings, ModelSelection } from '@/types/settings';
import { DEFAULT_SETTINGS } from '@/types/settings';
import { ModelSelector } from '@/components/ModelSelector';

// Switch 不在 components/ui，用与 settings/page.tsx 一致的内联 toggle 实现
function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={cn(
        'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
        checked ? 'bg-primary' : 'bg-muted',
      )}
      onClick={() => onChange(!checked)}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  );
}

export function SmartCategoryPanel() {
  const workspace = useWorkspaceStore((s) => s.workspace);
  const workspaceId = workspace?.id;
  const confirm = useConfirmStore((s) => s.confirm);

  const categories = useSmartCategoryStore((s) => s.categories);
  const activity = useSmartCategoryStore((s) => s.activity);
  const load = useSmartCategoryStore((s) => s.load);
  const triggerFullRebuild = useSmartCategoryStore((s) => s.triggerFullRebuild);
  const triggerOrganize = useSmartCategoryStore((s) => s.triggerOrganize);
  const cancel = useSmartCategoryStore((s) => s.cancel);
  const cancelOrganize = useSmartCategoryStore((s) => s.cancelOrganize);
  const refreshActivity = useSmartCategoryStore((s) => s.refreshActivity);

  // ── 设置状态 ──
  const [enabled, setEnabled] = useState(true);
  const [threshold, setThreshold] = useState(0.5);
  const [maxCategories] = useState(10); // 锁死，Phase 后续再开放
  const [selection, setSelection] = useState<ModelSelection | null>(null);
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [prompt, setPrompt] = useState('');
  const [defaultPrompt, setDefaultPrompt] = useState('');
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptDirty, setPromptDirty] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(true);
  const [loadingCategories, setLoadingCategories] = useState(false);

  // ── 初始拉取 ──
  useEffect(() => {
    if (!workspaceId) return;

    client.getSmartCategorySettings().then((r) => {
      if (typeof r.enabled === 'boolean') setEnabled(r.enabled);
      if (typeof r.threshold === 'number') setThreshold(r.threshold);
    });

    client.getCategorizeModelSelection().then((r) => {
      if ('selection' in r) setSelection(r.selection ?? null);
    });

    client.getSettings().then((s) => {
      if ('settings' in s && s.settings) setSettings(s.settings);
    });

    client.getCategorizePrompt().then((r) => {
      if ('prompt' in r && r.prompt) setPrompt(r.prompt);
      if ('defaultPrompt' in r && r.defaultPrompt) setDefaultPrompt(r.defaultPrompt);
    });

    load(workspaceId);
  }, [workspaceId, load]);

  // ── 2s 轮询分类活动 ──
  useEffect(() => {
    let alive = true;
    const poll = () => { if (alive) refreshActivity(); };
    poll();
    const id = setInterval(poll, 2000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [refreshActivity]);

  // ── handlers ──
  const handleToggleEnabled = async (v: boolean) => {
    setEnabled(v);
    await client.setSmartCategorySettings({ enabled: v });
  };

  const handleThresholdBlur = async (v: number) => {
    const clamped = Math.max(0.3, Math.min(0.8, v));
    setThreshold(clamped);
    await client.setSmartCategorySettings({ threshold: clamped });
  };

  const handleSelectionChange = async (next: ModelSelection | null) => {
    setSelection(next);
    await client.setCategorizeModelSelection({ selection: next });
  };

  const handleSavePrompt = async () => {
    await client.setCategorizePrompt({ prompt });
    setPromptDirty(false);
  };

  const handleResetPrompt = () => {
    setPrompt(defaultPrompt);
    setPromptDirty(true);
  };

  const handleRebuild = async () => {
    if (!workspaceId) return;
    const ok = await confirm({
      title: '立即重跑全部分类',
      description: '将清空现有分类，并按组重新决策所有组卡，过程可能持续几分钟。',
      buttons: [
        { label: '取消', value: 'cancel', variant: 'outline' },
        { label: '开始重跑', value: 'confirm', variant: 'default' },
      ],
    });
    if (ok === 'confirm') await triggerFullRebuild(workspaceId);
  };

  const handleOrganize = async () => {
    if (!workspaceId) return;
    const ok = await confirm({
      title: '一键整理现有标签',
      description: '将扫描所有分类，把超过 10 个的 anchorTags 压缩到上限内，并尝试合并语义高度重合的分类。会覆写现有标签结构，跑期间请勿新增组卡入库。',
      buttons: [
        { label: '取消', value: 'cancel', variant: 'outline' },
        { label: '开始整理', value: 'confirm', variant: 'default' },
      ],
    });
    if (ok === 'confirm') await triggerOrganize(workspaceId);
  };

  const handleReloadCategories = async () => {
    if (!workspaceId) return;
    setLoadingCategories(true);
    try {
      await load(workspaceId);
    } finally {
      setLoadingCategories(false);
    }
  };

  if (!workspaceId) {
    return <div className="text-sm text-muted-foreground py-8 text-center">请先选择一个工作区</div>;
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        分类对象：<b>话题</b>（一个话题可包含多个对话）。话题摘要产生 / 更新后自动决策，命中现有分类或另起新类。
      </p>

      {/* 1. 总开关 + 阈值 + 分类上限 */}
      <div className="flex flex-wrap items-center gap-6 rounded-md border bg-muted/30 px-3 py-3">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <ToggleSwitch checked={enabled} onChange={handleToggleEnabled} />
          启用智能分类
        </label>
        <label className="flex items-center gap-2 text-sm">
          匹配阈值
          <input
            type="number"
            min={0.3}
            max={0.8}
            step={0.05}
            value={threshold}
            onChange={(e) => setThreshold(parseFloat(e.target.value) || 0.5)}
            onBlur={(e) => handleThresholdBlur(parseFloat(e.target.value) || 0.5)}
            className="w-20 h-8 px-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          分类上限
          <input
            type="number"
            value={maxCategories}
            disabled
            className="w-16 h-8 px-2 text-sm border rounded-md bg-muted cursor-not-allowed opacity-60"
          />
          <span className="text-xs">（先锁死，看后续）</span>
        </label>
      </div>

      {/* 2. 模型选择 + 立即重跑 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2 flex-1">
          <label className="text-sm text-muted-foreground whitespace-nowrap">分类模型</label>
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
        <Button variant="outline" size="sm" onClick={handleRebuild}>
          <Sparkles className="w-4 h-4 mr-1" />
          立即重跑全部分类
        </Button>
        <div className="w-px h-5 bg-border mx-1" />
        <Button variant="outline" size="sm" onClick={handleOrganize}>
          <Wand2 className="w-4 h-4 mr-1" />
          一键整理现有标签
        </Button>
      </div>

      {/* 3. 提示词编辑器（折叠） */}
      <div className="rounded-md border">
        <button
          className="w-full flex items-center justify-between px-3 py-2 text-sm font-medium hover:bg-muted/50"
          onClick={() => setPromptOpen((v) => !v)}
        >
          <span>分类提示词</span>
          <ChevronDown className={cn('w-4 h-4 transition-transform', promptOpen && 'rotate-180')} />
        </button>
        {promptOpen && (
          <div className="p-3 space-y-2 border-t">
            <textarea
              className="w-full min-h-[200px] px-3 py-2 text-sm border rounded-md bg-background font-mono resize-y focus:outline-none focus:ring-1 focus:ring-ring"
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

      {/* 4. 分类活动状态 */}
      {activity && (
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm space-y-2">
          <div className="flex items-center gap-2">
            {activity.current ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-primary" />
                {activity.current.kind === 'organize' ? (
                  <span>正在整理现有标签（压 anchorTags + 合并重合分类）…</span>
                ) : (
                  <span>
                    正在分类{' '}
                    <code className="text-xs">
                      {(activity.current.groupId ?? activity.current.kind).slice(0, 12)}…
                    </code>
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-destructive"
                  onClick={() => (activity.current?.kind === 'organize' ? cancelOrganize() : cancel())}
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
                上次扫描发现 {activity.lastScan.dirtyCount} 个待分类 ·{' '}
                {new Date(activity.lastScan.at).toLocaleTimeString()}
              </span>
            )}
          </div>
          {activity.recent.length > 0 && (
            <ul className="space-y-1">
              {activity.recent.slice(0, 5).map((r, i) => (
                <li key={i} className="flex items-center gap-2 text-xs">
                  <span>
                    {r.outcome === 'match' ? '🎯'
                      : r.outcome === 'join' ? '➕'
                      : r.outcome === 'new' ? '✨'
                      : r.outcome === 'done' ? '✅'
                      : r.outcome === 'skip' ? '⚪'
                      : r.outcome === 'cancelled' ? '🚫'
                      : '❌'}
                  </span>
                  <span className="text-muted-foreground">{r.outcome}</span>
                  <code className="truncate max-w-[160px]">
                    {r.kind === 'organize' ? '批量整理' : `${(r.groupId ?? r.kind).slice(0, 12)}…`}
                  </code>
                  {r.kind === 'organize' && r.decisions && (
                    <span className="text-muted-foreground">
                      prune {r.decisions.prune ?? 0} / merge {r.decisions.merge ?? 0}
                    </span>
                  )}
                  {r.tier && <span className="text-muted-foreground">{r.tier}</span>}
                  {r.error && (
                    <span className="text-destructive truncate max-w-[200px]" title={r.error}>
                      {r.error}
                    </span>
                  )}
                  <span className="ml-auto text-muted-foreground">
                    {new Date(r.finishedAt).toLocaleTimeString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 5. 当前分类列表（折叠） */}
      <div className="rounded-md border">
        <div
          className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-muted/50"
          onClick={() => setCategoriesOpen((v) => !v)}
        >
          <span className="text-sm font-medium">当前分类（{categories.length}）</span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={(e) => { e.stopPropagation(); handleReloadCategories(); }}
              title="刷新分类列表"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', loadingCategories && 'animate-spin')} />
            </Button>
            <ChevronDown className={cn('w-4 h-4 transition-transform', categoriesOpen && 'rotate-180')} />
          </div>
        </div>
        {categoriesOpen && (
          <div className="p-3 border-t">
            {categories.length === 0 ? (
              <div className="text-sm text-muted-foreground py-4 text-center">
                <Brain className="w-8 h-8 mx-auto opacity-40 mb-2" />
                暂无分类，话题产生摘要后会自动生成
              </div>
            ) : (
              <ul className="space-y-2">
                {categories.map((cat) => (
                  <li key={cat.id} className="flex items-start gap-2 text-sm">
                    <Tag className="w-4 h-4 mt-0.5 text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">
                        {cat.name}{' '}
                        <span className="text-xs text-muted-foreground font-normal">
                          ({cat.groupIds.length})
                        </span>
                      </div>
                      {cat.anchorTags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {cat.anchorTags.map((t) => (
                            <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
