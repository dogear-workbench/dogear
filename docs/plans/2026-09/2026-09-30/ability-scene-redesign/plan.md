# 能力区重构（场景维度 + 只读化 + core-profile 退役）实施计划

**目标**：能力页纯展示化并按三大类分组，新增「场景」tab 承载全部能力启停（总分两级开关 + 恢复默认），core-profile 整链路删除。

**架构思路**：场景页是转置矩阵+编辑入口，不引入新开关真源，格内开关写回底层字段（abilityOverrides / enabledSkills / enabledToolPacks / personal config）。三大类作为 AbilityPack.category 进入注册表单一真源。详见 [design.md](./design.md)。

**涉及模块**：`electron/main/agents/ability-registry.ts`、`pi-session.ts`、`memory-tools.ts`、`memory-loader.ts`/`memory-fs.ts`、`tipc/ability.ts`、`tipc/memory.ts`、`workspace-config-service.ts`、`app/settings/`（AbilityTab 改造 + scene/ 新增 + page.tsx）、数据中心记忆面板、docs/codebase-map。

## 步骤索引

- [x] [Step 1: core-profile 整链路删除](./step1-remove-core-profile.md) — 删包定义/装配注入/agent 工具/IPC/数据中心入口/personal 默认键
- [x] [Step 2: 注册表分类字段 + getSceneOverview 接口](./step2-registry-scene-api.md) — AbilityPack.category、场景总览 IPC、memory 双闸文案
- [ ] [Step 3: 能力页只读化 + 三大类分组](./step3-ability-readonly.md) — 撤开关、分组渲染、开关逻辑提取共享模块
- [ ] [Step 4: 场景 tab 新增](./step4-scene-tab.md) — 六场景侧栏、总分开关、恢复默认、灰显只读
- [ ] [Step 5: 文档同步与提交](./step5-docs-commit.md) — codebase-map 三域同步、完成总结、git commit

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
