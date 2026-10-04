---
step: 2
title: 前端开关与展示跟进
status: done
---

## 目标

场景页、子会话派遣页、能力页跟进三个新包：开关行扩展、双开关拆分、三卡展示。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-pack-split.md] 的实施回填（三包 key 与 resolveAbilities 实际输出形态）
- 关键现状：
  - 场景页 `app/settings/scene/SceneTab.tsx`：七行 matrix（数据源 `getSceneOverview()`），browser 目前一行；sceneOverrides 键随包 key 扩展
  - 派遣页 `app/settings/SubAgentTab.tsx`：browser 单开关「齐开齐关 browser+extension 双字段」（settings.md 已注明）；browser-exploration skill 细选在能力域块内
  - 能力页 `app/settings/AbilityTab.tsx` + `ability/*`：包卡与详情页从 `getAbilityPacks()` 渲染（前端零硬编码），新包自动出卡；需关注纯 skill 包（无 toolGroups）在 `AbilityPackSidebar` / `AbilityMountsSection` 的展示是否自然
  - `tipc/ability.ts`：getAbilityPacks 视图按包聚合 toolGroups，browser-methodology 无组时的空态
- 关键决策回顾：拆开后 browser 一行变三行（内嵌 / 扩展 / 方法论）；派遣页双开关各自独立写 enabledAbilities.browser / .extension，不再齐开齐关。

## 计划改动

- [ ] `SceneTab.tsx` / `scene/` 相关：matrix 行按新包扩展（getSceneOverview 后端侧如有包清单枚举需同步——实施时以 step1 回填为准），三态渲染（switchable/forced/excluded）复用
- [ ] `SubAgentTab.tsx`：browser 能力域块拆「内嵌浏览器 / 浏览器扩展」两个开关 + 「浏览器方法论」skill 开关（写 enabledSkills 或对应字段，实施时对齐 step1 的字段语义）
- [ ] `AbilityTab.tsx` / `AbilityPackSidebar.tsx` / `AbilityMountsSection.tsx`：验证三卡自然渲染；纯 skill 包详情页（无工具组区）形态检查，必要时空态文案
- [ ] 验证：dev 人工核对——场景页三行开关写回生效（关扩展后子会话派遣页双闸反映）、能力页三卡与挂载矩阵正确、纯 skill 包详情不空白不报错

## 实施回填（做完后填）

### 实际改动
- 与计划差异：场景页/能力页零代码改动（buildSceneOverview 遍历 ABILITY_PACKS 数据驱动，三行/三卡自动出，前端无包 key 硬编码）；派遣页拆分照计划落地；超计划顺手闭环 step1 遗留的 schedulerCustomAgentCell reason 失实；browser-methodology 未加场景页 skill 细选展开（单 skill 开包即自动勾，与 stock/article 同待遇）。
- 改动文件清单：
  - `app/settings/SubAgentTab.tsx`：`SINGLE_FIELD_BY_PACK` 增 browser/browser-extension 映射，双开关独立写 `ab.browser`/`ab.extension`，删 `setBrowserBlock`；`SKILL_BLOCK_PACK_KEYS = {code-workflow, browser-methodology}` 泛化 skill 细选块（块开关批量勾 `ab.skills`）；能力域顶部说明改写为准确语义（subAutonomous 包 Profile 独立裁决，skill 型包还需工作区包闸）
  - `electron/main/tipc/ability-scene.ts`：`schedulerCustomAgentCell` 增 browser-extension（'定时任务不挂扩展通道工具'）与 browser-methodology（并入 code-workflow 按任务配置文案）两 case

### 给下一步的接力棒
- 关键签名 / 数据结构：派遣页块顺序 = 注册表顺序（stock→article→browser→browser-extension→browser-methodology→web-mcp→code-workflow，浏览器三块连排）；`SKILL_BLOCK_PACK_KEYS` 在 SubAgentTab.tsx 顶部，与主进程 `SKILL_FILTER_PACK_KEYS`（ability-scene.ts）语义对齐；前端已无 browser/extension 能力域硬编码残留（全工作区 grep 确认）
- 下个 step 该从哪里继续：step 3 通道表述统一——WEB_RESEARCH_GUIDANCE 触发条件仍 `web-mcp \|\| browser`（pi-session.ts，扩展-only 会话不注入）；pi-session.ts:465 browserPlaybook 闸已随方法论包无需再动；场景页子会话行 groupNote「扩展能力（股票/文章/浏览器/联网/代码 skill）…」仍概括成立，如需逐包点名可顺带润色
- 待办或已知限制：存量 enabledSkills 缺 browser-exploration 的工作区子会话丢方法论 skill（派遣页勾补即可）；挂载矩阵 skill 型包行 loaded 只反映包级闸（code-workflow 既有行为非本次引入）；能力域块描述尾缀「子会话 Profile 独立生效，不受此开关约束」的「此开关」指工作区包总闸，编辑器语境有轻微歧义（stock/article/web-mcp 同样存在，属注册表描述全局措辞，顶部新说明已消歧）
