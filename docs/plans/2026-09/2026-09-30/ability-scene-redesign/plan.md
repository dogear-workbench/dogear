# 能力区重构（场景维度 + 只读化 + core-profile 退役）实施计划

**目标**：能力页纯展示化并按三大类分组，新增「场景」tab 承载全部能力启停（总分两级开关 + 恢复默认），core-profile 整链路删除。

**架构思路**：场景页是转置矩阵+编辑入口，不引入新开关真源，格内开关写回底层字段（abilityOverrides / enabledSkills / enabledToolPacks / personal config）。三大类作为 AbilityPack.category 进入注册表单一真源。详见 [design.md](./design.md)。

**涉及模块**：`electron/main/agents/ability-registry.ts`、`pi-session.ts`、`memory-tools.ts`、`memory-loader.ts`/`memory-fs.ts`、`tipc/ability.ts`、`tipc/memory.ts`、`workspace-config-service.ts`、`app/settings/`（AbilityTab 改造 + scene/ 新增 + page.tsx）、数据中心记忆面板、docs/codebase-map。

## 步骤索引

- [x] [Step 1: core-profile 整链路删除](./step1-remove-core-profile.md) — 删包定义/装配注入/agent 工具/IPC/数据中心入口/personal 默认键
- [x] [Step 2: 注册表分类字段 + getSceneOverview 接口](./step2-registry-scene-api.md) — AbilityPack.category、场景总览 IPC、memory 双闸文案
- [x] [Step 3: 能力页只读化 + 三大类分组](./step3-ability-readonly.md) — 撤开关、分组渲染、开关逻辑提取共享模块
- [x] [Step 4: 场景 tab 新增](./step4-scene-tab.md) — 六场景侧栏、总分开关、恢复默认、灰显只读
- [x] [Step 5: 文档同步与提交](./step5-docs-commit.md) — codebase-map 三域同步、完成总结、git commit

## 全局决策

- **单一真源**：场景页开关只写既有字段，不发明场景级开关；大类分组头无开关
- **分类枚举**：`AbilityPack.category: 'system' | 'context-memory' | 'extension'`，展示顺序 system → context-memory → extension；标签常量导出供能力页/场景页共用
- **联动语义沿用**：开总开关只补齐 enabledSkills/enabledToolPacks 不删；关总开关只写 overrides 不动子开关（算法即现状 `AbilityTab.handleTogglePack/handleToggleSkills`，Step 3 提取到共享模块供 Step 4 复用）
- **恢复默认语义**：主会话=清空该工作区 abilityOverrides；临时会话=恢复 PERSONAL_DEFAULT_CONFIG；定时任务=清空 enabledToolPacks；一律先 `showConfirm()`
- **灰显不隐藏**：条件不满足/代码定死的项灰显+reason（复用 `sceneReason`），定时任务场景 memory 行灰显标「固定装载」
- **规则编辑器留在能力页**：agent.md 正文编辑是内容编辑非装配开关，RulesPackDetailPage 编辑器保留；规则包的开关行进场景页
- **残留容错**：`abilityOverrides.core-profile` 残留 key 静默忽略（机制已有）；存量空 core-profile.md 不清理
- **验证基线**：主进程改动后 `bun run build:electron` 必须过；前端改动 Vite 热重载目验；项目不写注释，WHY 非显而易见时一行
- **测试**：项目偏好不写单测，改动波及现有测试文件时（ability-registry.test.ts 等）同步更新

## 完成总结

### 实际改动汇总（Step 1-5，均已提交）

- **Step 1 core-profile 退役**（f66ceb02）：删包定义/装配注入/画像 agent 工具/画像 IPC 路由/数据中心画像面板/personal 默认键，连带清理全部孤儿代码（memory-loader.ts、core-profile-panel.tsx 整文件删除）；ABILITY_PACKS 剩 13 包；顺带同步 codebase-map 两处
- **Step 2 注册表分类 + 场景总览接口**（caea8dba）：AbilityPack.category 三分类（system/context-memory/extension）+ ABILITY_CATEGORIES 有序常量；场景数据底座迁入新建 tipc/ability-scene.ts，getSceneOverview IPC 上线；修正 memory 双闸与定时任务 notes 装配文案
- **Step 3 能力页只读化**（b4c04606）：能力页撤除全部装配开关（卡片/侧栏/详情页），按三大类分组展示；开关写回算法提取到共享模块 app/settings/ability/config-mutations.ts；pack-meta.ts 加 CATEGORY_FALLBACK 兜底；SubAgentTab 记忆块补双闸说明
- **Step 4 场景 tab**（4ceeaa4e）：新建 app/settings/scene/（SceneTab.tsx 344 行 + SceneAbilityRow.tsx 146 行），六场景侧栏、总分两级开关、恢复默认全部写回底层真源（abilityOverrides/enabledSkills/enabledToolPacks/personal config），恢复默认一律 showConfirm；page.tsx Tabs 改受控支持跨 tab 跳转，场景 tab 紧跟能力页
- **Step 5 文档同步**：codebase-map 四文件与实际代码对齐（settings.md 能力页只读化/场景页/config-mutations 条目+page.tsx 全实时保存描述修正；agent-core.md 13 包/category/ability-scene 条目/memory 工具组描述；index.md 检索词；data-center.md 核对无残留），plan/step 文档收尾

### 与原计划的偏差

- 场景数据底座未留在 tipc/ability.ts 原地扩展，而是迁入新建 tipc/ability-scene.ts（避免 ability.ts ↔ 新代码循环依赖），ability.ts re-export 类型保持前端 import 兼容
- getSceneOverview 返回 `{ rows, categories }` 而非裸数组：三大类分组头数据随接口下传，前端不需 import 主进程值常量
- 开关写回算法从 AbilityTab 提取为纯函数共享模块 config-mutations.ts（计划已预见的方向，实施时 AbilityTab 三个写函数随开关撤除整体移除，零残留）
- 新增计划未列的细节：CATEGORY_FALLBACK 兜底、bundled 工具组（dogear-extension）子开关行灰显说明、写后重拉 overview 消除 personal 空数组回落漂移
- 「全链路目验」项：无人值守无法真正目验 UI，改为静态核验——build:electron / build:renderer / tsc --noEmit 全绿（含 step3 全仓库 bun test 373 pass）；UI 目验（能力页只读、场景页六场景开关与恢复默认、新建会话装配无 core-profile）留给用户审核
