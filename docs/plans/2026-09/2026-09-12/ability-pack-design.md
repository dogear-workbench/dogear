# 能力包体系（Ability Pack）设计

**日期**：2026-09-12
**状态**：已与用户对齐，待写实施计划

## 背景

能力体系现状分裂在四处，各自为政：

- 前端硬编码：`app/settings/ability-types.ts` 的 `ABILITY_DOMAINS` / `SKILL_PACK_MAP` / `RESIDENT_GROUPS`
- 主进程硬编码：`electron/main/agents/session-append-templates.ts` 的提示词段定义
- 拼装逻辑：`electron/main/agents/pi-session/pi-session.ts` 里散落的条件 if
- 规则文件入口分裂：主界面顶部规则弹窗 + 设置页基础设置里的全局规则

能力页是单页视图（可选域卡片展开 + 常驻只读折叠区 + 三个详情弹窗），「可选」与「常驻」是两个割裂的体系；不同容器（主会话 / 子会话 Profile / 定时任务 / 话题会话）的能力组合散落在各编辑器里，改一个能力时无法知道影响哪些地方。

## 目标

1. **统一插拔单元**：能力包 = 提示词段 + 工具组 + skill 的任意组合（三件套），基础层纯净化——最纯净 = 框架 prompt + 基础工具的裸模型会话（排查提示词干扰的刚需）
2. **能力页两级化**：首页只放能力包卡片（描述 + 开关），点进二级页面看详情（左右分栏，TaskEditorPage 形态）
3. **组合关系可见**：能力详情页反向索引「挂载情况」，各编辑器保持就地配置
4. **零改动自然展示**：新增能力 = 注册表加条目 + 段模板，前端零改动

## 架构

### 分层模型

```
① 框架底层 system prompt（pi-ai 自带，不可控不可见）
② 基础工具：Read/Write/Edit/Bash/Glob/Grep…（底盘不可卸载；子会话按 Profile 裁剪）
③ 结构性注入（只读展示，不可关）：组上下文 / 子会话契约 / Profile 索引
④ 可开关能力包（首页卡片，共 10 张 + 系统行为卡）：
   ├ 纯提示词型：工作区规则、全局规则、核心画像（默认开）
   ├ 段+工具组型：记忆系统、笔记卡片、Agent 协作（默认开）
   └ skill+工具包型：股票分析、文章解析、浏览器、代码工作流（默认关，维持现状）
⑤ 派生物：skill 索引 = ④中启用 skill 的集合，无独立开关
```

- 「Agent 协作」= 协作派遣 + 共享区 + 跨会话引用三组工具合一（delegation / group / reference），本来就是一件事
- 触发条件（绑定工作区 / 属于组 / 主会话 vs 子会话）是功能内部逻辑，写在包定义与拼装代码里，用户侧只看到开关
- 段型提示词**只读不可编辑**（选 A）：段型能力提示词与工具配套，改文字牵连工具逻辑，不如改代码

### 能力注册表（单一真源）

新建 `electron/main/agents/ability-registry.ts`：

```ts
interface AbilityPack {
  key: string;                      // 'memory' | 'agent-collab' | 'stock' | ...
  label: string;
  description: string;              // 首页卡片一句话
  type: 'prompt-only' | 'segment-tools' | 'skill-packs';
  segmentKeys?: string[];           // 引用 session-append-templates 的段
  toolGroups?: string[];            // mcp server 名（dogear-memory…）
  skills?: string[];                // 包内 skill（股票域 2 个、代码工作流 6 个）
  defaultEnabled: boolean;
}
```

注册表是唯一真源：IPC `getAbilityPacks()` 暴露给前端渲染；`pi-session.ts` 拼提示词、注册工具组同查它。

### 开关存储与生效语义

`WorkspaceConfig` 新增 `abilityOverrides: Record<string, boolean>`——只存显式拨过的包，缺省走 `defaultEnabled`。旧配置无此字段 = 全走默认 = 行为不变，零迁移。

```
生效(包) = 工作区包开关 ∩ 触发条件 ∩ (子会话时 Profile 过滤)

规则文件型：开 → 读 agent.md / 核心画像注入；关 → 跳过读取
段+工具型：记忆段 = 包开 ∧ 绑定工作区；协作段+三工具组 = 包开 ∧ 属于组
skill 型：包开关是总闸，包内 skill 的 enabledSkills 是细闸，生效 = 双开交集
```

