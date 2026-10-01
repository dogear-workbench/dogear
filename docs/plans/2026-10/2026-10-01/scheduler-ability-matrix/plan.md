# 定时任务扩展能力矩阵 + skill 正常加载 实施计划

**目标**：定时任务编辑页扩展区换成场景同款矩阵（四包跟随/固化开关 + code-workflow 细则），装配侧 skill 弃全文拼接改正常加载（索引 + Skill 工具）。设计见 [design.md](./design.md)。

**步骤**：

- [ ] [Step 1: 装配侧正常加载](./step1-assembly.md) — custom-agent-task 弃全文拼接，改 formatSkillIndexForPrompt 索引 + createSkillTool 工具
- [ ] [Step 2: 编辑页扩展矩阵](./step2-editor-matrix.md) — 新矩阵组件替换两组件，撤 CustomSkillsSection/CustomToolPacksSection
- [ ] [Step 3: 收尾](./step3-wrapup.md) — 文案与场景页联动核查、codebase-map 同步、提交

## 全局决策

- 四包开关：默认跟随绑定工作区（显示其当前状态），拨动固化 task.toolPacksOverride，提供恢复跟随
- code-workflow：开关关 = skillsOverride undefined；开 = 勾选名单（默认全 6），不引入跟随工作区 enabledSkills 语义
- 存量 skillsOverride 非 code-workflow 域 skill：装配照挂，UI 不显示，不迁移
- 主进程改动跑 `bun run build:electron`；渲染层跑 `npx tsc --noEmit -p tsconfig.json`
- message 不加 AI 署名
