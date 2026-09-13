# 子会话预设按能力域块化 + 挂载矩阵补任务维度 实施计划

**目标**：ProfileEditor 能力域区按能力页包结构分块（总开关 + 细选浮窗）、挂载矩阵补三条后台任务固定行、内置「浏览器解析」预设并入文章能力、术语「细闸/总闸」换「子开关/总开关」。

**架构思路**：数据层不动（`enabledAbilities` 字段结构与 `resolveAbilities` 链路保持不变），只重排 UI 与展示；编辑器块结构数据源换 `getAbilityPacks()` 单一真源，退役 `CODE_WORKFLOW_TEMPLATES` 硬编码；矩阵后台任务行按 `buildCustomToolSet` 实际装载逻辑计算 loaded。设计全文见 [../subagent-profile-ability-blocks-design.md](../subagent-profile-ability-blocks-design.md)。

**涉及模块**：`app/settings/SubAgentTab.tsx`、`app/settings/ability/AbilityMountsSection.tsx`、`electron/main/tipc/ability.ts`、`electron/main/services/settings-types.ts`、注释/测试名/codebase-map 术语同步。

## 步骤索引

- [x] [Step 1: 数据层预设合并与术语替换](./step1-preset-merge.md) — browser-parse 加 article 能力 + description 重写；全库「细闸/总闸」换「子开关/总开关」
- [x] [Step 2: 挂载矩阵补任务维度](./step2-matrix-scheduler.md) — scene kind 加 scheduler，三条固定行按 enabledToolPacks 计算，前端展示适配
- [ ] [Step 3: ProfileEditor 能力域块化](./step3-profile-blocks.md) — 块行 + 细选 Popover 重构，补 stock skill 勾选入口
- [ ] [Step 4: 联调验证与文档同步](./step4-verify-docs.md) — 全链路验证 + codebase-map 同步 + 完成总结

## 全局决策

- **术语**：细闸 → 子开关；总闸 → 总开关（UI 文案、reason 字符串、注释、测试名、文档统一）
- **数据层冻结**：`SubAgentEnabledAbilities` 字段结构不变，块化只动渲染与勾选写回逻辑；存量 Profile 的 `ab.skills` 混入的其他域 skill 名原样保留不清除
- **块总开关语义**：细项勾选独立于总开关保存（关域不清细项）；browser 块开 = 双通道都 false 时双置 true，关 = 双清；code-workflow / 自定义 Skill 块以数组非空为「开」
- **browser-parse 预设**：id 与 name 不动（agent 文案 8 处硬引用），只加 `article: true` 与重写 description；存量靠 normalize deepMerge 补齐
- **矩阵后台行语义**：以 `custom-agent-tools.ts` 的实际装载为准（memory 恒装、browser 只查 `browser` 条目不装扩展、skill 文本与规则段不注入）；enabledToolPacks 残留旧 key 静默忽略
- **主进程改动需 `bun run build:electron` 重新编译**，Vite 热重载只对前端生效
