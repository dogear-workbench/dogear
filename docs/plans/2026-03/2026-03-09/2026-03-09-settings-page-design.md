# AI 设置页面设计

> 日期: 2026-03-09

## 概述

新增全局 AI 设置页面，支持 Thinking 模式、Effort 级别配置，以及多套模型方案（Profile）的管理和切换。设置持久化为全局 JSON 文件。

## 数据结构

### settings.json 位置

`app.getPath('userData')/settings.json`（如 `C:\Users\Dreama\AppData\Roaming\dogear\settings.json`）

### 结构定义

```typescript
// types/settings.ts

export interface ThinkingConfig {
  type: 'adaptive' | 'enabled' | 'disabled';
  budgetTokens?: number; // 仅 type='enabled' 时有效
}

export interface ModelProfile {
  id: string;           // UUID
  name: string;         // 显示名称，如"官方 API"、"代理 API"
  apiKey: string;       // ANTHROPIC_AUTH_TOKEN
  baseUrl: string;      // ANTHROPIC_BASE_URL
  model: string;        // 默认模型 ID，如 "claude-opus-4-6"
}

export interface AppSettings {
  ai: {
    thinking: ThinkingConfig;
    effort: 'low' | 'medium' | 'high' | 'max';
    activeProfileId: string; // 当前激活的方案 ID
  };
  profiles: Record<string, ModelProfile>; // key = profile.id
}
```

### 默认值

```json
{
  "ai": {
    "thinking": { "type": "adaptive" },
    "effort": "high",
    "activeProfileId": "default"
  },
  "profiles": {
    "default": {
      "id": "default",
      "name": "默认",
      "apiKey": "",
      "baseUrl": "",
      "model": "claude-sonnet-4-6"
    }
  }
}
```

## 架构

### 新增文件

| 文件 | 说明 |
|------|------|
| `types/settings.ts` | 设置类型定义 |
| `electron/main/services/settings-service.ts` | 设置读写服务（JSON 文件操作） |
| `electron/main/tipc/settings.ts` | IPC 路由：getSettings / updateSettings |
| `stores/settings-store.ts` | Zustand store，管理前端设置状态 |
| `app/settings/page.tsx` | 设置页面 UI |

### 修改文件

| 文件 | 修改内容 |
|------|----------|
| `electron/main/tipc/index.ts` | 注册 settings 路由 |
| `app/page.tsx` | header 添加设置图标按钮（导航到 /settings） |
| `electron/main/agents/query-based-session.ts` | 创建 query 时从 settings 读取配置注入 env 和 options |

### 数据流

```
设置页面 UI
  ↓ onChange
settings-store (Zustand)
  ↓ tipc.invoke('updateSettings')
settings tipc handler
  ↓
settings-service.save()
  ↓
userData/settings.json
```

```
创建 Agent 会话时:
query-based-session.ts
  ↓ settingsService.load()
读取 settings.json
  ↓ 注入到 queryOptions
options.thinking = settings.ai.thinking
options.effort = settings.ai.effort
env.ANTHROPIC_AUTH_TOKEN = activeProfile.apiKey
env.ANTHROPIC_BASE_URL = activeProfile.baseUrl
options.model = activeProfile.model
```

## UI 设计

### 页面路由

`app/settings/page.tsx` — 独立路由页面

### 布局

```
┌─────────────────────────────────────────────┐
│ ← 返回    设置                               │
├─────────────────────────────────────────────┤
│                                             │
│  AI 行为                                     │
│  ┌─────────────────────────────────────┐    │
│  │ Thinking 模式                        │    │
│  │ ○ Adaptive（自适应，推荐）            │    │
│  │ ○ Enabled（固定预算）[____] tokens   │    │
│  │ ○ Disabled（禁用）                   │    │
│  │                                     │    │
│  │ Effort 级别                          │    │
│  │ [Low] [Medium] [High] [Max]         │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  模型方案                                    │
│  ┌─────────────────────────────────────┐    │
│  │ [✓ 官方 API] [  代理 API ] [+ 新建]  │    │
│  │                                     │    │
│  │ 方案名称: [官方 API          ]       │    │
│  │ API Key:  [sk-ant-...       ] 👁    │    │
│  │ Base URL: [https://api.ant..]       │    │
│  │ 模型:     [claude-opus-4-6  ▼]      │    │
│  │                                     │    │
│  │                        [删除方案]    │    │
│  └─────────────────────────────────────┘    │
│                                             │
└─────────────────────────────────────────────┘
```

### 交互规则

- 修改即时保存，无需"保存"按钮
- 方案标签页切换 = 切换激活方案（修改 activeProfileId）
- "default" 方案不可删除
- API Key 输入框默认隐藏，点击眼睛图标显示
- Thinking 选择 "Enabled" 时展开 budgetTokens 输入框
- Effort 使用分段按钮组（SegmentedControl / ToggleGroup）

## 设置注入到 Agent

`query-based-session.ts` 中创建 query 时：

1. 调用 `settingsService.load()` 获取当前设置
2. 获取 `activeProfile` = `settings.profiles[settings.ai.activeProfileId]`
3. 将设置注入：
   - `options.thinking` = `settings.ai.thinking`
   - `options.effort` = `settings.ai.effort`
   - `env.ANTHROPIC_AUTH_TOKEN` = `activeProfile.apiKey`（如果非空，覆盖 .env）
   - `env.ANTHROPIC_BASE_URL` = `activeProfile.baseUrl`（如果非空，覆盖 .env）
   - query 的 model 参数 = `activeProfile.model`（如果非空）

.env 中的值作为 fallback，settings.json 中的值优先。
