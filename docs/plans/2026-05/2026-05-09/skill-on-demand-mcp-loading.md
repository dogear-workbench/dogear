# Skill 触发式 MCP 按需加载方案

> 创建日期：2026-05-09
> **状态：已废弃**（被 [skill-tool-search-migration.md](./skill-tool-search-migration.md) 取代）
> 废弃原因：动态 `setMcpServers` 挂载后 Agent 始终找不到新挂的工具，PreToolUse hook 内挂载与 SDK 推理上下文不同步。
> 替代方案：改为 SDK 默认开启的 Tool Search + 工具包统一开关 + system prompt 工具导览，详见 skill-tool-search-migration.md。
> 关联里程碑：1.5 Phase 3 模块 B（B3.3 修订）
> 前置：B3.3 当前实现「启用即全量加载」已完成但不符合用户偏好
> 预估工作量：1-1.5 天

---

## 一、为什么要重做 B3.3

### 当前实现的真实成本

`enabledSkills: ['stock-analysis']` 启用后，**每个会话启动**承担：

| 组件 | 进 system prompt 时机 | 估算 token |
|------|----------------------|-----------|
| SKILL.md frontmatter（name + description） | 启动 | ~100 |
| SKILL.md 正文 | Agent 调 `Skill(stock-analysis)` 时（已是按需） | ~400 |
| **7 个 MCP 工具 schema** | **启动**（这是大头） | **~3000** |

**问题**：用户的诉求是「让工作区有这个能力，需要时才加载工具」。但 MCP 工具 schema 在会话启动时就已经全量注入，本次对话不用也得吃这 ~3000 token。

### 关键文档发现

读 `claude_code_doc_md/sdk-^0.2.119/` 后纠正了之前的两个误判：

**误判 1**：「SDK 不支持运行时注册 MCP server」

**真相**：SDK 的 `Query` 接口提供了完整运行时控制 API：
- `setMcpServers(servers)` — 整体替换 MCP server 集合
- `toggleMcpServer(serverName, enabled)` — 单独开/关某个 MCP server
- `applyFlagSettings({ permissions: {...} })` — 运行时改权限规则
- 限制：仅 streaming input mode 可用（**dogear 当前就是这种模式**，agent-chat 走 streamInput）

**误判 2**：「SKILL.md 整个文件都进 system prompt」

**真相**（`自定义行为/sdk中的代理技能.md`：
> Skill metadata is discovered at startup; **full content loaded when triggered**

SKILL.md 的 frontmatter（name + description）在启动时进 context（~100 token），正文要等 Agent 主动调 `Skill(stock-analysis)` 时才注入。SKILL.md 这部分**已经是 progressive disclosure**，不需要改。

**真正要做的**：让 MCP 工具 schema 也走相同的 progressive 模式 —— Agent 调 `Skill(stock-analysis)` 那一刻，hook 拦截 → 动态注册 MCP server → 自动授权 → Agent 立即可见这些工具。

---

## 二、新方案：Skill 触发驱动的 MCP 按需挂载

### 核心思路

```
会话启动（启用了 stock-analysis）：
  ✓ SKILL.md 元数据进 system prompt（~100 token）
  ✗ MCP server 不注册（0 token）
  ✗ 工具不在 allowedTools 列表
  ✓ 注册 PreToolUse hook，监听 tool_name === 'Skill' && tool_input.name === 'stock-analysis'

Agent 在某轮判断需要 →  调 Skill(stock-analysis):
  → PreToolUse hook 触发
  → hook 内部 await query.toggleMcpServer('dogear-stock-analysis', true)
  → hook 内部 await query.applyFlagSettings({
        permissions: { allow: [...原有, 'mcp__dogear-stock-analysis__*'] }
     })
  → hook 返回 { decision: 'approve', additionalContext: '工具已加载，可直接调用' }
  → SDK 继续执行 Skill 工具（加载 SKILL.md 正文）
  → Agent 下一轮看到工具列表多了 7 个 MCP 工具，直接调用
  → 无权限询问、无重启会话

Agent 用完后：
  → MCP server 保持挂载到会话结束（避免反复加载）
  → 会话结束自然释放
```

