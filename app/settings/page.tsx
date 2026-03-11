import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ArrowLeft, Plus, Trash2, Eye, EyeOff, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings-store';
import type { ThinkingConfig } from '@/types/settings';
import { isProfileComplete } from '@/types/settings';

const EFFORT_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'max', label: 'Max' },
] as const;

export default function SettingsPage() {
  const navigate = useNavigate();
  const settings = useSettingsStore((s) => s.settings);
  const loaded = useSettingsStore((s) => s.loaded);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const setThinking = useSettingsStore((s) => s.setThinking);
  const setEffort = useSettingsStore((s) => s.setEffort);
  const setActiveProfile = useSettingsStore((s) => s.setActiveProfile);
  const updateProfile = useSettingsStore((s) => s.updateProfile);
  const addProfile = useSettingsStore((s) => s.addProfile);
  const deleteProfile = useSettingsStore((s) => s.deleteProfile);

  // API Key 显示/隐藏状态
  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({});
  // budgetTokens 使用本地 state，onBlur 时保存
  const [budgetTokens, setBudgetTokens] = useState<number>(0);

  // 加载设置
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // 同步 budgetTokens 本地 state
  useEffect(() => {
    if (settings?.ai.thinking.budgetTokens !== undefined) {
      setBudgetTokens(settings.ai.thinking.budgetTokens);
    }
  }, [settings?.ai.thinking.budgetTokens]);

  // 切换 API Key 可见性
  const toggleApiKeyVisibility = (profileId: string) => {
    setShowApiKey((prev) => ({ ...prev, [profileId]: !prev[profileId] }));
  };

  // 处理 Thinking 模式切换
  const handleThinkingChange = (type: ThinkingConfig['type']) => {
    if (type === 'enabled') {
      setThinking({ type, budgetTokens: budgetTokens || 10000 });
      if (!budgetTokens) setBudgetTokens(10000);
    } else {
      setThinking({ type });
    }
  };

  // 处理 budgetTokens 失焦保存
  const handleBudgetBlur = () => {
    if (settings?.ai.thinking.type === 'enabled') {
      setThinking({ type: 'enabled', budgetTokens });
    }
  };

  if (!loaded) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground mx-auto mb-3"></div>
          <p className="text-sm text-muted-foreground">加载设置...</p>
        </div>
      </div>
    );
  }

  if (!settings) return null;

  const profiles = settings.profiles;
  const profileIds = Object.keys(profiles);

  const inputClassName = "h-9 w-full px-3 text-sm border rounded-md bg-background focus:outline-none focus:ring-1 focus:ring-ring";

  return (
    <div className="h-screen flex flex-col">
      {/* 顶部导航栏 */}
      <header className="h-12 border-b flex items-center px-4 gap-3 bg-background">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <h1 className="font-semibold">设置</h1>
      </header>

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto py-6 px-4 space-y-6">
          {/* 卡片 1：AI 行为 */}
          <Card>
            <CardHeader>
              <CardTitle>AI 行为</CardTitle>
              <CardDescription>配置 AI 的思考模式和执行力度</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Thinking 模式 */}
              <div className="space-y-3">
                <label className="text-sm font-medium">Thinking 模式</label>
                <div className="space-y-2">
                  {/* Adaptive */}
                  <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
                    <input
                      type="radio"
                      name="thinking"
                      className="mt-0.5"
                      checked={settings.ai.thinking.type === 'adaptive'}
                      onChange={() => handleThinkingChange('adaptive')}
                    />
                    <div>
                      <div className="text-sm font-medium">Adaptive（自适应）</div>
                      <div className="text-xs text-muted-foreground">
                        Claude 自主决定何时思考及深度（推荐）
                      </div>
                    </div>
                  </label>

                  {/* Enabled */}
                  <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
                    <input
                      type="radio"
                      name="thinking"
                      className="mt-0.5"
                      checked={settings.ai.thinking.type === 'enabled'}
                      onChange={() => handleThinkingChange('enabled')}
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium">Enabled（固定预算）</div>
                      <div className="text-xs text-muted-foreground">
                        指定固定的思考 token 预算
                      </div>
                      {settings.ai.thinking.type === 'enabled' && (
                        <div className="mt-2">
                          <input
                            type="number"
                            className="h-8 w-40 px-2 text-sm border rounded bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                            value={budgetTokens}
                            onChange={(e) => setBudgetTokens(Number(e.target.value))}
                            onBlur={handleBudgetBlur}
                            min={1}
                            placeholder="Token 预算"
                          />
                        </div>
                      )}
                    </div>
                  </label>

                  {/* Disabled */}
                  <label className="flex items-start gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
                    <input
                      type="radio"
                      name="thinking"
                      className="mt-0.5"
                      checked={settings.ai.thinking.type === 'disabled'}
                      onChange={() => handleThinkingChange('disabled')}
                    />
                    <div>
                      <div className="text-sm font-medium">Disabled（禁用）</div>
                      <div className="text-xs text-muted-foreground">
                        关闭扩展思考
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              {/* Effort 级别 */}
              <div className="space-y-3">
                <label className="text-sm font-medium">Effort 级别</label>
                <div className="inline-flex h-10 items-center justify-center rounded-md bg-muted p-1">
                  {EFFORT_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      className={cn(
                        'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-4 py-1.5 text-sm font-medium transition-all',
                        settings.ai.effort === option.value
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                      onClick={() => setEffort(option.value)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 卡片 2：模型方案 */}
          <Card>
            <CardHeader>
              <CardTitle>模型方案</CardTitle>
              <CardDescription>管理 API 密钥和模型配置</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs
                value={settings.ai.activeProfileId}
                onValueChange={setActiveProfile}
              >
                <div className="flex items-center gap-2">
                  <TabsList className="flex-1">
                    {profileIds.map((id) => (
                      <TabsTrigger key={id} value={id}>
                        {profiles[id].name}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={addProfile}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>

                {profileIds.map((id) => {
                  const profile = profiles[id];
                  const isDefault = id === 'default';
                  const keyVisible = showApiKey[id] ?? false;
                  const profileComplete = isProfileComplete(profile);

                  return (
                    <TabsContent key={id} value={id} className="space-y-4 pt-2">
                      {/* 配置完整性警告 */}
                      {!profileComplete && (
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-200 text-sm">
                          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                          请完成所有必填字段后才能使用对话功能
                        </div>
                      )}

                      {/* 方案名称 */}
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">方案名称</label>
                        <input
                          type="text"
                          className={inputClassName}
                          value={profile.name}
                          onChange={(e) => updateProfile(id, { name: e.target.value })}
                        />
                      </div>

                      {/* API Key（必填） */}
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">
                          API Key <span className="text-destructive">*</span>
                        </label>
                        <div className="relative">
                          <input
                            type={keyVisible ? 'text' : 'password'}
                            className={cn(inputClassName, 'pr-10')}
                            value={profile.apiKey}
                            onChange={(e) => updateProfile(id, { apiKey: e.target.value })}
                            placeholder="输入 API Key"
                          />
                          <button
                            type="button"
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            onClick={() => toggleApiKeyVisibility(id)}
                          >
                            {keyVisible ? (
                              <EyeOff className="w-4 h-4" />
                            ) : (
                              <Eye className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Base URL（必填） */}
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">
                          Base URL <span className="text-destructive">*</span>
                        </label>
                        <input
                          type="text"
                          className={inputClassName}
                          value={profile.baseUrl}
                          onChange={(e) => updateProfile(id, { baseUrl: e.target.value })}
                          placeholder="如 https://api.anthropic.com"
                        />
                      </div>

                      {/* 模型映射（三个，必填） */}
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">
                          Haiku 模型 <span className="text-destructive">*</span>
                        </label>
                        <input
                          type="text"
                          className={inputClassName}
                          value={profile.haikuModel}
                          onChange={(e) => updateProfile(id, { haikuModel: e.target.value })}
                          placeholder="如 claude-haiku-4-5"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">
                          Sonnet 模型 <span className="text-destructive">*</span>
                        </label>
                        <input
                          type="text"
                          className={inputClassName}
                          value={profile.sonnetModel}
                          onChange={(e) => updateProfile(id, { sonnetModel: e.target.value })}
                          placeholder="如 claude-sonnet-4-6"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">
                          Opus 模型 <span className="text-destructive">*</span>
                        </label>
                        <input
                          type="text"
                          className={inputClassName}
                          value={profile.opusModel}
                          onChange={(e) => updateProfile(id, { opusModel: e.target.value })}
                          placeholder="如 claude-opus-4-6"
                        />
                      </div>

                      {/* API 超时时间 */}
                      <div className="space-y-1.5">
                        <label className="text-sm font-medium">API 超时时间（毫秒）</label>
                        <input
                          type="number"
                          className={inputClassName}
                          value={profile.apiTimeoutMs}
                          onChange={(e) => updateProfile(id, { apiTimeoutMs: Number(e.target.value) })}
                          min={1000}
                        />
                      </div>

                      {/* 禁用非必要流量 */}
                      <div className="flex items-center justify-between">
                        <div>
                          <label className="text-sm font-medium">禁用非必要流量</label>
                          <p className="text-xs text-muted-foreground">关闭 SDK 的非必要网络请求</p>
                        </div>
                        <button
                          type="button"
                          className={cn(
                            "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                            profile.disableNonessentialTraffic ? "bg-primary" : "bg-muted"
                          )}
                          onClick={() => updateProfile(id, { disableNonessentialTraffic: !profile.disableNonessentialTraffic })}
                        >
                          <span className={cn(
                            "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                            profile.disableNonessentialTraffic ? "translate-x-6" : "translate-x-1"
                          )} />
                        </button>
                      </div>

                      {/* 删除按钮（非默认方案才显示） */}
                      {!isDefault && (
                        <div className="pt-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => deleteProfile(id)}
                          >
                            <Trash2 className="w-4 h-4 mr-2" />
                            删除此方案
                          </Button>
                        </div>
                      )}
                    </TabsContent>
                  );
                })}
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
