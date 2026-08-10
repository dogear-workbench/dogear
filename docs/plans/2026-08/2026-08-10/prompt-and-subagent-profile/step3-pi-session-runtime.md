---
step: 3
title: PiSession 运行时改造
status: pending
---

## 目标

让 PiSession 在子会话模式下根据 Profile 配置加载提示词段、工具和 skill，通过 activeToolNames 控制实际激活的工具集。主会话模式保持不变。

## 依赖上下文（接力棒输入）

- Step 2 产出：`SubAgentProfile` 类型、`AppSettings.subAgent.profiles` 结构
- 当前提示词拼装逻辑：`pi-session.ts:238-271`（start() 方法内）
- 当前工具构建逻辑：`pi-session.ts:273-355`（start() 方法内）
- PiHarnessAdapter 构造：`pi-harness-adapter.ts:77-84`，目前不传 `activeToolNames`
- AgentHarness 支持 `activeToolNames` 选项：构造函数或 `setActiveTools()` 设置后，只将白名单内的工具发给模型
- PiSessionConfig 当前签名：`pi-session.ts:61-91`

## 计划改动

### 3.1 PiSessionConfig 新增字段

- [ ] `pi-session.ts` PiSessionConfig 接口新增：
  ```typescript
  /** role='sub' 时传入的 Profile 配置，驱动提示词段/工具/skill 的按需加载 */
  subAgentProfile?: SubAgentProfile;
  ```

### 3.2 提示词拼装改造（start() 方法）

当前逻辑 `pi-session.ts:238-271` 不区分主/子会话的能力域加载。改为：

- [ ] 子会话提示词拼装改为 Profile 驱动：
  - agent.md（通用 + 工作区）：始终加载（同主会话）
  - skill 索引：只包含 Profile 中勾选的 skill（skills + customSkills + memory 的 cross-session-review + stock 的 stock-analysis/stock-picking + article 的 article-parser）
  - MEMORY_GUIDANCE_APPEND：仅当 `enabledAbilities.memory === true` 时注入
  - NOTES_GUIDANCE_APPEND：仅当 `enabledAbilities.groupFiles === true` 时注入
  - groupContextText：仅当 `enabledAbilities.groupFiles === true || enabledAbilities.reference === true` 时注入（子会话需要知道组背景才能用共享区/引用工具；不勾选则不注入以省 context）
  - subAgentContractFor：始终注入（交付通信是固定的）
- [ ] 主会话提示词拼装保持不变

### 3.3 工具构建改造（start() 方法）

当前逻辑 `pi-session.ts:273-355` 中，子会话和主会话走同一套工具构建。改为：

- [ ] 基础工具（createBuiltinFileTools + createSearchToolDefs）：始终全部创建
- [ ] Skill 工具（createSkillTool）：当 Profile 有 ≥1 个 skill 勾选时创建
- [ ] dogear-memory：仅当 `enabledAbilities.memory === true` 时注册
- [ ] dogear-memory-review：仅当 `enabledAbilities.memory === true` 时注册（归入记忆系统域）
- [ ] stock 工具包：仅当 `enabledAbilities.stock === true` 时注册
- [ ] article 工具包：仅当 `enabledAbilities.article === true` 时注册
- [ ] dogear-group：仅当 `enabledAbilities.groupFiles === true` 时注册
- [ ] dogear-delegation：始终注册（固定）
- [ ] dogear-reference：仅当 `enabledAbilities.reference === true` 时注册

### 3.4 activeToolNames 计算

- [ ] 在 PiHarnessAdapter 构造前，根据 Profile 计算 activeToolNames：
  ```typescript
  const activeToolNames = isSubAgent
    ? computeSubAgentActiveTools(profile, toolDefs)
    : undefined; // 主会话不传 = 全部激活
  ```
- [ ] `computeSubAgentActiveTools` 逻辑：
  - 基础工具：取 profile.enabledBasicTools（注意大小写映射：'read'→'Read', 'Glob'→'Glob' 等，需对齐工具实际名称）
  - 交付通信：固定加入 SendMessage/WaitForMessage/ListLinkedSessions/StopSession
  - 能力域：按 profile 映射加入对应工具名
  - Skill 工具：有勾选 skill 时加入 'Skill'

### 3.5 PiHarnessAdapter 透传

- [ ] `pi-harness-adapter.ts`：
  - PiHarnessAdapterOptions 新增 `activeToolNames?: string[]`
  - 构造 AgentHarness 时传入：`new AgentHarness({ ..., activeToolNames: options.activeToolNames })`
- [ ] `pi-session.ts` 构造 PiHarnessAdapter 时传入 activeToolNames

### 3.6 skill 加载过滤

- [ ] `pi-session.ts` 中 `loadSkillIndex` 调用后，子会话需要按 Profile 过滤 skill entries：
  - 代码工作流 skill：只保留 `profile.enabledAbilities.skills` 中列出的
  - 自定义 skill：只保留 `profile.enabledAbilities.customSkills` 中列出的
  - 记忆/股票/文章 skill：按对应能力域开关决定
- [ ] 过滤后的 entries 传给 `formatSkillIndexForPrompt` 和 `createSkillTool`

## 验证

- `bun run build:electron` 编译通过
- 主会话启动正常，工具集和提示词不变
- 子会话启动后，从日志确认 activeToolNames 只含勾选的工具
- 不勾选任何能力域的子会话：无 skill 索引、无 Skill 工具、无记忆/股票/文章/共享区/引用工具

## 实施回填（做完后填）

### 实际改动
- （待填）

### 给下一步的接力棒
- PiSessionConfig.subAgentProfile 字段的完整签名
- computeSubAgentActiveTools 函数的导出路径和签名
- 子会话提示词拼装的实际代码位置和行号（供 Step 4 检查 Profile 索引注入的衔接点）
