# 提示词四层架构重构 实施计划

**目标**：落地 [prompt-layering-design.md](../prompt-layering-design.md)——四层提示词单一事实源、code-discipline 新建、staged-execution 瘦身、execProfile 接线修正、用户级 agent.md 复活。

**架构思路**：纯内容（agent.md/skill 模板）先行，代码接线随后，最后 doc-sync 收口。每步独立可验证，内容层不依赖代码层（skill 挂载查表没改之前，新 skill 不会被 code-impl 任务挂载，但 code-workflow 包开着的工作区可见索引，无副作用）。

**涉及模块**：应用数据目录 2 个 agent.md、resources/agent-templates/、resources/skill-templates/（3 个 skill）、electron/main（task-queue.ts / task-tools.ts / ability-registry.ts / task-execution-prompt.ts / session-append-templates.ts）、docs/codebase-map/agent-core.md

## 步骤索引

- [x] [Step 1: agent.md 内容层三处](./step1-agent-md.md) — 用户级重写 + general 模板同步 + 工作区去重
- [ ] [Step 2: skill 层三文件](./step2-skill-layer.md) — code-discipline 新建 + staged-execution 瘦身 + brainstorming 引用化
- [ ] [Step 3: 代码接线](./step3-code-wiring.md) — 挂载查表 / CreateTask 文案 / 能力注册 / 执行提示词 + build + 测试
- [ ] [Step 4: doc-sync 与端到端自查](./step4-docsync-verify.md) — 代码地图同步 + 挂载链路验证

## 全局决策

- **单一事实源裁决**：通用流程约定 → 系统段；项目事实 → 工作区 agent.md；场景步骤 → skill；跨工作区人格 → 用户级 agent.md。skill 内文引用不复述；skill 的 frontmatter description 属场景定义，允许自含保留
- **staged-impl 的 SKILL.md 本次不动**（description 触发条件即场景定义，保留）
- **不 rename 'code-impl' 枚举**：存量数据/UI/查表三处引用，只改语义描述
- **code-discipline 的 lint/build 命令不写死具体命令名**：写「按项目 agent.md 常用命令区执行」，保持跨工作区通用
- **路径常量**（Step 1 用）：
  - 用户级 agent.md：`/Users/dream/Library/Application Support/dogear/.dogear/agent.md`（应用数据目录已挂载进会话文件边界，直接写文件；agent.md 不在禁写区清单）
  - dogear 工作区 agent.md：`/Users/dream/Library/Application Support/dogear/.dogear/workspaces/572b768f-70d2-42a0-983c-29093c4b0b9d/agent.md`
- **验证纪律**：改 electron/ 下文件后 `bun run build:electron`；全部完成后 `bun run lint`；相关测试文件逐一跑（Step 3 详列）
- **提交纪律**：每 step 验收通过即 commit，只提交该 step 计划内文件；message 格式 `<type>(<模块>): <做了什么>`，禁 Co-Authored-By 等 AI 署名 trailer
