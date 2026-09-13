# 子会话预设按能力域块化 + 挂载矩阵补任务维度 实施计划

**目标**：ProfileEditor 能力域区按能力页包结构分块（总开关 + 细选浮窗）、挂载矩阵补三条后台任务固定行、内置「浏览器解析」预设并入文章能力、术语「细闸/总闸」换「子开关/总开关」。

**架构思路**：数据层不动（`enabledAbilities` 字段结构与 `resolveAbilities` 链路保持不变），只重排 UI 与展示；编辑器块结构数据源换 `getAbilityPacks()` 单一真源，退役 `CODE_WORKFLOW_TEMPLATES` 硬编码；矩阵后台任务行按 `buildCustomToolSet` 实际装载逻辑计算 loaded。设计全文见 [../subagent-profile-ability-blocks-design.md](../subagent-profile-ability-blocks-design.md)。

**涉及模块**：`app/settings/SubAgentTab.tsx`、`app/settings/ability/AbilityMountsSection.tsx`、`electron/main/tipc/ability.ts`、`electron/main/services/settings-types.ts`、注释/测试名/codebase-map 术语同步。

## 步骤索引

- [x] [Step 1: 数据层预设合并与术语替换](./step1-preset-merge.md) — browser-parse 加 article 能力 + description 重写；全库「细闸/总闸」换「子开关/总开关」
- [x] [Step 2: 挂载矩阵补任务维度](./step2-matrix-scheduler.md) — scene kind 加 scheduler，三条固定行按 enabledToolPacks 计算，前端展示适配
- [x] [Step 3: ProfileEditor 能力域块化](./step3-profile-blocks.md) — 块行 + 细选 Popover 重构，补 stock skill 勾选入口
- [x] [Step 4: 联调验证与文档同步](./step4-verify-docs.md) — 全链路验证 + codebase-map 同步 + 完成总结

## 全局决策

- **术语**：细闸 → 子开关；总闸 → 总开关（UI 文案、reason 字符串、注释、测试名、文档统一）
- **数据层冻结**：`SubAgentEnabledAbilities` 字段结构不变，块化只动渲染与勾选写回逻辑；存量 Profile 的 `ab.skills` 混入的其他域 skill 名原样保留不清除
- **块总开关语义**：细项勾选独立于总开关保存（关域不清细项）；browser 块开 = 双通道都 false 时双置 true，关 = 双清；code-workflow / 自定义 Skill 块以数组非空为「开」
- **browser-parse 预设**：id 与 name 不动（agent 文案 8 处硬引用），只加 `article: true` 与重写 description；存量靠 normalize deepMerge 补齐
- **矩阵后台行语义**：以 `custom-agent-tools.ts` 的实际装载为准（memory 恒装、browser 只查 `browser` 条目不装扩展、skill 文本与规则段不注入）；enabledToolPacks 残留旧 key 静默忽略
- **主进程改动需 `bun run build:electron` 重新编译**，Vite 热重载只对前端生效

## 完成总结

**实际改动汇总（按 step）**

- **Step 1（62ddeca5）数据层预设合并与术语替换**：`createBrowserParseSubAgentProfile` 加 `article: true` + 双通道调研描述重写（settings-types.ts）；normalize 对 browser-parse 按内置全集补缺失键 + 旧描述按 LEGACY 已知值迁移（settings-service.ts，LEGACY 集合新增第 6 个旧值）；渲染层镜像工厂同步（types/settings.ts）；迁移冒烟脚本补 v6 用例并修复既有 FAIL 用例；全库「细闸/总闸」→「子开关/总开关」归零（源码/测试名/codebase-map）。
- **Step 2（bb533ae4）挂载矩阵补任务维度**：`AbilityMountSceneKind` 加 `scheduler`；`buildMountRows` 在 executor 行后追加三条 system 行（定时自定义任务按 `schedulerCustomAgentCell`/`schedulerPackHitCell` 对齐 buildCustomToolSet 实际装载、话题状态抽取/文章解析恒 false）；前端 AbilityMountsSection 按 kind 显示「后台任务」徽标。
- **Step 3（20236274）ProfileEditor 能力域块化**：新增 `app/settings/subagent/AbilityBlockRow.tsx`（块行 + 细选 Popover + 通道开关 + skill 细选项）；SubAgentTab 能力域区按 `getAbilityPacks()` 单一真源块化渲染（单开关/细选/双通道三类块 + 自定义 skill 块 + 交付通信固定行），退役 `CODE_WORKFLOW_TEMPLATES`/`BOOLEAN_ABILITIES`/`toggleInArray`，写回走 enabledAbilities 原字段（数组只增删包内名）；getAbilityPacks 失败显示错误行 + 重试。
- **Step 4（本次）联调验证与文档同步**：验证全绿（见下）；docs/codebase-map/settings.md 三处同步（ability/ 组件描述补挂载矩阵后台任务行、「细开关」→「子开关」、SubAgentTab 块化描述、settings-service browser-parse 模板补键迁移描述）。

