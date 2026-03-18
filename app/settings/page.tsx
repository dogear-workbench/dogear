import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ArrowLeft, Plus, Trash2, Eye, EyeOff, AlertTriangle, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings-store';
import type { AppSettings, ModelProfile } from '@/types/settings';
import { DEFAULT_SETTINGS, isProfileComplete } from '@/types/settings';

// ═══ 常量 ═══════════════════════════════════════════

// SDK 内置工具
const SDK_TOOLS = [
  { name: 'Read', description: '读取文件内容' },
  { name: 'Glob', description: '按模式搜索文件' },
  { name: 'Grep', description: '搜索文件内容' },
  { name: 'Bash', description: '执行终端命令' },
  { name: 'Write', description: '创建或覆盖文件' },
  { name: 'Edit', description: '编辑文件片段' },
  { name: 'WebFetch', description: '抓取网页内容' },
  { name: 'WebSearch', description: '搜索互联网' },
] as const;

// 自定义工具
const CUSTOM_TOOLS = [
  { name: 'SearchInChapters', description: '在书籍章节中搜索关键词' },
  { name: 'AnswerQuestion', description: '基于书籍内容回答问题' },
  { name: 'ReadArticle', description: '读取已保存文章的内容' },
  { name: 'ListArticles', description: '列出工作区中的文章' },
  { name: 'SaveAnalysis', description: '保存书籍分析结果' },
  { name: 'SaveChapterAnalysis', description: '保存章节分析结果' },
  { name: 'MarkComplete', description: '标记分析任务完成' },
] as const;

const EFFORT_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'max', label: 'Max' },
] as const;

const PERMISSION_MODE_OPTIONS = [
  { value: 'default', label: '标准', description: '危险操作需用户确认（推荐）' },
  { value: 'acceptEdits', label: '自动编辑', description: '文件编辑自动通过，其余需确认' },
  { value: 'plan', label: '仅规划', description: '只规划不执行，工具调用被阻止' },
  { value: 'dontAsk', label: '静默拒绝', description: '未预授权的工具直接拒绝' },
] as const;

