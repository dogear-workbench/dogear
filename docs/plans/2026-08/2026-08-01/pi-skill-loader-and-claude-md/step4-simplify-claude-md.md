---
step: 4
title: CLAUDE.md 精简改写
status: pending
---

## 目标

把 `.claude/CLAUDE.md` 从 ~120 行精简到 ~45 行，砍常识 / 评估性内容 / 细节，留约束 / 示警 / 项目级硬决策。这是规则层减负的最后一步，CLAUDE.md 同时被 pi 主会话和 SDK 主会话读取，精简后两侧都受益。

## 依赖上下文（接力棒输入）

- **前置 step 产出**：[step3-codebase-map-as-skill.md] codebase-map skill 已存在，CLAUDE.md 末尾的「详细参考」段引用 `Skill 工具加载 codebase-map` 才能真正生效
- **设计文档「CLAUDE.md 精简方案」一节**：[pi-skill-loader-and-claude-md-design.md](../../pi-skill-loader-and-claude-md-design.md) 已列出砍 / 留清单和精简后骨架
- **`os` import 不需要**：本 step 只改 .md 文件，纯文本编辑
- **feedback memory**：派子会话时把 .claude/ 下的文档/规则动作剥离出来，主会话自己做（写 .claude/ 会阻塞导致超时）。**本 step 必须主会话亲自做**，不要派子会话

## 计划改动

- [ ] 用 Edit 工具修改 `.claude/CLAUDE.md`，整体替换为精简版（按设计文档「保留的内容（精简后 ~45 行）」骨架）
- [ ] **保留技术栈速查表**：原 CLAUDE.md 的「技术栈速查」表格原样保留（Electron / Vite / React / Bun / shadcn / Zustand / tipc / AI SDK / JSON / Python / 文档解析 等），不砍
- [ ] 砍掉的内容（最终确认清单）：
  - 「禁止事项」里的「不要引入重复库」「不要自行实现 SDK 已提供的功能」（常识）
  - 「项目级硬性约定」里的「开发阶段不做兼容性代码」（偏抽象）
  - 「项目级硬性约定」里的「UI 交互状态（搜索/折叠/Minimap 等）用组件内 state，不随意扩大 store」（细节，移 codebase-map skill）
  - 「关键开发约定」整段的「TypeScript 配置」子段（细节，移 codebase-map skill）
  - 「关键开发约定」整段的「模块化解耦原则」子段（评估性，移 codebase-map skill）
  - 「关键开发约定」末尾的「详细的现有模块化范例」链接段（已经在指向 codebase-map.md / agent-development.md，转 skill 入口后这些 rules 文件不再被 pi 加载，CLAUDE.md 也不需要再指）
  - 「代码地图」整段（已经在指向 `.claude/rules/codebase-map.md`，现在 codebase-map 已经是 skill，不需要 CLAUDE.md 再指）
- [ ] 保留的内容（按设计文档骨架）：
  - 项目身份 + 技术栈速查表 + 常用命令
  - 硬约束 6 条（中文 / 95% 把握 / 不写注释 / 不留半成品 / >300 行拆 / path:line）
  - 红线 5 条（不绕 tipc / 不渲染层操作文件系统 / 不用 window.confirm / 不用 require() / RTK 自动处理）
  - 项目级硬决策 4 条（JSON 不用 SQLite / store 命名 / Agent 工具 registerTools / zod + isError）
  - 「详细参考」段：指向 Skill 工具加载 codebase-map / brainstorming / systematic-debugging 等
- [ ] 验证：精简后总行数 40-50 行；所有保留段的内容原样未丢；Markdown 格式正确（标题层级、列表符号）
- [ ] 手测：新建 pi 会话，问"你怎么回答的"或类似问题，让 agent 自报家门时验证它看到了精简版项目身份；问"代码地图"看 agent 是否会调 Skill 工具加载 codebase-map
- [ ] **不需要重新 build**：纯 .md 改动，重启 pi 会话即生效

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒

- **CLAUDE.md 已精简到 ~45 行**：同时影响 SDK 主会话（也读 CLAUDE.md）。SDK 侧原本依赖 path-based rules 触发的细节（agent-development.md / 模块化原则）通过 `.claude/rules/` 自动加载机制仍保留，**SDK 侧无规则丢失**。pi 侧则通过 codebase-map skill 按需加载这些细节。
- **`.claude/rules/` 暂留**：SDK 时代遗物，等 pi 主会话迁移最后阶段（上 AgentHarness 整包 + conversation 模型重构）收尾时统一清理。
- **后续 step（不在本计划范围）**：
  1. 把 tipc 那边给 `PiSessionConfig.systemPrompt` 注入的 SDK preset+append 模板拆掉，让 pi 完全自给自足（读 CLAUDE.md + skill 索引）
  2. persona / temp_prompt 迁移（作为用户消息第一条注入，不进 systemPrompt）
  3. 纯净会话模式 `conversation.mode === 'clean'` 实现
  4. AgentHarness 整包迁移（conversation 数据模型重构）
- 本计划全部 step 已完成，可在 plan.md 把所有 checkbox 改 `[x]` 并加「完成总结」段
