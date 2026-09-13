# 子会话预设按能力域块化 + 挂载矩阵补任务维度 设计

**日期**：2026-09-13
**状态**：已确认（对话收敛）

## 背景

能力页已按功能维度把能力组织成块（`ABILITY_PACKS` 单一真源），但子会话 Profile 编辑器的能力域区还是 6 个扁平 checkbox + 两组 skill 列表，两边结构不对齐；且存在盲点：stock 域勾选只挂 4 个工具包，`stock-analysis` / `stock-picking` 两个 skill 走 `ab.skills` 数组过滤但 UI 无勾选入口。同时能力页挂载矩阵（main / sub-default / profile / executor 四类场景行）缺后台任务维度，用户看不到「定时任务 / 状态抽取 / 文章解析各自拿到什么」。

系统内「提示词 + 能力组装」场景全景（本次设计的事实基座）：

| 场景 | 能力来源 | 可配置性 |
|------|---------|---------|
| 主会话 | 工作区能力包开关 ∩ 触发条件 | 功能维度（能力页） |
| 子会话 | 工作区开关 ∩ 触发条件 ∩ Profile 子开关 | **唯一会话维度手动可配** |
| 执行会话 executor | 同主会话，裁掉存卡纪律段 | 固定 |
| 定时自定义任务 CUSTOM_AGENT | 固定基础集（文件+检索+记忆）+ `enabledToolPacks` 联动可选包；独立提示词 | 半固定（无 skill / 无规则段） |
| 话题状态抽取 STATE_EXTRACT | 单工具 + 固定提示词 | 全固定 |
| 文章解析 PARSE_ARTICLE | Claude Agent SDK（SKILL.md 当提示词） | 全固定 |

## 目标

1. ProfileEditor 能力域区按能力页包结构分块，块 = 总开关，块内多细项点「细选」弹浮窗勾选（Popover）；补上 stock skill 盲点
2. 挂载矩阵补「定时自定义任务 / 话题状态抽取 / 文章解析」三条固定行，功能 × 场景图谱完整
3. 内置「浏览器解析」预设并入文章能力（article: true），description 重写；名字不动
4. 术语替换：细闸 → 子开关、总闸 → 总开关（UI 文案 + reason 字符串 + 注释/测试名/文档同步）

## 架构

### ① ProfileEditor 块化（渲染层重构）

数据源换 `client.getAbilityPacks()`（单一真源），退役 `CODE_WORKFLOW_TEMPLATES` 硬编码数组。Profile 编辑器只展示子会话可配的域，包 → `enabledAbilities` 映射：

| 能力块（包 key） | 主开关字段 | 浮窗细项 |
|---|---|---|
| memory 记忆系统 | `ab.memory` | 无 |
| stock 股票分析 | `ab.stock` | 2 个 skill：stock-analysis / stock-picking（写 `ab.skills`，勾选状态独立保存，域关不生效不丢失） |
| article 文章解析 | `ab.article` | 无（article-parser skill 随开关直通，块描述说明） |
| browser 浏览器 | `ab.browser \|\| ab.extension`（开 = 双通道都 false 时双置 true；关 = 双清） | 2 个通道：内嵌浏览器（`ab.browser`）/ 浏览器扩展（`ab.extension`） |
| web-mcp 联网搜索 | `ab.web` | 无 |
| code-workflow 代码工作流 | skills 数组本身（任一勾 = 开；开时全 false 则默认全勾；关 = 清空该包 skill） | 6 个 skill（`ab.skills`） |
| 自定义 Skill（仅存在时显示） | customSkills 数组本身（同上语义） | 各自定义 skill（`ab.customSkills`），数据仍来自挂载时 `client.getSkills` 解析 |

- 块行 UI：包图标 + 名称 + 描述 + 右侧总开关；有细项的块显示「细选」按钮，点击弹 Popover（细项 checkbox 列表，browser 块细项为 Switch）
- 细项勾选独立于总开关保存（预设语义：关域不清细项，重开即恢复生效）
- prompt-only 包（规则/核心画像）、notes / group-context / agent-collab、交付通信固定行：不出现在编辑器或维持现状固定行
- 排除的选项：给 enabledAbilities 加 per-pack 结构化重构（如 `Record<packKey, {...}>`）——存量迁移成本高且 resolveAbilities 已按现字段跑通，不动数据层，只重排 UI

