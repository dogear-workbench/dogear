# 设置模块重构设计

> 2026-03-18 | 将设置页面从即时保存改为表单模式，优化布局，新增参数

## 目标

1. 进入设置不关闭运行中的 Agent
2. 改为表单模式（手动保存），提供 取消/保存/保存并重启会话 三个按钮
3. 左侧纵向 Tab 导航 + 右侧内容区（标题+描述+表单）
4. 工具权限展示 SDK 内置工具 + 自定义 tools，附描述文案
5. 模型方案增加"启用中"标识
6. 新增 `permissionMode` 参数

## 布局结构

```
┌──────────────────────────────────────────────┐
│  ← 返回    设置        [取消] [保存] [保存并重启] │  ← 顶部固定栏
├────────┬─────────────────────────────────────┤
│        │  标题                                │
│ AI行为  │  描述文案                             │
│        │                                     │
│ 工具权限 │  表单内容区                           │
│        │  （可滚动）                           │
│ 模型方案 │                                     │
└────────┴─────────────────────────────────────┘
```

- 顶部固定栏：返回按钮 + 页面标题 + 操作按钮组
- 按钮组仅在 dirty 时高亮可用，非 dirty 时灰色禁用
- 左侧 Tab 使用 shadcn Tabs 的 vertical 模式

## Tab 详细设计

### Tab 1: AI 行为

**标题**：AI 行为
**描述**：配置 Agent 的思考模式、执行力度和权限策略

表单项：
1. **思考模式** — 单选组（adaptive/enabled/disabled）
   - enabled 下展开 budgetTokens 数字输入
2. **执行力度** — 分段按钮组（low/medium/high/max）
3. **最大执行轮次** — 数字输入，留空不限制
4. **默认权限模式**（新增）— 单选组
   - 标准（default）：危险操作需用户确认（推荐）
   - 自动编辑（acceptEdits）：文件编辑自动通过，其余需确认
   - 仅规划（plan）：只规划不执行，工具调用被阻止
   - 静默拒绝（dontAsk）：未预授权的工具直接拒绝

### Tab 2: 工具权限

**标题**：工具权限
**描述**：管理 Agent 可使用的工具及其权限级别

表格展示，每行：工具名称 | 描述 | 权限标签（允许/默认/拒绝 三态切换）

工具来源：
- SDK 内置：Read、Glob、Grep、Bash、Write、Edit、WebFetch、WebSearch
- 自定义：SearchInChapters、AnswerQuestion、ReadArticle、ListArticles、SaveAnalysis、SaveChapterAnalysis、MarkComplete

两组之间用分隔线区分。

### Tab 3: 模型方案

**标题**：模型方案
**描述**：管理 API 配置方案，切换不同的模型和服务地址

- 内层 Tabs 展示所有方案，当前启用的方案 Tab 带 ✓ 徽章
- 表单字段：方案名称、API Key（可切换显隐）、Base URL、三个模型名、API 超时、禁用非必要流量
- 底部按钮："启用此方案"（非当前方案时显示）、"删除"（非 default 方案时显示）
- 切换启用方案也算 dirty

## 数据流

### 表单模式状态

```
Settings Page
├── savedSettings    ← store 中的已保存设置（只读参考）
├── localSettings    ← 本地编辑副本
├── isDirty          ← deepEqual(saved, local) === false
└── 按钮
    ├── 取消      → localSettings = cloneDeep(savedSettings)
    ├── 保存      → store.saveSettings(localSettings)
    └── 保存并重启 → 保存 + client.restartActiveSessions()
```

### 重启会话流程

```
前端 "保存并重启"
  → saveSettings(localSettings)
  → client.restartActiveSessions()
  → 主进程遍历活跃 QueryBasedSession
  → 每个: close() → 用新 settings 重建
  → 前端通过 sessionMessage 事件自动恢复
```

### 工具列表获取

- SDK 内置工具：前端硬编码列表 + 描述
- 自定义工具：新增 IPC `getRegisteredTools`，主进程从 agents/tools/ 收集返回

## 类型变更

```typescript
// types/settings.ts
interface AppSettings {
  ai: {
    thinking: ThinkingConfig;
    effort: 'low' | 'medium' | 'high' | 'max';
    activeProfileId: string;
    maxTurns?: number;
    permissionMode: 'default' | 'acceptEdits' | 'plan' | 'dontAsk';  // 新增
  };
  permissionRules?: { allow?: string[]; deny?: string[] };
  profiles: Record<string, ModelProfile>;
}
```

## 文件变更范围

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `types/settings.ts` | 修改 | 新增 permissionMode 字段 |
| `electron/main/services/settings-service.ts` | 修改 | 默认值加 permissionMode: 'default' |
| `app/settings/page.tsx` | 重写 | 纵向 Tab + 表单模式 + dirty 检测 |
| `stores/settings-store.ts` | 修改 | 精简 setter，改为整体 save |
| `electron/main/tipc/settings.ts` | 修改 | 新增 restartActiveSessions |
| `electron/main/tipc/agent.ts` | 修改 | 新增 getRegisteredTools |
| `electron/main/agents/query-based-session.ts` | 修改 | 注入 permissionMode |

## 不做的事

- 不新增 MCP 服务器管理 UI（后续单独做）
- 不新增 systemPrompt 配置（放在会话侧边栏）
- 不新增 maxBudgetUsd（后续考虑）
- 不改变工具权限的三态标签交互样式
