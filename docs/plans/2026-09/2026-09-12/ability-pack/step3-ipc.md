---
step: 3
title: IPC 路由
status: pending
---

## 目标

暴露能力元数据与挂载索引给渲染层，确认规则文件读写链路可复用。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2-session.md] pi-session 已消费 resolveAbilities，注册表数据结构稳定
- 现状参考：`electron/main/tipc/index.ts` 路由注册中枢；`system-prompt.ts` 路由已有 getSystemPromptSegments（本步评估去留——详情页改用注册表数据后该路由是否仍被引用）
- WorkspaceRuleDialog 现有 agent.md 读写 IPC 链路（找到具体路由名，全局 agent.md 是否同链路待确认）

## 计划改动

- [ ] 新建 `electron/main/tipc/ability.ts`：
  - `getAbilityPacks()` — 返回 `{ packs: AbilityPack[], systemBehaviors: SystemBehavior[] }`（含每包的段 label、工具组 label、skill 描述等展示所需元数据，从注册表 + session-append-templates + tool-registry 聚合）
  - `getAbilityMounts(key)` — 读时扫描：全部工作区 config（abilityOverrides/enabledSkills → 判定包启用）+ `settings.subAgent.profiles`（能力域/memory/skill 与包的交集）+ scheduler tasks（toolPacksOverride 工具包名经注册表反查所属包）；返回分组结构 `{ workspaces: [...], profiles: [...], tasks: [...] }`
- [ ] `tipc/index.ts` 注册新路由
- [ ] 确认 agent.md 读写：工作区级与全局级的读写 RPC 现状，缺全局级补齐（规则文件详情页内嵌编辑要用）
- [ ] 渲染层 `types` 镜像：AbilityPack/Mounts 类型（或前端直接 import type——按项目现状 tipc 类型自动流转则免镜像）
- [ ] `getSystemPromptSegments` 路由处置：若无消费方则删除，SystemBehavior 数据并入 getAbilityPacks

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
