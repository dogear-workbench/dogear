# 能力归属重划与能力页三轮修正 设计

**背景**：二轮修正后用户提出系统性反馈：能力分类维度是「可不可关」，与用户心智「功能归属」打架，多处工具/提示词挂错位置；skill 型详情页顶部占位过多压正文、chips 英文；挂载展示维度错（工作区实例而非会话场景）；开关拨动全页闪烁；设置「保存并退出」模式过时。

**目标**：按功能归属重划能力包；挂载展示改会话场景矩阵；详情页布局优化；开关乐观更新；设置全实时保存。

## 1. 能力归属重划（最终定版）

| 能力 | 提示词段 | 工具组 | 开关语义 |
|---|---|---|---|
| 系统行为卡（首页最前，只读） | 无 | 基础工具（read/write/edit/bash/Glob/Grep 权限）+ 跨会话检索（dogear__ListTopics、dogear__ReadReferenceSession） | 常驻，工作区即注册 |
| 会话组（**新独立能力包**） | 组上下文（背景总结：组头+话题状态） | dogear__ReadGroupBackground | 可开关（工作区 override），触发 = 属于组 |
| Agent 协作 | 主会话协作规范 + 子会话交付契约 | dogear-delegation + dogear-group + dogear__ListSiblingSessions | 可开关，子会话强制生效 |
| 笔记卡片 | 存卡纪律 | dogear-notes + dogear-tasks | 同开同关 |
| 其余包（核心画像/规则/记忆/股票/文章/浏览器/代码工作流） | 不变 | 不变 | 不变 |

**关键行为变化**：
- `dogear-reference` 组拆解：ReadGroupBackground → 会话组包；ListSiblingSessions → 协作包
- `dogear-tasks` 从常驻挪入笔记包，受包开关控制；任务执行会话按派单特判保底注册申报工具
- 共享区引导文字从组上下文模板删除；「阶段总结可写共享区」等缺失句并入协作规范/契约段已有的共享区段落（只补缺不重复）
- 删除「协作包关 = 组上下文裁剪为纯组头」特殊逻辑：组上下文归会话组包，与协作包解耦
- 组上下文注入条件：属于组 ∧ 会话组包开；组头不再含共享区教学
- 子会话 reference 细闸（Profile.enabledAbilities.reference）退役：ReadGroupBackground 随会话组包、ListSiblingSessions 随协作包、ListTopics/ReadReferenceSession 常驻不查细闸
- 子会话交付契约（sub-agent-contract 段）展示挪入协作包详情（注入行为不变，仅展示归属）

## 2. 挂载矩阵（替换工作区挂载列表）

详情页右栏「挂载情况」→「加载情况」场景矩阵，工作区维度删除：
- 固定行：主会话、任务执行会话
- 「子会话·默认」：系统预设·定死全开，标注不可改
- 其余 Profile：动态读 settings，显示真实勾选状态
- 单元格：✓/✗ + 一句话原因（包开关 / Profile 勾选 / 场景规则）
- 系统行为卡、会话组包同样适用
- `getAbilityMounts` IPC 改造为场景矩阵数据（场景规则代码内定义 × Profile 实际配置）

## 3. 详情页布局（skill 型多 skill 包）

- 顶部压两行：第一行 = 返回 + 中文包名（去英文 key 后缀与类型徽标，徽标挪右栏）；第二行 = skill chips 横排
- 包描述挪右栏顶部（开关上方）
- 左栏整体滚动（chips 下方即正文）
- chips 中文化：显示 SKILL.md 首行标题；skill 文件缺失显示 key 并标灰（沿用容错）
- 右栏加宽：w-72 → 约 5:4 比例；左栏 Markdown 字号降一档

## 4. 规则详情页

- 上下双编辑器 → 两个徽章切换（「工作区规则 / 全局规则」），一次只显示一个编辑器，与 skill 详情页 chips 交互统一

## 5. 开关交互修复

- 现状根因：`writeOverrides`（AbilityTab.tsx:64-80）走 `setPackBusy` → await IPC → configVersion 递增，两个状态全页传导重渲染，Markdown 全文重解析闪烁
- 改乐观更新：本地先翻转 → 后台落盘 → 失败回滚 + 提示；去掉 busy 全局态传导

## 6. 设置保存模式全实时

- 去掉「保存并退出」按钮（page.tsx:242）与未保存弹窗（page.tsx:155）
- 基础设置/模型方案等草稿字段改改动即写（防抖落盘）
- 规则编辑器（RuleFileEditor）保持独立编辑态保存不变

## 未决问题（实施时定）

- ListSiblingSessions 在协作包内的工具组归属（并入 dogear-group 或保留独立组）
- 会话组包关闭时子会话组头注入语义（「包关 = 组上下文不注入任何会话」或子会话强制保留组头）
- 全实时化防抖时机与写失败提示形式
- 矩阵场景规则的数据来源（注册表元数据 vs 前端硬编码）
