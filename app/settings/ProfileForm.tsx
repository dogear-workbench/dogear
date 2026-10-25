/**
 * 模型方案右栏表单：方案字段（form-grid 两列）+ 模型清单 + 删除
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Eye, EyeOff, AlertTriangle, RefreshCw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import type { ModelProfile, PiWireApi } from '@/types/settings';
import { isProfileComplete } from '@/types/settings';
import { formatContextLabel, resolveModelWindow } from '@/lib/pi-model-catalog';
import { PiModelRow } from './pi-model-row';
import { FetchModelsDialog, type UpstreamModel } from './FetchModelsDialog';
import { formatTokens } from '@/components/agent-chat/usage-badge/usage-utils';

const inputCls = 'h-9 w-full px-3 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring';

interface FieldProps {
  label: string;
  required?: boolean;
  hint?: ReactNode;
  full?: boolean;
  children: ReactNode;
}

function Field({ label, required, hint, full, children }: FieldProps) {
  return (
    <div className={cn('space-y-1.5 min-w-0', full && 'col-span-2')}>
      <label className="text-sm font-medium">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </label>
      {children}
      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

interface ProfileFormProps {
  profile: ModelProfile;
  isDefault: boolean;
  onUpdate: (updates: Partial<ModelProfile>) => void;
  onDelete: () => void;
}

export function ProfileForm({ profile, isDefault, onUpdate, onDelete }: ProfileFormProps) {
  const [showApiKey, setShowApiKey] = useState(false);
  const [modelDraft, setModelDraft] = useState('');
  const [fetching, setFetching] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<UpstreamModel[] | null>(null);

  const complete = isProfileComplete(profile);
  const models = profile.piModels ?? [];

  const handleFetchUpstreamModels = async () => {
    if (!profile.baseUrl?.trim() || !profile.apiKey?.trim()) {
      toast.error('请先填写 Base URL 和 API Key 再拉取');
      return;
    }
    setFetching(true);
    try {
      const result = await client.fetchUpstreamModels({
        baseUrl: profile.baseUrl,
        apiKey: profile.apiKey,
        piWireApi: profile.piWireApi ?? 'anthropic-messages',
      });
      if (!result.ok) {
        toast.error(`拉取失败：${result.error}`);
        return;
      }
      setFetchedModels(result.models);
    } finally {
      setFetching(false);
    }
  };

  const addModel = () => {
    const raw = modelDraft.trim();
    setModelDraft('');
    if (!raw || models.some(m => m.id === raw)) return;
    onUpdate({ piModels: [...models, { id: raw }] });
  };

  const compactPercentHint = (() => {
    const first = models[0];
    if (!first) return null;
    const contextWindow = resolveModelWindow(first);
    const percent = profile.autoCompactPercent ?? 80;
    return <>{percent}%（{formatContextLabel(contextWindow)} 窗口 ≈ {formatTokens(Math.floor(contextWindow * percent / 100))} tokens 触发）</>;
  })();

  return (
    <div className="space-y-5">
      {!complete && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-200 text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          请完成所有必填字段后才能使用对话功能
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Field label="方案名称">
          <input type="text" className={inputCls}
            value={profile.name}
            onChange={(e) => onUpdate({ name: e.target.value })}
          />
        </Field>

        <Field label="上游协议">
          <select
            className="h-9 w-full px-3 text-sm border rounded bg-background"
            value={profile.piWireApi ?? 'anthropic-messages'}
            onChange={(e) => onUpdate({ piWireApi: e.target.value as PiWireApi })}
          >
            <option value="anthropic-messages">anthropic-messages（默认）</option>
            <option value="openai-responses">openai-responses</option>
          </select>
        </Field>

        <Field label="API Key" required full>
          <div className="relative">
            <input type={showApiKey ? 'text' : 'password'}
              className={cn(inputCls, 'pr-10')}
              value={profile.apiKey}
              onChange={(e) => onUpdate({ apiKey: e.target.value })}
              placeholder="输入 API Key"
            />
            <button type="button"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowApiKey(v => !v)}
            >
              {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </Field>

        <Field label="Base URL" required full>
          <input type="text" className={inputCls}
            value={profile.baseUrl}
            onChange={(e) => onUpdate({ baseUrl: e.target.value })}
            placeholder="如 https://api.anthropic.com"
          />
        </Field>

        <Field label="API 超时时间（毫秒）">
          <input type="number" className={inputCls}
            value={profile.apiTimeoutMs}
            onChange={(e) => onUpdate({ apiTimeoutMs: Number(e.target.value) })}
            min={1000}
          />
        </Field>

        <Field label="自动压缩阈值（%）" hint={compactPercentHint}>
          <Input
            type="number"
            min={50}
            max={95}
            placeholder="80"
            value={profile.autoCompactPercent ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              onUpdate({
                autoCompactPercent: v === '' ? undefined : Math.min(95, Math.max(50, Math.round(Number(v) || 80))),
              });
            }}
          />
        </Field>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">模型清单 <span className="text-destructive">*</span></label>
          <Button
            variant="outline"
            size="sm"
            disabled={fetching}
            onClick={() => void handleFetchUpstreamModels()}
          >
            {fetching
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <RefreshCw className="h-3.5 w-3.5" />}
            从上游拉取
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          方案内可用的模型，保存后出现在模型选择器里；显示名缺省显示 ID。
          窗口、输出上限、价格徽标点击可手动设置，留空用内置目录值；力度为该模型预设的执行力度，未设置时关闭。
        </p>
        <div className="space-y-2">
          {models.length === 0 && (
            <p className="text-xs text-muted-foreground italic">尚未添加任何模型</p>
          )}
          {models.map(model => (
            <PiModelRow
              key={model.id}
              entry={model}
              others={models.filter(m => m.id !== model.id)}
              onChange={(next) => onUpdate({
                piModels: models.map(m => m.id === model.id ? next : m),
              })}
              onRemove={() => onUpdate({
                piModels: models.filter(m => m.id !== model.id),
              })}
            />
          ))}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <input
            type="text"
            className={inputCls}
            value={modelDraft}
            onChange={(e) => setModelDraft(e.target.value)}
            placeholder="输入模型 ID，如 gpt-5、claude-sonnet-4-6"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addModel();
              }
            }}
          />
          <Button variant="outline" size="sm" onClick={addModel}>
            <Plus className="w-4 h-4 mr-1" />
            添加
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        {!isDefault && (
          <Button variant="ghost" size="sm"
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={onDelete}
          >
            <Trash2 className="w-4 h-4 mr-2" />
            删除此方案
          </Button>
        )}
      </div>

      {fetchedModels && (
        <FetchModelsDialog
          open
          profileName={profile.name}
          models={fetchedModels}
          existingIds={new Set(models.map(m => m.id))}
          onClose={() => setFetchedModels(null)}
          onConfirm={(selected) => {
            const existingIds = new Set(models.map(m => m.id));
            const added = selected.filter(m => !existingIds.has(m.id));
            onUpdate({ piModels: [...models, ...added] });
            setFetchedModels(null);
            toast.success(`已添加 ${added.length} 个模型到清单`);
          }}
        />
      )}
    </div>
  );
}
