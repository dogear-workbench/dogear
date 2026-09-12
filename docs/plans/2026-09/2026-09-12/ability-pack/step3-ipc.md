---
step: 3
title: IPC 路由
status: done
---

## 目标

暴露能力元数据与挂载索引给渲染层，确认规则文件读写链路可复用。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2-session.md] pi-session 已消费 resolveAbilities，注册表数据结构稳定
- 现状参考：`electron/main/tipc/index.ts` 路由注册中枢；`system-prompt.ts` 路由已有 getSystemPromptSegments（本步评估去留——详情页改用注册表数据后该路由是否仍被引用）
- WorkspaceRuleDialog 现有 agent.md 读写 IPC 链路（找到具体路由名，全局 agent.md 是否同链路待确认）

## 计划改动

- [x] 新建 `electron/main/tipc/ability.ts`：
  - `getAbilityPacks()` — 返回 `{ packs: AbilityPack[], systemBehaviors: SystemBehavior[] }`（含每包的段 label、工具组 label、skill 描述等展示所需元数据，从注册表 + session-append-templates + tool-registry 聚合）
  - `getAbilityMounts(key)` — 读时扫描：全部工作区 config（abilityOverrides/enabledSkills → 判定包启用）+ `settings.subAgent.profiles`（能力域/memory/skill 与包的交集）+ scheduler tasks（toolPacksOverride 工具包名经注册表反查所属包）；返回分组结构 `{ workspaces: [...], profiles: [...], tasks: [...] }`
- [x] `tipc/index.ts` 注册新路由
- [x] 确认 agent.md 读写：工作区级与全局级的读写 RPC 均已存在（readUserAgentMd/writeUserAgentMd 等），无需补齐
- [x] 渲染层 `types` 镜像：免镜像，createClient<Router> 自动推导 + 需要时 import type
- [x] `getSystemPromptSegments` 路由处置：保留（AbilityTab 仍活跃消费，Step 4 切源后 Step 5 删），SystemBehavior 数据已并入 getAbilityPacks

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - `getAbilityMounts` 的 Profile 维度判定抽为注册表纯函数 `buildProfileAbilityMount`（与 `resolveAbilities` 同文件同源维护，可脱离 tipc 环境单测）
  - 仅 memory/stock/article/browser/code-workflow 五包有 Profile 过滤维度，其余包 profiles 组返回空数组（prompt-only/notes/agent-collab 无 Profile 细闸）；code-workflow 的 Profile 过滤在运行时位于 skill 级（filterSkillsForSubAgent 的 ab.skills），非包级
  - `getSystemPromptSegments` 路由保留未删（唯一消费方 AbilityTab.tsx:94 仍活跃，Step 4 前端切数据源后 Step 5 cleanup 再删）；getAbilityPacks 内部直接调同名函数聚合段全文
  - agent.md 全局级读写 RPC 已存在（readUserAgentMd/writeUserAgentMd/getUserAgentTemplate），无需补齐
  - 类型流转免镜像：前端经 createClient<Router> 自动推导，组件需显式类型时可 `import type` 自 `electron/main/tipc/ability.ts`（有 ExtensionStatus 先例）
  - abilityOverrides 快照标脏未接线（范围约束“本步不强做”）：复用方式 = PiSessionManager 遍历 sessions 匹配 getWorkspaceId() 调 markSnapshotDirty()（rebuildForSettingsChange 重走 start() 自然消费新包开关），挂到 updateWorkspaceConfig 路由写 abilityOverrides 后
- 改动文件清单：
  - 新建 `electron/main/tipc/ability.ts`：getAbilityPacks / getAbilityMounts 两路由 + 展示类型
  - 新建 `electron/main/agents/ability-registry.test.ts`：9 项测试（Profile 挂载判定 / 与 resolveAbilities 对齐性 / TOOL_PACK_TO_ABILITY 反查）
  - 改 `electron/main/agents/ability-registry.ts`：新增 ProfileAbilityMount 类型 + buildProfileAbilityMount()
  - 改 `electron/main/tipc/index.ts`：注册 abilityRouter

### 给下一步的接力棒
- 关键签名 / 数据结构：见共享区 step3-delivery.md（含完整返回 JSON 示例）
- 下个 step 该从哪里继续：Step 4 前端两级页面，数据源 getAbilityPacks() + getAbilityMounts(key)，开关写 updateWorkspaceConfig({ abilityOverrides })
- 待办或已知限制：
  - getSystemPromptSegments 路由待 Step 4 切换后删除（Step 5 cleanup）
  - stock-analysis 工具组实际工具数 10 与 OPTIONAL_TOOL_PACKS.toolCount 声明 6 漂移（存量）；前端展示用 toolGroupMetas[].tools.length 实际值
  - bun 对 'electron' 有内建 shim，主进程单元测试中 mock.module('electron') 不可靠，重定向目录用 DOGEAR_CONFIG_DIR
