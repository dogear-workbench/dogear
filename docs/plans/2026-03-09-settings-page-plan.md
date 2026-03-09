# AI 设置页面 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 新增全局 AI 设置页面，支持 Thinking/Effort 配置和多套模型方案（Profile）切换，持久化为 JSON 文件。

**Architecture:** 全局 settings.json 存储在 Electron userData 目录。主进程 settings-service 负责读写，tipc 路由暴露给渲染层。前端 Zustand store 管理状态，独立路由页面 `/settings` 提供 UI。创建 Agent 会话时从 settings 读取配置注入。

**Tech Stack:** Electron (app.getPath), @egoist/tipc, Zustand 5, Next.js app router, shadcn/ui (Card, Tabs, Button), lucide-react, Tailwind CSS

---

### Task 1: 类型定义

**Files:**
- Create: `types/settings.ts`

**Step 1: 创建设置类型文件**

```typescript
// types/settings.ts

export interface ThinkingConfig {
  type: 'adaptive' | 'enabled' | 'disabled';
  budgetTokens?: number; // 仅 type='enabled' 时有效
}

export interface ModelProfile {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface AppSettings {
  ai: {
    thinking: ThinkingConfig;
    effort: 'low' | 'medium' | 'high' | 'max';
    activeProfileId: string;
  };
  profiles: Record<string, ModelProfile>;
}

export const DEFAULT_SETTINGS: AppSettings = {
  ai: {
    thinking: { type: 'adaptive' },
    effort: 'high',
    activeProfileId: 'default',
  },
  profiles: {
    default: {
      id: 'default',
      name: '默认',
      apiKey: '',
      baseUrl: '',
      model: 'claude-sonnet-4-6',
    },
  },
};
```

**Step 2: 提交**

```bash
git add types/settings.ts
git commit -m "feat: 新增 AI 设置类型定义（ThinkingConfig, ModelProfile, AppSettings）"
```

---

### Task 2: 设置读写服务

**Files:**
- Create: `electron/main/services/settings-service.ts`

**Step 1: 创建 settings-service**

此服务负责从 `app.getPath('userData')/settings.json` 读写设置。

```typescript
// electron/main/services/settings-service.ts
import fs from 'fs';
import path from 'path';
import electron from 'electron';
const { app } = electron;

// 类型在主进程中需要内联定义（主进程不能导入 types/ 别名路径）
// 与 types/settings.ts 保持一致
export interface ThinkingConfig {
  type: 'adaptive' | 'enabled' | 'disabled';
  budgetTokens?: number;
}

export interface ModelProfile {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface AppSettings {
  ai: {
    thinking: ThinkingConfig;
    effort: 'low' | 'medium' | 'high' | 'max';
    activeProfileId: string;
  };
  profiles: Record<string, ModelProfile>;
}

const DEFAULT_SETTINGS: AppSettings = {
  ai: {
    thinking: { type: 'adaptive' },
    effort: 'high',
    activeProfileId: 'default',
  },
  profiles: {
    default: {
      id: 'default',
      name: '默认',
      apiKey: '',
      baseUrl: '',
      model: 'claude-sonnet-4-6',
    },
  },
};

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json');
}

/**
 * 读取设置。文件不存在则返回默认值。
 */
export function loadSettings(): AppSettings {
  const filePath = getSettingsPath();
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      // 与默认值深度合并，确保新增字段有默认值
      return deepMerge(DEFAULT_SETTINGS, parsed);
    }
  } catch (error) {
    console.error('读取设置文件失败:', error);
  }
  return structuredClone(DEFAULT_SETTINGS);
}

/**
 * 保存设置到 JSON 文件。
 */
export function saveSettings(settings: AppSettings): void {
  const filePath = getSettingsPath();
  try {
    fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8');
  } catch (error) {
    console.error('保存设置文件失败:', error);
    throw error;
  }
}

/**
 * 获取当前激活的 Profile。
 */
export function getActiveProfile(settings: AppSettings): ModelProfile {
  const profile = settings.profiles[settings.ai.activeProfileId];
  return profile || settings.profiles['default'] || Object.values(settings.profiles)[0];
}

/**
 * 简单的深度合并：以 defaults 为基础，用 override 覆盖存在的字段。
 */
function deepMerge<T extends Record<string, any>>(defaults: T, override: Partial<T>): T {
  const result = { ...defaults };
  for (const key of Object.keys(override) as (keyof T)[]) {
    const val = override[key];
    if (val !== undefined && val !== null && typeof val === 'object' && !Array.isArray(val)
        && typeof result[key] === 'object' && !Array.isArray(result[key])) {
      result[key] = deepMerge(result[key] as any, val as any);
    } else if (val !== undefined) {
      result[key] = val as T[keyof T];
    }
  }
  return result;
}
```