### ② 挂载矩阵补任务维度（主进程）

`AbilityMountSceneKind` 增加 `'scheduler'`。`getAbilityMounts` 补读工作区 config 的 `enabledToolPacks`（与 abilityOverrides 同一个 config.json），新增三条 `system: true` 固定行：

| 行 | loaded 计算 | reason 说明 |
|---|---|---|
| 定时自定义任务 | prompt-only / notes / group-context / agent-collab / code-workflow → false（各自原因）；memory → true（`buildCustomToolSet` 恒装记忆工具，autonomous 契约）；skill-packs 包 → `pack.toolGroups ∩ enabledToolPacks` 非空即 true（browser 包只查 `browser` 条目，扩展通道不装） | 列出实际装载的工具包名；注明 skill 文本与规则段不注入 |
| 话题状态抽取 | 全 false（emit_state_increment 单工具不属任何包） | 固定提示词 + 单工具 |
| 文章解析 | 全 false（Claude Agent SDK 自带装配） | 固定，见 agent-worker |

前端 `AbilityMountsSection` 按 kind 徽标文案适配（「后台任务」分组或顺序追加，样式对齐现有 system 行）。

### ③ 内置预设合并（数据层）

`createBrowserParseSubAgentProfile`：`enabledAbilities` 加 `article: true`；description 重写为涵盖「浏览器与扩展双通道调研 + 工作区文章读取与解析」；id 与 name 均不动（8 处 agent 文案硬引用「浏览器解析」名，避免迁移风险）。存量用户由 normalize deepMerge 补齐 article 字段，显式关过的保留。

### ④ 术语替换

- 用户可见：SubAgentTab「此处为子会话侧细闸」→「子开关」表述；ability.ts reason「不受 Profile 细闸约束」→「不受 Profile 子开关约束」
- 非用户可见顺手同步：AbilityTab.tsx / ability-registry.ts / pi-session.ts 注释、ability-registry.test.ts 测试名、codebase-map.md

## 模块边界

- `app/settings/SubAgentTab.tsx` — 块化重构 + 细选 Popover 组件（可拆 `app/settings/subagent/AbilityBlockRow.tsx`）
- `electron/main/tipc/ability.ts` — scene kind 扩展 + 三条固定行 + enabledToolPacks 读取
- `app/settings/ability/AbilityMountsSection.tsx` — 新 kind 展示适配
- `electron/main/services/settings-types.ts` — browser-parse 预设合并
- 注释 / 测试名 / `docs/codebase-map.md` — 术语同步

## 数据流

ProfileEditor：`getAbilityPacks()`（包结构+skillMetas）+ `getSkills()`（自定义 skill）→ 块渲染 → 勾选写回 `draft.enabledAbilities`（字段结构不变，保存链路零改动）。挂载矩阵：`getAbilityMounts` 读 config（abilityOverrides + enabledToolPacks + subAgent profiles）→ 场景行计算下传。

## 错误处理 / 边界情况

- `getAbilityPacks` 失败：编辑器退化为现状扁平 checkbox（保底可用）或提示重试——实施时取提示重试，不再维护双 UI
- enabledToolPacks 残留旧 key（如 extension）：矩阵计算静默忽略（对齐 custom-agent-tools 实际装载逻辑）
- 存量 Profile 的 `ab.skills` 混有非本包 skill：块过滤只取本包 skillMetas 内的名字，其他域的值不显示但不清除（保存时原样保留）

## 未决问题

- 细选 Popover 内 browser 双通道用 Switch、skill 用 checkbox——统一性 vs 语义，实施时按视觉微调
- 矩阵三条新行的展示排序（追加在 executor 后 vs 单列「后台任务」分组）——实施时看视觉密度定