Profile 既有配置（memory 开关、能力域过滤）语义改为与工作区包开关取交集——容器只能做减法。

### UI 两级结构

**首页（列表态）**：工作区选择器 + 卡片网格。每卡 = 图标 + 名称 + 一句话描述 + 开关 + 统计（段/工具组/skill 数）+ 类型徽标。另有一张「系统行为」卡（只读无开关）= 三个结构性段的归属地。无任何展开折叠区。

**详情态**：面包屑 + 左右分栏——

- 左（主区）：能力说明 + 大提示词区。段型显示模板全文（只读）；规则文件型内嵌 textarea 直接编辑 agent.md（这就是编辑处）；核心画像显示全文 + 跳数据中心编辑入口
- 右（参数栏）：主开关 + 配套清单（skill 细开关 / 工具组展开看工具）+ 挂载情况 + 「重启会话生效」提示

列表态↔详情态为 AbilityTab 内部 state（同 SchedulerPanel editing 模式），不走路由。SkillDetailDialog / ToolDetailDialog 复用；SegmentDetailDialog 退役（段全文已在左区）。

### 挂载情况（反向索引）

新增 IPC `getAbilityMounts(key)`，详情页打开时读时扫描（快照，不订阅）：

- 工作区：全部工作区 config（abilityOverrides / enabledSkills）
- Profile：settings.subAgent.profiles（能力域、memory、skill 过滤）
- 任务：scheduler tasks 的 toolPacksOverride（工具包名经注册表反查所属能力包）

展示按容器分组，计数 + 默认折叠明细；「主会话/话题会话：跟随工作区配置，属组时协作类自动激活」一行说明。

**排除的选项**：挂载矩阵页（任务列无穷、稀疏膨胀、纯只读多一层中转）；提示词模板+覆盖编辑（段与工具配套，改代码更靠谱）；常驻区保持只读（割裂持续）；全局规则应用级开关（能力页单一粒度，工作区级覆盖更顺）。

## 模块边界

| 动作 | 文件 |
|---|---|
| 新建 | `electron/main/agents/ability-registry.ts` |
| 改 | `electron/main/agents/session-append-templates.ts`（段 key 对齐注册表） |
| 改 | `electron/main/agents/pi-session/pi-session.ts`（拼装/工具注册查注册表） |
| 改 | `electron/main/tipc/`（getAbilityPacks / getAbilityMounts；WorkspaceConfig 扩展） |
| 改 | WorkspaceConfig 类型（渲染层 `types/electron-api.ts` + 主进程镜像） |
| 重构 | `app/settings/AbilityTab.tsx`（两级态）+ 新详情页组件 |
| 删 | `ability-types.ts` 硬编码常量（保留纯 UI 类型）、`AbilityResidentSection.tsx`、`AbilityDomainCard.tsx`、`SegmentDetailDialog.tsx` |
| 迁 | 设置页基础设置的全局规则入口 → 能力页详情；主界面顶部规则弹窗保留为快捷入口 |

## 数据流

- 设置页：`getAbilityPacks()` → 卡片 → 开关 → `updateWorkspaceConfig({ abilityOverrides })` → 重启会话生效（沿用快照标脏链路）
- 会话启动：`resolveAbilities(config, role, profile)` → 段注入与工具注册消费同一份解析结果，不会半开
- 详情页：`getAbilityPacks()` + `getAbilityMounts(key)` → 右栏挂载情况
- 规则文件详情：读 agent.md → 左区编辑 → 写文件（与顶部弹窗同一份内容）

## 错误处理 / 边界情况

1. **协作包关闭**：主会话无派遣工具，子会话不会被创建（自洽）；组上下文裁剪为纯组头（共享区/话题指引引用的协作工具不存在，避免幻引）
2. **skill 目录缺失**：卡片照常显示，详情页标注「skill 文件缺失」
3. **abilityOverrides 残留已下线包 key**：静默忽略（向前兼容卸载能力）
4. **旧配置**：无 abilityOverrides → 全走 defaultEnabled → 行为不变
5. **任务 executor 会话**：本就不注入笔记纪律的裁剪逻辑保留

## 未决问题

- 「系统行为」卡详情页的三个结构性段展示格式（实施时细化）
- 核心画像详情是纯跳转还是内嵌编辑（当前拍板：显示全文 + 跳数据中心）
- 详情页卡片图标选型（实施时定）
