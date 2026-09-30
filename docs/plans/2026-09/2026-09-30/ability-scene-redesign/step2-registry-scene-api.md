---
step: 2
title: 注册表分类字段 + getSceneOverview 接口
status: done
---

## 目标

后端数据层就绪：AbilityPack 增加 category 三分类；tipc 新增 `getSceneOverview` 场景总览接口；memory 双闸文案修正。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1] core-profile 已删，ABILITY_PACKS 剩 13 包
- 关键现状：`tipc/ability.ts` 的 `buildMountRows`（按包产场景行）与 `sceneReason`/`personalSceneReason`/`schedulerCustomAgentCell` 文案函数是场景数据的现成底座，本步按场景维度重组输出

## 计划改动

- [x] `electron/main/agents/ability-registry.ts`：`AbilityPack` 接口加 `category: 'system' | 'context-memory' | 'extension'`；13 包逐一归类（system: workspace-rules/global-rules/notes/agent-collab/shunt；context-memory: memory/group-context/workspace-git；extension: stock/article/browser/web-mcp/code-workflow）；导出 `ABILITY_CATEGORIES` 有序常量（含 key+label+一句话说明），供能力页/场景页共用
- [x] `electron/main/tipc/ability.ts` 新增 `getSceneOverview: t.procedure.input<{ workspaceId: string }>().action(...)`，返回六场景总览：

```ts
interface ScenePackCell {
  key: string; label: string; category: AbilityCategory;
  enabled: boolean;      // 该场景真源里的开关现值（overrides ?? default / personal 同式 / 定时=enabledToolPacks 命中）
  loaded: boolean;       // 最终装配结果（resolveAbilities 判定，只读场景按现状矩阵语义）
  editable: boolean;     // 该格是否有裁决权（灰显 = false）
  reason: string;        // 一行触发说明，复用/重组 sceneReason 系文案
  subToggles?: {         // 仅可编辑场景的展开层
    skills: { name: string; title?: string; enabled: boolean }[];
    toolPacks: { id: string; label: string; enabled: boolean }[];
  };
}
interface SceneOverviewRow {
  id: 'main' | 'personal' | 'executor' | 'scheduler-custom' | 'scheduler-state' | 'scheduler-parse';
  label: string; editable: boolean; description: string;  // 只读场景的整页说明
  packs: ScenePackCell[];
}
```

  实现要点：复用 `buildMountRows` 内部逻辑按场景维度重排（一次遍历六场景 × 13 包），避免包维度六次调用；executor/state/parse 三场景 `editable: false` 整页只读，packs 仍给 loaded/reason（executor 随主会话开关、state/parse 恒空装配说明）
- [x] `tipc/ability.ts` `profileFilterReason`（约 281 行）memory 分支文案补双闸说明
- [x] 确认 `client.updateWorkspaceConfig` 对 PERSONAL_WORKSPACE_ID 写入支持
- [x] 前端类型镜像（改为 tipc 推导可达 + ability-scene.ts 导出，不复制双份）

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
  - 新建 `electron/main/tipc/ability-scene.ts` 承载场景数据底座：原 ability.ts 的挂载矩阵类型/文案函数/构建函数迁入（避免 ability.ts ↔ 新文件循环依赖），ability.ts re-export AbilityMountSceneRow/AbilityMountSceneKind/SYSTEM_MOUNTS_PACK_KEY 保持前端 import 兼容
  - getSceneOverview 返回 `{ rows, categories }` 而非裸数组：categories 附带三大类分组头数据（key+label+description），前端分组直接消费返回值，不需 import 主进程值常量（值 import 会把 electron 依赖链拉进 renderer bundle）
  - subToggles 只给 skill-packs 包（design「总分两级开关」：prompt-only/segment-tools 无展开层）；scheduler-custom 行只给带 toolGroups 的 skill-packs（web-mcp/stock/article/browser，code-workflow 无工具包层不给）
  - schedulerCustomAgentCell 的 notes 文案修正：buildCustomToolSet 实际恒装 dogear-notes（任务产物落卡），原文案「loaded: false 笔记与任务工具为主会话专属」失实，改为 loaded: true + 固定装载说明（对 memory 行的既有语义同式）
  - 前端类型不复制进 types/electron-api.ts：现有模式即前端从 tipc 文件 type-only import（AbilityMountsSection.tsx 先例），新类型在 tipc/ability-scene.ts 导出，tipc 推导可达
- 改动文件清单：
  - `electron/main/agents/ability-registry.ts`：AbilityCategory 类型 + AbilityPack.category 必填字段 + 13 包归类 + ABILITY_CATEGORIES 有序常量
  - `electron/main/tipc/ability-scene.ts`（新）：挂载矩阵底座迁入 + SceneOverviewId/ScenePackCell/SceneOverviewRow 等类型 + buildSceneOverview（六场景×13 包一次遍历）
  - `electron/main/tipc/ability.ts`：迁出场景底座、加 getSceneOverview 路由（565→272 行）、profileFilterReason memory 双闸文案（迁入 ability-scene.ts 时修正）

### 给下一步的接力棒

- 关键签名：`client.getSceneOverview({ workspaceId })` → `{ rows: SceneOverviewRow[], categories } | { error }`；SceneOverviewRow.id: 'main'|'personal'|'executor'|'scheduler-custom'|'scheduler-state'|'scheduler-parse'；ScenePackCell { key,label,category,enabled(真源开关现值),loaded(最终装配),editable(灰显=可裁决权),reason,subToggles?{skills,toolPacks} }
- 开关写回通道（step3）：main 行写 `updateWorkspaceConfig(workspaceId, { abilityOverrides })`；personal 行同通道 workspaceId=PERSONAL_WORKSPACE_ID（已验证支持写入，非阻塞）；scheduler-custom 行写 `{ enabledToolPacks }`；恢复默认：main=清 overrides（传空对象 {}）即回落注册表 defaultEnabled，personal=传空对象/空数组回落 PERSONAL_DEFAULT_CONFIG（getWorkspaceConfig 合并语义），定时=清 enabledToolPacks
- 个人写入 caveat：updateWorkspaceConfig 对 personal 会把合并 defaults 后的全集固化进 stored（首次写入后 defaults 版本变更不再自动生效，恢复默认写空即回正轨）；personal 的 enabledToolPacks 写空数组读时回落 ['web-mcp']（恰好等于恢复默认语义，无碍）
- 下个 step（step3 UI）从共享区 2026*-step2-delivery.md 取 SceneOverviewRow 最终形态与用法示例
- 待办或已知限制：personal config 无路径时（未绑定工作区）`workspaces/personal/` 目录不存在，getWorkspaceConfig 回落 defaults，属正常；'dogear-extension' 在 subToggles.toolPacks 中 enabled 恒 false（非 enabledToolPacks 合法成员），UI 需按 OPTIONAL_TOOL_PACKS 名单判可点性（scene cell 已带 label「浏览器扩展」）
