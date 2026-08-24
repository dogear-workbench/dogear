import { useEffect, useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ArrowLeft, Plus, Trash2, Eye, EyeOff, AlertTriangle, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings-store';
import { useUIStore } from '@/stores/ui-store';
import { useConfirmStore } from '@/stores/confirm-store';
import { useConversationStore } from '@/stores/conversation-store';
import type { AppSettings, ModelProfile } from '@/types/settings';
import { DEFAULT_SETTINGS, isProfileComplete } from '@/types/settings';
import { WorkspaceManagementTab } from './WorkspaceManagementTab';
import { MemoryTab } from './MemoryTab';
import { DigestsPanel } from './memory/DigestsPanel';
import { SmartCategoryPanel } from './memory/SmartCategoryPanel';
import { SchedulerPanel } from './scheduler/SchedulerPanel';
import { AbilityTab } from './AbilityTab';
import { GeneralAgentMdDialog } from '@/components/GeneralAgentMdDialog';
import { BasicToolsSection } from './BasicToolsSection';
import { SubAgentTab } from './SubAgentTab';
import { AboutTab } from './AboutTab';
import { ArticleParseHistoryPanel } from '@/components/ArticleParseHistoryPanel';
import { ModelSelector } from '@/components/ModelSelector';
import { formatContextLabel, lookupContextWindow, resolveModelWindow } from '@/lib/pi-model-catalog';
import { PiModelRow } from './pi-model-row';
import { FailoverSection } from './FailoverSection';
import { formatTokens } from '@/components/agent-chat/usage-badge/usage-utils';

// ═══ 常量 ═══════════════════════════════════════════

const EFFORT_OPTIONS = [
  { value: null, label: '默认' },
  { value: 'off', label: '关闭' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'max', label: '最高' },
] as const;

const PERMISSION_MODE_OPTIONS = [
  { value: 'default', label: '默认', description: '已注册工具包自动放行；基础工具按映射决定；其余需确认（推荐）' },
  { value: 'autoExecute', label: '自动执行', description: '⚠️ 无条件放行所有工具调用，仅在受控环境中使用' },
] as const;

// ═══ 深度比较 ════════════════════════════════════════

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;

  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keysA = Object.keys(objA);
  const keysB = Object.keys(objB);
  if (keysA.length !== keysB.length) return false;

  return keysA.every(key => deepEqual(objA[key], objB[key]));
}

// ═══ 主组件 ══════════════════════════════════════════

