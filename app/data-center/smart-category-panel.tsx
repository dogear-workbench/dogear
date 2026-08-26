import { useState, useEffect } from 'react';
import { RefreshCw, ChevronDown, Brain, Tag, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { client } from '@/lib/client';
import { cn } from '@/lib/utils';
import { resolveModelLabel } from '@/lib/model-selection';
import { useSmartCategoryStore } from '@/stores/smart-category-store';
import { useSettingsStore } from '@/stores/settings-store';
import { showConfirm } from '@/stores/confirm-store';
import type { ModelSelection } from '@/types/settings';

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

interface Props {
  workspaceId: string;
}

export function SmartCategoryPanel({ workspaceId }: Props) {
  const categories = useSmartCategoryStore((s) => s.categories);
  const load = useSmartCategoryStore((s) => s.load);
  const triggerFullRebuild = useSmartCategoryStore((s) => s.triggerFullRebuild);
  const settings = useSettingsStore((s) => s.settings);

  // ── 设置状态 ──
  const [enabled, setEnabled] = useState(true);
  const [threshold, setThreshold] = useState(0.5);
  const [maxCategories] = useState(10); // 锁死，Phase 后续再开放
  const [categoriesOpen, setCategoriesOpen] = useState(true);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [categorizeModel, setCategorizeModel] = useState<ModelSelection | null>(null);

  // ── 初始拉取 ──
  useEffect(() => {
    client.getSmartCategorySettings().then((r) => {
      if (typeof r.enabled === 'boolean') setEnabled(r.enabled);
      if (typeof r.threshold === 'number') setThreshold(r.threshold);
    });

    client.getCategorizeModelSelection().then((r) => {
      if ('selection' in r) setCategorizeModel(r.selection ?? null);
    }).catch(() => {});

    load(workspaceId);
  }, [workspaceId, load]);

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

  const handleReloadCategories = async () => {
    setLoadingCategories(true);
    try {
      await load(workspaceId);
    } finally {
      setLoadingCategories(false);
    }
  };

  const handleRebuild = async () => {
    const r = await client.listGroups({ workspaceId });
    const groupCount = Array.isArray(r.groups) ? r.groups.length : 0;
    const modelSel = categorizeModel ?? settings.ai.defaultModelSelection;
    const modelLabel = modelSel ? resolveModelLabel(settings, modelSel) : '默认模型（未设置）';
    const ok = await showConfirm(
      '全量重置分类',
      `清空现有智能分类并重新决策全部组卡（当前工作区 ${groupCount} 组，约 10-30 分钟）。将使用模型 ${modelLabel}（可在 定时计划 → 补分类 → 详情 中修改）。通常只需在分类混乱时使用，日常补漏走定时计划的「补分类」任务。`,
    );
    if (!ok) return;
    await triggerFullRebuild(workspaceId);
    toast.success('已开始全量重置分类');
  };

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        分类对象：<b>话题</b>（一个话题可包含多个对话）。话题摘要产生 / 更新后自动决策，命中现有分类或另起新类。
        模型、提示词、补分类与整理入口均在「定时计划」。
      </p>

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

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={handleRebuild}>
          <RotateCcw className="w-4 h-4 mr-1" />
          全量重置分类
        </Button>
        <span className="text-xs text-muted-foreground">全量重置为破坏性长任务，仅在分类混乱时使用</span>
      </div>

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
