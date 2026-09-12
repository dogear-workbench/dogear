# 能力页 UX 二轮修正 设计

**背景**：能力包体系重构五步完成后，用户对能力页提出五条反馈：①规则编辑布局与入口 ②提示词渲染与字号不统一 ③skill 详情交互 ④详情页左右布局 ⑤系统行为归类混乱。讨论后全部收口，另盘点出 extension 工具包无入口、reference 组错包通用工具两处归属问题。

**目标**：能力页整体对齐应用常用风格（渲染态 + rem 字号受控），规则编辑体验理顺，详情页左右职责重划，系统行为重定位为「框架固定行为总览」，工具归属修正（extension 并包、reference 拆组、常驻工具搬家）。

## 一、规则合并展示

- 移除主界面顶部工作区规则按钮（WorkspaceRuleDialog 入口退役）。
- 注册表保持 `workspace-rules` / `global-rules` 两个包 key 不变（开关粒度 = 规则粒度，拼装侧零改动），**前端首页将两卡合并渲染为一张「规则」卡**：展示两条规则各自的启用状态徽标，不带总开关（无单一开关语义），点击进合并详情页。
- 合并详情页左侧：两个规则编辑块（工作区 agent.md、全局 agent.md），各自独立编辑。
- 右侧栏：两条规则各自的包开关 + 挂载情况（两个包 key 分别展示）。
- RuleFileEditor 改单栏态切换：平时 MarkdownRenderer 渲染态，点「编辑」进入 Textarea 编辑态（保存 / 恢复模板 / 未保存标记保留），保存后回渲染态。不再编辑+预览两列并排。

## 二、渲染与字号统一

- SegmentBlock（提示词段）、SystemBehaviorDetail（系统行为段）全文从 `<pre> font-mono text-[11px]` 改为 `MarkdownRenderer` + `text-sm`，只保留渲染态，不做源码切换（已确认）。
- 全能力页清除固定像素字号：`text-[10px]` / `text-[11px]` → `text-xs` / `text-sm` 等 Tailwind 标准档位。rem 体系随 root font-size 缩放，左右两侧、卡片、侧栏全部受字体大小设置控制。

## 三、详情页布局重划

```
┌─────────────────────────────────┬──────────────┐
│ 包说明                           │ 能力总开关    │
│ skill切换chips（skill型包）       │ 配套工具组    │
│ 选中skill的SKILL.md渲染全文        │ (点击弹浮窗)  │
│ + skill细开关（就近放标题旁）       │ 挂载情况      │
│ （段型包：规则编辑/核心画像/段）     │              │
└─────────────────────────────────┴──────────────┘
```

- 左侧主区 = 内容区：skill 型包顶部一排切换 chips，选中项显示 SKILL.md 渲染全文，细开关放选中 skill 标题旁；段型包为规则编辑 / 核心画像 / 提示词段。
- 右侧固定窄栏（约 320px，可适度收窄）：能力总开关 + 工具组折叠列表 + 挂载情况。skill 细开关从右侧挪走后右侧减负，不采用 3:2 比例布局（固定窄栏在窄窗口下更稳）。
- 工具详情保持浮窗（轻量查看动作）。

**浮窗关闭闪烁修复**（SkillDetailDialog / ToolDetailDialog 都有）：现状关闭时置 null 导致 Radix 关闭动画期间内容被清空。修复：组件内保留 lastSkill/lastTool（仅非空时更新）用于渲染，open 仍由 props 判定；同时用「content 对应的 name」派生 loading 态，打开新 skill 时不闪旧内容一帧。

## 四、系统行为重定位

从「结构性注入段」扩展为**「框架固定行为」总览**——凡是不可开关、不归能力包管的行为都有归属，每项标注触发条件 + 在哪控制。三区结构：

```
系统行为（不可关）
├─ 会话组上下文：group-context 段（有组即注入）
├─ 主子会话协作：sub-agent-contract 段（子会话固定注入）
│   + 子会话侧固定注册的 group/delegation 工具组说明
│   + 交叉引用：「主会话派遣规范与 Profile 索引归 Agent 协作能力包，受其开关控制」
└─ 常驻工具（无提示词）：
    基础工具 7 个（Read/Write/Edit/Bash/Glob/Grep/Skill）→ ask/allow 权限控制就地操作，即时保存
    任务工具组 dogear-tasks（主会话+工作区即注册）→ 说明展示
    跨会话检索组（见五）→ 说明展示
```