### 收益对比

| 模式 | 启动 token | Skill 触发后 | 工具调用是否需要点允许 | 总成本（不需要时） |
|------|----------|-----------|--------------------|--------------|
| **当前实现** | ~3100 | ~3500 | 是 | ~3100 |
| **新方案** | ~100 | ~3500 | **否（hook 自动授权）** | **~100** |

省下的不是峰值（峰值还要付的），是「**没用到时永远不付**」—— 完全符合用户「让工作区有能力，需要时才加载」的偏好。

---

## 三、实施细节

### 3.1 改动范围

| 文件 | 类型 | 改动 |
|------|------|------|
| `electron/main/services/conversation-runtime-service.ts` | 改 | stock-analysis 启用时只加 plugin 路径，**不再预注册 MCP server** |
| `electron/main/agents/query-based-session.ts` | 改 | 注册 PreToolUse hook、监听 Skill 触发、动态调用 toggleMcpServer + applyFlagSettings |
| `electron/main/services/optional-skills.ts` | 改 | OptionalSkillMeta 加 `mcpServerFactory?: () => McpServerConfig` 字段，提供按需挂载工厂 |
| `electron/main/agents/tools/stock-analysis-tools.ts` | 不动 | createStockAnalysisTools() 工厂保持现状，改在 hook 触发时调用 |

### 3.2 关键代码骨架

#### `optional-skills.ts` 增强

```ts
export interface OptionalSkillMeta {
  name: string;
  label: string;
  description: string;
  toolCount: number;
  requirements?: string;

  /**
   * MCP server 名称（如 'dogear-stock-analysis'）。
   * 触发 Skill 时通过此名称在 hook 中加载对应 MCP。
   */
  mcpServerName?: string;

  /**
   * MCP server 工厂函数（按需调用，避免常驻内存）。
   * Skill 触发时由 hook 调用并通过 setMcpServers 注入。
   */
  mcpServerFactory?: () => McpServerConfig;

  /**
   * Skill 触发时自动加入 allow 列表的工具模式
   * 例如 ['mcp__dogear-stock-analysis__*']
   */
  autoApproveOnTrigger?: string[];
}

export const OPTIONAL_SKILLS: OptionalSkillMeta[] = [
  {
    name: 'stock-analysis',
    label: '股票分析',
    description: '...',
    toolCount: 7,
    mcpServerName: 'dogear-stock-analysis',
    mcpServerFactory: () => createStockAnalysisTools(),
    autoApproveOnTrigger: ['mcp__dogear-stock-analysis__*'],
    requirements: '需要 Python 3.10+ ...',
  },
];
```

#### `conversation-runtime-service.ts` 改动

```ts
const enabledSkills = appSettings.enabledSkills ?? [];
const stockAnalysisEnabled = enabledSkills.includes('stock-analysis');

// 改动 1：只挂 plugin（让 SKILL.md 元数据进 context），不预注册 MCP
const extraPluginPaths: string[] = [];
if (stockAnalysisEnabled) {
  extraPluginPaths.push(getStockAnalysisSkillDir());
}

// 改动 2：mcpServers 不再预挂 dogear-stock-analysis
const mcpServers: Record<string, McpServerConfig> = {};
// 注：article-parse 仍常驻（高频且工具少）

// 改动 3：把 enabledSkills 列表传给 session config，让 query-based-session 知道要挂 hook
return {
  // ... 原有字段
  extraPluginPaths,
  mcpServers,
  enabledSkillsForOnDemand: stockAnalysisEnabled ? ['stock-analysis'] : [],
};
```

#### `query-based-session.ts` 注册 hook

