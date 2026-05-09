import { useEffect, useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ArrowLeft, Plus, Trash2, Eye, EyeOff, AlertTriangle, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { client } from '@/lib/client';
import { useSettingsStore } from '@/stores/settings-store';
import { useUIStore } from '@/stores/ui-store';
import { useConfirmStore } from '@/stores/confirm-store';
import type { AppSettings, ModelProfile } from '@/types/settings';
import { DEFAULT_SETTINGS, BUILTIN_DEFAULT_SYSTEM_PROMPT, isProfileComplete } from '@/types/settings';
import { WorkspaceConfigTab } from './WorkspaceConfigTab';
import { WorkspaceManagementTab } from './WorkspaceManagementTab';
import { PersonaTab } from './PersonaTab';
import { AgentsTab } from './AgentsTab';
import { MemoryTab } from './MemoryTab';
import { ToolPacksTab } from './ToolPacksTab';
import { ArticleParseHistoryPanel } from '@/components/ArticleParseHistoryPanel';

// ═══ 常量 ═══════════════════════════════════════════

const EFFORT_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: '超高' },
  { value: 'max', label: 'Max' },
] as const;

const PERMISSION_MODE_OPTIONS = [
  { value: 'default', label: '标准', description: '危险操作需用户确认（推荐）' },
  { value: 'acceptEdits', label: '自动编辑', description: '文件编辑（Edit/Write）和 Bash 文件系统命令（mkdir/touch/rm/mv/cp/sed 等）自动通过，其余需确认' },
  { value: 'plan', label: '仅规划', description: '只规划不执行，工具调用被阻止' },
  { value: 'bypassPermissions', label: '自动执行', description: '⚠️ 跳过所有权限检查，仅在受控环境中使用' },
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
  // 内层 profile tab 选中状态（独立于 activeProfileId）
  const [selectedProfileTab, setSelectedProfileTab] = useState<string>('default');

  // 动态加载已注册的工具列表（按 server 分组）
  interface ToolInfo { name: string; description: string; server: string }
  interface ToolGroup { server: string; label: string; tools: ToolInfo[] }
  const [toolGroups, setToolGroups] = useState<ToolGroup[]>([]);
  useEffect(() => {
    client.getRegisteredTools().then((result: any) => {
      // 新格式：ToolGroup[]
      if (Array.isArray(result)) setToolGroups(result);
    }).catch(() => {});
  }, []);

  // 自定义工具在 SDK 中的实际名称格式：mcp__<server>__<name>
  // SDK 内置工具直接用短名称
  const toSdkToolName = (tool: ToolInfo): string =>
    tool.server === 'sdk' ? tool.name : `mcp__${tool.server}__${tool.name}`;

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
      closeSettings();
    }
    // null（点击遮罩/ESC）= 留在设置页
  };

  // ── 工具权限 helper ──

  /** 获取组级 SDK 权限名（如 'mcp__dogear-stock'） */
  const toServerKey = (server: string): string =>
    server === 'sdk' ? '' : `mcp__${server}`;

  /** 获取单个工具的有效权限（考虑组级规则） */
  const getToolPermission = (tool: ToolInfo): ToolPermission => {
    const toolKey = toSdkToolName(tool);
    const serverKey = toServerKey(tool.server);
    const rules = local.permissionRules;

    // 先查单个工具的规则
    if (rules?.allow?.includes(toolKey)) return 'allow';
    if (rules?.deny?.includes(toolKey)) return 'deny';

    // 再查组级规则（SDK 内置工具无组级规则）
    if (serverKey) {
      if (rules?.allow?.includes(serverKey)) return 'allow';
      if (rules?.deny?.includes(serverKey)) return 'deny';
    }

    return 'default';
  };

  /** 获取组级权限状态：如果有组级规则则返回对应状态，否则返回 'default' */
  const getGroupPermission = (group: ToolGroup): ToolPermission => {
    const serverKey = toServerKey(group.server);
    if (!serverKey) {
      // SDK 内置工具组：检查是否所有工具权限一致
      const perms = group.tools.map(t => getToolPermission(t));
      if (perms.every(p => p === 'allow')) return 'allow';
      if (perms.every(p => p === 'deny')) return 'deny';
      if (perms.every(p => p === 'default')) return 'default';
      return 'default'; // 混合状态
    }
    const rules = local.permissionRules;
    if (rules?.allow?.includes(serverKey)) return 'allow';
    if (rules?.deny?.includes(serverKey)) return 'deny';
    return 'default';
  };

  /** 检查组内是否有单个工具的独立规则（混合状态检测） */
  const hasIndividualRules = (group: ToolGroup): boolean => {
    const rules = local.permissionRules;
    if (!rules) return false;
    return group.tools.some(tool => {
      const key = toSdkToolName(tool);
      return rules.allow?.includes(key) || rules.deny?.includes(key);
    });
  };

  /** 设置单个工具的权限 */
  const setToolPermission = (tool: ToolInfo, perm: ToolPermission) => {
    const toolKey = toSdkToolName(tool);
    const serverKey = toServerKey(tool.server);
    const rules = local.permissionRules || { allow: [], deny: [] };
    let allow = (rules.allow || []).filter(t => t !== toolKey);
    let deny = (rules.deny || []).filter(t => t !== toolKey);

    // 如果存在组级规则，需要移除组级规则（因为现在子工具有独立状态了）
    if (serverKey) {
      allow = allow.filter(t => t !== serverKey);
      deny = deny.filter(t => t !== serverKey);
    }

    if (perm === 'allow') allow.push(toolKey);
    if (perm === 'deny') deny.push(toolKey);
    // perm === 'default' 时不写入任何规则

    setLocal(prev => ({ ...prev, permissionRules: { allow, deny } }));
  };

  /** 设置组级权限（整个 MCP Server） */
  const setGroupPermission = (group: ToolGroup, perm: ToolPermission) => {
    const serverKey = toServerKey(group.server);
    const rules = local.permissionRules || { allow: [], deny: [] };

    // 移除组内所有单个工具的规则
    const toolKeys = group.tools.map(t => toSdkToolName(t));
    let allow = (rules.allow || []).filter(t => !toolKeys.includes(t));
    let deny = (rules.deny || []).filter(t => !toolKeys.includes(t));

    if (serverKey) {
      // 自定义工具组：使用组级规则
      allow = allow.filter(t => t !== serverKey);
      deny = deny.filter(t => t !== serverKey);
      if (perm === 'allow') allow.push(serverKey);
      if (perm === 'deny') deny.push(serverKey);
    } else {
      // SDK 内置工具组：逐个设置（SDK 工具没有 server 级规则）
      if (perm === 'allow') {
        for (const key of toolKeys) allow.push(key);
      } else if (perm === 'deny') {
        for (const key of toolKeys) deny.push(key);
      }
      // perm === 'default' 时已经清理完毕
    }

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
  const renderToolRow = (tool: ToolInfo) => {
    const perm = getToolPermission(tool);
    return (
      <div key={toSdkToolName(tool)} className="flex items-center justify-between py-2 px-4">
        <div className="flex-1 min-w-0">
          <span className="text-sm font-mono">{tool.name}</span>
          <span className="text-xs text-muted-foreground ml-2">{tool.description}</span>
        </div>
        <div className="inline-flex h-7 items-center rounded-md bg-muted p-0.5 flex-shrink-0 ml-4">
          {([
            { value: 'allow' as const, label: '自动允许', color: 'text-green-700' },
            { value: 'default' as const, label: '需确认', color: 'text-foreground' },
            { value: 'deny' as const, label: '禁止', color: 'text-red-600' },
          ]).map(opt => (
            <button
              key={opt.value}
              className={cn(
                'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-2.5 py-1 text-xs font-medium transition-all',
                perm === opt.value
                  ? `bg-background ${opt.color} shadow-sm`
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={() => setToolPermission(tool, opt.value)}
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
            AI 行为
          </TabsTrigger>
          <TabsTrigger value="permissions" className="justify-start px-3 py-2 data-[state=active]:bg-background">
            工具权限
          </TabsTrigger>
          <TabsTrigger value="toolpacks" className="justify-start px-3 py-2 data-[state=active]:bg-background">
            工具包
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
          <TabsTrigger value="agents" className="justify-start px-3 py-2 data-[state=active]:bg-background">
            代理管理
          </TabsTrigger>
          <TabsTrigger value="parse-history" className="justify-start px-3 py-2 data-[state=active]:bg-background">
            解析历史
          </TabsTrigger>
        </TabsList>

        {/* ── Tab: AI 行为 ── */}
        <TabsContent value="behavior" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <div className="max-w-2xl py-6 px-6">
            <h2 className="text-lg font-semibold mb-1">AI 行为</h2>
            <p className="text-sm text-muted-foreground mb-6">配置 Agent 的思考模式、执行力度和权限策略</p>
            <div className="space-y-6">
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

              {/* 默认模型层级 */}
              <div className="space-y-2">
                <label className="text-sm font-medium">默认模型</label>
                <p className="text-xs text-muted-foreground">
                  注入 ANTHROPIC_MODEL 环境变量，决定 CLI 的默认模型层级。不指定时由 SDK 决定。
                </p>
                <select
                  className="h-9 w-full px-3 text-sm border rounded bg-background"
                  value={local.ai.defaultModelTier || ''}
                  onChange={(e) => updateAI({
                    defaultModelTier: e.target.value ? e.target.value as 'haiku' | 'sonnet' | 'opus' : undefined
                  })}
                >
                  <option value="">不指定</option>
                  <option value="haiku">Haiku</option>
                  <option value="sonnet">Sonnet</option>
                  <option value="opus">Opus</option>
                </select>
              </div>

              {/* 子代理模型层级 */}
              <div className="space-y-2">
                <label className="text-sm font-medium">子代理模型</label>
                <p className="text-xs text-muted-foreground">
                  注入 CLAUDE_CODE_SUBAGENT_MODEL 环境变量，决定 Task 工具启动的子代理用哪一层。
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
          </div>
        </TabsContent>

        {/* ── Tab: 工具权限 ── */}
        <TabsContent value="permissions" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <div className="max-w-2xl py-6 px-6">
            <h2 className="text-lg font-semibold mb-1">工具权限</h2>
            <p className="text-sm text-muted-foreground mb-6">管理 Agent 可使用的工具及其权限级别。可按分组整体控制，也可单独设置每个工具。</p>

            <div className="space-y-6">
              {toolGroups.map(group => {
                const groupPerm = getGroupPermission(group);
                const hasMixed = hasIndividualRules(group) && toServerKey(group.server) !== '';
                return (
                  <div key={group.server} className="border rounded-lg overflow-hidden">
                    {/* 分组标题 + 组级三态按钮 */}
                    <div className="flex items-center justify-between px-4 py-3 bg-muted/30">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold">{group.label}</h3>
                        <span className="text-xs text-muted-foreground">({group.tools.length})</span>
                      </div>
                      <div className="inline-flex h-8 items-center rounded-md bg-muted p-0.5 flex-shrink-0">
                        {([
                          { value: 'allow' as const, label: '全部允许', color: 'text-green-700' },
                          { value: 'default' as const, label: '需确认', color: 'text-foreground' },
                          { value: 'deny' as const, label: '全部禁止', color: 'text-red-600' },
                        ]).map(opt => (
                          <button
                            key={opt.value}
                            className={cn(
                              'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1 text-xs font-medium transition-all',
                              groupPerm === opt.value && !hasMixed
                                ? `bg-background ${opt.color} shadow-sm`
                                : 'text-muted-foreground hover:text-foreground'
                            )}
                            onClick={() => setGroupPermission(group, opt.value)}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* 组内工具列表 */}
                    <div className="divide-y">
                      {group.tools.map(renderToolRow)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </TabsContent>

        {/* ── Tab: 工具包 ── */}
        <TabsContent value="toolpacks" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <ToolPacksTab local={local} setLocal={setLocal} />
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

        {/* ── Tab: 代理管理 ── */}
        <TabsContent value="agents" className="flex-1 overflow-hidden mt-0 p-0 data-[state=inactive]:hidden">
          <AgentsTab />
        </TabsContent>

        {/* ── Tab: 解析历史 ── */}
        <TabsContent value="parse-history" className="flex-1 overflow-y-auto mt-0 p-0 data-[state=inactive]:hidden">
          <ArticleParseHistoryPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
