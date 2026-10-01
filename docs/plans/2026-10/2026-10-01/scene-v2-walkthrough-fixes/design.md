# 场景 v2 走查修正 设计

**日期**：2026-10-01
**前置**：场景配置 v2（commit f1e70db6..4f4c4557）
**事实底账**：会话组共享区 `20261001-scene-v2-walkthrough-facts.md`（A~H 八节，本设计的证据基础）

## 背景

v2 落地后用户走查提出 8 条反馈：扩展细则超标、临时会话 workspace-rules 强制标注无意义、子会话/定时任务扩展列展示误导（三层闸只露一层；「排除」与「已装载」同格并存）、排除项正当性存疑、执行提示词两类只差三行且代码实施语境硬编码、状态抽取/文章解析渲染小气、文案太 AI、定时任务缺 skill 挂载。

## 已拍板决策（用户确认）

1. 扩展细则：**只有 code-workflow 有细则**（6 skill），stock/article/browser/web-mcp 一律单开关整包装载；Profile 编辑器的 browser 双通道细选也砍成单开关
2. 定时任务 skill 挂载：**选中即全文拼进任务提示词**——「人判断过该定时任务会用到该能力」

## 逐点方案

### 1. 扩展细则收敛
- `mainCell`/`personalCell` 的 subToggles 只为 code-workflow 生成；其余 skill-packs 包不再带展开层
- 开关语义沿用 applyPackToggle：开=补齐全部子键（enabledSkills/enabledToolPacks），关=包总闸压死不动子键
- 存量部分勾选残留不迁移，用户下次拨动自愈

### 2. 临时会话行瘦身
- 删 workspace-rules 格子（personal 读 `workspaces/personal/agent.md` 永远空文件，机制 no-op；装配侧不改动）
- 行结构收敛为：global-rules 开关 + 扩展能力组（细则仅 code-workflow）
- PERSONAL_EXCLUDED_KEYS 的六个灰格撤掉，合并为一句说明文字

### 3. 子会话/定时任务扩展区撤格子
- 两行扩展能力分组不再渲染包格子，换一句话 + 跳转入口（子会话→派遣页 Profile；定时任务→数据中心编辑页）
- 由此消除：code-workflow 三层闸只露第一层的误导；scheduler excluded+loaded 绿徽标并存矛盾
- `SceneTab` statusBadge 的 excluded&&loaded「已装载」分支删除（scheduler 扩展格消失后成死代码）
- `sceneOverrides.sub` 残留 code-workflow 键静默忽略（无 UI 写入，装配仍读不影响）

### 4. 排除项审计结论（保持现状）
全部排除项均有机制必然或设计边界依据：shunt×子/执/定（分流按钮只对用户回复有意义）；notes×子会话（子会话产物走交付契约）；记忆/笔记/Git×临时（无工作区路径）；组上下文×临时/定（无组）；协作×定（无派遣交付通道）；规则段×定（后台提示词自包含）。唯一不达标项 code-workflow×定时由第 8 点转为可配置。

### 5. 执行提示词统一（插拔式）
- `buildExecutionPrompt` 删 default/code-impl 双 modeLines 分支，合并为一份通用任务流程提示词
- 当任务挂载了专项 skill（skillsOverride 非空）时追加一行：「本任务已挂载专项 skill：{names}，开工前先读该 skill 并按其纪律执行」；default 不加
- task-queue 把 CODE_IMPL_SKILLS 传给 buildExecutionPrompt 生成该行；未来新 execProfile 只换挂载清单，提示词零改动

### 6. 状态抽取/文章解析富渲染
- ScenePromptsPanel 提示词正文改 MarkdownRenderer 渲染（模板本身是 markdown），删 max-h-72 内滚、随页面滚动
- 卡片风格对齐能力页详情：标题 + 徽章 + 正文；executor 行两段静态模板同款渲染

### 7. 文案全面重写（基调：直白、说人话）
新文案基准（实施时以此风格统一改写全部 description/reason/confirm/页头页脚）：
- 主会话：「控制新开的主会话加载哪些能力。改完对新会话生效，已开的会话不变。」
- 临时会话：「临时会话不带工作区，记忆、笔记、Git、组协作这些能力自动不可用。这里只管全局规则和扩展能力。」
- 子会话：「固定层一般不用动，预设跟工作区走。扩展能力在派遣页按 Profile 勾选。」
- 任务执行：「固定层预设跟工作区走。代码实施任务自动挂分步实施 skill，其余按默认装配。」
- 定时任务：「记忆和笔记可开关，基础工具恒装。扩展能力在定时任务编辑页按任务配置。」
- 状态抽取：「后台任务：读完话题新增内容，把要点写进话题状态卡。」
- 文章解析：「后台任务：文章导入失败时用 AI 补写解析产物。」
- reason 一句话化（如「临时会话没有工作区，用不了」）；矩阵描述列即「为什么是这个状态」，每条一句话

### 8. 定时任务 skill 挂载
- `task-types.ts` 定时任务模型加 `skillsOverride?: string[]`（undefined = 不挂载，与 toolPacksOverride 语义对齐）
- 编辑页 CustomToolPacksSection 旁新增「扩展能力（Skill）」选择区：列出可挂 skill（与主会话 enabledSkills 同源的 skill 索引），多选，默认空；plan-validate sanitize 过滤非法名
- `custom-agent-task.ts` 装配：把选中 skill 的 SKILL.md 全文以 `<mounted-skill name="...">...</mounted-skill>` 分段拼进任务 systemPrompt（skill 文件读取复用 pi skill 索引的同一目录源）
- 场景页定时任务行说明同步为「扩展能力（工具包与 skill）在定时任务编辑页按任务配置」

## 模块边界

| 层 | 文件 |
|---|---|
| 提示词/执行 | `electron/main/services/task-execution-prompt.ts`、`task-queue.ts`（skills 传参） |
| 定时任务 | `task-types.ts`、`app/data-center/scheduler/TaskEditorPage.tsx` + 新 Skill 选择组件、`custom-agent-task.ts`、`custom-agent-tools.ts`、`plan-validate.ts` |
| 场景数据 | `electron/main/tipc/ability-scene.ts`（六行重构 + 文案 + subToggles 收敛 + 徽标逻辑 + profileFilterReason memory 残留分支清理） |
| 场景前端 | `app/settings/scene/SceneTab.tsx`、`SceneAbilityRow.tsx`、`ScenePromptsPanel.tsx` |
| Profile 编辑器 | `app/settings/SubAgentTab.tsx`（browser 单开关化） |

## 错误处理 / 边界情况

- sceneOverrides.sub 残留键：静默忽略（现状策略一致）
- Profile `enabledAbilities` 双通道/browser 细选残留字段：装配侧不再读，忽略
- 定时任务 skillsOverride 为空数组：等价 undefined（sanitize 时归一）
- skill 文件缺失/读取失败：跳过该 skill 并在任务日志记 warning，不阻断任务
- 存量任务无 skillsOverride 字段：不挂载（与现状一致）

## 未决问题

- 定时任务可挂 skill 的候选清单口径：全部 skill 目录 vs 仅 builtin 包内 skill（倾向后者+自定义 skill，实施时看 skill 索引 API 取数方便性定）
