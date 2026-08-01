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
- [x] [Step 2: pi-session 接入 CLAUDE.md + 扩 skill 扫描目录](./step2-pi-session-claude-md-and-dirs.md) — `start()` 内读 `.claude/CLAUDE.md` + `~/.claude/CLAUDE.md`，扩 `loadSkillIndex` 调用到 4 个目录，重构 systemPrompt 拼装顺序
- [x] [Step 3: codebase-map 提升为 skill](./step3-codebase-map-as-skill.md) — 新建 `.claude/skills/codebase-map/SKILL.md`，从 `.claude/rules/codebase-map.md` 复制内容 + 加 frontmatter
- [x] [Step 4: CLAUDE.md 精简改写](./step4-simplify-claude-md.md) — 按设计文档的精简方案改 `.claude/CLAUDE.md` 到 ~45 行

## 全局决策

- **systemPrompt 极简策略**：pi 主会话的 systemPrompt = 项目级 CLAUDE.md + 用户级 CLAUDE.md（可选）+ skill 索引。三段拼一次，**不接 persona / temp_prompt**（留作后续 step），不迁移 SDK 的 6 段隐形系统契约（`session-append-templates.ts`）。
- **skill 扫描顺序**（顺序敏感）：`.claude/skills` → `~/.claude/skills` → `.dogear/skills/article-parser` → `.dogear/skills/review`。**Step 2 实施时发现 loadSkills 内部去重逻辑是「先到为准」而非「后到覆盖」**——这意味着当前传入顺序下项目级 `.claude/skills` 实际优先级最高（与原设计期望相反）。当前各目录无重名 skill，行为正确，未来若引入重名需重新审视传入顺序。
- **skill-loader 对外签名保持不变**：`loadSkillIndex(dirs)` / `formatSkillIndexForPrompt(entries)` / `createSkillTool(entries)` 三个函数签名不动，只换内部实现，避免影响 pi-session.ts 调用方。
- **CLAUDE.md 精简会同时影响 SDK 主会话**：SDK 自己也读 CLAUDE.md，精简后 SDK 侧也减负；但 SDK 还会自动加载 `.claude/rules/`（path-based 触发），所以 SDK 侧不丢规则。这是设计内的正向副作用。
- **`.claude/rules/` 本次不动**：SDK 时代遗物，等 pi 主会话迁移收尾时统一清理。
- **派子会话执行时**：Step 4（修改 `.claude/CLAUDE.md`）必须主会话亲自做，不要派子会话（参考 feedback memory：写 .claude/ 会阻塞导致超时）。其他 step 可以派子会话。
- **不写单测**：项目偏好，验证靠 build + lint + 手测。

## 完成总结

**4 个 step 全部完成**：

- Step 1：skill-loader 改为薄封装 `loadSkills` + `formatSkillInvocation`，对外三函数签名不变。
- Step 2：pi-session.ts 启动读项目级 + 用户级 CLAUDE.md，扩 skill 扫描到 4 个目录，systemPrompt 改 4 段拼装。
- Step 3：codebase-map 提升为 `.claude/skills/codebase-map/SKILL.md`（保留旧 `.claude/rules/codebase-map.md` 不动）。
- Step 4：CLAUDE.md 精简到 61 行（原 117 行，砍 48%；技术栈表 + bash 块占大头，比设计文档预估 ~45 行偏多但可接受）。

**实施中发现的真实偏差**：

- loadSkills 内部去重是「先到为准」而非「后到覆盖」。当前传入顺序下项目级 `.claude/skills` 实际优先级最高，与 plan 全局决策原本期望相反。当前各目录无重名 skill，行为正确；未来若引入重名需重新审视目录传入顺序。（已记到全局决策注释）

**遗留 / 后续 step（不在本计划范围）**：

1. tipc 那边给 `PiSessionConfig.systemPrompt` 注入的 SDK preset+append 模板（session-append-templates.ts 那 6 段隐形契约）尚未拆——pi 当前 systemPrompt 拼了冗余的 SDK preset。后续 step 把这个字段废弃，让 pi 完全自给自足（读 CLAUDE.md + skill 索引）。
2. persona / temp_prompt 迁移（作为用户消息第一条注入，不进 systemPrompt）。
3. 纯净会话模式 `conversation.mode === 'clean'` 实现（不读 CLAUDE.md、不带项目 skill 索引）。
4. AgentHarness 整包迁移（conversation 数据模型重构），届时统一清理 `.claude/rules/`。
5. `formatSkillInvocation` 在 Windows 下 `References are relative to` 段显示 `/`（上游 pi-agent-core bug），不影响功能。

**验证状态**：

- `bun run lint` 0 errors（83 warnings 全是项目存量，本次改动文件无 warning）。
- `bun run build:electron` 通过。
- 手测项（pi 启动后 skills 数组长度 ≥ 10、claudeMd 字段、agent 自报家门、调 codebase-map skill）未执行——主进程改动后需要重启 dev 才能验证，不在 staged-execution 范围。