type ToolPermission = 'allow' | 'default' | 'deny';

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
  const navigate = useNavigate();
  const savedSettings = useSettingsStore((s) => s.settings);
  const loaded = useSettingsStore((s) => s.loaded);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const saveToStore = useSettingsStore((s) => s.saveSettings);
  const restartActiveSessions = useSettingsStore((s) => s.restartActiveSessions);

  // 本地编辑副本
  const [local, setLocal] = useState<AppSettings>(DEFAULT_SETTINGS);
  // API Key 显示/隐藏
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({});
  // 内层 profile tab 选中状态（独立于 activeProfileId）
  const [selectedProfileTab, setSelectedProfileTab] = useState<string>('default');

  // 加载设置
  useEffect(() => { loadSettings(); }, [loadSettings]);

  // 当 store 中的 settings 更新时，同步到本地
  useEffect(() => {
    if (loaded) {
      setLocal(structuredClone(savedSettings));
      setSelectedProfileTab(savedSettings.ai.activeProfileId);
    }
  }, [loaded, savedSettings]);

  // dirty 检测
  const isDirty = useMemo(() => !deepEqual(local, savedSettings), [local, savedSettings]);

  // ── 通用更新 helper ──
  const updateAI = (patch: Partial<AppSettings['ai']>) => {
    setLocal(prev => ({ ...prev, ai: { ...prev.ai, ...patch } }));
  };

  // ── 保存 ──
  const handleSave = async () => {
    await saveToStore(local);
  };

  const handleSaveAndRestart = async () => {
    await saveToStore(local);
    await restartActiveSessions();
  };

  const handleCancel = () => {
    setLocal(structuredClone(savedSettings));
  };

  // ── 工具权限 helper ──
  const getToolPermission = (toolName: string): ToolPermission => {
    if (local.permissionRules?.allow?.includes(toolName)) return 'allow';
    if (local.permissionRules?.deny?.includes(toolName)) return 'deny';
    return 'default';
  };

  const setToolPermission = (toolName: string, perm: ToolPermission) => {
    const rules = local.permissionRules || { allow: [], deny: [] };
    const allow = (rules.allow || []).filter(t => t !== toolName);
    const deny = (rules.deny || []).filter(t => t !== toolName);
    if (perm === 'allow') allow.push(toolName);
    if (perm === 'deny') deny.push(toolName);
    setLocal(prev => ({ ...prev, permissionRules: { allow, deny } }));
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
      const activeId = prev.ai.activeProfileId === profileId ? 'default' : prev.ai.activeProfileId;
      return { ...prev, profiles: rest, ai: { ...prev.ai, activeProfileId: activeId } };
    });
    setSelectedProfileTab('default');
  };

  const activateProfile = (profileId: string) => {
    updateAI({ activeProfileId: profileId });
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

  // ── 工具权限行渲染 ──
  const renderToolRow = (tool: { name: string; description: string }) => {
    const perm = getToolPermission(tool.name);
    return (
      <div key={tool.name} className="flex items-center justify-between py-2 border-b last:border-b-0">
        <div className="flex-1 min-w-0">
          <span className="text-sm font-mono">{tool.name}</span>
          <span className="text-xs text-muted-foreground ml-2">{tool.description}</span>
        </div>
        <div className="inline-flex h-8 items-center rounded-md bg-muted p-0.5 flex-shrink-0 ml-4">
          {([
            { value: 'allow' as const, label: '自动允许', color: 'text-green-700' },
            { value: 'default' as const, label: '需确认', color: 'text-foreground' },
            { value: 'deny' as const, label: '禁止', color: 'text-red-600' },
          ]).map(opt => (
            <button
              key={opt.value}
              className={cn(
                'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1 text-xs font-medium transition-all',
                perm === opt.value
                  ? `bg-background ${opt.color} shadow-sm`
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setToolPermission(tool.name, opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="h-screen flex flex-col">
      {/* ── 顶部固定栏 ── */}
      <header className="h-12 border-b flex items-center px-4 gap-3 bg-background flex-shrink-0">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
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
            AI 行为
          </TabsTrigger>
          <TabsTrigger value="permissions" className="justify-start px-3 py-2 data-[state=active]:bg-background">
            工具权限
          </TabsTrigger>
          <TabsTrigger value="profiles" className="justify-start px-3 py-2 data-[state=active]:bg-background">
            模型方案
          </TabsTrigger>
        </TabsList>

        {/* ── Tab: AI 行为 ── */}
        <TabsContent value="behavior" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <div className="max-w-2xl py-6 px-6">
            <h2 className="text-lg font-semibold mb-1">AI 行为</h2>
            <p className="text-sm text-muted-foreground mb-6">配置 Agent 的思考模式、执行力度和权限策略</p>
            <div className="space-y-6">
              {/* Thinking 模式 */}
              <div className="space-y-3">
                <label className="text-sm font-medium">思考模式</label>
                <div className="space-y-2">
                  <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
                    <input type="radio" name="thinking" className="mt-0.5"
                      checked={local.ai.thinking.type === 'adaptive'}
                      onChange={() => updateAI({ thinking: { type: 'adaptive' } })}
                    />
                    <div>
                      <div className="text-sm font-medium">Adaptive（自适应）</div>
                      <div className="text-xs text-muted-foreground">Claude 自主决定何时思考及深度（推荐）</div>
                    </div>
                  </label>
                  <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
                    <input type="radio" name="thinking" className="mt-0.5"
                      checked={local.ai.thinking.type === 'enabled'}
                      onChange={() => updateAI({ thinking: { type: 'enabled', budgetTokens: local.ai.thinking.budgetTokens || 10000 } })}
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium">Enabled（固定预算）</div>
                      <div className="text-xs text-muted-foreground">指定固定的思考 token 预算</div>
                      {local.ai.thinking.type === 'enabled' && (
                        <div className="mt-2">
                          <input type="number"
                            className="h-8 w-40 px-2 text-sm border rounded bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                            value={local.ai.thinking.budgetTokens || 10000}
                            onChange={(e) => updateAI({ thinking: { type: 'enabled', budgetTokens: Number(e.target.value) } })}
                            min={1} placeholder="Token 预算"
                          />
                        </div>
                      )}
                    </div>
                  </label>
                  <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
                    <input type="radio" name="thinking" className="mt-0.5"
                      checked={local.ai.thinking.type === 'disabled'}
                      onChange={() => updateAI({ thinking: { type: 'disabled' } })}
                    />
                    <div>
                      <div className="text-sm font-medium">Disabled（禁用）</div>
                      <div className="text-xs text-muted-foreground">关闭扩展思考</div>
                    </div>
                  </label>
                </div>
              </div>

              {/* Effort 级别 */}
              <div className="space-y-3">
                <label className="text-sm font-medium">执行力度</label>
                <div className="inline-flex h-10 items-center justify-center rounded-md bg-muted p-1">
                  {EFFORT_OPTIONS.map(opt => (
                    <button key={opt.value}
                      className={cn(
                        'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-4 py-1.5 text-sm font-medium transition-all',
                        local.ai.effort === opt.value
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
            </div>
          </div>
        </TabsContent>

        {/* ── Tab: 工具权限 ── */}
        <TabsContent value="permissions" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <div className="max-w-2xl py-6 px-6">
            <h2 className="text-lg font-semibold mb-1">工具权限</h2>
            <p className="text-sm text-muted-foreground mb-6">管理 Agent 可使用的工具及其权限级别</p>

            <div className="mb-6">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">SDK 内置工具</h3>
              <div className="space-y-0">
                {SDK_TOOLS.map(renderToolRow)}
              </div>
            </div>

            <div>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">自定义工具</h3>
              <div className="space-y-0">
                {CUSTOM_TOOLS.map(renderToolRow)}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ── Tab: 模型方案 ── */}
        <TabsContent value="profiles" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <div className="max-w-2xl py-6 px-6">
            <h2 className="text-lg font-semibold mb-1">模型方案</h2>
            <p className="text-sm text-muted-foreground mb-6">管理 API 配置方案，切换不同的模型和服务地址</p>

            {/* 内层 Tabs：Profile 切换（浏览用，不等于 activeProfileId） */}
            <Tabs value={selectedProfileTab} onValueChange={setSelectedProfileTab}>
              <div className="flex items-center gap-2 mb-4">
                <TabsList className="flex-1">
                  {profileIds.map(id => (
                    <TabsTrigger key={id} value={id} className="gap-1.5">
                      {local.ai.activeProfileId === id && <Check className="w-3 h-3" />}
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
                const isActive = local.ai.activeProfileId === id;

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

                    {/* 底部操作 */}
                    <div className="flex items-center gap-2 pt-2">
                      {!isActive && (
                        <Button variant="outline" size="sm" onClick={() => activateProfile(id)}>
                          <Check className="w-4 h-4 mr-2" />
                          启用此方案
                        </Button>
                      )}
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
      </Tabs>
    </div>
  );
}