export default function SettingsPage() {
  const closeSettings = useUIStore((s) => s.closeSettings);
  const savedSettings = useSettingsStore((s) => s.settings);
  const loaded = useSettingsStore((s) => s.loaded);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const saveToStore = useSettingsStore((s) => s.saveSettings);
  const restartActiveSessions = useSettingsStore((s) => s.restartActiveSessions);

  // 本地编辑副本
  const [local, setLocal] = useState<AppSettings>(DEFAULT_SETTINGS);
  // API Key 显示/隐藏
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({});
  // 内层 profile tab 选中状态
  const [selectedProfileTab, setSelectedProfileTab] = useState<string>('default');
  // pi Profile 的模型 ID 输入框草稿（按 profileId 索引）
  const [piModelDrafts, setPiModelDrafts] = useState<Record<string, string>>({});
  const [agentMdDialogOpen, setAgentMdDialogOpen] = useState(false);

  // 加载设置
  useEffect(() => { loadSettings(); }, [loadSettings]);

  // 当 store 中的 settings 更新时，同步到本地
  useEffect(() => {
    if (loaded) {
      setLocal(structuredClone(savedSettings));
      const firstProfileId = Object.keys(savedSettings.profiles)[0] ?? 'default';
      setSelectedProfileTab(firstProfileId);
    }
  }, [loaded, savedSettings]);

  // dirty 检测
  const isDirty = useMemo(() => !deepEqual(local, savedSettings), [local, savedSettings]);

  // ── 通用更新 helper ──
  const updateAI = (patch: Partial<AppSettings['ai']>) => {
    setLocal(prev => ({ ...prev, ai: { ...prev.ai, ...patch } }));
  };

  const updateUI = (patch: Partial<NonNullable<AppSettings['ui']>>) => {
    setLocal(prev => ({
      ...prev,
      ui: { ...(prev.ui ?? { messageDisplayMode: 'compact' }), ...patch }
    }));
  };

  // ── 保存 ──
  const handleSave = async () => {
    await saveToStore(local);
  };

  const handleSaveAndRestart = async () => {
    await saveToStore(local);
    await restartActiveSessions();
    useConversationStore.getState().triggerSessionRestart();
    closeSettings();
  };

  const handleCancel = () => {
    setLocal(structuredClone(savedSettings));
  };

  // ── 关闭（dirty 时拦截） ──
  const confirmDialog = useConfirmStore((s) => s.confirm);
  const handleClose = async () => {
    if (!isDirty) {
      closeSettings();
      return;
    }
    const result = await confirmDialog({
      title: '未保存的更改',
      description: '设置已修改但尚未保存，你希望如何处理？',
      buttons: [
        { label: '放弃更改', value: 'discard', variant: 'outline' },
        { label: '保存', value: 'save', variant: 'default' },
        { label: '保存并重启会话', value: 'saveRestart', variant: 'default' },
      ],
    });
    if (result === 'discard') {
      setLocal(structuredClone(savedSettings));
      closeSettings();
    } else if (result === 'save') {
      await saveToStore(local);
    } else if (result === 'saveRestart') {
      await saveToStore(local);
      await restartActiveSessions();
      useConversationStore.getState().triggerSessionRestart();
      closeSettings();
    }
    // null（点击遮罩/ESC）= 留在设置页
  };

  // ── Profile helpers ──
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

  const deleteProfileById = (profileId: string) => {
    if (profileId === 'default') return;
    setLocal(prev => {
      const { [profileId]: _removed, ...rest } = prev.profiles;
      const newAi = { ...prev.ai };
      const clearIfMatch = (key: 'defaultModelSelection' | 'digestModelSelection' | 'reviewModelSelection' | 'categorizeModelSelection') => {
        if (newAi[key]?.profileId === profileId) newAi[key] = null;
      };
      clearIfMatch('defaultModelSelection');
      clearIfMatch('digestModelSelection');
      clearIfMatch('reviewModelSelection');
      clearIfMatch('categorizeModelSelection');
      return { ...prev, profiles: rest, ai: newAi };
    });
    setSelectedProfileTab('default');
  };

  // ── 加载中 ──
  if (!loaded) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">加载设置...</p>
        </div>
      </div>
    );
  }

  const profileIds = Object.keys(local.profiles);
  const inputCls = "h-9 w-full px-3 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring";

  return (
    <div className="h-screen flex flex-col">
      {/* ── 顶部固定栏 ── */}
      <header className="h-12 border-b flex items-center px-4 gap-3 bg-background flex-shrink-0">
        <Button variant="ghost" size="sm" onClick={handleClose}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h1 className="font-semibold flex-1">设置</h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" disabled={!isDirty} onClick={handleCancel}>
            取消
          </Button>
          <Button variant="outline" size="sm" disabled={!isDirty} onClick={handleSave}>
            保存
          </Button>
          <Button size="sm" disabled={!isDirty} onClick={handleSaveAndRestart}>
            保存并重启会话
          </Button>
        </div>
      </header>

      {/* ── 主体：纵向 Tabs ── */}
      <Tabs defaultValue="behavior" orientation="vertical" className="flex-1 flex overflow-hidden">
        {/* 左侧导航 */}
        <TabsList className="flex flex-col h-auto items-stretch gap-1 rounded-none border-r bg-muted/30 p-2 w-36 flex-shrink-0">
          <TabsTrigger value="behavior" className="justify-start px-3 py-2 data-[state=active]:bg-background">
            基础设置
          </TabsTrigger>
          <TabsTrigger value="abilities" className="justify-start px-3 py-2 data-[state=active]:bg-background">
            能力
          </TabsTrigger>
          <TabsTrigger value="profiles" className="justify-start px-3 py-2 data-[state=active]:bg-background">
            模型方案
          </TabsTrigger>
          <TabsTrigger value="workspace-management" className="justify-start px-3 py-2 data-[state=active]:bg-background">
            工作区管理
          </TabsTrigger>
          <TabsTrigger value="memory" className="justify-start px-3 py-2 data-[state=active]:bg-background">
            记忆管理
          </TabsTrigger>
          <TabsTrigger value="digests" className="justify-start px-3 py-2 data-[state=active]:bg-background">
            会话摘要
          </TabsTrigger>
          <TabsTrigger value="scheduler" className="justify-start px-3 py-2 data-[state=active]:bg-background">
            定时计划
          </TabsTrigger>
          <TabsTrigger value="sub-agent" className="justify-start px-3 py-2 data-[state=active]:bg-background">
            子会话派遣
          </TabsTrigger>
          <TabsTrigger value="parse-history" className="justify-start px-3 py-2 data-[state=active]:bg-background">
            解析历史
          </TabsTrigger>
          <TabsTrigger value="about" className="justify-start px-3 py-2 data-[state=active]:bg-background">
            关于
          </TabsTrigger>
        </TabsList>

        {/* ── Tab: 基础设置 ── */}
        <TabsContent value="behavior" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <div className="max-w-2xl py-6 px-6">
            <h2 className="text-lg font-semibold mb-1">基础设置</h2>
            <p className="text-sm text-muted-foreground mb-6">配置 Agent 的思考模式、执行力度和权限策略</p>
            <div className="space-y-6">
              {/* Effort 级别 */}
              <div className="space-y-2">
                <label className="text-sm font-medium">执行力度（effort）</label>
                <p className="text-xs text-muted-foreground">
                  「默认」由模型自决思考深度；「关闭」不产生思考；其余级别控制思考投入程度。
                </p>
                <div className="inline-flex h-10 items-center justify-center rounded-md bg-muted p-1">
                  {EFFORT_OPTIONS.map(opt => (
                    <button key={String(opt.value)}
                      className={cn(
                        'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-4 py-1.5 text-sm font-medium transition-all',
                        (local.ai.effort ?? null) === opt.value
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                      onClick={() => updateAI({ effort: opt.value })}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 默认模型 */}
              <div className="space-y-2">
                <label className="text-sm font-medium">默认模型</label>
                <p className="text-xs text-muted-foreground">
                  新建对话将使用此模型；选「不指定」时新对话需手动选择模型才能发送消息。
                  此处的修改仅影响之后新建的对话，不会改动已存在对话的模型设置。
                </p>
                <ModelSelector
                  settings={local}
                  value={local.ai.defaultModelSelection}
                  onChange={(v) => updateAI({ defaultModelSelection: v })}
                  allowUnset={true}
                  triggerVariant="block"
                />
              </div>

              {/* 默认权限模式 */}
              <div className="space-y-3">
                <label className="text-sm font-medium">默认权限模式</label>
                <div className="space-y-2">
                  {PERMISSION_MODE_OPTIONS.map(opt => (
                    <label key={opt.value} className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
                      <input type="radio" name="permissionMode" className="mt-0.5"
                        checked={local.ai.permissionMode === opt.value}
                        onChange={() => updateAI({ permissionMode: opt.value })}
                      />
                      <div>
                        <div className="text-sm font-medium">{opt.label}</div>
                        <div className="text-xs text-muted-foreground">{opt.description}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
              {/* 消息显示模式 */}
              <div className="space-y-3">
                <label className="text-sm font-medium">消息显示模式</label>
                <p className="text-xs text-muted-foreground">控制工具调用和思考过程的默认展开态</p>
                <div className="space-y-2">
                  <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
                    <input
                      type="radio"
                      name="messageDisplayMode"
                      className="mt-0.5"
                      checked={(local.ui?.messageDisplayMode ?? 'compact') === 'compact'}
                      onChange={() => updateUI({ messageDisplayMode: 'compact' })}
                    />
                    <div>
                      <div className="text-sm font-medium">简化（推荐）</div>
                      <div className="text-xs text-muted-foreground">工具调用和思考块默认折叠，只显示标题</div>
                    </div>
                  </label>
                  <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
                    <input
                      type="radio"
                      name="messageDisplayMode"
                      className="mt-0.5"
                      checked={local.ui?.messageDisplayMode === 'detailed'}
                      onChange={() => updateUI({ messageDisplayMode: 'detailed' })}
                    />
                    <div>
                      <div className="text-sm font-medium">详细</div>
                      <div className="text-xs text-muted-foreground">工具调用和思考块默认展开，显示完整输入/输出</div>
                    </div>
                  </label>
                </div>
              </div>

              <BasicToolsSection local={local} setLocal={setLocal} />

              {/* 通用级 agent.md */}
              <div className="space-y-2">
                <label className="text-sm font-medium">通用级 Agent 指令</label>
                <p className="text-xs text-muted-foreground">
                  位于 <code className="text-[10px] bg-muted px-1 py-0.5 rounded">.dogear/agent.md</code>，
                  对所有工作区生效。
                </p>
                <Button variant="outline" size="sm" onClick={() => setAgentMdDialogOpen(true)}>
                  <FileText className="w-3.5 h-3.5 mr-1.5" />
                  编辑通用级 agent.md
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ── Tab: 能力 ── */}
        <TabsContent value="abilities" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <AbilityTab local={local} setLocal={setLocal} />
        </TabsContent>

        {/* ── Tab: 模型方案 ── */}
        <TabsContent value="profiles" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <div className="max-w-2xl py-6 px-6">
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
                        openai-responses 走 OpenAI Responses API（适用于 GLM、DeepSeek、Qwen 等国产 OpenAI 兼容网关）。
                      </p>
                      <select
                        className="h-9 w-full px-3 text-sm border rounded bg-background"
                        value={profile.piWireApi ?? 'anthropic-messages'}
                        onChange={(e) => updateProfileField(id, { piWireApi: e.target.value as 'anthropic-messages' | 'openai-responses' })}
                      >
                        <option value="anthropic-messages">anthropic-messages（默认）</option>
                        <option value="openai-responses">openai-responses</option>
                      </select>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">模型清单 <span className="text-destructive">*</span></label>
                      <p className="text-xs text-muted-foreground">
                        该 Profile 可用的模型 ID 列表，每条可另设显示名（缺省显示 ID）；点击右侧窗口徽标可手填上下文窗口（缺省查表，未识别按 200K）。保存后在 ModelSelector 下拉里出现。
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
                          onClick={() => deleteProfileById(id)}
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
          </div>
        </TabsContent>

        {/* ── Tab: 工作区管理 ── */}
        <TabsContent value="workspace-management" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <WorkspaceManagementTab />
        </TabsContent>

        {/* ── Tab: 记忆管理 ── */}
        <TabsContent value="memory" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <MemoryTab />
        </TabsContent>

        {/* ── Tab: 会话摘要 ── */}
        <TabsContent value="digests" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <div className="max-w-4xl py-6 px-6 space-y-10">
            <div>
              <h2 className="text-lg font-semibold mb-1">会话摘要</h2>
              <p className="text-sm text-muted-foreground mb-6">后台自动把每个会话提炼成摘要卡，可在此查看组卡详情，或对单个组补跑提炼；提炼模型与提示词在「定时计划」的任务编辑器中配置。</p>
              <DigestsPanel />
            </div>
            <div>
              <h2 className="text-lg font-semibold mb-1">智能分类</h2>
              <p className="text-sm text-muted-foreground mb-6">每张新摘要卡产生后自动决策归类。本工作区独立，分类由 agent 全权决定；用户可在此调节匹配阈值、查看分类结果或全量重置；模型、提示词、补分类与整理在「定时计划」中配置。</p>
              <SmartCategoryPanel />
            </div>
          </div>
        </TabsContent>

        {/* ── Tab: 定时计划 ── */}
        <TabsContent value="scheduler" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <div className="max-w-4xl py-6 px-6">
            <h2 className="text-lg font-semibold mb-1">定时计划</h2>
            <p className="text-sm text-muted-foreground mb-6">
              每个任务一行：内置任务（组卡提炼 / 复盘报告 / 补分类 / 分类整理）常驻可改不可删，也可新建自定义任务；按时间规则（每天时刻 / 间隔 / 时间窗口 / 单次）或条件事件（启动、关会话、窗口关闭）触发，多个触发器任一命中即触发。
            </p>
            <SchedulerPanel />
          </div>
        </TabsContent>

        {/* ── Tab: 子会话派遣 ── */}
        <TabsContent value="sub-agent" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <SubAgentTab local={local} setLocal={setLocal} />
        </TabsContent>

        {/* ── Tab: 解析历史 ── */}
        <TabsContent value="parse-history" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <ArticleParseHistoryPanel />
        </TabsContent>

        {/* ── Tab: 关于 ── */}
        <TabsContent value="about" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <AboutTab />
        </TabsContent>
      </Tabs>

      <GeneralAgentMdDialog open={agentMdDialogOpen} onOpenChange={setAgentMdDialogOpen} />
    </div>
  );
}
