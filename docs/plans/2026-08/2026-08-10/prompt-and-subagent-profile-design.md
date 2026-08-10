# 提示词文件迁移 + 子会话 Profile 化设计

## 背景

当前提示词文件 `.claude/CLAUDE.md` 散落在工作区文件系统中，与 Dogear 的 `.dogear` 配置体系不统一。同时子会话派遣配置过于粗粒度（三个 boolean 开关），且提示词与工具加载不对齐——子会话有记忆工具但没有记忆引导提示词，有 skill 工具但不一定有 skill 索引。

核心设计原则：**提示词与工具是一套的——提示词不引导的能力，工具不挂载。**

## 目标

1. 提示词文件迁移到 `.dogear` 系统目录下，命名为 `agent.md`
2. 子会话派遣配置从单一全局配置改为可管理的 Profile 列表
3. 主会话根据 Profile 描述自动选择合适的子会话类型
4. 子会话的提示词和工具严格按 Profile 配置对齐加载

## 一、提示词文件迁移

### 路径变化

| 角色 | 原路径 | 新路径 |
|------|--------|--------|
| 通用提示词 | `~/.claude/CLAUDE.md` | `getConfigDir()/agent.md` |
| 工作区提示词 | `{workspacePath}/.claude/CLAUDE.md` | `getConfigDir()/workspaces/{workspaceId}/agent.md` |

### 兼容策略

不做 fallback，代码只读新路径。旧 `.claude/CLAUDE.md` 文件留着不动，用户自行迁移内容。

### pi 框架层面

pi-ai / pi-agent-core 框架本身不读任何提示词文件，`AgentHarness` 和裸 `Agent` 都只接收 `systemPrompt: string` 参数。两个 agent.md 是 Dogear 唯一自定义注入的提示词文件。

## 二、子会话 Profile 数据结构

### 新增类型

```typescript
interface SubAgentProfile {
  id: string;
  name: string;              // 显示名，如"默认"、"探索"、"编码"
  description: string;       // 告诉主会话何时用这个 Profile
  modelSelection?: ModelSelection | null;  // null = 继承默认模型
  timeoutMinutes: number;    // 超时分钟数
  enabledBasicTools: string[];   // 启用的基础工具名，默认全开
  enabledAbilities: {
    memory?: boolean;        // 记忆系统（整体）
    stock?: boolean;         // 股票分析（整体）
    article?: boolean;       // 文章解析（整体）
    skills?: string[];       // 代码工作流 skill（按名勾选）
    customSkills?: string[]; // 自定义 skill（按名勾选）
    groupFiles?: boolean;    // 共享区文件读写（整体）
    reference?: boolean;     // 引用回溯（整体）
  };
}
```

### AppSettings 变化

```typescript
// 旧结构（废弃）
subAgent: {
  modelSelection?: ModelSelection | null;
  timeoutMinutes: number;
  cachePolicy?: '5m' | '1h';
  loadCoreProfile?: boolean;
  loadSkills?: boolean;
  loadArticleParse?: boolean;
}

// 新结构
subAgent: {
  profiles: SubAgentProfile[];  // Profile 列表，至少含一个默认 Profile
}
```

### 默认 Profile

```typescript
{
  id: 'default',
  name: '默认',
  description: '标准派遣会话，具备全部基础工具和 Agent 协作能力',
  modelSelection: null,
  timeoutMinutes: 30,
  enabledBasicTools: ['read', 'write', 'edit', 'bash', 'Glob', 'Grep'],
  enabledAbilities: {},
}
```

默认 Profile 可编辑但不可删除（作为 fallback）。cachePolicy 固定 5m，loadCoreProfile 移除（子会话不再自动加载用户画像）。

## 三、能力域定义

子会话 Profile 可选的能力域，与"能力"Tab 的组织对齐。每个能力域是提示词段 + skill + 工具的整体组合。

### 能力域清单

| 能力域 | 粒度 | 包含内容 | 默认状态 |
|--------|------|---------|---------|
| 交付通信 | **固定，不可选** | dogear-delegation（SendMessage / WaitForMessage / ListLinkedSessions）+ 子会话契约提示词段 | 始终开 |
| 记忆系统 | 整体开关 | MEMORY_GUIDANCE_APPEND 提示词段 + cross-session-review skill（如已订阅）+ dogear-memory 工具 | 关 |
| 股票分析 | 整体开关 | stock-analysis / stock-picking skill + stock-quote / stock-analysis / stock-announcement / stock-picking 工具包 | 关 |
| 文章 | 整体开关 | article-parser skill + article 工具包 | 关 |
| 代码工作流 | 每个 skill 单独 | brainstorming / codebase-map / doc-sync / staged-execution / staged-impl / systematic-debugging（各自勾选） | 全关 |
| 自定义 Skill | 每个 skill 单独 | 工作区或用户目录下自建的、不在模板列表中的 Skill（各自勾选） | 全关 |
| 共享区文件 | 整体开关 | dogear-group（ListGroupFiles / ReadGroupFile / WriteGroupFile）+ NOTES_GUIDANCE_APPEND 提示词段 | 关 |
| 引用回溯 | 整体开关 | dogear-reference（ReadReferenceSession / TraceSource / ReadGroupBackground / ListSiblingSessions 等） | 关 |

### 提示词-工具对齐规则

