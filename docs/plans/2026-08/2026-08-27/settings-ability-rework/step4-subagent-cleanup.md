---
step: 4
title: SubAgentTab 修复 + 收尾
status: done
---

## 目标

子会话派遣 tab 的 workspaceId 改为本地初始化（修复设置窗口里自定义 skill 列表拿不到的问题）；整体 lint / build 验证；同步 codebase-map。

## 依赖上下文（接力棒输入）

- 前置 step 产出：
  - [step1] `listSkills` custom 部分扫描 `.dogear/skills/`，签名不变
  - [step3] AbilityTab 已用「getAll + getDefault 本地 state」模式修好 workspaceId，本步在 SubAgentTab 复用同一模式
- 当前关键文件状态：
  - `app/settings/SubAgentTab.tsx:280` — `const workspaceId = useWorkspaceStore((s) => s.workspace?.id ?? null)`（设置窗口里恒 null）；`SubAgentTab.tsx:285-295` useEffect 里 `listSkills({ workspaceId })`；Profile 编辑器勾选 skill 用 `enabledAbilities.skills`（模板名）与 `customSkills`（自定义名）
  - `app/settings/WorkspaceManagementTab.tsx` — 自己 getAll 拉列表，`currentWorkspace` 仅用于删除当前工作区时 clearWorkspace（设置窗口里恒 null 的小瑕疵，本次不处理，记录即可）
- 关键决策回顾：workspaceId 用本地 state（getAll + getDefault，default null 选第一个），不依赖 workspace-store。

## 计划改动

- [x] `app/settings/SubAgentTab.tsx`
  - `useWorkspaceStore` 取 workspaceId 改为本地 state：挂载时 `client.getAll()` + `client.getDefault()` 初始化（与 AbilityTab 相同模式；不需要 Select UI——Profile 勾选 skill 只是读取 skill 列表，跟随默认工作区即可）
  - 移除 `useWorkspaceStore` import（若无其他使用点）
- [x] 全局收尾
  - `bun run lint` 全绿
  - `bun run build:electron` + `bun run build` 通过
  - 手工冒烟：设置窗口各 tab 切换、能力页开关读写、子会话派遣 Profile 编辑器里可选/自定义 skill 列表正常出现
- [x] doc-sync：更新 `docs/codebase-map.md`
  - `app/settings/` 段：AbilityTab 重构后的结构（双胶囊 + 工作区 Select + 拆出的 AbilitySkillView / AbilityToolGroupView、AbilityCard 已删）、布局改顶部 tab
  - `skill-service` / `pi-session` 段：custom skill 目录全局化（`.dogear/skills/`）、cross-session-review 已删
  - `article-parser-skills-service`：运行时目录 `.dogear/article-parser/` + 一次性迁移

## 验证

- 子会话派遣 tab：Profile 编辑器的 skill 勾选区出现可选模板 + 自定义 skill（生产 .dogear/skills/ 有内容时）；无自定义 skill 时只有模板列表，不报错
- 全量构建无 TS 报错；codebase-map 与实际代码一致

## 实施回填（做完后填）

### 实际改动
- 与计划差异：workspaceId 未落 state 而是 mount effect 内局部变量（SubAgentTab 无 Select UI、初始化后无变化源，state 无消费者会成为死代码）；零工作区时 listSkills({ workspaceId: null }) 照常返回三源列表（主进程安全，enabled 全 false，Profile 勾选不受影响）；doc-sync 额外修正了 review-skill-service.ts 条目（step1 后实为 no-op 遗留）与 pi-session.ts 条目（补 skill 三源扫描描述），AbilityCard 在 map 中本无条目故无需删条目
- 改动文件清单：`app/settings/SubAgentTab.tsx`（workspaceId 本地初始化 + 删 useWorkspaceStore import）、`docs/codebase-map.md`（settings 段 5 条 + review-skill-service/skill-service/article-parser-skills-service/pi-session.ts 条目）、本计划文档回填

### 给下一步的接力棒
- 关键签名 / 数据结构：SubAgentTab 挂载 effect 内 `getAll + getDefault → initial`（default 不在列表选第一个，零工作区 null）后同步拉 `listSkillTemplates()` + `listSkills({ workspaceId: initial })`；组件不再读 workspace-store
- 下个 step 该从哪里继续：本 step 为计划末步，无后续
- 待办或已知限制：无 GUI 环境未人工冒烟（建议有 GUI 环境过一遍设置窗口六 tab + Profile 编辑器 skill 列表）；WorkspaceManagementTab 的 currentWorkspace 恒 null 小瑕疵按计划记录不处理；step1 遗留的 review-skill-service.ts no-op 文件 + index.ts:484 调用未删（不在本计划范围）