```ts
// QueryBasedSessionConfig 新增字段
interface QueryBasedSessionConfig {
  // ... 原有
  enabledSkillsForOnDemand?: string[]; // 需要按需加载 MCP 的 Skill 列表
}

// 启动 query 时注册 hook
const onDemandSkills = this.config.enabledSkillsForOnDemand ?? [];

if (onDemandSkills.length > 0) {
  const skillMetas = onDemandSkills
    .map((name) => OPTIONAL_SKILLS.find((s) => s.name === name))
    .filter((m): m is OptionalSkillMeta => m !== undefined && !!m.mcpServerFactory);

  // 已加载的 MCP server 集合（防止重复加载）
  const loadedServers = new Set<string>();

  queryOptions.hooks = {
    PreToolUse: [
      {
        matcher: 'Skill', // 只匹配 Skill 工具调用
        hooks: [
          async (input, _toolUseId, _options) => {
            if (input.hook_event_name !== 'PreToolUse') {
              return { continue: true };
            }

            const toolInput = input.tool_input as { name?: string };
            const skillName = toolInput?.name;

            const meta = skillMetas.find((m) => m.name === skillName);
            if (!meta || !meta.mcpServerName || !meta.mcpServerFactory) {
              return { continue: true };
            }

            // 已加载过，直接放行
            if (loadedServers.has(meta.mcpServerName)) {
              return {
                continue: true,
                hookSpecificOutput: {
                  hookEventName: 'PreToolUse',
                  permissionDecision: 'allow',
                },
              };
            }

            // 动态挂载 MCP server
            this.logger.info(`[Skill on-demand] 触发 ${skillName}，加载 MCP: ${meta.mcpServerName}`);
            try {
              const currentStatus = await this.query.mcpServerStatus();
              const currentServers: Record<string, McpServerConfig> = {};
              for (const status of currentStatus) {
                if (status.config) {
                  currentServers[status.name] = status.config as McpServerConfig;
                }
              }

              // 整体替换：保留现有 + 加新的
              await this.query.setMcpServers({
                ...currentServers,
                [meta.mcpServerName]: meta.mcpServerFactory(),
              });

              // 自动授权工具
              if (meta.autoApproveOnTrigger?.length) {
                const currentSettings = await this.query.initializationResult();
                const currentAllow = currentSettings?.permissions?.allow ?? [];
                await this.query.applyFlagSettings({
                  permissions: {
                    ...this.permissionRules,
                    allow: [...currentAllow, ...meta.autoApproveOnTrigger],
                  },
                });
              }

              loadedServers.add(meta.mcpServerName);
              this.logger.info(`[Skill on-demand] ${meta.mcpServerName} 加载完成`);
            } catch (error) {
              this.logger.error('[Skill on-demand] 加载失败:', error);
              return {
                continue: true,
                systemMessage: `加载 ${skillName} 工具失败，可能影响后续操作`,
              };
            }

            return {
              continue: true,
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'allow',
                additionalContext: `已自动加载 ${meta.label} 相关工具，下一轮即可调用。`,
              },
            };
          },
        ],
      },
    ],
  };

  this.logger.info('已注册按需 Skill hook:', onDemandSkills);
}
```

### 3.3 关键技术点

#### a. Hook 是 async 函数

`HookCallback` 签名是 `Promise<HookJSONOutput>`，所以 hook 内部可以 await `query.setMcpServers()`、`query.applyFlagSettings()` —— SDK 会等 hook 完成才继续执行 Skill 工具。

#### b. setMcpServers 是「整体替换」

必须先 `mcpServerStatus()` 拿到当前所有 server，合并再调 `setMcpServers`。直接传单 server 会把现有的 article-parse 顶掉。

#### c. PreToolUse hook 的时序

