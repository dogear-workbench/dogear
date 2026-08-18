import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ModelSelector } from '@/components/ModelSelector';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { client } from '@/lib/client';
import { showConfirm } from '@/stores/confirm-store';
import { useSettingsStore } from '@/stores/settings-store';
import type { BuiltinTaskId } from '@/types/scheduler';
import type { ModelSelection } from '@/types/settings';

interface Props {
  builtinId: BuiltinTaskId;
}

const MODEL_IO = {
  group_digest: { get: client.getDigestModelSelection, set: client.setDigestModelSelection },
  review: { get: client.getReviewModelSelection, set: client.setReviewModelSelection },
  categorize: { get: client.getCategorizeModelSelection, set: client.setCategorizeModelSelection },
  categorize_organize: { get: client.getCategorizeModelSelection, set: client.setCategorizeModelSelection },
} as const;

export function BuiltinTaskDetailSection({ builtinId }: Props) {
  const settings = useSettingsStore((s) => s.settings);
  const [selection, setSelection] = useState<ModelSelection | null>(null);
  const [prompt, setPrompt] = useState('');
  const [tools, setTools] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    MODEL_IO[builtinId].get().then((r) => {
      if (cancelled) return;
      if ('selection' in r) setSelection(r.selection ?? null);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [builtinId]);

  const handleSelectionChange = async (next: ModelSelection | null) => {
    setSelection(next);
    try {
      const r = await MODEL_IO[builtinId].set({ selection: next });
      if (!('success' in r)) toast.error('保存模型选择失败', { description: r.error });
    } catch (e) {
      toast.error('保存模型选择失败', { description: String(e) });
    }
  };

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    client.getBuiltinTaskDetail({ builtinId }).then((r) => {
      if (cancelled) return;
      setLoading(false);
      if (r.error) {
        setError(r.error);
        return;
      }
      setPrompt(r.prompt);
      setTools(r.tools ?? []);
    }).catch((e) => {
      if (cancelled) return;
      setLoading(false);
      setError(String(e));
    });
    return () => {
      cancelled = true;
    };
  }, [builtinId]);

  const handleSavePrompt = async () => {
    if (!prompt.trim()) {
      toast.error('提示词不能为空');
      return;
    }
    setSaving(true);
    try {
      const r = await client.saveBuiltinPrompt({ builtinId, prompt });
      if (r.ok) toast.success('提示词已保存');
      else toast.error('保存提示词失败', { description: r.error });
    } catch (e) {
      toast.error('保存提示词失败', { description: String(e) });
    }
    setSaving(false);
  };

  const handleResetPrompt = async () => {
    const ok = await showConfirm(
      '恢复默认提示词',
      '将把该内置任务的全局模板恢复为内置默认值并立即写回磁盘，影响所有触发入口，确定继续吗？',
    );
    if (!ok) return;
    setResetting(true);
    try {
      const r = await client.resetBuiltinPrompt({ builtinId });
      if (r.ok) {
        setPrompt(r.prompt);
        toast.success('已恢复默认提示词');
      } else {
        toast.error('恢复默认失败', { description: r.error });
      }
    } catch (e) {
      toast.error('恢复默认失败', { description: String(e) });
    }
    setResetting(false);
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium shrink-0">模型</span>
        <div className="min-w-[220px]">
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
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">提示词</label>
          <Badge variant="subtle" className="text-[10px] px-1.5 py-0">全局模板</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          全局模板，影响该内置任务的所有触发入口（含其他工作区与后台自动运行）；保存提示词独立于下方「保存」按钮。
        </p>
        {loading ? (
          <div className="h-[220px] rounded-md border flex items-center justify-center text-xs text-muted-foreground">
            提示词加载中…
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : (
          <>
            <Textarea
              className="min-h-[220px] text-sm font-mono"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSavePrompt} disabled={saving || resetting}>
                {saving ? '保存中…' : '保存提示词'}
              </Button>
              <Button size="sm" variant="outline" onClick={handleResetPrompt} disabled={saving || resetting}>
                {resetting ? '恢复中…' : '恢复默认'}
              </Button>
            </div>
          </>
        )}
      </div>
      <div className="space-y-1.5">
        <label className="text-sm font-medium">可用工具</label>
        {loading ? (
          <p className="text-xs text-muted-foreground">工具清单加载中…</p>
        ) : error ? (
          <p className="text-xs text-muted-foreground">工具清单不可用</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {tools.map((t) => (
              <Badge key={t} variant="outline" className="font-mono text-[11px] font-normal">
                {t}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
