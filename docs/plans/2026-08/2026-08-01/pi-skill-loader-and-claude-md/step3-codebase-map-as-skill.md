---
step: 3
title: codebase-map 提升为 skill
status: pending
---

## 目标

把 `.claude/rules/codebase-map.md` 提升为 `.claude/skills/codebase-map/SKILL.md`，让 Step 2 接入的 skill loader 能扫到它。agent 在"不知道某个文件 / 模块在哪"时主动调用 `Skill(name='codebase-map')` 拿到完整代码地图。

## 依赖上下文（接力棒输入）

- **前置 step 产出**：[step2-pi-session-claude-md-and-dirs.md] pi-session.ts 已扫 `.claude/skills` 目录，本 step 只需让 codebase-map 在该目录下以合规的 SKILL.md 形式出现即可被发现
- **loadSkills 的 name 校验规则**（`node_modules/@earendil-works/pi-agent-core/dist/harness/skills.js:225`）：
  - 必须是 `[a-z0-9-]+`（小写字母 / 数字 / 连字符）
  - 长度 ≤ 64
  - 不能以 `-` 开头或结尾
  - 不能有连续 `--`
  - **name 必须等于父目录名**（"codebase-map" 目录对应 name="codebase-map"，否则 warn）
- **description 校验**：必填，长度 ≤ 1024
- **现有 codebase-map.md 位置**：`.claude/rules/codebase-map.md`（dogear 项目根），是 SDK 时代 path-based rules 触发的产物
- **现有 7 个 skill 的目录结构**（参考 `.claude/skills/brainstorming/`）：每个 skill 一个目录，目录内一个 `SKILL.md`（带 frontmatter）

## 计划改动

- [ ] 新建目录 `.claude/skills/codebase-map/`
- [ ] 新建 `.claude/skills/codebase-map/SKILL.md`：
  - frontmatter：
    ```yaml
    ---
    name: codebase-map
    description: 当你不清楚某个文件/模块在哪、要做什么时主动调用。包含 Dogear 项目的入口/页面/组件/Store/IPC 路由/服务层/Agent 框架/数据存储 的完整文件功能索引。
    ---
    ```
  - 正文：从 `.claude/rules/codebase-map.md` 整体复制过来（保持现有内容不动）
- [ ] **保留 `.claude/rules/codebase-map.md` 不动**：SDK 时代遗物，SDK 主会话仍会通过 path-based 触发加载它（虽然内容重复但 SDK 侧无影响）。等 pi 主会话迁移收尾时统一清理 `.claude/rules/`
- [ ] 验证 description 不超 1024 字符（实际看下来这段很短，肯定不超）
- [ ] 手测：pi 会话启动后看日志 `skills: [...]` 数组里有没有 `codebase-map`；新会话里发"models 层在哪"这种问题，看 agent 是否主动调 `Skill(name='codebase-map')`

## 实施回填（做完后填）

### 实际改动

- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒

- **codebase-map skill 已生效**：description 写法影响 agent 命中率，初版用 "当你不清楚某个文件/模块在哪、要做什么时主动调用"。如果手测发现命中率低，调整 description 关键词（让模型在"在哪 / 哪里 / 不知道"等表达时更易触发）
- **现有 `.claude/rules/codebase-map.md` 未删**：因为 SDK 仍会 path-based 触发。两份内容此时重复，等 pi 迁移收尾时再删旧版。**注意**：以后改 codebase-map 内容要同步改两份——或者 Step 4 之后改成 SKILL.md 为单一来源，`.claude/rules/codebase-map.md` 改成单行重定向提示。短期不优化。
- 下个 step 该从哪里继续：`.claude/CLAUDE.md` 精简改写（最后一步，独立改文件）
