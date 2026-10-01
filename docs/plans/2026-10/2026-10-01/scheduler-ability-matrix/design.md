# 定时任务扩展能力矩阵 + skill 正常加载 设计

**日期**：2026-10-01
**前置**：场景 v2 走查修正（08275f47）后的用户反馈修正
**背景**：走查修正第 8 点把定时任务扩展能力做成了「CustomToolPacksSection 覆盖选择 + CustomSkillsSection 全量 skill 多选（全文拼接进 systemPrompt）」。用户反馈：形态错了，应该和场景页扩展矩阵一致（code-workflow 细则、其他整包开关）；skill 加载弃全文拼接，改正常加载（索引 + Skill 工具懒加载）。

## 已拍板决策（用户确认）

1. **定时任务编辑页扩展区 = 场景同款矩阵**：五包（stock/article/browser/web-mcp/code-workflow），四包整包开关，code-workflow 可展开 6 skill 细则
2. **四包开关语义 = 跟随 + 固化**：默认跟随绑定工作区（定时任务必须绑定唯一工作区，TaskEditorPage 强制校验）；矩阵初始显示绑定工作区当前开关状态并标注「跟随」；拨动后固化为任务级 `toolPacksOverride`；提供「恢复跟随」（override → undefined）
3. **code-workflow 细则 = 任务级 skill 名单**：开关关 = `skillsOverride: undefined`（不挂载，与现状一致）；开 = 勾选名单写 `skillsOverride`（默认开时全 6 勾上）。**不引入「跟随工作区 enabledSkills」语义**（YAGNI：定时任务挂 skill 是显式行为）
4. **skill 正常加载**：装配时选中 skill 走 `<available_skills>` 索引进 systemPrompt + `Skill` 工具懒加载全文（复用 skill-loader 的 `formatSkillIndexForPrompt` / `createSkillTool`，与 pi-session 同机制），弃 `buildMountedSkillsSection` 全文拼接

## 模块边界

| 层 | 文件 | 改动 |
|---|---|---|
| 装配 | `agents/tasks/custom-agent-task.ts` | 弃 buildMountedSkillsSection；loadAllSkillEntries 过滤 skillsOverride → formatSkillIndexForPrompt 拼进 fullSystemPrompt + createSkillTool(entries) 追加进 tools |
| 装配 | `services/scheduler/custom-agent-prompt.ts` | 删 buildMountedSkillsSection |
| UI | `app/data-center/scheduler/`（新组件） | 扩展能力矩阵：四包开关（跟随/固化/恢复跟随）+ code-workflow 开关+细则 |
| UI | `TaskEditorPage.tsx` | 撤 CustomToolPacksSection + CustomSkillsSection 挂载，换新矩阵组件 |
| UI | 删除 | CustomSkillsSection.tsx、CustomToolPacksSection.tsx |

## 数据流

- 四包开关 → `draft.toolPacksOverride`（undefined=跟随，名单=固化）→ saveTask sanitizeToolPacksOverride（既有）
- code-workflow 细则 → `draft.skillsOverride`（undefined=不挂）→ saveTask sanitizeSkillsOverride（既有，白名单=全 skill 索引）
- 装配：`task-executor` 透传（既有）→ `custom-agent-task`：entries = loadAllSkillEntries().filter(skillsOverride 含名) → index 文本进 systemPrompt、createSkillTool(entries) 进工具集

## 错误处理 / 边界

- 矩阵取数：四包跟随态显示 = 绑定工作区当前 enabledToolPacks（listToolPacks 既有路由带 enabled）；code-workflow skill 清单来自包视图（ability tipc）
- 存量 skillsOverride 含非 code-workflow 域 skill：UI 无入口显示但装配照挂（数据残留静默生效，不迁移不清理）
- skill 索引为空/读取失败：索引文本为空串、不追加 Skill 工具，不阻断任务（沿用 skill-loader 既有容错）

## 排除的选项

- 三态开关（跟随/强制开/强制关）显式建模：与「和场景一样」的两态直觉不符，跟随态由「未固化」隐式表达
- code-workflow 跟随工作区 enabledSkills：引入跨语义耦合（工作区 enabledSkills 是主会话语境），且定时任务挂 skill 本就该显式
- 保留自定义 skill 多选入口（CustomSkillsSection）：用户明确「只放和场景一样的扩展矩阵」，能力口径与场景页对齐