参考 SDK 文档：
- Skill 工具触发 → SDK 调 PreToolUse hook
- Hook 完成 → SDK 决定是否执行 Skill 工具（若 hook 返回 `decision: 'block'` 则跳过）
- 我们返回 `permissionDecision: 'allow'` 让 Skill 继续执行（加载 SKILL.md 正文给 agent）
- 此时 MCP 已经挂上，**但 agent 看到工具列表更新要等到下一轮**（因为本轮的 system prompt 已经发出）

这意味着：**Agent 调 Skill → 拿到 SKILL.md 指引 → 下一轮才能调 MCP 工具**。延迟 1 轮，但 agent 调用模式天然就是这样（先了解工具用法，再调用），不影响体验。

#### d. autoApproveOnTrigger 的合并方式

`applyFlagSettings({ permissions: {...} })` 是**浅合并**，传入 `allow` 会替换整个 allow 数组。所以必须先取当前 allow 列表合并新规则。

注：`initializationResult()` 是否返回当前生效 settings 需实施时验证；若不行，可在 session 内自己维护 `currentAllowRules: string[]` 状态。

### 3.4 设置页 UI 调整

`SkillsTab.tsx` 增强提示文案：

> 启用「股票分析」后：
> - 默认只占用 ~100 token（仅 Skill 描述）
> - Agent 判断需要时自动加载 7 个工具（首次约 +3000 token）
> - 工具加载后自动授权，无需点击允许
> - 每个会话独立，会话结束自动释放

让用户清楚「启用 ≠ 立即占用」。

---

## 四、风险和兜底

| 风险 | 可能性 | 影响 | 兜底 |
|------|-------|------|------|
| `setMcpServers` 在 streaming input mode 外不可用 | 低 | hook 调用失败 | dogear 当前已是 streaming mode，不会触发；hook 内 try/catch + 降级日志提醒用户重启 |
| 「整体替换」时漏传现有 server | 中 | article-parse 等被顶掉 | 强制走 mcpServerStatus() 拿当前列表，再合并 |
| Hook 内 await 太久导致 Skill 工具响应延迟 | 低 | 用户体感变慢 | createStockAnalysisTools 是同步工厂，setMcpServers 实测 <100ms |
| applyFlagSettings 的 permissions 合并语义和预期不符 | 中 | 自动授权失效 | 实施前先单独跑一个测试：在 streaming session 中调一次 applyFlagSettings 看 permissions 是否生效；不行就退化为 `permissionMode: 'bypassPermissions'`（仅本次工具调用） |
| Hook 触发后 agent 不知道工具已可用 | 低 | agent 不调用新工具 | 通过 `additionalContext: '已自动加载 xxx 工具'` 告诉 agent；同时 SKILL.md 正文里明确写"调用 SkillTool 后下一轮即可使用 MCP 工具" |
| `initializationResult()` 不能返回当前 allow 列表 | 中 | 无法合并已有规则 | session 内自维护 `currentAllowRules` 状态，hook 触发时基于此合并 |

---

## 五、实施步骤

### Phase 1：API 验证（0.5 天）

在动手大改前先**单独写个最小可运行 demo** 验证以下三个 API 在 streaming input mode 下的实际行为：

1. `query.setMcpServers()` 能否在会话进行中动态加 MCP server，且新工具立即可见
2. `query.applyFlagSettings({ permissions: { allow: [...] } })` 能否运行时生效（避免权限询问）
3. `PreToolUse` hook 内 await 异步操作（`setMcpServers` + `applyFlagSettings`）能否串行完成

验证脚本写在 `electron/main/agents/__tests__/skill-on-demand-poc.ts`（手动跑，不进 build）。

**Gate**：三个 API 都通过验证才进 Phase 2，否则回到当前方案+「启用即授权」改造。

### Phase 2：实施（0.5-1 天）