| Profile 配置 | 提示词加载 | 工具加载 |
|-------------|-----------|---------|
| 基础工具勾选 | agent.md 始终加载（项目约定必须遵守） | 对应工具通过 activeToolNames 激活 |
| 记忆系统 = true | MEMORY_GUIDANCE_APPEND | dogear-memory 工具包 + cross-session-review skill 索引 |
| 股票分析 = true | stock skill 索引条目 | stock 工具包 |
| 文章 = true | article-parser skill 索引条目 | article 工具包 |
| 共享区文件 = true | NOTES_GUIDANCE_APPEND | dogear-group 工具包 |
| 引用回溯 = true | （无提示词段） | dogear-reference 工具包 |
| skills 含某项 | 该 skill 索引条目 | Skill 工具（只要 ≥1 个能力域勾了 ≥1 个 skill） |
| 能力全关 | 无 skill 索引 | 无 Skill 工具 |

### activeToolNames 机制

pi 框架原生支持：`new AgentHarness({ tools, activeToolNames })`。
- 不传 activeToolNames → 默认全部激活
- 传了 → 只有列出的工具发给模型
- 运行时可动态切换：`setActiveTools(toolNames)`

子会话创建时根据 Profile 计算 activeToolNames，构造时传入 PiHarnessAdapter。

## 四、主会话增强

### CreateSession / CreateSessionBatch 加 profile 参数

```typescript
// delegation-tools.ts
CreateSession({ task, outputPath, title?, profile? })
CreateSessionBatch({ items: [{ task, outputPath, title?, profile? }] })
```

`profile` 是可选 string，匹配 Profile.name。不指定或匹配不到 → 走 default Profile。

### 主会话提示词注入 Profile 索引

在主会话系统提示词末尾追加（仅 role='main' 且有 groupId 时）：

```
## 可用的子会话 Profile

派遣子会话时可以根据任务性质选择合适的 Profile：

- **默认**：标准派遣会话，具备全部基础工具和 Agent 协作能力
- **探索**：只读探索，不修改文件，带 codebase-map skill
- **调研**：深度调研，带全部代码工作流 skill

不指定 profile 时走「默认」。在 CreateSession 中传 profile 参数选择。
```

### 派遣链路改造

1. `delegation-tools.ts`：CreateSession 接收 profile 参数，传给 delegation-bridge
2. `delegation-bridge.ts` startChild()：根据 profile name 查找 Profile 配置，传给 conversation-runtime-service
3. `conversation-runtime-service.ts` attachConversation()：把 Profile 配置透传给 PiSessionConfig
4. `pi-session.ts` start()：根据 Profile 配置决定：
   - 加载哪些提示词段（skill 索引过滤、记忆引导等）
   - 创建哪些工具（按能力域）
   - 通过 activeToolNames 控制基础工具激活集

## 五、设置页 UI

### 子会话派遣 Tab 重构

从单一配置页改为 Profile 管理器：

- **Profile 列表**：卡片形式列出所有 Profile，每张卡片显示名称 + 描述 + 简要配置摘要
- **添加 Profile**：新建按钮 → 填写名称、描述 → 选择基础工具 + 能力域 → 保存
- **编辑 Profile**：点击卡片编辑（默认 Profile 也可编辑）
- **删除 Profile**：默认 Profile 不可删，其余可删

### Profile 编辑界面

- **名称**：文本输入
- **描述**：文本输入（告诉主会话何时用）
- **模型**：ModelSelector（可不指定，继承默认）
- **超时**：数字输入
- **基础工具**：6 个 checkbox（Read / Write / Edit / Bash / Glob / Grep）
- **能力域**：
  - 记忆系统（checkbox）
  - 股票分析（checkbox）
  - 文章（checkbox）
  - 代码工作流 Skill（多选列表，每项 name + 一句话描述）
  - 自定义 Skill（多选列表，动态扫描工作区/用户目录下的自建 skill）
  - 交付通信（固定，仅展示说明文字）
  - 共享区文件（checkbox，默认关）
  - 引用回溯（checkbox，默认关）

## 六、旧设置归一化

settings-normalize.ts 中的迁移逻辑：

| 旧字段 | 映射 |
|--------|------|
| `subAgent.modelSelection` | → 默认 Profile 的 `modelSelection` |
| `subAgent.timeoutMinutes` | → 默认 Profile 的 `timeoutMinutes` |
| `subAgent.loadSkills: true` | → 默认 Profile 的 `enabledAbilities.skills` 加入全部代码工作流 skill |
| `subAgent.loadArticleParse: true` | → 默认 Profile 的 `enabledAbilities.article = true` |
| `subAgent.cachePolicy` | 移除（固定 5m） |
| `subAgent.loadCoreProfile` | 移除 |
| 无 `subAgent.profiles` | 创建默认 Profile（全基础工具、无能力域） |

## 未决问题

1. **记忆能力域的提示词段**：子会话勾选记忆系统后注入的 MEMORY_GUIDANCE_APPEND 是否需要调整内容（子会话是短期执行者，记忆引导可能需要不同措辞）
2. **预设 Profile 初始值**：除了默认 Profile，是否预置"探索"（只读）和"调研"（带 skill）两个 Profile 作为开箱即用模板
3. **dogear-memory-review**：当前子会话会加载 review 工具包，新设计中归入"记忆系统"能力域还是单独处理
4. **Conversation 级别的 profile 记录**：子会话 conversation 是否需要记录使用的 profile name（用于溯源和 UI 展示）
