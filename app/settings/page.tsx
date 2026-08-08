import { useEffect, useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ArrowLeft, Plus, Trash2, Eye, EyeOff, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings-store';
import { useUIStore } from '@/stores/ui-store';
import { useConfirmStore } from '@/stores/confirm-store';
import { useConversationStore } from '@/stores/conversation-store';
import type { AppSettings, ModelProfile } from '@/types/settings';
import { DEFAULT_SETTINGS, BUILTIN_DEFAULT_SYSTEM_PROMPT, isProfileComplete } from '@/types/settings';
import { WorkspaceConfigTab } from './WorkspaceConfigTab';
import { WorkspaceManagementTab } from './WorkspaceManagementTab';
import { PersonaTab } from './PersonaTab';
import { AgentsTab } from './AgentsTab';
import { MemoryTab } from './MemoryTab';
import { DigestsPanel } from './memory/DigestsPanel';
import { ReviewPanel } from './memory/ReviewPanel';
import { SmartCategoryPanel } from './memory/SmartCategoryPanel';
import { AbilityTab } from './AbilityTab';
import { BasicToolsSection } from './BasicToolsSection';
import { SubAgentTab } from './SubAgentTab';
import { ArticleParseHistoryPanel } from '@/components/ArticleParseHistoryPanel';
import { ModelSelector } from '@/components/ModelSelector';

// ═══ 常量 ═══════════════════════════════════════════

const EFFORT_OPTIONS = [
  { value: null, label: '不指定' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: '超高' },
  { value: 'max', label: 'Max' },
] as const;

const THINKING_TYPE_OPTIONS = [
  { value: 'adaptive', label: '自适应', description: '模型自决何时思考、思考多深（推荐）' },
  { value: 'enabled', label: '固定预算', description: '每轮固定花 N token 思考' },
  { value: 'disabled', label: '关闭', description: '不思考，省 thinking token' },
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
      haikuModel: '', sonnetModel: '', opusModel: '',
      apiTimeoutMs: 3000000, disableNonessentialTraffic: true,
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
          <TabsTrigger value="personas" className="justify-start px-3 py-2 data-[state=active]:bg-background">
            人设管理
          </TabsTrigger>
          <TabsTrigger value="workspace" className="justify-start px-3 py-2 data-[state=active]:bg-background">
            工作区配置
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
          <TabsTrigger value="agents" className="justify-start px-3 py-2 data-[state=active]:bg-background">
            代理管理
          </TabsTrigger>
          <TabsTrigger value="sub-agent" className="justify-start px-3 py-2 data-[state=active]:bg-background">
            子会话派遣
          </TabsTrigger>
          <TabsTrigger value="parse-history" className="justify-start px-3 py-2 data-[state=active]:bg-background">
            解析历史
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
                  选「不指定」时不传 effort 给 SDK，由模型自带默认值决定（一般更省 thinking token）。
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

              {/* 子代理模型层级 */}
              <div className="space-y-2">
                <label className="text-sm font-medium">子代理模型</label>
                <p className="text-xs text-muted-foreground">
                  注入 CLAUDE_CODE_SUBAGENT_MODEL 环境变量，决定 Task 工具启动的子代理用哪一层。
                  未指定时，若配置了「努力程度」会自动用 Sonnet（Haiku 不支持 effort 参数）。
                </p>
                <select
                  className="h-9 w-full px-3 text-sm border rounded bg-background"
                  value={local.ai.subagentModelTier || ''}
                  onChange={(e) => updateAI({
                    subagentModelTier: e.target.value ? e.target.value as 'haiku' | 'sonnet' | 'opus' : undefined
                  })}
                >
                  <option value="">不指定</option>
                  <option value="haiku">Haiku</option>
                  <option value="sonnet">Sonnet</option>
                  <option value="opus">Opus</option>
                </select>
              </div>

              {/* 思考模式 */}
              <div className="space-y-2">
                <label className="text-sm font-medium">思考模式</label>
                <p className="text-xs text-muted-foreground">
                  控制 SDK 传给模型的 thinking 配置（ThinkingConfig.type）。
                </p>
                <select
                  className="h-9 w-full px-3 text-sm border rounded bg-background"
                  value={local.ai.thinkingType ?? 'adaptive'}
                  onChange={(e) => updateAI({ thinkingType: e.target.value as 'adaptive' | 'enabled' | 'disabled' })}
                >
                  {THINKING_TYPE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label} — {opt.description}</option>
                  ))}
                </select>
              </div>

              {/* 思考预算（仅 enabled 模式） */}
              {(local.ai.thinkingType ?? 'adaptive') === 'enabled' && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">思考预算（tokens）</label>
                  <p className="text-xs text-muted-foreground">
                    每轮固定花费的 thinking token 数量。建议 4000–16000；留空走 SDK 默认。
                  </p>
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    placeholder="8000"
                    className="h-9 w-full px-3 text-sm border rounded bg-background"
                    value={local.ai.thinkingBudgetTokens ?? ''}
                    onChange={(e) => {
                      const v = e.target.value.trim();
                      updateAI({ thinkingBudgetTokens: v === '' ? undefined : Number(v) });
                    }}
                  />
                </div>
              )}

              {/* 思考过程展示（关闭模式下隐藏） */}
              {(local.ai.thinkingType ?? 'adaptive') !== 'disabled' && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">思考过程展示</label>
                  <p className="text-xs text-muted-foreground">
                    控制模型 thinking 块的可见性。Opus 4.7 默认隐藏，开启「显示摘要」可看到推理过程。
                  </p>
                  <select
                    className="h-9 w-full px-3 text-sm border rounded bg-background"
                    value={local.ai.thinkingDisplay ?? 'summarized'}
                    onChange={(e) => updateAI({ thinkingDisplay: e.target.value as 'summarized' | 'omitted' })}
                  >
                    <option value="summarized">显示摘要</option>
                    <option value="omitted">不展示</option>
                  </select>
                </div>
              )}

              {/* maxTurns */}
              <div className="space-y-3">
                <label className="text-sm font-medium">最大执行轮次</label>
                <div className="flex items-center gap-3">
                  <input type="number"
                    className="h-9 w-32 px-3 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                    value={local.ai.maxTurns ?? ''}
                    onChange={(e) => updateAI({ maxTurns: e.target.value ? Number(e.target.value) : undefined })}
                    min={1} placeholder="不限制"
                  />
                  <span className="text-xs text-muted-foreground">限制 Agent 单次对话的执行轮次，防止无限循环</span>
                </div>
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
              {/* 默认系统提示词 */}
              <div className="space-y-3">
                <label className="text-sm font-medium">默认系统提示词</label>
                <p className="text-xs text-muted-foreground">
                  此提示词作为所有对话的基础系统提示，追加到 Claude Code 预设之后。不可为空。
                </p>
                <textarea
                  className="w-full min-h-[120px] px-3 py-2 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-y font-mono"
                  value={local.ai.defaultSystemPrompt || BUILTIN_DEFAULT_SYSTEM_PROMPT}
                  onChange={(e) => updateAI({ defaultSystemPrompt: e.target.value || BUILTIN_DEFAULT_SYSTEM_PROMPT })}
                  placeholder={BUILTIN_DEFAULT_SYSTEM_PROMPT}
                />
              </div>

              {/* 下一步建议气泡（promptSuggestions） */}
              <div className="space-y-3">
                <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={local.ai.promptSuggestionsEnabled !== false}
                    onChange={(e) => updateAI({ promptSuggestionsEnabled: e.target.checked })}
                  />
                  <div>
                    <div className="text-sm font-medium">下一步建议气泡</div>
                    <div className="text-xs text-muted-foreground">
                      Agent 每轮回答后显示一条下一步提示气泡，点击可快速填入输入框（SDK 0.2.119+ 特性）
                    </div>
                  </div>
                </label>
              </div>

              {/* 环境上下文挪到首条消息（excludeDynamicSections） */}
              <div className="space-y-3">
                <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={local.ai.excludeDynamicSections !== false}
                    onChange={(e) => updateAI({ excludeDynamicSections: e.target.checked })}
                  />
                  <div>
                    <div className="text-sm font-medium">优化 Prompt 缓存</div>
                    <div className="text-xs text-muted-foreground">
                      将环境上下文（工作目录、时间等）移到首条用户消息，避免每轮打穿缓存。一般建议开启（SDK 0.2.119+ 特性）
                    </div>
                  </div>
                </label>
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
            </div>

            <BasicToolsSection local={local} setLocal={setLocal} />
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
                      <label className="text-sm font-medium">运行时格式</label>
                      <p className="text-xs text-muted-foreground">
                        决定该方案的对话走哪套运行时。默认 anthropic-sdk（Claude Agent SDK，功能完整）；
                        pi（pi-ai + pi-agent-core）已支持基础工具（Read/Write/Edit/Bash/Grep/Glob）、
                        常驻记忆工具、skill 加载、权限卡片、插话队列，但暂不支持 fork/压缩/子会话派遣/
                        group/reference/市场插件 skill/stock 等业务工具包。
                      </p>
                      <select
                        className="h-9 w-full px-3 text-sm border rounded bg-background"
                        value={profile.apiFormat ?? 'anthropic-sdk'}
                        onChange={(e) => updateProfileField(id, { apiFormat: e.target.value as 'anthropic-sdk' | 'pi' })}
                      >
                        <option value="anthropic-sdk">anthropic-sdk（默认）</option>
                        <option value="pi">pi</option>
                      </select>
                    </div>

                    {profile.apiFormat === 'pi' && (
                      <>
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
                            该 Profile 可用的模型 ID 列表，每条既是模型标识也是显示名。保存后在 ModelSelector 下拉里出现。
                          </p>
                          <div className="space-y-2">
                            {(profile.piModels ?? []).length === 0 && (
                              <p className="text-xs text-muted-foreground italic">尚未添加任何模型</p>
                            )}
                            {(profile.piModels ?? []).map(modelId => (
                              <div key={modelId} className="flex items-center gap-2">
                                <span className="flex-1 text-sm font-mono px-3 py-1.5 border rounded bg-muted/30 truncate">
                                  {modelId}
                                </span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => updateProfileField(id, {
                                    piModels: (profile.piModels ?? []).filter(m => m !== modelId),
                                  })}
                                >
                                  <Trash2 className="w-4 h-4 text-destructive" />
                                </Button>
                              </div>
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
                                  if (existing.includes(raw)) {
                                    setPiModelDrafts(prev => ({ ...prev, [id]: '' }));
                                    return;
                                  }
                                  updateProfileField(id, { piModels: [...existing, raw] });
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
                                if (existing.includes(raw)) {
                                  setPiModelDrafts(prev => ({ ...prev, [id]: '' }));
                                  return;
                                }
                                updateProfileField(id, { piModels: [...existing, raw] });
                                setPiModelDrafts(prev => ({ ...prev, [id]: '' }));
                              }}
                            >
                              <Plus className="w-4 h-4 mr-1" />
                              添加
                            </Button>
                          </div>
                        </div>
                      </>
                    )}

                    {profile.apiFormat !== 'pi' && (
                      <>
                        {(['haikuModel', 'sonnetModel', 'opusModel'] as const).map(field => {
                          const labels: Record<string, string> = { haikuModel: 'Haiku 模型', sonnetModel: 'Sonnet 模型', opusModel: 'Opus 模型' };
                          const placeholders: Record<string, string> = { haikuModel: '如 claude-haiku-4-5', sonnetModel: '如 claude-sonnet-4-6', opusModel: '如 claude-opus-4-6' };
                          return (
                            <div key={field} className="space-y-1.5">
                              <label className="text-sm font-medium">{labels[field]} <span className="text-destructive">*</span></label>
                              <input type="text" className={inputCls}
                                value={profile[field]}
                                onChange={(e) => updateProfileField(id, { [field]: e.target.value })}
                                placeholder={placeholders[field]}
                              />
                            </div>
                          );
                        })}
                      </>
                    )}

                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">API 超时时间（毫秒）</label>
                      <input type="number" className={inputCls}
                        value={profile.apiTimeoutMs}
                        onChange={(e) => updateProfileField(id, { apiTimeoutMs: Number(e.target.value) })}
                        min={1000}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <label className="text-sm font-medium">禁用非必要流量</label>
                        <p className="text-xs text-muted-foreground">关闭 SDK 的非必要网络请求</p>
                      </div>
                      <button type="button"
                        className={cn(
                          "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                          profile.disableNonessentialTraffic ? "bg-primary" : "bg-muted"
                        )}
                        onClick={() => updateProfileField(id, { disableNonessentialTraffic: !profile.disableNonessentialTraffic })}
                      >
                        <span className={cn(
                          "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                          profile.disableNonessentialTraffic ? "translate-x-6" : "translate-x-1"
                        )} />
                      </button>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-sm font-medium">自动压缩窗口 (tokens)</label>
                      <p className="text-xs text-muted-foreground">
                        CLAUDE_CODE_AUTO_COMPACT_WINDOW；留空按模型默认（标准 200K / 扩展 1M）。
                        填 500000 = 到 50 万 token 时触发压缩。上限受模型实际上下文窗口约束。
                      </p>
                      <Input
                        type="number"
                        min={0}
                        placeholder="留空 = 走 SDK 默认"
                        value={profile.autoCompactWindow ?? ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          updateProfileField(id, {
                            autoCompactWindow: v === '' ? undefined : Math.max(0, Number(v) || 0),
                          });
                        }}
                        className="max-w-[240px]"
                      />
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
          </div>
        </TabsContent>

        {/* ── Tab: 人设管理 ── */}
        <TabsContent value="personas" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <PersonaTab local={local} setLocal={setLocal} />
        </TabsContent>

        {/* ── Tab: 工作区配置 ── */}
        <TabsContent value="workspace" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <WorkspaceConfigTab local={local} setLocal={setLocal} />
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
              <p className="text-sm text-muted-foreground mb-6">后台自动把每个会话提炼成摘要卡，可在此查看、重新提炼、配置提炼方案与提示词。</p>
              <DigestsPanel />
            </div>
            <div>
              <h2 className="text-lg font-semibold mb-1">跨会话复盘</h2>
              <p className="text-sm text-muted-foreground mb-6">后台综合本工作区的摘要卡，滚动维护一张复盘卡（首页仪表盘呈现）。可在此配置复盘方案、档位与提示词，或立即复盘。</p>
              <ReviewPanel />
            </div>
            <div>
              <h2 className="text-lg font-semibold mb-1">智能分类</h2>
              <p className="text-sm text-muted-foreground mb-6">每张新摘要卡产生后自动决策归类。本工作区独立，分类由 agent 全权决定；用户可在此调节阈值/模型/提示词，或立即重跑全量。</p>
              <SmartCategoryPanel />
            </div>
          </div>
        </TabsContent>

        {/* ── Tab: 代理管理 ── */}
        <TabsContent value="agents" className="flex-1 flex overflow-hidden mt-0 p-0 data-[state=inactive]:hidden">
          <AgentsTab />
        </TabsContent>

        {/* ── Tab: 子会话派遣 ── */}
        <TabsContent value="sub-agent" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <SubAgentTab local={local} setLocal={setLocal} />
        </TabsContent>

        {/* ── Tab: 解析历史 ── */}
        <TabsContent value="parse-history" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <ArticleParseHistoryPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
