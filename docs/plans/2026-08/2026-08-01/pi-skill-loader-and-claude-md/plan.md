# pi Skill 加载机制 + CLAUDE.md 精简 实施计划

**目标**：让 pi 主会话能用 pi-agent-core 的 `loadSkills` 发现多个目录的 skill，启动时主动读 CLAUDE.md 拼进 systemPrompt，同时把 CLAUDE.md 精简到 ~45 行（砍常识 / 评估性内容 / 细节，留约束 / 示警 / 硬决策）。

**架构思路**：用 `harness/skills.js` 的 `loadSkills` 模块替换手写 skill-loader（白嫖递归 / .gitignore / yaml 解析 / name 校验）；pi 主会话启动时主动 `fs.readFile` 读项目级 + 用户级 CLAUDE.md，加 skill 索引，三段拼一次进 systemPrompt，**不学 SDK 的 preset + append 多源模板**。详见 [设计文档](../pi-skill-loader-and-claude-md-design.md)。

**涉及模块**：
- `electron/main/agents/pi-session/skill-loader.ts`（重写）
- `electron/main/agents/pi-session/pi-session.ts:135`（扩扫描目录 + 读 CLAUDE.md）
- `.claude/skills/codebase-map/SKILL.md`（新增）
- `.claude/CLAUDE.md`（精简改写）

## 步骤索引

- [x] [Step 1: 重写 skill-loader 用 loadSkills 替换手写](./step1-rewrite-skill-loader.md) — 删除手写 frontmatter 解析 / formatSkillIndexForPrompt / createSkillTool，改为薄封装 pi-agent-core 的 `loadSkills` + `formatSkillInvocation`；保留对外签名不变
- [ ] [Step 2: pi-session 接入 CLAUDE.md + 扩 skill 扫描目录](./step2-pi-session-claude-md-and-dirs.md) — `start()` 内读 `.claude/CLAUDE.md` + `~/.claude/CLAUDE.md`，扩 `loadSkillIndex` 调用到 4 个目录，重构 systemPrompt 拼装顺序
- [ ] [Step 3: codebase-map 提升为 skill](./step3-codebase-map-as-skill.md) — 新建 `.claude/skills/codebase-map/SKILL.md`，从 `.claude/rules/codebase-map.md` 复制内容 + 加 frontmatter
- [ ] [Step 4: CLAUDE.md 精简改写](./step4-simplify-claude-md.md) — 按设计文档的精简方案改 `.claude/CLAUDE.md` 到 ~45 行

## 全局决策

- **systemPrompt 极简策略**：pi 主会话的 systemPrompt = 项目级 CLAUDE.md + 用户级 CLAUDE.md（可选）+ skill 索引。三段拼一次，**不接 persona / temp_prompt**（留作后续 step），不迁移 SDK 的 6 段隐形系统契约（`session-append-templates.ts`）。
- **skill 扫描顺序**（顺序敏感，后到覆盖前者）：`.claude/skills` → `~/.claude/skills` → `.dogear/skills/article-parser` → `.dogear/skills/review`。项目级优先级最低，本地 `.dogear` 优先级最高。
- **skill-loader 对外签名保持不变**：`loadSkillIndex(dirs)` / `formatSkillIndexForPrompt(entries)` / `createSkillTool(entries)` 三个函数签名不动，只换内部实现，避免影响 pi-session.ts 调用方。
- **CLAUDE.md 精简会同时影响 SDK 主会话**：SDK 自己也读 CLAUDE.md，精简后 SDK 侧也减负；但 SDK 还会自动加载 `.claude/rules/`（path-based 触发），所以 SDK 侧不丢规则。这是设计内的正向副作用。
- **`.claude/rules/` 本次不动**：SDK 时代遗物，等 pi 主会话迁移收尾时统一清理。
- **派子会话执行时**：Step 4（修改 `.claude/CLAUDE.md`）必须主会话亲自做，不要派子会话（参考 feedback memory：写 .claude/ 会阻塞导致超时）。其他 step 可以派子会话。
- **不写单测**：项目偏好，验证靠 build + lint + 手测。
