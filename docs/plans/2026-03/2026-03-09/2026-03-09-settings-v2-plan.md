# 设置系统 V2：移除 .env 依赖，完善模型方案配置

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将所有 API 配置从 .env 文件迁移到设置页面的方案（Profile）中管理，Profile 中添加模型映射和高级配置字段，settings.json 存储到项目目录下的 `.dogear/` 文件夹。

**Architecture:** 完全移除 dotenv 依赖，settings.json 成为唯一配置源。Profile 必须配置完整（API Key + Base URL + 三个模型映射）才能创建会话。query-based-session 的 env 完全从 Profile 构建，不再继承 process.env。

**Tech Stack:** TypeScript, Zustand 5, @egoist/tipc, Electron, Next.js 16

---

### Task 1: 更新 ModelProfile 类型定义

**Files:**
- Modify: `types/settings.ts`

**Step 1: 修改 ModelProfile 接口**

将 `types/settings.ts` 修改为：

```typescript
export interface ThinkingConfig {
  type: 'adaptive' | 'enabled' | 'disabled';
  budgetTokens?: number; // 仅 type='enabled' 时有效
}

export interface ModelProfile {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  // 模型映射（对应 SDK 环境变量）
  haikuModel: string;    // ANTHROPIC_DEFAULT_HAIKU_MODEL
  sonnetModel: string;   // ANTHROPIC_DEFAULT_SONNET_MODEL
  opusModel: string;     // ANTHROPIC_DEFAULT_OPUS_MODEL
  // 高级配置
  apiTimeoutMs: number;                // API_TIMEOUT_MS，默认 3000000
  disableNonessentialTraffic: boolean; // CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC，默认 true
}

/**
 * 检查 Profile 是否配置完整（可以用于创建会话）
 */
export function isProfileComplete(profile: ModelProfile): boolean {
  return !!(
    profile.apiKey &&
    profile.baseUrl &&
    profile.haikuModel &&
    profile.sonnetModel &&
    profile.opusModel
  );
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
      haikuModel: '',
      sonnetModel: '',
      opusModel: '',
      apiTimeoutMs: 3000000,
      disableNonessentialTraffic: true,
    },
  },
};
```

**Step 2: 验证类型编译**

运行: `npx tsc --noEmit -p tsconfig.json 2>&1 | head -30`

预期: 会有错误（其他文件引用了旧的 `model` 字段），这是正常的，后续步骤会修复。

**Step 3: Commit**

```bash
git add types/settings.ts
git commit -m "refactor: 更新 ModelProfile 类型，移除 model 字段，添加模型映射和高级配置"
```

---

### Task 2: 更新 settings-service.ts（存储路径 + 类型同步）

**Files:**
- Modify: `electron/main/services/settings-service.ts`

**Step 1: 修改 settings-service.ts**

1. 移除 `electron` 的 `app` 导入，改用 `app.isPackaged` + `app.getAppPath()` 判断路径
2. 更新内部类型定义（与 Task 1 的 `types/settings.ts` 保持一致）
3. 修改 `getSettingsPath()` → `getConfigDir()` + `getSettingsPath()`

