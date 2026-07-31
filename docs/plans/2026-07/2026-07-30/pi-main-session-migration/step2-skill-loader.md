---
step: 2
title: Skill 加载器
status: done
---

## 目标

实现一个不依赖 `AgentHarness` 的轻量 skill 加载器，让 pi 会话能加载 `article-parser`/`review` 两个现有本地 skill（`SKILL.md` 格式），索引注入 systemPrompt、命中后懒加载详情。验收标准：在 pi 会话里聊"帮我看看首页报告"之类能触发 review skill 的对话，观察到模型确实读到了完整 `SKILL.md` 内容并按其指引行动（不要求这一步就跑通完整 PARSE_ARTICLE/review 业务链路，那依赖第二批才会接入的其他工具，这一步只验证"skill 索引注入 + 懒加载"机制本身工作正常）。

## 依赖上下文（接力棒输入）

- **前置 step 产出**：[step1-walking-skeleton.md] 已建立 `PiSession` 基础骨架（能收发文本消息），本步骤在其 `start()`/构造 systemPrompt 的地方插入 skill 索引。
- **设计文档已定方案**（`docs/plans/2026-07/2026-07-30/pi-main-session-migration-design.md` "Skill 加载"一节）：
  - 不引入 `AgentHarness`，手写 loader
  - 核心逻辑：扫描目录找 `SKILL.md` → 正则切分 frontmatter（`---\n...\n---`）解析 `name`/`description` → 拼索引文本塞进 systemPrompt → 命中后通过一个新的 `Skill` 工具（`ToolDef`）把完整 body 作为工具结果返回
  - 零新依赖，不用 `yaml`/`ignore` 包
- **现有本地 skill 目录**：
  - `electron/main/services/article-parser-skills-service.ts` 幂等初始化 `.dogear/skills/article-parser/`，内容 `SKILL.md`（frontmatter `name`+`description`）+ `common.md` + `platforms/*.py` + `history.jsonl`
  - `electron/main/services/memory/review-skill-service.ts` 初始化 `<configDir>/skills/review/SKILL.md`
- **SDK 侧对照**（供理解格式，不需要照抄机制）：`query-based-session.ts:460-469` 用 `plugins: [{ type: 'local', path }]` 挂载，`getArticleParserSkillsDir()`/`getReviewSkillDir()` 两个函数返回目录路径，可直接复用这两个函数取路径。
- **`ToolDef`/`toPiTools` 签名**：`electron/main/agents/pi/tool-adapter.ts`，`defineTool(name, description, schema, handler)` 返回 `ToolDef`，`toPiTools(defs: ToolDef[]): AgentTool[]`。

## 计划改动

- [ ] 新建 `electron/main/agents/pi-session/skill-loader.ts`：
  - `loadSkillIndex(dirs: string[]): Promise<SkillEntry[]>`（`SkillEntry = { name, description, dir, bodyPath }`）—— 遍历每个目录找 `SKILL.md`，手写正则切 frontmatter，解析 `name`/`description`（简单 `key: value` 逐行解析即可，不需要完整 YAML 解析器，frontmatter 字段就两三个）
  - `formatSkillIndexForPrompt(entries: SkillEntry[]): string` —— 拼 `<available_skills>` 风格的索引文本
  - `createSkillTool(entries: SkillEntry[]): ToolDef` —— 一个名为 `Skill` 的工具，入参 `{ name: string }`，handler 读取对应 `SKILL.md` 全文返回
- [ ] `pi-session.ts`（Step 1 产出）里，构建 systemPrompt 时调用 `loadSkillIndex([getArticleParserSkillsDir(), getReviewSkillDir()])` 并拼接索引；构建工具列表时加入 `createSkillTool(entries)`
- [ ] 手测：pi 会话里问一个会触发 review skill 索引命中的问题，确认模型调用了 `Skill` 工具、拿到了完整 SKILL.md 内容

## 实施回填（做完后填）

### 实际改动

- 新建 `electron/main/agents/pi-session/skill-loader.ts`：
  - `loadSkillIndex(dirs: string[]): Promise<SkillEntry[]>` —— 遍历 `<dir>/SKILL.md`，正则 `^---\r?\n([\s\S]*?)\r?\n---` 切 frontmatter，逐行 `key: value` 手写解析（只认 `name`/`description`），目录/文件不存在或字段缺失静默跳过（缺字段打 warn）。
  - `formatSkillIndexForPrompt(entries): string` —— 拼 `<available_skills>` 索引文本，无 entry 返回空串。
  - `createSkillTool(entries): ToolDef` —— 名为 `Skill` 的工具，入参 `{ name: string }`，命中读全文返回 + `mainLogger.info` 打日志，未命中 `isError: true` + 可用列表提示。
- 修改 `pi-session.ts`：`start()` 里 `buildPiModels(profile)` 之后调 `loadSkillIndex([getArticleParserSkillsDir(), getReviewSkillDir()])`，索引文本拼进 systemPrompt（`[原提示词, 索引文本].filter(Boolean).join('\n\n')`），`toPiTools([createSkillTool(skillEntries)])` 塞进 `Agent` 的 `initialState.tools`；完成日志加了 `skills: skillEntries.map(e => e.name)`。
- 未改动其他文件，`message-converter.ts` 的 `tool_use`/`tool_result` 转换按计划留给 Step 3。
- 验证：`bun run build:electron`（0 错误）、`bun run lint`（0 error，83 个既有 warning 未增加）均通过；手测确认两个 skill 目录扫描正确、`Skill` 工具命中/未命中行为均符合预期。

### 给下一步的接力棒

- **`SkillEntry`**：`{ name: string; description: string; dir: string; bodyPath: string }`。
- **`createSkillTool` 返回的是中立 `ToolDef`**（复用 `pi/tool-adapter.ts` 的 `defineTool`），`pi-session.ts` 里统一走一次 `toPiTools([...])` 转换后整体赋给 `initialState.tools`。**Step 3 扩充工具列表时**建议延续这个模式：各业务域产出自己的 `ToolDef[]`，最后 `toPiTools([...skillTool, ...fileTools, ...])` 一次性转换、一次性赋值，不要多次调用 `toPiTools`。
- **索引文本实际样子**：
  ```
  以下 skill 提供特定任务的专项指引。当任务匹配某个 skill 的 description 时，先调用 Skill 工具（参数 name）加载完整内容，再按其指引行动。

  <available_skills>
    <skill>
      <name>article-parser</name>
      <description>...</description>
    </skill>
    <skill>
      <name>cross-session-review</name>
      <description>...</description>
    </skill>
  </available_skills>
  ```
  **已知简化**：description 未做 XML 转义（现有两个 SKILL.md 描述都是纯文本无特殊字符），未校验 name/description 长度上限，只扫描单层 `<dir>/SKILL.md` 不递归子目录。这些如果后续要挂载更多/第三方 skill 需要补上。
- 完整交付细节见组共享区 `step2-delivery.md`。