- **Profile 索引从 SYSTEM_BEHAVIORS 移除**：`main-agent-delegation` 段（协作规范+Profile 索引同段）实际受 agent-collab 包开关控制（pi-session.ts:567），在系统行为卡标「不可关」是语义错误。段跟包走，agent-collab 包详情已展示，消除重合。
- **BasicToolsSection 从设置页「基础」tab 移入**系统行为详情常驻工具区，权限切换从草稿+保存模式改为即时保存（client.updateSettings + 广播），对齐能力页习惯。
- memory 触发条件文案补充「无工作区会话现状兜底注册」的事实（pi-session.ts:646，只改描述不改行为）。

## 五、工具归属修正

### extension 并入 browser 包

- 现状：`OPTIONAL_TOOL_PACKS` 无 extension 条目，主会话 `case 'extension'` 只能靠旧配置残留触发（死分支）；子会话侧靠 Profile `extension===true`。browser-exploration skill 的双通道方法论同时指挥 `dogear__browser__*`（内嵌）与 `dogear__extension__*`（扩展），但扩展通道无入口。
- 改法：browser 包 `toolGroups` 增加 `'extension'`，作为包内第二个工具组「浏览器扩展通道」展示；主会话注册受 browser 包总闸 gate（不再走 enabledToolPacks 细闸，旧残留静默忽略）；子会话 Profile `extension===true` 细闸保持不变；browser 包描述提及双通道。

### reference 拆组

`dogear-reference` 组 4 个工具两种性质，拆分：

| 工具 | 新归属 | 注册条件 |
|---|---|---|
| ListTopics、ReadReferenceSession | **新常驻组「跨会话检索」**（只读，只要 workspaceId） | 主会话+子会话：绑定工作区即注册，不可关 |
| ReadGroupBackground、ListSiblingSessions | 留在 agent-collab 包（dogear-reference 组或并入 group 组，实施时按代码结构就近） | 现状保持：有组 + agent-collab 生效 |

- 新组 server 命名实施时定（如 `dogear-history`）。
- 关掉 Agent 协作（纯净模式）后仍可查历史会话/跨话题检索——通用检索是基础设施，与基础工具同性质。

### 常驻工具搬家（随系统行为四）

dogear-tasks、跨会话检索组在常驻工具区展示说明与工具清单（点工具弹浮窗看描述）。

## 模块边界

| 文件 | 改动 |
|---|---|
| `electron/main/agents/ability-registry.ts` | SYSTEM_BEHAVIORS 删 profile-index；browser 包 toolGroups + extension + 描述；memory 触发条件描述（getSystemPromptSegments 侧文案） |
| `electron/main/agents/tools/reference-tools.ts` | 拆两组 create 函数 + registerToolGroup |
| `electron/main/agents/pi-session/pi-session.ts` | buildMain/ SubAgentToolDefs：extension 注册条件改 browser 包 gate；新检索组常驻注册；reference 组调整 |
| `electron/main/services/tool-packs.ts` | OPTIONAL_TOOL_PACKS 处理 extension（条目或注释说明并入） |
| `electron/main/tipc/ability.ts` | getAbilityPacks 视图扩展：常驻工具区数据（基础工具清单+权限值、tasks 组、检索组）；规则合并卡数据组织 |
| `app/settings/AbilityTab.tsx` + `ability/*` | 首页规则合并卡、系统行为卡描述；详情页布局重划（chips + 窄栏）；SystemBehaviorDetail 三区 |
| `app/settings/ability/RuleFileEditor.tsx` | 单栏渲染/编辑态切换 |
| `app/settings/SkillDetailDialog.tsx` / `ToolDetailDialog.tsx` | 关闭闪烁修复 |
| `app/settings/page.tsx` | 移除 BasicToolsSection 引用 |
| 主界面顶部（实施时定位） | 移除 WorkspaceRuleDialog 入口 |

## 数据流

机制不变：包开关 `abilityOverrides`、skill 细闸 `enabledSkills`、基础工具权限 `AppSettings.basicToolPermissions`（改即时保存）。常驻工具区数据经 getAbilityPacks 一次性下发（打开详情时刷新权限值）。

## 错误处理 / 边界

- 旧 `enabledToolPacks` 残留 `extension`：静默忽略（不再作为注册依据）。
- 无工作区会话：常驻区检索/任务工具标注「绑定工作区后可用」。
- skill 文件缺失卡片照显并标注（现状保留）。
- 后台基础设施工具（workspace-file-tools / article-parse-tools）不进能力页；后台执行历史展示已另立占位任务 nmpslmcw。

## 未决问题（实施时定）

- 新检索组 server 命名与 reference 拆分后的组文件组织。
- 合并规则卡在首页的具体视觉（两条状态徽标的排布）。
