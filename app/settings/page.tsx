import { useEffect, useState, useMemo, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ArrowLeft, Plus, Trash2, Eye, EyeOff, AlertTriangle, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings-store';
import { useConfirmStore } from '@/stores/confirm-store';
import { useUIStore } from '@/stores/ui-store';
import type { AppSettings, ModelProfile } from '@/types/settings';
import { DEFAULT_SETTINGS, isProfileComplete } from '@/types/settings';
import { WorkspaceManagementTab } from './WorkspaceManagementTab';
import { AbilityTab } from './AbilityTab';
import { ExtensionStatusLine } from './ExtensionStatusLine';
import { SubAgentTab } from './SubAgentTab';
import { AboutTab } from './AboutTab';
import { ModelSelector } from '@/components/ModelSelector';
import { formatContextLabel, lookupContextWindow, resolveModelWindow } from '@/lib/pi-model-catalog';
import { PiModelRow } from './pi-model-row';
import { FailoverSection } from './FailoverSection';
import { formatTokens } from '@/components/agent-chat/usage-badge/usage-utils';
import { playDogearSound } from '@/lib/dogear-sound';

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

const FONT_SIZE_OPTIONS = [
  { value: 'small' as const, label: '小' },
  { value: 'medium' as const, label: '中' },
  { value: 'large' as const, label: '大' },
];

const THEME_OPTIONS = [
  { value: 'light' as const, label: '亮色', description: '柔雾浅灰底色，适合长时间阅读' },
  { value: 'dark' as const, label: '暗色', description: '墨蓝底色，适合夜间与暗光环境' },
  { value: 'system' as const, label: '跟随系统', description: '随操作系统深浅模式自动切换' },
];

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
  const savedSettings = useSettingsStore((s) => s.settings);
  const loaded = useSettingsStore((s) => s.loaded);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const saveToStore = useSettingsStore((s) => s.saveSettings);
  const closeSettings = useUIStore((s) => s.closeSettings);

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

  const updateAppearance = (patch: Partial<NonNullable<AppSettings['appearance']>>) => {
    setLocal(prev => ({
      ...prev,
      appearance: { ...(prev.appearance ?? { theme: 'light' }), ...patch }
    }));
  };

  const updateSound = (patch: Partial<NonNullable<NonNullable<AppSettings['ui']>['sound']>>) => {
    setLocal(prev => ({
      ...prev,
      ui: {
        ...(prev.ui ?? { messageDisplayMode: 'compact' }),
        sound: {
          enabled: prev.ui?.sound?.enabled ?? true,
          volume: prev.ui?.sound?.volume ?? 0.25,
          backgroundOnly: prev.ui?.sound?.backgroundOnly ?? true,
          ...patch,
        },
      },
    }));
  };

  // ── 保存 ──
  const handleSaveAndClose = async () => {
    await saveToStore(local);
    closeSettings();
  };

  const handleCancel = () => {
    setLocal(structuredClone(savedSettings));
  };

  // ── 关闭 overlay（dirty 时拦截） ──
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
        { label: '保存并退出', value: 'save', variant: 'default' },
      ],
    });
    if (result === 'discard') {
      setLocal(structuredClone(savedSettings));
      closeSettings();
    } else if (result === 'save') {
      await saveToStore(local);
      closeSettings();
    }
    // null（点击遮罩/ESC）= 留在设置页
  };

  const handleCloseRef = useRef(handleClose);
  handleCloseRef.current = handleClose;

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
      const clearIfMatch = (key: 'defaultModelSelection' | 'parseModelSelection' | 'stateModelSelection') => {
        if (newAi[key]?.profileId === profileId) newAi[key] = null;
      };
      clearIfMatch('defaultModelSelection');
      clearIfMatch('parseModelSelection');
      clearIfMatch('stateModelSelection');
      return { ...prev, profiles: rest, ai: newAi };
    });
    setSelectedProfileTab('default');
  };

  // ── 加载中 ──
  if (!loaded) {
    return (
      <div className="flex items-center justify-center h-full">
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
    <div className="h-full flex flex-col">
      {/* ── 顶部固定栏 ── */}
      <header className="h-12 border-b flex items-center px-4 gap-3 bg-background flex-shrink-0">
        <Button variant="ghost" size="sm" onClick={() => void handleCloseRef.current()}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h1 className="font-semibold flex-1">设置</h1>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" disabled={!isDirty} onClick={handleCancel}>
            取消
          </Button>
          <Button size="sm" disabled={!isDirty} onClick={handleSaveAndClose}>
            保存并退出
          </Button>
        </div>
      </header>

      {/* ── 主体：顶部下划线 Tabs ── */}
      <Tabs defaultValue="behavior" className="flex-1 flex flex-col overflow-hidden">
        <TabsList variant="underline" className="justify-start px-6 flex-shrink-0">
          <TabsTrigger variant="underline" value="behavior">基础设置</TabsTrigger>
          <TabsTrigger variant="underline" value="abilities">能力</TabsTrigger>
          <TabsTrigger variant="underline" value="profiles">模型方案</TabsTrigger>
          <TabsTrigger variant="underline" value="workspace-management">工作区管理</TabsTrigger>
          <TabsTrigger variant="underline" value="sub-agent">子会话派遣</TabsTrigger>
          <TabsTrigger variant="underline" value="about">关于</TabsTrigger>
        </TabsList>

        {/* ── Tab: 基础设置 ── */}
        <TabsContent value="behavior" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <div className="max-w-2xl mx-auto py-6 px-6">
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

              {/* 文章解析模型 */}
              <div className="space-y-2">
                <label className="text-sm font-medium">文章解析模型</label>
                <p className="text-xs text-muted-foreground">
                  文章导入固定解析不达标时的 AI 兑底任务使用此模型，适合配置便宜档；选「不指定」时回退到默认模型。
                </p>
                <ModelSelector
                  settings={local}
                  value={local.ai.parseModelSelection}
                  onChange={(v) => updateAI({ parseModelSelection: v })}
                  allowUnset={true}
                  triggerVariant="block"
                />
              </div>

              {/* 话题状态提炼模型 */}
              <div className="space-y-2">
                <label className="text-sm font-medium">话题状态提炼模型</label>
                <p className="text-xs text-muted-foreground">
                  开启话题组会话时增量提炼话题状态卡的后台任务使用此模型，运行频繁，适合配置便宜档；选「不指定」时回退到默认模型。
                </p>
                <ModelSelector
                  settings={local}
                  value={local.ai.stateModelSelection}
                  onChange={(v) => updateAI({ stateModelSelection: v })}
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

              {/* 界面大小 */}
              <div className="space-y-2">
                <label className="text-sm font-medium">界面大小</label>
                <p className="text-xs text-muted-foreground">
                  全局缩放文字、图标和间距（图表与终端字号不变），对所有窗口生效；默认为「中」。
                </p>
                <div className="inline-flex h-10 items-center justify-center rounded-md bg-muted p-1">
                  {FONT_SIZE_OPTIONS.map(opt => (
                    <button key={opt.value}
                      className={cn(
                        'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-4 py-1.5 text-sm font-medium transition-all',
                        (local.ui?.fontSize ?? 'medium') === opt.value
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                      onClick={() => updateUI({ fontSize: opt.value })}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Dogear 提示音 */}
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <label className="text-sm font-medium flex items-center gap-2">
                      <Volume2 className="w-4 h-4" />
                      Dogear 提示音
                    </label>
                    <p className="text-xs text-muted-foreground mt-1">
                      使用应用内合成音效，不调用 Windows 通知或系统提示音。主会话完成、任务完成/失败、等待授权时触发；仅应用后台时响（可关）。
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    checked={local.ui?.sound?.enabled ?? true}
                    onChange={(e) => updateSound({ enabled: e.target.checked })}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-3 pl-0">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <input
                      type="checkbox"
                      checked={local.ui?.sound?.backgroundOnly ?? true}
                      onChange={(e) => updateSound({ backgroundOnly: e.target.checked })}
                    />
                    仅当 Dogear 不在前台时播放
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    音量
                    <input
                      type="range"
                      min="0"
                      max="100"
                      step="5"
                      className="w-28"
                      value={Math.round((local.ui?.sound?.volume ?? 0.25) * 100)}
                      onChange={(e) => updateSound({ volume: Number(e.target.value) / 100 })}
                    />
                    <span className="w-9 text-xs text-muted-foreground">{Math.round((local.ui?.sound?.volume ?? 0.25) * 100)}%</span>
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => playDogearSound('complete', { force: true, volume: local.ui?.sound?.volume })}
                    disabled={(local.ui?.sound?.enabled ?? true) === false}
                  >
                    试听
                  </Button>
                </div>
              </div>

              {/* 主题 */}
              <div className="space-y-3">
                <label className="text-sm font-medium">主题</label>
                <p className="text-xs text-muted-foreground">切换亮/暗配色，保存后立即应用到所有窗口；默认为「亮色」。</p>
                <div className="space-y-2">
                  {THEME_OPTIONS.map(opt => (
                    <label key={opt.value} className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
                      <input type="radio" name="appearanceTheme" className="mt-0.5"
                        checked={(local.appearance?.theme ?? 'light') === opt.value}
                        onChange={() => updateAppearance({ theme: opt.value })}
                      />
                      <div>
                        <div className="text-sm font-medium">{opt.label}</div>
                        <div className="text-xs text-muted-foreground">{opt.description}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* 浏览器 */}
              <div className="space-y-3">
                <label className="text-sm font-medium">浏览器</label>
                <p className="text-xs text-muted-foreground">
                  Agent 内嵌浏览器工具（读文章 / 网页搜索）共用的代理与搜索引擎配置。
                </p>
                <div className="space-y-4 rounded-lg border p-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">代理地址</label>
                    <p className="text-xs text-muted-foreground">
                      仅 Google / DuckDuckGo 搜索请求经此代理分流，读文章与 Bing 直连不受影响；
                      留空 = 禁用代理引擎，搜索仅使用 Bing。
                    </p>
                    <input
                      type="text"
                      className={inputCls}
                      value={local.browserProxyServer ?? ''}
                      onChange={(e) => setLocal(prev => ({ ...prev, browserProxyServer: e.target.value }))}
                      placeholder="127.0.0.1:7890"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">默认搜索引擎</label>
                    <p className="text-xs text-muted-foreground">
                      auto = 代理可用时用 Google，不可用时自动改用 Bing；搜索失败时按 Google → DuckDuckGo → Bing 自动降级。
                    </p>
                    <select
                      className="h-9 w-full px-3 text-sm border rounded bg-background"
                      value={local.browserSearchEngine}
                      onChange={(e) => setLocal(prev => ({
                        ...prev,
                        browserSearchEngine: e.target.value as AppSettings['browserSearchEngine'],
                      }))}
                    >
                      <option value="auto">auto（智能选择）</option>
                      <option value="google">Google</option>
                      <option value="bing">Bing</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium">浏览器扩展</label>
                    <p className="text-xs text-muted-foreground">
                      连接后 Dogear 可读取扩展所在浏览器当前标签页的标题、网址与正文预览。
                    </p>
                    <ExtensionStatusLine />
                  </div>
                </div>
              </div>

              {/* 联网搜索（GLM MCP） */}
              <div className="space-y-3">
                <label className="text-sm font-medium">联网搜索（GLM MCP）</label>
                <p className="text-xs text-muted-foreground">
                  能力页「联网搜索」工具包（bigmodel__webSearch / bigmodel__webReader）的 API Key，
                  在智谱个人编程套餐 → 套餐概览页创建；消耗套餐专属 MCP 额度。
                </p>
                <div className="space-y-1.5 rounded-lg border p-4">
                  <label className="text-sm font-medium">GLM Coding Plan API Key</label>
                  <p className="text-xs text-muted-foreground">
                    留空时开启工具包也会因缺 Key 在调用时返回提示（不会崩溃）。
                  </p>
                  <input
                    type="password"
                    className={inputCls}
                    value={local.webMcpApiKey ?? ''}
                    onChange={(e) => setLocal(prev => ({ ...prev, webMcpApiKey: e.target.value }))}
                    placeholder="GLM Coding Plan API Key"
                    autoComplete="off"
                  />
                </div>
              </div>

              {/* 通用级 agent.md：唯一编辑入口在能力页「全局规则」包详情 */}
              <div className="space-y-2">
                <label className="text-sm font-medium">通用级 Agent 指令</label>
                <p className="text-xs text-muted-foreground">
                  位于 <code className="text-[0.9em] bg-muted px-1 py-0.5 rounded">.dogear/agent.md</code>，
                  对所有工作区生效。在「能力」页选择「全局规则」包进行编辑。
                </p>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ── Tab: 能力 ── */}
        <TabsContent value="abilities" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <AbilityTab />
        </TabsContent>

        {/* ── Tab: 模型方案 ── */}
        <TabsContent value="profiles" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
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

        {/* ── Tab: 子会话派遣 ── */}
        <TabsContent value="sub-agent" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <SubAgentTab local={local} setLocal={setLocal} />
        </TabsContent>

        {/* ── Tab: 关于 ── */}
        <TabsContent value="about" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <AboutTab />
        </TabsContent>
      </Tabs>

    </div>
  );
}