- [ ] **Step 1**：扩展 `optional-skills.ts` 的 OptionalSkillMeta，加 `mcpServerName / mcpServerFactory / autoApproveOnTrigger`
- [ ] **Step 2**：改 `conversation-runtime-service.ts`，移除 stock-analysis MCP 预注册，改为传 `enabledSkillsForOnDemand`
- [ ] **Step 3**：改 `query-based-session.ts`：
  - QueryBasedSessionConfig 加 `enabledSkillsForOnDemand` 字段
  - 启动时注册 PreToolUse hook
  - 维护 `loadedServers: Set<string>` 防重复
  - 加日志：`[Skill on-demand] 触发 / 加载 / 完成 / 失败` 四个时机都打
- [ ] **Step 4**：SKILL.md 更新提示文案，明确告诉 agent「调用此 Skill 后下一轮即可使用 MCP 工具」
- [ ] **Step 5**：`SkillsTab.tsx` 改提示文案
- [ ] **Step 6**：build:electron + 手动联调

### Phase 3：验证（0.5 天）

测试矩阵：

| 场景 | 期望 |
|------|------|
| 未启用 stock-analysis | mcp_servers 不含 dogear-stock-analysis；system prompt 无 SKILL.md |
| 启用但本次对话不调用 | mcp_servers 不含 dogear-stock-analysis；system prompt 含 SKILL.md frontmatter（~100 token） |
| 启用且 agent 主动调 Skill(stock-analysis) | hook 触发 → MCP 挂上 → 下一轮 agent 看到 7 个工具 → 直接调用无权限询问 |
| 同一会话多次调用 stock-analysis 工具 | 第一次后 loadedServers 标记，后续直接放行不重复挂载 |
| 启用了但 Skill 描述判断不命中 | mcp_servers 不含 dogear-stock-analysis（永远不付 ~3000 token 成本）|
| 关闭 stock-analysis 后新建会话 | mcp_servers 不含；plugins 不含；完全 0 占用 |

---

## 六、不在本方案范围

- **B3.4 book-analysis Skill 迁移**：方案验证通过后，复制到 book-analysis 即可（3 个工具）
- **多 Skill 同时触发的并发竞争**：当前 OPTIONAL_SKILLS 只有一个，未来扩展时再设计
- **Skill 卸载逻辑**：会话结束自然释放，不主动卸载
- **跨会话 MCP 状态共享**：每会话独立 query 实例，不共享，符合「会话隔离」原则

---

## 七、决策项（待用户确认）

1. **是否启动 Phase 1 API 验证？** 方案理论上可行，但 setMcpServers / applyFlagSettings 的实际行为最好在动主代码前用 ~50 行 demo 验证一遍，避免到 Phase 2 才发现 SDK 行为不符预期
2. **autoApproveOnTrigger 的回退策略**：如果 applyFlagSettings 验证不通过，是否接受退化为「触发时不自动授权，第一次仍要点允许」？这种情况下用户在「设置 → 工具权限」给 7 个工具批量加 allow 也能达到等价效果
3. **是否延后 B3.4**：先做完 B3.3 修订并验证稳定后再做 book-analysis，避免同时改两个 Skill 增加排错难度

---

## 八、和原 milestone-1.5 计划的关系

`docs/plans/2026-05/2026-05-07/milestone-1.5-workspace-ux-and-skill.md` 中 B3.3 原计划是「7 个工具迁 Python 脚本 + Bash 调用」，因为 K 线服务在 TS 层（限流/缓存/备用源），脚本独立抓数据会破坏防御，所以保留 MCP + Python Bridge 架构。

本方案是**对 B3.3 的二次修订**：保持 MCP + Python Bridge 不变，但通过 SDK 运行时 API（`setMcpServers` / `applyFlagSettings`）实现真正的按需加载，达到原计划「按需」的目标，且无需重写 7 个工具。

---

## 九、修订历史

- 2026-05-09：初版。基于阅读 `claude_code_doc_md/sdk-^0.2.119/Agent SDK 参考 - TypeScript.md` 后纠正了「SDK 不支持运行时 MCP 注册」的误判，提出 hook + setMcpServers 的按需加载方案。
