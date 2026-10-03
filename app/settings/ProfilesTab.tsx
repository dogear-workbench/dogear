/**
 * 设置页「模型方案」Tab
 */
import { useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Plus, Trash2, Eye, EyeOff, AlertTriangle, RefreshCw, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { useConfirmStore } from '@/stores/confirm-store';
import type { AppSettings, ModelProfile, PiWireApi } from '@/types/settings';
import { isProfileComplete } from '@/types/settings';
import { formatContextLabel, lookupContextWindow, resolveModelWindow } from '@/lib/pi-model-catalog';
import { PiModelRow } from './pi-model-row';
import { FetchModelsDialog, type UpstreamModel } from './FetchModelsDialog';
import { FailoverSection } from './FailoverSection';
import { formatTokens } from '@/components/agent-chat/usage-badge/usage-utils';

const inputCls = "h-9 w-full px-3 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring";

interface ProfilesTabProps {
  local: AppSettings;
  setLocal: Dispatch<SetStateAction<AppSettings>>;
}

export function ProfilesTab({ local, setLocal }: ProfilesTabProps) {
  const confirmDialog = useConfirmStore((s) => s.confirm);

  // API Key 显示/隐藏
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({});
  // 内层 profile tab 选中状态
  const [selectedProfileTab, setSelectedProfileTab] = useState<string>('default');
  // pi Profile 的模型 ID 输入框草稿（按 profileId 索引）
  const [piModelDrafts, setPiModelDrafts] = useState<Record<string, string>>({});
  const [fetchingModels, setFetchingModels] = useState<Record<string, boolean>>({});
  const [fetchDialog, setFetchDialog] = useState<{ profileId: string; models: UpstreamModel[] } | null>(null);

  const profileIds = Object.keys(local.profiles);

  // 首次挂载选中第一个方案；选中项被删除后回退到第一个
  const initializedRef = useRef(false);
  useEffect(() => {
    if (profileIds.length === 0) return;
    if (!initializedRef.current || !profileIds.includes(selectedProfileTab)) {
      initializedRef.current = true;
      setSelectedProfileTab(profileIds[0]);
    }
  }, [profileIds, selectedProfileTab]);

  const addNewProfile = () => {
    const id = crypto.randomUUID();
    const newProfile: ModelProfile = {
      id, name: '新方案', apiKey: '', baseUrl: '',
      apiTimeoutMs: 3000000, piWireApi: 'anthropic-messages',
    };
    setLocal(prev => ({
      ...prev,
      profiles: { ...prev.profiles, [id]: newProfile },
    }));
    setSelectedProfileTab(id);
  };

  const updateProfileField = (profileId: string, updates: Partial<ModelProfile>) => {
    setLocal(prev => ({
      ...prev,
      profiles: {
        ...prev.profiles,
        [profileId]: { ...prev.profiles[profileId], ...updates },
      },
    }));
  };

  const handleFetchUpstreamModels = async (profileId: string) => {
    const profile = local.profiles[profileId];
    if (!profile) return;
    if (!profile.baseUrl?.trim() || !profile.apiKey?.trim()) {
      toast.error('请先填写 Base URL 和 API Key 再拉取');
      return;
    }
    setFetchingModels(prev => ({ ...prev, [profileId]: true }));
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
      setFetchDialog({ profileId, models: result.models });
    } finally {
      setFetchingModels(prev => ({ ...prev, [profileId]: false }));
    }
  };

  const confirmFetchModels = (selected: UpstreamModel[]) => {
    if (!fetchDialog) return;
    const { profileId } = fetchDialog;
    const existing = local.profiles[profileId]?.piModels ?? [];
    const existingIds = new Set(existing.map(m => m.id));
    const added = selected.filter(m => !existingIds.has(m.id));
    updateProfileField(profileId, { piModels: [...existing, ...added] });
    setFetchDialog(null);
    toast.success(`已添加 ${added.length} 个模型到清单`);
  };

  const deleteProfileById = async (profileId: string) => {
    if (profileId === 'default') return;
    const name = local.profiles[profileId]?.name ?? profileId;
    const result = await confirmDialog({
      title: '删除模型方案',
      description: `「${name}」将立即删除且无法恢复，确定继续？`,
      buttons: [
        { label: '取消', value: 'cancel', variant: 'outline' },
        { label: '删除', value: 'delete', variant: 'destructive' },
      ],
    });
    if (result !== 'delete') return;
    setLocal(prev => {
      const { [profileId]: _removed, ...rest } = prev.profiles;
      const newAi = { ...prev.ai };
      const clearIfMatch = (key: 'defaultModelSelection' | 'parseModelSelection' | 'stateModelSelection' | 'visionModelSelection') => {
        if (newAi[key]?.profileId === profileId) newAi[key] = null;
      };
      clearIfMatch('defaultModelSelection');
      clearIfMatch('parseModelSelection');
      clearIfMatch('stateModelSelection');
      clearIfMatch('visionModelSelection');
      return { ...prev, profiles: rest, ai: newAi };
    });
    setSelectedProfileTab('default');
  };

  return (
    <div className="max-w-2xl mx-auto py-6 px-6">
      <h2 className="text-lg font-semibold mb-1">模型方案</h2>
      <p className="text-sm text-muted-foreground mb-6">管理 API 配置方案，切换不同的模型和服务地址</p>

      {/* 内层 Tabs：Profile 切换 */}
      <Tabs value={selectedProfileTab} onValueChange={setSelectedProfileTab}>
        <div className="flex items-center gap-2 mb-4">
          <TabsList className="flex-1">
            {profileIds.map(id => (
              <TabsTrigger key={id} value={id}>
                {local.profiles[id].name}
              </TabsTrigger>
            ))}
          </TabsList>
          <Button variant="outline" size="sm" onClick={addNewProfile}>
            <Plus className="w-4 h-4" />
          </Button>
        </div>

        {profileIds.map(id => {
          const profile = local.profiles[id];
          const isDefault = id === 'default';
          const keyVisible = showApiKey[id] ?? false;
          const complete = isProfileComplete(profile);

          return (
            <TabsContent key={id} value={id} className="space-y-4 pt-2">
              {!complete && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-200 text-sm">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  请完成所有必填字段后才能使用对话功能
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-sm font-medium">方案名称</label>
                <input type="text" className={inputCls}
                  value={profile.name}
                  onChange={(e) => updateProfileField(id, { name: e.target.value })}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">API Key <span className="text-destructive">*</span></label>
                <div className="relative">
                  <input type={keyVisible ? 'text' : 'password'}
                    className={cn(inputCls, 'pr-10')}
                    value={profile.apiKey}
                    onChange={(e) => updateProfileField(id, { apiKey: e.target.value })}
                    placeholder="输入 API Key"
                  />
                  <button type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowApiKey(prev => ({ ...prev, [id]: !prev[id] }))}
                  >
                    {keyVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Base URL <span className="text-destructive">*</span></label>
                <input type="text" className={inputCls}
                  value={profile.baseUrl}
                  onChange={(e) => updateProfileField(id, { baseUrl: e.target.value })}
                  placeholder="如 https://api.anthropic.com"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">上游协议</label>
                <p className="text-xs text-muted-foreground">
                  pi 客户端连接上游的线协议。anthropic-messages 走 Claude 兼容字段；
                  openai-responses 走 OpenAI Responses API（适用于 GLM、DeepSeek、Qwen 等国产 OpenAI 兼容网关）；
                  openai-completions 走 OpenAI Chat Completions（GLM Coding Plan 端点 /api/coding/paas/v4，套餐额度）。
                </p>
                <select
                  className="h-9 w-full px-3 text-sm border rounded bg-background"
                  value={profile.piWireApi ?? 'anthropic-messages'}
                  onChange={(e) => updateProfileField(id, { piWireApi: e.target.value as PiWireApi })}
                >
                  <option value="anthropic-messages">anthropic-messages（默认）</option>
                  <option value="openai-responses">openai-responses</option>
                  <option value="openai-completions">openai-completions（GLM Coding Plan）</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">模型清单 <span className="text-destructive">*</span></label>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={fetchingModels[id] === true}
                    onClick={() => handleFetchUpstreamModels(id)}
                  >
                    {fetchingModels[id]
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <RefreshCw className="h-3.5 w-3.5" />}
                    从上游拉取
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  该 Profile 可用的模型 ID 列表，每条可另设显示名（缺省显示 ID）；点击右侧窗口徽标可手填上下文窗口（缺省查表，未识别按 200K）；点击价格徽标可填价格（元/百万 tokens，用于费用估算，留空用目录默认价）。保存后在 ModelSelector 下拉里出现。
                </p>
                <div className="space-y-2">
                  {(profile.piModels ?? []).length === 0 && (
                    <p className="text-xs text-muted-foreground italic">尚未添加任何模型</p>
                  )}
                  {(profile.piModels ?? []).map(model => (
                    <PiModelRow
                      key={model.id}
                      entry={model}
                      others={(profile.piModels ?? []).filter(m => m.id !== model.id)}
                      onChange={(next) => updateProfileField(id, {
                        piModels: (profile.piModels ?? []).map(m => m.id === model.id ? next : m),
                      })}
                      onRemove={() => updateProfileField(id, {
                        piModels: (profile.piModels ?? []).filter(m => m.id !== model.id),
                      })}
                    />
                  ))}
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="text"
                    className={inputCls}
                    value={piModelDrafts[id] ?? ''}
                    onChange={(e) => setPiModelDrafts(prev => ({ ...prev, [id]: e.target.value }))}
                    placeholder="如 gpt-5、claude-sonnet-4-6 等"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const raw = (piModelDrafts[id] ?? '').trim();
                        if (!raw) return;
                        const existing = profile.piModels ?? [];
                        if (existing.some(m => m.id === raw)) {
                          setPiModelDrafts(prev => ({ ...prev, [id]: '' }));
                          return;
                        }
                        updateProfileField(id, { piModels: [...existing, { id: raw }] });
                        setPiModelDrafts(prev => ({ ...prev, [id]: '' }));
                      }
                    }}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const raw = (piModelDrafts[id] ?? '').trim();
                      if (!raw) return;
                      const existing = profile.piModels ?? [];
                      if (existing.some(m => m.id === raw)) {
                        setPiModelDrafts(prev => ({ ...prev, [id]: '' }));
                        return;
                      }
                      updateProfileField(id, { piModels: [...existing, { id: raw }] });
                      setPiModelDrafts(prev => ({ ...prev, [id]: '' }));
                    }}
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    添加
                  </Button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">API 超时时间（毫秒）</label>
                <input type="number" className={inputCls}
                  value={profile.apiTimeoutMs}
                  onChange={(e) => updateProfileField(id, { apiTimeoutMs: Number(e.target.value) })}
                  min={1000}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">自动压缩阈值（%）</label>
                <p className="text-xs text-muted-foreground">
                  上下文占用超过模型窗口的该比例时，在下一条消息发送前自动压缩对话历史。
                  范围 50–95，默认 80。
                </p>
                <Input
                  type="number"
                  min={50}
                  max={95}
                  placeholder="80"
                  value={profile.autoCompactPercent ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    updateProfileField(id, {
                      autoCompactPercent: v === '' ? undefined : Math.min(95, Math.max(50, Math.round(Number(v) || 80))),
                    });
                  }}
                  className="max-w-[240px]"
                />
                {(() => {
                  const first = (profile.piModels ?? [])[0];
                  if (!first) return null;
                  const contextWindow = resolveModelWindow(first);
                  const percent = profile.autoCompactPercent ?? 80;
                  return (
                    <p className="text-xs text-muted-foreground">
                      {percent}%（{formatContextLabel(contextWindow)} 窗口 ≈ {formatTokens(Math.floor(contextWindow * percent / 100))} tokens 时触发）
                      {first.contextWindow === undefined && lookupContextWindow(first.id) === undefined && '；首模型未识别按 200K 估算，可在模型行点击窗口徽标手填'}
                    </p>
                  );
                })()}
              </div>

              {/* 底部操作 */}
              <div className="flex items-center gap-2 pt-2">
                {!isDefault && (
                  <Button variant="ghost" size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    onClick={() => void deleteProfileById(id)}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    删除此方案
                  </Button>
                )}
              </div>
            </TabsContent>
          );
        })}
      </Tabs>

      <FailoverSection local={local} setLocal={setLocal} />

      {fetchDialog && (
        <FetchModelsDialog
          open
          profileName={local.profiles[fetchDialog.profileId]?.name ?? fetchDialog.profileId}
          models={fetchDialog.models}
          existingIds={new Set((local.profiles[fetchDialog.profileId]?.piModels ?? []).map(m => m.id))}
          onClose={() => setFetchDialog(null)}
          onConfirm={confirmFetchModels}
        />
      )}
    </div>
  );
}