注意：主进程用 `electron/main/` 下的相对路径，不能用 `@/types/` 别名（那是前端 tsconfig 的）。所以类型在 service 内部重复定义一份。

**Step 2: 提交**

```bash
git add electron/main/services/settings-service.ts
git commit -m "feat: 新增 settings-service，JSON 文件读写 + 深度合并默认值"
```

---

### Task 3: IPC 路由

**Files:**
- Create: `electron/main/tipc/settings.ts`
- Modify: `electron/main/tipc/index.ts`

**Step 1: 创建 settings tipc 路由**

```typescript
// electron/main/tipc/settings.ts
import { tipc } from '@egoist/tipc/main';
import { loadSettings, saveSettings } from '../services/settings-service.js';
import type { AppSettings } from '../services/settings-service.js';

const t = tipc.create();

export const settingsRouter = {
  getSettings: t.procedure
    .action(async () => {
      try {
        return { settings: loadSettings() };
      } catch (error) {
        console.error('获取设置失败:', error);
        return { settings: null, error: String(error) };
      }
    }),

  updateSettings: t.procedure
    .input<{ settings: AppSettings }>()
    .action(async ({ input }) => {
      try {
        saveSettings(input.settings);
        return { success: true };
      } catch (error) {
        console.error('保存设置失败:', error);
        return { success: false, error: String(error) };
      }
    }),
};
```

**Step 2: 在 index.ts 中注册路由**

修改 `electron/main/tipc/index.ts`：

```typescript
// 新增 import
import { settingsRouter } from './settings.js';

// 在 router 中新增
export const router = {
  ...dbRouter,
  ...bookRouter,
  ...aiRouter,
  ...fileRouter,
  ...workspaceRouter,
  ...agentRouter,
  ...conversationsRouter,
  ...articleRouter,
  ...explorerRouter,
  ...settingsRouter,  // 新增
};
```

**Step 3: 提交**

```bash
git add electron/main/tipc/settings.ts electron/main/tipc/index.ts
git commit -m "feat: 新增 settings IPC 路由（getSettings / updateSettings）"
```

---

### Task 4: 前端 Zustand Store

**Files:**
- Create: `stores/settings-store.ts`

**Step 1: 创建 settings store**

```typescript
// stores/settings-store.ts
import { create } from 'zustand';
import { client } from '@/lib/client';
import type { AppSettings, ThinkingConfig, ModelProfile } from '@/types/settings';
import { DEFAULT_SETTINGS } from '@/types/settings';
import { v4 as uuidv4 } from 'uuid';

interface SettingsState {
  settings: AppSettings;
  loaded: boolean;

  // 加载设置
  loadSettings: () => Promise<void>;
  // 保存并同步到主进程
  saveSettings: (settings: AppSettings) => Promise<void>;

  // AI 行为
  setThinking: (thinking: ThinkingConfig) => Promise<void>;
  setEffort: (effort: AppSettings['ai']['effort']) => Promise<void>;

  // Profile 方案管理
  setActiveProfile: (profileId: string) => Promise<void>;
  addProfile: (name: string) => Promise<string>;  // 返回新 profile ID
  updateProfile: (profileId: string, updates: Partial<ModelProfile>) => Promise<void>;
  deleteProfile: (profileId: string) => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  loadSettings: async () => {
    const result = await client.getSettings();
    if (result.settings) {
      set({ settings: result.settings, loaded: true });
    }
  },

  saveSettings: async (settings: AppSettings) => {
    set({ settings });
    await client.updateSettings({ settings });
  },

  setThinking: async (thinking) => {
    const { settings, saveSettings } = get();
    await saveSettings({ ...settings, ai: { ...settings.ai, thinking } });
  },

  setEffort: async (effort) => {
    const { settings, saveSettings } = get();
    await saveSettings({ ...settings, ai: { ...settings.ai, effort } });
  },

  setActiveProfile: async (profileId) => {
    const { settings, saveSettings } = get();
    if (!settings.profiles[profileId]) return;
    await saveSettings({ ...settings, ai: { ...settings.ai, activeProfileId: profileId } });
  },

  addProfile: async (name) => {
    const { settings, saveSettings } = get();
    const id = uuidv4();
    const newProfile: ModelProfile = { id, name, apiKey: '', baseUrl: '', model: 'claude-sonnet-4-6' };
    const newProfiles = { ...settings.profiles, [id]: newProfile };
    await saveSettings({ ...settings, profiles: newProfiles, ai: { ...settings.ai, activeProfileId: id } });
    return id;
  },

  updateProfile: async (profileId, updates) => {
    const { settings, saveSettings } = get();
    const existing = settings.profiles[profileId];
    if (!existing) return;
    const updated = { ...existing, ...updates };
    const newProfiles = { ...settings.profiles, [profileId]: updated };
    await saveSettings({ ...settings, profiles: newProfiles });
  },

  deleteProfile: async (profileId) => {
    if (profileId === 'default') return; // default 不可删
    const { settings, saveSettings } = get();
    const { [profileId]: _, ...rest } = settings.profiles;
    const activeId = settings.ai.activeProfileId === profileId ? 'default' : settings.ai.activeProfileId;
    await saveSettings({ ...settings, profiles: rest, ai: { ...settings.ai, activeProfileId: activeId } });
  },
}));
```

