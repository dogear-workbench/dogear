---
step: 3
title: PiSession 运行时改造
status: done
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

- [x] `pi-session.ts` PiSessionConfig 接口新增：
  ```typescript
  /** role='sub' 时传入的 Profile 配置，驱动提示词段/工具/skill 的按需加载 */
  subAgentProfile?: SubAgentProfile;
  ```

### 3.2 提示词拼装改造（start() 方法）

当前逻辑 `pi-session.ts:238-271` 不区分主/子会话的能力域加载。改为：

- [x] 子会话提示词拼装改为 Profile 驱动（pi-session.ts:325-342）：
  - agent.md（通用 + 工作区）：始终加载
  - MEMORY_GUIDANCE_APPEND：仅 memory===true
  - NOTES_GUIDANCE_APPEND：仅 groupFiles===true
  - groupContextText：仅 groupId && (groupFiles||reference)
  - subAgentContractFor：始终注入
- [x] 主会话提示词拼装保持不变

### 3.3 工具构建改造（start() 方法）

当前逻辑 `pi-session.ts:273-355` 中，子会话和主会话走同一套工具构建。改为：

- [x] buildSubAgentToolDefs() 方法（pi-session.ts:477）：基础工具始终创建、Skill 按 skill 勾选、memory/stock/article/group/reference 按能力域、delegation 固定
- [x] buildMainAgentToolDefs() 方法（pi-session.ts:410）：保持原有逻辑
- [x] registerPack 从局部函数提取为私有方法

### 3.4 activeToolNames 计算

- [x] `computeSubAgentActiveTools(profile, toolDefs)` 函数（pi-session.ts:149）：enabledBasicTools Set + toolDefs 所有工具名去重
- [x] 主会话 activeToolNames = undefined（全部激活）

### 3.5 PiHarnessAdapter 透传

- [x] `pi-harness-adapter.ts:67`：PiHarnessAdapterOptions 新增 `activeToolNames?: string[]`
- [x] `pi-harness-adapter.ts:90`：构造 AgentHarness 时传入 activeToolNames
- [x] `pi-session.ts:376`：构造 PiHarnessAdapter 时传入 activeToolNames

### 3.6 skill 加载过滤

- [x] `filterSkillsForSubAgent(entries, profile, scanDirs)` 函数（pi-session.ts:124）：使用 path.relative 安全判断 skill 目录归属，按 skills/customSkills/article/memory 过滤
- [x] 过滤后的 entries 传给 formatSkillIndexForPrompt 和 createSkillTool

## 验证

- `bun run build:electron` 编译通过
- 主会话启动正常，工具集和提示词不变
- 子会话启动后，从日志确认 activeToolNames 只含勾选的工具
- 不勾选任何能力域的子会话：无 skill 索引、无 Skill 工具、无记忆/股票/文章/共享区/引用工具

## 实施回填（做完后填）

### 实际改动
- `pi-session.ts` — 新增 subAgentProfile 字段（line 80）、filterSkillsForSubAgent 函数（line 124）、computeSubAgentActiveTools 函数（line 149）、buildMainAgentToolDefs 私有方法（line 410）、buildSubAgentToolDefs 私有方法（line 477）、registerPack 提取为私有方法（line 400）；start() 内提示词拼装按主/子分支（line 275-344）；修复 Step 2 遗留的 loadCoreProfile 编译错误
- `pi-harness-adapter.ts` — PiHarnessAdapterOptions 新增 activeToolNames（line 67），构造 AgentHarness 传入（line 90）

### 给下一步的接力棒
- PiSessionConfig.subAgentProfile 字段在 `pi-session.ts:80`，类型 `SubAgentProfile | undefined`
- computeSubAgentActiveTools 在 `pi-session.ts:149`，签名 `(profile: SubAgentProfile, toolDefs: ToolDef[]): string[]`
- filterSkillsForSubAgent 在 `pi-session.ts:124`，签名 `(entries: SkillEntry[], profile: SubAgentProfile, scanDirs) => SkillEntry[]`
- 子会话提示词拼装在 `pi-session.ts:325-344`
- **已知编译错误（Step 4 修复）**：
  1. `delegation-bridge.ts:191` — 读 `subAgent.modelSelection`
  2. `delegation-bridge.ts:214` — 读 `subAgent.cachePolicy` → 固定 '5m'
  3. `delegation-bridge.ts:267` — 读 `subAgent.timeoutMinutes`
  4. `delegation-tools.ts:127` — 读 `subAgent.timeoutMinutes`