**验证结果（Step 4）**

- `bun run build:electron` / `bun run build`（Vite + tsc）/ `bun run lint` 全绿（0 errors；84 warnings 为存量 no-explicit-any 基线）
- `bun test electron/main/agents/` 106 pass / 0 fail（11 文件，含 ability-registry / tool-registration-smoke）
- `node resources/browser-eval/profile-migration-smoke.mjs` 全 PASS（含 v6 旧描述迁移与幂等）
- 代码级联调断言：normalize 补键链（settings-service.ts:314）确认 browser-parse 存量自动获得 `article: true`（显式 false 保留）；renderPackBlock 确认 article 块按模板四键全 true 初始 on（含直通注明）、browser 块 2/2 on；buildMountRows → AbilityMountsSection kind 映射数据链完整无断点；本工作区两工作区 config.json `enabledToolPacks: []` → skill-packs 包后台行 false「工作区未启用该域任何工具包」、memory 行恒 true，推演与实现一致

**与原计划偏差**

- 挂载矩阵前端展示取「kind 徽标映射『后台任务』」方案（计划给的二选一之一）
- Step 1 外配套：LEGACY 集合加旧值、types/settings.ts 镜像同步、冒烟脚本修复既有 FAIL 用例（基线即红，非本次引入）
- 交付通信固定行保留（不出块、无写回），prompt-only 与 notes/group-context/agent-collab 不出块
- 细选按钮带计数（「细选 · n/m」）为 UI 增补；块描述统一取 pack.description 单一真源

**遗留问题**

- **browser 块中间态缝隙（既有语义）**：`resolveAbilities` 子会话过滤只查 `ab.browser`（ability-registry.ts），细选仅开扩展通道时块 Switch 显示 on 但 browser 包实际不生效；已裁决为设计拍板语义 + 数据层冻结下的既有行为，不改主进程，留档。
- **SubAgentTab.tsx 618 行**：块化后超出 300 行拆分线（主函数 ProfileEditor 约 220 行未超）；step3 交付记「约 510 行」为低估，实际以 wc 为准；如需进一步拆 ProfileEditor 到 subagent/ 目录另立任务。
- **LEGACY_BROWSER_PARSE_DESCRIPTIONS 已累积 6 个旧值**：纯历史包袱，保留迁移能力，无清理计划。
- **源码区残留 3 处「细开关」旧表述**（skill-service.ts:9、ability.ts:224/242）：**已收尾**——验收阶段主会话裁决为术语统一目标内第三种写法漏网，授权 step4 补漏替换为「子开关」，grep 归零 + build:electron 通过（见 step4-delivery 返工修复记录）。
- **UI 人工目视未做**：执行环境无法启动 Electron UI，Profile 编辑勾选组合/矩阵行展示以代码级推演替代（step2 15 项、step3 勾选组合断言、step4 数据链断言），建议用户首次启动时目视抽验：设置 → 子会话派遣（browser-parse Profile 的 article 块初始 on）与设置 → 能力（任一包详情出现三条「后台任务」行）。