```typescript
/**
 * 全局设置读写服务
 * 从 .dogear/settings.json 读写 AI 设置
 * - 开发阶段：<项目根目录>/.dogear/settings.json
 * - 打包发布后：<app.asar 同级目录>/.dogear/settings.json
 */
import fs from 'fs/promises';
import path from 'path';
import electron from 'electron';

const { app } = electron;

// ============================================================
// 类型定义（与 types/settings.ts 保持一致，主进程独立定义）
// ============================================================

export interface ThinkingConfig {
  type: 'adaptive' | 'enabled' | 'disabled';
  budgetTokens?: number;
}

export interface ModelProfile {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  haikuModel: string;
  sonnetModel: string;
  opusModel: string;
  apiTimeoutMs: number;
  disableNonessentialTraffic: boolean;
}

export interface AppSettings {
  ai: {
    thinking: ThinkingConfig;
    effort: 'low' | 'medium' | 'high' | 'max';
    activeProfileId: string;
  };
  profiles: Record<string, ModelProfile>;
}

/**
 * 检查 Profile 是否配置完整
 */
export function isProfileComplete(profile: ModelProfile): boolean {
  return !!(
    profile.apiKey &&
    profile.baseUrl &&
    profile.haikuModel &&
    profile.sonnetModel &&
    profile.opusModel
  );
}

// ============================================================
// 默认值
// ============================================================

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
      haikuModel: '',
      sonnetModel: '',
      opusModel: '',
      apiTimeoutMs: 3000000,
      disableNonessentialTraffic: true,
    },
  },
};

// ============================================================
// 路径函数
// ============================================================

/**
 * 获取 .dogear 配置目录
 * 开发阶段：项目根目录/.dogear
 * 打包后：app.asar 同级目录/.dogear
 */
function getConfigDir(): string {
  if (app.isPackaged) {
    return path.join(path.dirname(app.getAppPath()), '.dogear');
  }
  return path.join(process.cwd(), '.dogear');
}

function getSettingsPath(): string {
  return path.join(getConfigDir(), 'settings.json');
}

// ============================================================
// 辅助函数
// ============================================================

// deepMerge 函数保持不变...

// ============================================================
// 公开接口
// ============================================================

/**
 * 读取设置
 * 文件不存在时返回默认值，已存在时与默认值深度合并
 */
export async function loadSettings(): Promise<AppSettings> {
  const settingsPath = getSettingsPath();
  try {
    const raw = await fs.readFile(settingsPath, 'utf-8');
    const saved = JSON.parse(raw) as AppSettings;
    return deepMerge(saved, DEFAULT_SETTINGS);
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

/**
 * 写入设置到 JSON 文件
 * 自动创建 .dogear 目录
 */
export async function saveSettings(settings: AppSettings): Promise<void> {
  const configDir = getConfigDir();
  await fs.mkdir(configDir, { recursive: true });
  const settingsPath = getSettingsPath();
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
}

// getActiveProfile 保持不变...
```

**Step 2: Commit**

```bash
git add electron/main/services/settings-service.ts
git commit -m "refactor: settings-service 存储路径改为 .dogear/ 目录，更新类型定义"
```

---

### Task 3: 添加 .dogear 到 .gitignore

**Files:**
- Modify: `.gitignore`

**Step 1: 在 .gitignore 末尾添加**

```
# 应用配置目录（含 API Key 等敏感信息）
.dogear/
```

**Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: 添加 .dogear/ 到 gitignore"
```

---

### Task 4: 移除 dotenv 依赖

**Files:**
- Modify: `electron/main/index.ts`（移除 dotenv import 和 config 调用）
- Modify: `package.json`（移除 dotenv 依赖）

**Step 1: 修改 electron/main/index.ts**

删除以下代码：
```typescript
import { config } from 'dotenv';
import { resolve } from 'path';

// 加载 .env 配置
config({ path: resolve(process.cwd(), '.env') });
```

注意：`resolve` 如果在其他地方也用到了需保留导入。

**Step 2: 从 package.json 移除 dotenv**

```bash
npm uninstall dotenv
```

**Step 3: 验证编译**

运行: `npm run build:electron`

**Step 4: Commit**

```bash
git add electron/main/index.ts package.json package-lock.json
git commit -m "refactor: 移除 dotenv 依赖，不再从 .env 文件读取配置"
```

---

### Task 5: 改造 query-based-session.ts 的环境变量注入

**Files:**
- Modify: `electron/main/agents/query-based-session.ts`

**Step 1: 修改 start() 方法中的环境变量构建逻辑**

在 `start()` 方法中，找到当前的 env 构建逻辑（约 232-258 行），替换为：

```typescript
// 从 settings 构建 env（不再继承 process.env）
const appSettings = await loadSettings();
const activeProfile = getActiveProfile(appSettings);

// 校验 Profile 完整性
if (!isProfileComplete(activeProfile)) {
  const errorMsg = `当前模型方案 "${activeProfile.name}" 配置不完整，请在设置页面完善 API Key、Base URL 和模型映射`;
  this.logger.error(errorMsg);
  this.emit('sessionError', { error: errorMsg });
  return;
}

// 注入 thinking 和 effort
queryOptions.thinking = appSettings.ai.thinking;
queryOptions.effort = appSettings.ai.effort;

// 构建全新的 env 对象（不继承 process.env）
const claudeConfigDir = getClaudeConfigDir();
queryOptions.env = {
  ANTHROPIC_AUTH_TOKEN: activeProfile.apiKey,
  ANTHROPIC_BASE_URL: activeProfile.baseUrl,
  ANTHROPIC_DEFAULT_HAIKU_MODEL: activeProfile.haikuModel,
  ANTHROPIC_DEFAULT_SONNET_MODEL: activeProfile.sonnetModel,
  ANTHROPIC_DEFAULT_OPUS_MODEL: activeProfile.opusModel,
  API_TIMEOUT_MS: String(activeProfile.apiTimeoutMs),
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: activeProfile.disableNonessentialTraffic ? '1' : '0',
  CLAUDE_CONFIG_DIR: claudeConfigDir,
};