**Step 2: 提交**

```bash
git add stores/settings-store.ts
git commit -m "feat: 新增 settings-store（Zustand），管理 AI 设置和方案切换"
```

---

### Task 5: 设置页面 UI

**Files:**
- Create: `app/settings/page.tsx`

**Step 1: 先安装 shadcn/ui 的 input、label、radio-group 组件（如果没有）**

```bash
npx shadcn@latest add input label radio-group separator
```

注：如果某些组件已存在，shadcn 会跳过。如果 shadcn 安装有问题，直接手写简单的 input/label 即可。

**Step 2: 创建设置页面**

创建 `app/settings/page.tsx`，包含：

1. 顶部导航栏（返回按钮 + 标题）
2. AI 行为卡片：Thinking 模式（RadioGroup）+ Effort 级别（按钮组）
3. 模型方案卡片：Tab 切换方案 + 编辑表单 + 新建/删除

完整代码：

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { ArrowLeft, Plus, Trash2, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings-store';
import type { ThinkingConfig } from '@/types/settings';

export default function SettingsPage() {
  const router = useRouter();
  const {
    settings, loaded, loadSettings,
    setThinking, setEffort, setActiveProfile,
    addProfile, updateProfile, deleteProfile,
  } = useSettingsStore();

  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({});
  const [budgetTokens, setBudgetTokens] = useState<string>(
    String(settings.ai.thinking.budgetTokens || 10000)
  );

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // 同步 budgetTokens 输入框
  useEffect(() => {
    if (settings.ai.thinking.type === 'enabled') {
      setBudgetTokens(String(settings.ai.thinking.budgetTokens || 10000));
    }
  }, [settings.ai.thinking]);

  if (!loaded) {
    return <div className="h-screen flex items-center justify-center text-muted-foreground">加载设置中...</div>;
  }

  const activeProfileId = settings.ai.activeProfileId;
  const profiles = Object.values(settings.profiles);

  const handleThinkingChange = (type: ThinkingConfig['type']) => {
    if (type === 'enabled') {
      setThinking({ type: 'enabled', budgetTokens: parseInt(budgetTokens) || 10000 });
    } else {
      setThinking({ type });
    }
  };

  const handleBudgetTokensBlur = () => {
    const val = parseInt(budgetTokens) || 10000;
    setBudgetTokens(String(val));
    if (settings.ai.thinking.type === 'enabled') {
      setThinking({ type: 'enabled', budgetTokens: val });
    }
  };

  const handleAddProfile = async () => {
    await addProfile('新方案');
  };

  return (
    <main className="h-screen flex flex-col">
      {/* 顶部导航 */}
      <header className="h-12 border-b flex items-center px-4 bg-background gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push('/')}>
          <ArrowLeft className="w-4 h-4 mr-1" />
          返回
        </Button>
        <h1 className="font-semibold">设置</h1>
      </header>

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto p-6 max-w-2xl mx-auto w-full space-y-6">

        {/* AI 行为 */}
        <Card>
          <CardHeader>
            <CardTitle>AI 行为</CardTitle>
            <CardDescription>控制 Claude 的思考和推理行为</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Thinking 模式 */}
            <div className="space-y-3">
              <label className="text-sm font-medium">Thinking 模式</label>
              <div className="space-y-2">
                {([
                  { value: 'adaptive', label: 'Adaptive（自适应）', desc: 'Claude 自主决定何时思考及深度（推荐）' },
                  { value: 'enabled', label: 'Enabled（固定预算）', desc: '指定固定的思考 token 预算' },
                  { value: 'disabled', label: 'Disabled（禁用）', desc: '关闭扩展思考' },
                ] as const).map(({ value, label, desc }) => (
                  <label key={value} className="flex items-start gap-3 p-2 rounded hover:bg-muted/50 cursor-pointer">
                    <input
                      type="radio"
                      name="thinking"
                      value={value}
                      checked={settings.ai.thinking.type === value}
                      onChange={() => handleThinkingChange(value)}
                      className="mt-1"
                    />
                    <div>
                      <div className="text-sm font-medium">{label}</div>
                      <div className="text-xs text-muted-foreground">{desc}</div>
                      {value === 'enabled' && settings.ai.thinking.type === 'enabled' && (
                        <div className="mt-2 flex items-center gap-2">
                          <input
                            type="number"
                            value={budgetTokens}
                            onChange={(e) => setBudgetTokens(e.target.value)}
                            onBlur={handleBudgetTokensBlur}
                            className="h-8 w-32 px-2 text-sm border rounded bg-background"
                            min={1000}
                            step={1000}
                          />
                          <span className="text-xs text-muted-foreground">tokens</span>
                        </div>
                      )}
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {/* Effort 级别 */}
            <div className="space-y-3">
              <label className="text-sm font-medium">Effort 级别</label>
              <p className="text-xs text-muted-foreground">控制推理深度，与 Thinking 配合使用</p>
              <div className="flex gap-1 bg-muted p-1 rounded-md">
                {(['low', 'medium', 'high', 'max'] as const).map((level) => (
                  <button
                    key={level}
                    onClick={() => setEffort(level)}
                    className={cn(
                      'flex-1 px-3 py-1.5 text-sm font-medium rounded-sm transition-all capitalize',
                      settings.ai.effort === level
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 模型方案 */}
        <Card>
          <CardHeader>
            <CardTitle>模型方案</CardTitle>
            <CardDescription>管理多套 API 配置，快速切换</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs
              value={activeProfileId}
              onValueChange={(id) => setActiveProfile(id)}
            >
              <div className="flex items-center gap-2 mb-4">
                <TabsList className="flex-1">
                  {profiles.map((p) => (
                    <TabsTrigger key={p.id} value={p.id} className="flex-1">
                      {p.name}
                    </TabsTrigger>
                  ))}
                </TabsList>
                <Button variant="outline" size="sm" onClick={handleAddProfile}>
                  <Plus className="w-4 h-4" />
                </Button>
              </div>

              {profiles.map((profile) => (
                <TabsContent key={profile.id} value={profile.id} className="space-y-4">
                  {/* 方案名称 */}
                  <div className="space-y-1">
                    <label className="text-sm font-medium">方案名称</label>
                    <input
                      type="text"
                      value={profile.name}
                      onChange={(e) => updateProfile(profile.id, { name: e.target.value })}
                      className="w-full h-9 px-3 text-sm border rounded bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>

                  {/* API Key */}
                  <div className="space-y-1">
                    <label className="text-sm font-medium">API Key</label>
                    <div className="flex gap-2">
                      <input
                        type={showApiKey[profile.id] ? 'text' : 'password'}
                        value={profile.apiKey}
                        onChange={(e) => updateProfile(profile.id, { apiKey: e.target.value })}
                        placeholder="留空则使用 .env 中的值"
                        className="flex-1 h-9 px-3 text-sm border rounded bg-background focus:outline-none focus:ring-1 focus:ring-ring font-mono"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setShowApiKey(prev => ({ ...prev, [profile.id]: !prev[profile.id] }))}
                      >
                        {showApiKey[profile.id] ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>

                  {/* Base URL */}
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Base URL</label>
                    <input
                      type="text"
                      value={profile.baseUrl}
                      onChange={(e) => updateProfile(profile.id, { baseUrl: e.target.value })}
                      placeholder="留空则使用 .env 中的值"
                      className="w-full h-9 px-3 text-sm border rounded bg-background focus:outline-none focus:ring-1 focus:ring-ring font-mono"
                    />
                  </div>

                  {/* 模型 */}
                  <div className="space-y-1">
                    <label className="text-sm font-medium">模型</label>
                    <input
                      type="text"
                      value={profile.model}
                      onChange={(e) => updateProfile(profile.id, { model: e.target.value })}
                      placeholder="如 claude-opus-4-6"
                      className="w-full h-9 px-3 text-sm border rounded bg-background focus:outline-none focus:ring-1 focus:ring-ring font-mono"
                    />
                  </div>

                  {/* 删除按钮 */}
                  {profile.id !== 'default' && (
                    <div className="flex justify-end pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => deleteProfile(profile.id)}
                      >
                        <Trash2 className="w-4 h-4 mr-1" />
                        删除方案
                      </Button>
                    </div>
                  )}
                </TabsContent>
              ))}
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
```

**Step 3: 提交**

```bash
git add app/settings/page.tsx
git commit -m "feat: 新增 AI 设置页面（Thinking/Effort + 模型方案管理）"
```

---

### Task 6: 主页面添加设置入口

**Files:**
- Modify: `app/page.tsx`

**Step 1: 在 header 右侧按钮区添加设置按钮**

在 `app/page.tsx` 的 header 中，Agent 监控按钮旁边添加：

```tsx
import { Settings } from 'lucide-react';
import { useRouter } from 'next/navigation';

// 在组件内部
const router = useRouter();

// 在 header 的按钮区域，Agent 监控按钮前面添加：
<Button variant="outline" size="sm" onClick={() => router.push('/settings')}>
  <Settings className="w-4 h-4 mr-2" />
  设置
</Button>
```

**Step 2: 提交**

```bash
git add app/page.tsx
git commit -m "feat: 主页面 header 添加设置入口按钮"
```

---

### Task 7: Agent 会话注入设置

**Files:**
- Modify: `electron/main/agents/query-based-session.ts`

**Step 1: 在创建 query 时读取 settings 并注入**

修改 `query-based-session.ts` 中 `startSession()` 方法，在构建 `queryOptions` 时注入 settings：

```typescript
// 在文件顶部新增 import
import { loadSettings, getActiveProfile } from '../services/settings-service.js';

// 在 startSession() 方法中，构建 queryOptions 之后、配置 env 之前，插入：

// ---- 从 settings.json 读取配置 ----
const appSettings = loadSettings();
const activeProfile = getActiveProfile(appSettings);

// 注入 thinking 和 effort
queryOptions.thinking = appSettings.ai.thinking;
queryOptions.effort = appSettings.ai.effort;

// ...（原有 env 配置代码）

// 在 queryOptions.env = { ...process.env, CLAUDE_CONFIG_DIR: claudeConfigDir } 之后，
// 用 activeProfile 中的非空值覆盖：
if (activeProfile.apiKey) {
  queryOptions.env.ANTHROPIC_AUTH_TOKEN = activeProfile.apiKey;
}
if (activeProfile.baseUrl) {
  queryOptions.env.ANTHROPIC_BASE_URL = activeProfile.baseUrl;
}

// 注入模型（如果 profile 中指定了）
if (activeProfile.model) {
  queryOptions.model = activeProfile.model;
}
```

需要**删除**原来硬编码的 `thinking: { type: 'adaptive' }`（第 145 行）。

**Step 2: 提交**

```bash
git add electron/main/agents/query-based-session.ts
git commit -m "feat: Agent 会话创建时从 settings.json 注入 AI 配置和模型方案"
```

---

### Task 8: 验证和测试

**Step 1: 启动应用**

```bash
npm run dev
```

**Step 2: 手动验证清单**

- [ ] 主页面 header 出现"设置"按钮
- [ ] 点击设置按钮导航到 `/settings` 页面
- [ ] 设置页面正确加载默认配置
- [ ] 修改 Thinking 模式能即时保存（刷新后仍保持）
- [ ] 修改 Effort 级别能即时保存
- [ ] 新建模型方案成功
- [ ] 切换方案标签页会激活该方案
- [ ] 编辑方案名称/API Key/Base URL/模型能保存
- [ ] 删除非 default 方案成功
- [ ] 返回按钮能回到主页面
- [ ] 创建新对话时 Agent 使用设置中的配置

**Step 3: 提交最终状态**

修复验证中发现的任何问题后提交。
