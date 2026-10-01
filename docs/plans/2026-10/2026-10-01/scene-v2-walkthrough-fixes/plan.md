# 场景 v2 走查修正 实施计划

**目标**：修复 v2 走查的 8 条反馈——扩展细则收敛、临时会话/子会话/定时任务三行重构、执行提示词统一、富渲染、文案重写、定时任务 skill 挂载。

**架构思路**：装配与数据链先行（提示词统一、定时任务 skillsOverride），再改 buildSceneOverview（行结构 + 新文案），再改场景页前端渲染，最后单元层 UI（Profile browser 单开关、定时任务编辑页 skill 选择）。设计细节见 [design.md](./design.md)。

**涉及模块**：task-execution-prompt / task-queue / task-types / custom-agent-task / custom-agent-tools / plan-validate / ability-scene / SceneTab / SceneAbilityRow / ScenePromptsPanel / SubAgentTab / TaskEditorPage

## 步骤索引

- [x] [Step 1: 装配与数据链](./step1-assembly-data.md) — 执行提示词统一为插拔式、定时任务 skillsOverride 字段与 SKILL.md 全文拼接
- [x] [Step 2: buildSceneOverview 重构](./step2-scene-overview.md) — 六行结构修正（personal 瘦身/sub/scheduler 扩展区撤格子）、subToggles 收敛、徽标死代码清理、全部新文案
- [x] [Step 3: 场景页前端](./step3-scene-frontend.md) — SceneTab/SceneAbilityRow 适配新行结构、ScenePromptsPanel 富渲染（MarkdownRenderer 无高度上限）
- [x] [Step 4: 单元层 UI](./step4-unit-ui.md) — SubAgentTab browser 单开关化、定时任务编辑页「扩展能力（Skill）」选择区
- [x] [Step 5: 收尾](./step5-wrapup.md) — 全链路目验清单、codebase-map 同步、git 提交

## 全局决策

- 文案基调：直白说人话，一句话说清；reason = 为什么是这个状态；新文案基准表在 design.md §7，实施时以此风格改写所见全部面向用户文案
- 扩展细则：全应用只有 code-workflow 保留 6 skill 细选（场景页与 Profile 编辑器同标准）
- 数据残留一律静默忽略不迁移（sceneOverrides.sub 残键、Profile 双通道字段、存量部分子键勾选）
- 主进程改动后需 `bun run build:electron` 验证；渲染层用 `npx tsc --noEmit -p tsconfig.json` 验证
- 提交拆分按 step 粒度，message 不加 AI 署名

## 完成总结

8 点反馈全部落地，提交链：97b55d25（step1 装配与数据链）→ 7022f1f9（step2 buildSceneOverview 重构）→ 88eef98e（step3 场景页前端）→ de8093f9（step4 单元层 UI）→ step5 收尾。

1. **扩展细则收敛**：subToggles 仅 code-workflow 生成，其余 skill-packs 单开关整包；Profile 编辑器 browser 细选砍成单开关（齐开齐关）
2. **临时会话瘦身**：workspace-rules 格与六个排除格撤掉，行收敛为 global-rules + 5 扩展包
3. **子会话/定时任务扩展区撤格子**：换 groupNotes 分组说明 + 跳转入口；「排除+已装载」并存矛盾数据侧根除（schedulerPackHitCell 整删）
4. **排除项审计**：保持现状，唯一不达标项 code-workflow×定时转为可配置（见 8）
5. **执行提示词统一**：删 execProfile 双分支，通用模板 + mountedSkills 挂载行；EXECUTOR_PROMPTS 合并单段
6. **富渲染**：ScenePromptsPanel 改 MarkdownRenderer，删 max-h-72 内滚，卡片对齐能力页风格
7. **文案重写**：六行 description/全部 reason/confirm/页头页脚/label 按 §7 直白基调重写；终检无「裁决/回落/机制级/装配」面向用户残留
8. **定时任务 skill 挂载**：skillsOverride 全链路（模型字段→sanitize→透传→装配拼 `<mounted-skill>` 段→编辑页 CustomSkillsSection 选择区）

遗留：人工 UI 目验清单见 step5-wrapup.md（无人值守未做）；定时任务跳转落 /data-center 需手动点 tab（可后续加初始 tab 机制）