this.logger.info('已从 settings 构建 env:', {
  profileName: activeProfile.name,
  baseUrl: activeProfile.baseUrl,
  haikuModel: activeProfile.haikuModel,
  sonnetModel: activeProfile.sonnetModel,
  opusModel: activeProfile.opusModel,
  apiTimeoutMs: activeProfile.apiTimeoutMs,
});
```

同时需要更新 import：添加 `isProfileComplete` 的导入。

**Step 2: 移除 start() 中旧的重复 settings 读取逻辑**

当前代码在 start() 中读取了两次 settings（一次在约 150 行注入 thinking/effort，一次在约 246 行注入 env）。合并为一次。

**Step 3: 移除 model 相关的旧逻辑**

删除 `queryOptions.model = activeProfile.model` 这行，因为 model 字段已移除。SDK 会通过 `ANTHROPIC_DEFAULT_*_MODEL` 环境变量自动选择模型。

**Step 4: 移除 QueryBasedSessionConfig 中的 model 字段**

`QueryBasedSessionConfig.model` 字段不再需要（模型通过 env 注入），可以移除。

**Step 5: 验证编译**

运行: `npm run build:electron`

**Step 6: Commit**

```bash
git add electron/main/agents/query-based-session.ts
git commit -m "refactor: query-based-session env 完全从 settings Profile 构建，不再依赖 process.env"
```

---

### Task 6: 更新 tipc/agent.ts（移除 model 传参）

**Files:**
- Modify: `electron/main/tipc/agent.ts`

**Step 1: 修改 createQueryBasedSession 的 input 类型和会话配置构建**

1. 从 input 类型中移除 `model?: string`
2. 在构建 `sessionConfig` 时移除 `model: input.model`

```typescript
createQueryBasedSession: t.procedure
  .input<{
    // model 字段已移除——模型通过 settings Profile 的环境变量注入
    allowedTools?: string[];
    context?: { bookId?: string; chapterId?: string; selectedText?: string };
    enableSkills?: boolean;
    projectRoot?: string;
    conversationId?: string;
    resume?: string;
    forkSession?: boolean;
    resumeSessionAt?: string;
    isForkNewConversation?: boolean;
    agents?: Record<string, any>;
  }>()
```

**Step 2: Commit**

```bash
git add electron/main/tipc/agent.ts
git commit -m "refactor: createQueryBasedSession 移除 model 参数"
```

---

### Task 7: 更新前端 AgentChat.tsx（移除 model 传参 + 添加配置校验）

**Files:**
- Modify: `components/AgentChat.tsx`

**Step 1: 移除 createQueryBasedSession 调用中的 model 参数**

在两处调用 `client.createQueryBasedSession({...})` 中，移除 `model: 'claude-sonnet-4-5-20250929'` 行。

**Step 2: 在创建会话前添加 Profile 完整性检查**

在调用 `client.createQueryBasedSession` 之前，从 settings store 获取当前 Profile 并检查完整性。如果不完整，显示提示并阻止创建会话：

```typescript
// 检查 Profile 配置是否完整
const settingsState = useSettingsStore.getState();
const activeId = settingsState.settings.ai.activeProfileId;
const activeProfile = settingsState.settings.profiles[activeId];
if (!activeProfile || !isProfileComplete(activeProfile)) {
  // 显示提示，不创建会话
  setMessages(prev => [...prev, {
    role: 'assistant',
    content: '⚠️ 当前模型方案未配置完整，请先前往设置页面完成配置（API Key、Base URL、模型映射）。',
    timestamp: Date.now(),
    type: 'text',
  }]);
  return;
}
```

需要导入 `isProfileComplete` from `@/types/settings` 和 `useSettingsStore`。

**Step 3: Commit**

```bash
git add components/AgentChat.tsx
git commit -m "refactor: AgentChat 移除 model 参数，添加 Profile 完整性检查"
```

---

### Task 8: 更新设置页面 UI

**Files:**
- Modify: `app/settings/page.tsx`

**Step 1: 更新 Profile 表单字段**

替换模型方案卡片中的 Profile 编辑表单：

1. **移除**单个"模型"输入框
2. **新增**三个模型映射输入框：Haiku 模型 / Sonnet 模型 / Opus 模型
3. **新增** API 超时时间输入框（数字，默认 3000000）
4. **新增**禁用非必要流量开关（默认开启）
5. **修改** API Key 和 Base URL 的 placeholder，移除"留空则使用 .env 中的值"提示
6. **必填字段**（apiKey、baseUrl、三个模型映射）旁标红星号
7. **添加配置完整性警告**：如果当前 Profile 不完整，在卡片顶部显示黄色警告条

更新后的 Profile 表单 JSX：

```tsx
{/* API Key（必填） */}
<div className="space-y-1.5">
  <label className="text-sm font-medium">
    API Key <span className="text-destructive">*</span>
  </label>
  <div className="relative">
    <input
      type={keyVisible ? 'text' : 'password'}
      className="h-9 w-full px-3 pr-10 text-sm border rounded-md bg-background ..."
      value={profile.apiKey}
      onChange={(e) => updateProfile(id, { apiKey: e.target.value })}
      placeholder="输入 API Key"
    />
    {/* 眼睛图标按钮 */}
  </div>
