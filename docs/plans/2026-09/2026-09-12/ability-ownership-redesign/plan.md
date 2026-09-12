# 能力归属重划与能力页三轮修正 实施计划

**目标**：按功能归属重划能力包（会话组独立成包、reference 拆解、tasks 归笔记、协作包补齐子会话契约），挂载展示改会话场景矩阵，详情页布局优化，开关乐观更新，设置全实时保存。

**架构思路**：注册表（ability-registry.ts）仍是单一真源，本次调整的是包的划分与拼装 gate 条件；系统行为卡瘦身为纯常驻卡（无提示词）；矩阵数据 = 场景规则（代码内）× Profile 实际配置，改造 getAbilityMounts 而非新开 IPC。设计全文见 [../ability-ownership-redesign-design.md](../ability-ownership-redesign-design.md)。

**涉及模块**：
- `electron/main/agents/ability-registry.ts`（包定义/系统行为）
- `electron/main/agents/session-append-templates.ts`（段模板文字迁移）
- `electron/main/agents/pi-session/pi-session.ts`（工具注册 gate + 段注入条件）
- `electron/main/agents/tools/reference-tools.ts`（组拆分）
- `electron/main/tipc/ability.ts`（挂载矩阵 IPC）
- `app/settings/AbilityTab.tsx` + `app/settings/ability/*`（布局/矩阵/乐观更新）
- `app/settings/page.tsx`（全实时保存）

## 步骤索引

- [x] [Step 1: 后端归属重划](./step1-backend-ownership.md) — 注册表新会话组包、reference 拆解、tasks 归笔记、共享区文字迁移、组上下文解耦
- [x] [Step 2: 挂载矩阵](./step2-mount-matrix.md) — getAbilityMounts 改场景矩阵，前端替换工作区列表
- [x] [Step 3: 详情页布局](./step3-detail-layout.md) — 顶部两行 + chips 中文化 + 右栏加宽 + 规则页徽章切换
- [x] [Step 4: 开关乐观更新与设置全实时](./step4-toggle-and-autosave.md) — 乐观更新去闪烁；设置页去保存按钮改防抖即写

## 全局决策

- 语义基线：拼装生效 = 工作区包开关 ∩ 功能内部触发条件 ∩（子会话时 Profile 过滤）；协作包对子会话强制生效不变
- 会话组包 key 建议 `group-context`，与段 key 同名；组上下文注入条件 = 属于组 ∧ 会话组包开
- ReadGroupBackground 不可关语义取消——随会话组包开关；跨会话检索（ListTopics/ReadReferenceSession）保持工作区即注册不查细闸
- Profile.enabledAbilities.reference 细闸退役，读配置时静默忽略旧值（不迁移）
- 任务执行会话申报工具（ReportTaskResult 所在组）按派单特判保底注册，不受笔记包开关影响
- 段模板文字只迁移不重写：共享区引导缺失句并入协作规范/契约段既有共享区段，只补缺不重复
- 前端不硬编码包/场景规则，一律经 getAbilityPacks / 新矩阵 IPC 动态获取
- commit 排除 package.json 版本号与 tmp/（环境既有改动）

## 完成总结（2026-09-14）

四个 step 全部完成并逐个提交：

| Step | commit | 核心产出 |
|---|---|---|
| 1 后端归属重划 | ac250ef3 | 会话组包 group-context 独立、reference 拆解（dogear-group-context / dogear-sibling）、tasks 归笔记包（executor 保底）、SYSTEM_BEHAVIORS 退役、共享区引导文字迁移 |
| 2 挂载矩阵 | 980f8842 | getAbilityMounts 改场景矩阵（主会话/子会话·默认/各 Profile/任务执行会话，复用 resolveAbilities），前端矩阵渲染替工作区反查，reference 细闸前端清理 |
| 3 详情页布局 | 1703d505 | 顶部两行化 + skill chips 中文化（SKILL.md 首行标题经 IPC 透传）+ 右栏 5:4 + 字号降档 + 规则页徽章切换 |
| 4 乐观更新与全实时 | 42dbf566 | 开关乐观更新（失败重拉回滚+toast）、mountsRefreshKey 矩阵信号、Markdown memo 化；设置页防抖即写+卸载 flush，删保存按钮 |

**关键语义定夺**（实施中拍板）：
- 「子会话·默认」行显示 default Profile 真实勾选结果而非字面全开（字面全开=假数据；无细闸维度包仍定死看包开关）
- 会话组包关 = 子会话组头也不注入（唯一强制例外仍是协作包）
- saveSettings 失败改 throw、删模型方案加确认弹窗（全实时模式的必要支撑）

**遗留**：GUI 冒烟六点清单见 step4 回填；SubAgentTab 删 Profile 无确认（不对称待统一）；build:renderer 既有失败（@xterm/headless，非本计划引入）；首页系统行为卡 chip「提示词段 0」待 systemBehaviors 字段收尾时清理。
