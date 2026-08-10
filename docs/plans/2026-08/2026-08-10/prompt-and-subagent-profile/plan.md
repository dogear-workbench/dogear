# 提示词文件迁移 + 子会话 Profile 化 实施计划

**目标**：提示词文件迁移到 `.dogear` 目录；子会话派遣从单一全局配置改为可管理的 Profile 列表，主会话按描述自动选择，提示词与工具严格对齐加载。

**架构思路**：数据结构先行（类型 + 归一化），然后自底向上改造：运行时加载逻辑 → 派遣链路透传 → 主会话增强 → 设置页 UI。文件迁移作为独立步骤不阻塞主线。

**设计文档**：[prompt-and-subagent-profile-design.md](../prompt-and-subagent-profile-design.md)

**涉及模块**：
- 类型：`electron/main/services/settings-types.ts`、`app/types/settings.ts`
- 归一化：`electron/main/services/settings-normalize.ts`、`electron/main/services/settings-service.ts`
- 运行时：`electron/main/agents/pi-session/pi-session.ts`、`pi-harness-adapter.ts`
- 派遣链路：`electron/main/agents/tools/delegation-tools.ts`、`electron/main/agents/delegation-bridge.ts`、`electron/main/services/conversation-runtime-service.ts`
- 提示词模板：`electron/main/agents/session-append-templates.ts`
- 设置页：`app/settings/SubAgentTab.tsx`、`app/settings/page.tsx`

## 步骤索引

- [x] [Step 1: 提示词文件迁移](./step1-prompt-migration.md) — `.claude/CLAUDE.md` → `.dogear/agent.md`
- [x] [Step 2: 设置类型 + 归一化](./step2-settings-types.md) — SubAgentProfile 类型、AppSettings.subAgent 重构、旧字段归一化
- [x] [Step 3: PiSession 运行时改造](./step3-pi-session-runtime.md) — Profile 驱动的提示词段/工具/skill 加载 + activeToolNames
- [x] [Step 4: 派遣链路 + 主会话增强](./step4-delegation-chain.md) — CreateSession 加 profile 参数、链路透传、Profile 索引注入
- [x] [Step 5: 设置页 UI 重构](./step5-settings-ui.md) — SubAgentTab 改为 Profile 管理器

## 全局决策

### Profile 数据结构（所有步骤共享）

```typescript
interface SubAgentProfile {
  id: string;
  name: string;
  description: string;
  modelSelection?: ModelSelection | null;
  timeoutMinutes: number;
  enabledBasicTools: string[];
  enabledAbilities: {
    memory?: boolean;
    stock?: boolean;
    article?: boolean;
    skills?: string[];
    customSkills?: string[];
    groupFiles?: boolean;
    reference?: boolean;
  };
}
```

### 默认 Profile 值

```typescript
{
  id: 'default',
  name: '默认',
  description: '标准派遣会话，具备全部基础工具和交付通信能力',
  modelSelection: null,
  timeoutMinutes: 30,
  enabledBasicTools: ['read', 'write', 'edit', 'bash', 'Glob', 'Grep'],
  enabledAbilities: {},
}
```

### 能力域 → 提示词/工具映射

| 能力域 | 提示词段 | 工具 |
|--------|---------|------|
| 交付通信（固定） | subAgentContractFor | dogear-delegation（子会话集） |
| memory | MEMORY_GUIDANCE_APPEND | dogear-memory |
| stock | stock skill 索引 | stock-quote/analysis/announcement/picking |
| article | article-parser skill 索引 | article |
| skills[i] | 对应 skill 索引条目 | Skill 工具 |
| customSkills[i] | 对应 skill 索引条目 | Skill 工具 |
| groupFiles | NOTES_GUIDANCE_APPEND | dogear-group |
| reference | （无） | dogear-reference |

### activeToolNames 计算

子会话的 activeToolNames = 基础工具勾选项 + 固定的交付通信工具 + 能力域激活的工具。主会话不传 activeToolNames（全部激活）。

### cachePolicy 处理

移除设置项，conversation-runtime-service.ts 中子会话 cachePolicy 固定 '5m'。

### Skill 工具激活条件

当 `skills` 或 `customSkills` 中有 ≥1 个条目时，Skill 工具激活。Skill 索引只包含勾选的 skill。