</div>

{/* Base URL（必填） */}
<div className="space-y-1.5">
  <label className="text-sm font-medium">
    Base URL <span className="text-destructive">*</span>
  </label>
  <input ... placeholder="如 https://api.anthropic.com" />
</div>

{/* 模型映射（三个，必填） */}
<div className="space-y-1.5">
  <label className="text-sm font-medium">
    Haiku 模型 <span className="text-destructive">*</span>
  </label>
  <input ... value={profile.haikuModel}
    onChange={(e) => updateProfile(id, { haikuModel: e.target.value })}
    placeholder="如 claude-haiku-4-5" />
</div>
<div className="space-y-1.5">
  <label className="text-sm font-medium">
    Sonnet 模型 <span className="text-destructive">*</span>
  </label>
  <input ... value={profile.sonnetModel}
    onChange={(e) => updateProfile(id, { sonnetModel: e.target.value })}
    placeholder="如 claude-sonnet-4-6" />
</div>
<div className="space-y-1.5">
  <label className="text-sm font-medium">
    Opus 模型 <span className="text-destructive">*</span>
  </label>
  <input ... value={profile.opusModel}
    onChange={(e) => updateProfile(id, { opusModel: e.target.value })}
    placeholder="如 claude-opus-4-6" />
</div>

{/* API 超时时间 */}
<div className="space-y-1.5">
  <label className="text-sm font-medium">API 超时时间（毫秒）</label>
  <input type="number"
    className="h-9 w-full px-3 text-sm border rounded-md bg-background ..."
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
```

**Step 2: 添加配置完整性警告**

在 TabsContent 顶部添加：

```tsx
{!isProfileComplete(profile) && (
  <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-50 dark:bg-yellow-950 border border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-200 text-sm">
    <AlertTriangle className="w-4 h-4 flex-shrink-0" />
    请完成所有必填字段后才能使用对话功能
  </div>
)}
```

需要导入 `AlertTriangle` from `lucide-react` 和 `isProfileComplete` from `@/types/settings`。

**Step 3: Commit**

```bash
git add app/settings/page.tsx
git commit -m "feat: 设置页面添加模型映射、超时时间、非必要流量开关，标注必填字段"
```

---

### Task 9: 更新 settings store（同步新字段默认值）

**Files:**
- Modify: `stores/settings-store.ts`

**Step 1: 更新 addProfile 中的默认值**

```typescript
addProfile: async () => {
  const { settings, saveSettings } = get();
  const id = crypto.randomUUID();
  const newProfile: ModelProfile = {
    id,
    name: '新方案',
    apiKey: '',
    baseUrl: '',
    haikuModel: '',
    sonnetModel: '',
    opusModel: '',
    apiTimeoutMs: 3000000,
    disableNonessentialTraffic: true,
  };
  // ...
},
```

**Step 2: Commit**

```bash
git add stores/settings-store.ts
git commit -m "refactor: settings-store addProfile 同步新字段默认值"
```

---

### Task 10: 验证与编译

**Step 1: 编译 Electron 主进程**

运行: `npm run build:electron`

预期: 无错误

**Step 2: 编译前端**

运行: `npm run build`

预期: 无错误

**Step 3: 运行 lint**

运行: `npm run lint`

预期: 无新增错误

**Step 4: 手动验证**

运行: `npm run dev`

验证:
1. 打开设置页面，确认新字段显示正常
2. 配置完整的 Profile，确认可以创建对话
3. 清空某个必填字段，确认看到警告且无法创建对话
4. 确认 settings.json 存储在 `.dogear/settings.json`

**Step 5: 最终 Commit**

```bash
git add -A
git commit -m "feat: 设置系统 v2 完成，移除 .env 依赖，配置全部通过设置页面管理"
```