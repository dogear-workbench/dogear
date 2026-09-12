---
step: 1
title: 能力注册表与配置扩展
status: done
---

## 目标

建立数据模型层：能力注册表单一真源 + 配置存储扩展，纯新增不改运行行为。

## 依赖上下文（接力棒输入）

- 设计全文：`docs/plans/2026-09/2026-09-12/ability-pack-design.md`
- 现状参考：
  - `app/settings/ability-types.ts` — 现有 `SKILL_PACK_MAP`（skill→工具包映射）、`RESIDENT_GROUPS`（5 常驻组）、`ABILITY_DOMAINS`（4 域），本步迁移其信息到注册表
  - `electron/main/agents/session-append-templates.ts` — 段定义已有 key（group-context / memory-guidance / notes-discipline / main-agent-delegation / sub-agent-contract / profile-index）
  - WorkspaceConfig 真源在主进程 workspace config 读写服务，渲染层镜像 `types/electron-api.ts`，现字段 `enabledToolPacks` / `enabledSkills`

## 计划改动

- [ ] 新建 `electron/main/agents/ability-registry.ts`：
  - `interface AbilityPack`（key/label/description/type/segmentKeys/toolGroups/skills/defaultEnabled，另加 `icon`? 字段留给前端展示可选）
  - `ABILITY_PACKS: AbilityPack[]` — 10 个包：
    - prompt-only：`workspace-rules`（工作区规则）、`global-rules`（全局规则）、`core-profile`（核心画像），defaultEnabled: true
    - segment-tools：`memory`（段 memory-guidance + 组 dogear-memory）、`notes`（段 notes-discipline + 组 dogear-notes）、`agent-collab`（段 main-agent-delegation + 组 dogear-delegation/dogear-group/dogear-reference），defaultEnabled: true
    - skill-packs：`stock`（skills: stock-analysis/stock-picking + 包 stock-quote/stock-analysis/stock-announcement/stock-picking）、`article`（article-parser + article）、`browser`（browser-exploration + browser）、`code-workflow`（6 skill 无工具包），defaultEnabled: false
  - `resolveAbilities(config, opts)` — 输入 wsConfig + `{ role: 'main'|'sub', isExecutor, groupId, hasWorkspace, profile? }`，输出 `Set<string>` 生效包 key；规则：abilityOverrides 覆盖 defaultEnabled → 触发条件过滤（memory 需 hasWorkspace；agent-collab 主会话需 groupId；子会话 agent-collab 契约不在此处理）；skill 型包生效不代表包内 skill 全启用（细闸在调用侧取交集 enabledSkills）
  - `SYSTEM_BEHAVIORS` — 结构性段元数据（组上下文/子会话契约/Profile 索引：label + triggerDescription + 只读标记），供「系统行为」卡展示
- [ ] WorkspaceConfig 类型加 `abilityOverrides?: Record<string, boolean>`：主进程真源 + `types/electron-api.ts` 镜像
- [ ] `session-append-templates.ts`：核对段 key 与注册表 segmentKeys 一致，缺的补（main-agent-delegation 若无 key 则补）
- [ ] 不改 pi-session.ts（Step 2 做），本步注册表是死数据

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - toolGroups 为混合 ID：常驻组存 MCP server 名（dogear-memory）、可选包存工具包 name（stock-quote），两类集合不相交可唯一定位
  - 新增导出 SKILL_PACK_MAP（skill→可选工具包 name 映射，自 ability-types.ts 迁入），供 Step 2 细闸消费
  - profile-index 段实际不存在（Profile 索引拼在 main-agent-delegation 段内），SYSTEM_BEHAVIORS 的 profile-index 条目 segmentKey 指向 main-agent-delegation，不拆段
  - session-append-templates.ts 补导出 SystemPromptSegmentKey 联合类型，注册表 segmentKeys 编译期防漂移（超出计划的正向加固）
  - isExecutor 不参与包级过滤（现状 executor 只裁 notes 段不裁工具组，包级剔除会改变现状），字段保留透传
- 改动文件清单：
  - `electron/main/agents/ability-registry.ts`（新建：AbilityPack + ABILITY_PACKS 10 包 + SKILL_PACK_MAP + resolveAbilities + SYSTEM_BEHAVIORS）
  - `electron/main/agents/session-append-templates.ts`（导出 SystemPromptSegmentKey + 返回类型收窄）
  - `electron/main/services/workspace-config-service.ts`（WorkspaceConfig.abilityOverrides + merge）
  - `types/electron-api.ts`（镜像同步）

### 给下一步的接力棒
- 关键签名 / 数据结构：`resolveAbilities(config, opts: {role, isExecutor?, groupId?, hasWorkspace, profile?}) → Set<string>`；生效 = abilityOverrides 覆盖 defaultEnabled ∩ 触发条件（memory 主会话需 hasWorkspace/子会话需 profile.memory；notes 仅主会话+hasWorkspace；agent-collab 需 groupId）∩ 子会话 Profile 过滤（stock/article/browser 需 enabledAbilities 对应 true）
- 下个 step 该从哪里继续：Step 2 拼装侧消费 resolveAbilities；保留特判：子会话 dogear-group/dogear-delegation 始终注册（dogear-reference 受 profile.reference 细控）、sub-agent-contract 段不受包开关、executor 跳 notes 段但保留工具组
- 待办或已知限制：dogear-tasks 工具组与 extension 工具包不在 10 包体系内（计划即如此）；icon 字段留空待 Step 4 填
