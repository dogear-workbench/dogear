---
step: 5
title: 入口收编与验证
status: done
---

## 目标

入口迁移收尾、旧代码清理、全链路构建与纯净模式冒烟。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step4-ui.md] 能力页两级结构可用，规则文件编辑在详情页
- 现状参考：设置页基础设置 tab 内的全局规则（agent.md）编辑入口（`app/settings/page.tsx` 定位）；主界面顶部 `WorkspaceRuleDialog.tsx`（保留为快捷入口，确认与详情页编辑同一份文件）

## 计划改动

- [x] 设置页基础设置的全局规则编辑入口删除，能力页「全局规则」详情为唯一完整编辑处（保留条目文案指向能力页）
- [x] 主界面顶部规则弹窗验证仍可用（同一读写链路 readWorkspaceAgentMd/writeWorkspaceAgentMd，同一份文件）
- [x] `SubAgentTab.tsx`：Profile 编辑器能力域区补一行交集语义说明（实际生效 = Profile 勾选 ∩ 工作区能力包开关）
- [x] 清理：tipc/system-prompt.ts 路由壳、types/system-prompt.ts 死类型、setSkillEnabled 路由+函数、GeneralAgentMdDialog 组件（死代码连带）
- [x] 全量验证：lint/build/tsc/test 全过 + bun 脚本三模式冒烟 28 断言全过（纯净/默认/协作关）
- [x] doc-sync 更新 codebase-map.md 能力页相关条目（plan.md 完成总结由主会话补）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 删除 GeneralAgentMdDialog 组件文件（计划只提删入口）：唯一消费方是 settings/page.tsx，入口删除后即成死代码，一并清理；读写的 RPC（readUserAgentMd 等）保留，能力页 RuleFileEditor 在用。
  - setSkillEnabled 连同 skill-service 同名函数一并删除（计划允许评估后删）：前端（ToolPacksTab/SubAgentTab/AbilityTab）零调用，能力页 skill 细开关走 updateWorkspaceConfig 原子双写。
  - 冒烟未实例化完整 PiSession（bun 脚本下 electron shim 缺具名导出，import 链过重），改用任务允许的退路加强版：mock 三个 tools 工厂 + workspace-config-service 后 import 真实 PiSession 原型，直接调 buildMainAgentToolDefs 真实现；resolveAbilities/buildGroupContextPrompt/段常量/拼装条件公式全部真实现（拼装公式为 pi-session.ts start() 内 main 分支的逐行复刻）。
  - 基础设置「通用级 Agent 指令」区块保留条目与路径说明、删除编辑按钮，文案指向能力页「全局规则」包（非整块删除，降低老用户迁移困惑）。
- 改动文件清单：
  - `app/settings/page.tsx` — 删 GeneralAgentMdDialog import/agentMdDialogOpen state/dialog 挂载/FileText icon；「通用级 Agent 指令」区块改纯文案指向能力页
  - `app/settings/SubAgentTab.tsx` — 能力域区补交集语义说明（Profile 勾选 ∩ 工作区能力包开关）
  - `electron/main/tipc/index.ts` — 移除 systemPromptRouter 注册
  - `electron/main/tipc/skill.ts` — 删 setSkillEnabled 路由（listSkills 保留）
  - `electron/main/services/skill-service.ts` — 删 setSkillEnabled 函数与 updateWorkspaceConfig import
  - 删除：`electron/main/tipc/system-prompt.ts`（getSystemPromptSegments 路由壳，主进程内部同名函数被 tipc/ability.ts 聚合使用故保留于 session-append-templates.ts）、`types/system-prompt.ts`（零消费方死类型；electron/main/types.ts 的同名接口仍在用，勿混淆）、`components/GeneralAgentMdDialog.tsx`
  - `docs/codebase-map.md` — AbilityTab 四条目重写为两级结构 + ability/ 目录条目；删 types/system-prompt 与 tipc/system-prompt 条目；新增 ability-registry.ts / tipc/ability.ts 条目；skill-service 条目去 setSkillEnabled；pi-session 条目标注能力拼装查包；session-append-templates 条目更新为现状导出
  - `docs/plans/.../step5-cleanup.md` — status done + 本回填

### 全量验证与冒烟结果
- `bun run lint`：0 errors / 87 warnings（全部存量 no-explicit-any 基线）
- `bun run build`（Vite + tsc 主进程）：通过
- `bunx tsc -p tsconfig.json --noEmit`（前端类型）：0 错误
- `bun test`：287 pass / 1 skip / 0 fail
- 冒烟（bun 脚本直调，DOGEAR_CONFIG_DIR 重定向临时目录，28 断言全过，脚本与临时目录已清理）：
  - 纯净模式（10 包全关）：activeAbilities 空集；无记忆/笔记/协作/Profile 索引段；无 core-profile；agent.md 文件存在但包关不读（标记文本不出现）；组上下文仅组名一句（结构段不受包开关影响）；工具组仅剩 dogear-tasks；工具定义无协作/记忆/笔记工具名
  - 默认模式（无 overrides）：生效 6 包（三规则+记忆+笔记+协作，skill 型 4 包 default false 不在）；记忆/笔记/协作/Profile 索引四段齐注入；工作区+全局 agent.md 标记文本出现；组上下文完整（组名+共享区引导）；工具组六组齐挂（memory/notes/group/delegation/reference/tasks）
  - 协作关（仅 agent-collab=false）：生效 5 包；dogear-delegation/group/reference 未注册，memory/notes/tasks 不受影响；无协作规范段；组上下文只剩组名一句（无共享区引导、无 ReadGroupBackground 指引）；记忆段仍在
- WorkspaceRuleDialog 验证：与能力页 workspace-rules 详情编辑同一读写 RPC（readWorkspaceAgentMd/writeWorkspaceAgentMd + getWorkspaceAgentTemplate），即同一份文件；弹窗 open 时重新拉取，能力页保存后立即反映 ✓

### 给下一步的接力棒
- 本任务五步全部完成，无遗留实施项；plan.md 完成总结由主会话补写
- `getSystemPromptSegments()`（session-append-templates.ts 内部函数）仍被 tipc/ability.ts 聚合段全文使用，勿删；tipc/system-prompt.ts 路由壳已删
- 工作区 package.json 版本号 bump 与 tmp/ 目录为环境既有改动，commit 时照旧排除
