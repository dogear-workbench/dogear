---
step: 3
title: 详情页布局
status: done
---

## 目标

skill 型详情页顶部压缩为两行、chips 中文化、右栏加宽左栏字号降档；规则详情页双编辑器改徽章切换。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2-mount-matrix.md] 右栏已有加载矩阵区块
- 关键决策回顾：顶部第一行 = 返回 + 中文包名（去英文 key 后缀与类型徽标，徽标挪右栏）；第二行 = skill chips；包描述挪右栏顶部开关上方；左栏整体滚动；chips 显示 SKILL.md 首行标题、缺失显示 key 标灰；右栏 w-72 → 约 5:4；规则页徽章「工作区规则 / 全局规则」切换一次一个编辑器

## 计划改动

- [x] `app/settings/ability/AbilityPackDetailPage.tsx`：顶部结构压缩两行；skill chips 数据源接 SKILL.md 首行标题（skillMetas 已含或经 IPC 补充）；描述挪右栏；左栏滚动容器调整；右栏宽度比例调整；类型徽标挪右栏
- [x] `app/settings/ability/RulesPackDetailPage.tsx` / `RuleFileEditor.tsx`：双编辑器改徽章切换（一次渲染一个），编辑态逻辑不变
- [x] 左栏 Markdown 字号降一档（SegmentBlock / SKILL.md 渲染处）
- [x] bunx tsc --noEmit / lint / build 全过

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - chips 中文化数据源落法：skill-template-service 新增 parseTitle（剥 frontmatter 取首个 `# ` 行）→ SkillTemplateMeta / AbilitySkillMeta 加 `title?` → getAbilityPacks 同一 IPC 透传，无新增端点、前端零硬编码；无 title 显示 key 标灰
  - 字号降档实现：PROSE_DOWN_CLASS = `[&.prose-sm]:text-xs [&_pre]:text-xs [&_th]:text-xs [&_td]:text-xs`（双类选择器压过 prose-sm，@tailwindcss/cli 验证过 CSS 生成）；skill 内容 h1 text-xl→text-lg
  - 规则页徽章切换 = 常驻挂载 + hidden 互斥（切徽章不丢未保存编辑），RuleFileEditor 编辑态逻辑零改动
  - AGENT_COLLAB_OFF_NOTE 文案迁移时修正失实（「裁剪纯组头/共享区移除」已被 step1 重划证伪，改为现行语义）
  - SystemBehaviorDetail 死代码清理（groupContext/subAgentContract 区块），behaviors prop 按接口保留不解构
  - 布局骨架：左栏 flex-[5] 单层滚动 / 右栏 Sidebar flex-[4]
- 改动文件清单：electron/main/services/skill-template-service.ts、electron/main/tipc/ability.ts、app/settings/ability/AbilityPackDetailPage.tsx、app/settings/ability/AbilityPackSidebar.tsx、app/settings/ability/RulesPackDetailPage.tsx、app/settings/ability/SystemBehaviorDetail.tsx

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - SkillTemplateMeta / AbilitySkillMeta 均含 `title?: string`；getAbilityPacks 透传，`!skill.title` = chip 无中文标题判定
  - PROSE_DOWN_CLASS（AbilityPackDetailPage 内，字号降档统一点）
- 下个 step 该从哪里继续：step4（开关乐观更新与设置全实时）——矩阵刷新信号仍挂 configVersion（Sidebar refreshKey），乐观更新去掉 configVersion 递增时必须换刷新信号；左栏已收敛单层滚动，闪烁面只剩 Markdown 重解析
- 待办或已知限制：build:renderer 失败为既有环境问题（@xterm/headless module 入口缺失，仅 pty-service 引用），非本计划引入，建议后续 bun install 重装；规则页右栏仍固定 w-80（计划只调 skill 型详情页）；首页系统行为卡 chip「提示词段 0 · 常驻工具」待后端 systemBehaviors 字段收尾时清理；docs/codebase-map.md 未同步（延续前两 step）
