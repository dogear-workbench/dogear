---
step: 1
title: 装配侧正常加载
status: done
---

## 目标
custom-agent-task 装配把 skillsOverride 从「全文拼接 systemPrompt」改为「available_skills 索引 + Skill 工具懒加载」。

## 依赖上下文
- 现状（commit 360dfaaa 后）：`custom-agent-task.ts:55-60` 调 `buildMountedSkillsSection(payload.skillsOverride)` 拼 `<mounted-skill>` 段进 fullSystemPrompt
- 可复用：`skill-loader.ts` 的 `formatSkillIndexForPrompt(entries)`（拼 `<available_skills>` 索引 + 引导语）与 `createSkillTool(entries)`（Skill 工具，defineTool 包装，entries 命中直接用缓存正文）；`loadAllSkillEntries()` 三目录索引
- 对照参考：`pi-session.ts:450-499` 的装配方式（skillEntries → index 文本进 systemPrompt）

## 计划改动
- [x] `custom-agent-task.ts`：装配改为 `const entries = (await loadAllSkillEntries()).filter(e => payload.skillsOverride?.includes(e.name))`；skillsOverride 非空且 entries 非空时：index 文本拼进 fullSystemPrompt（[systemPrompt, skillIndexText].filter(Boolean).join('\n\n')）、`createSkillTool(entries)` 追加进 tools；日志行同步
- [x] `custom-agent-prompt.ts`：删 buildMountedSkillsSection（无其他消费方，删前 grep 确认）
- [x] 验证：`bun run build:electron` 通过；grep 无 buildMountedSkillsSection/mounted-skill 残留

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无实质差异。过滤用 `Set(payload.skillsOverride).has` 而非 `includes`（与 pi-session.ts:464 的 skillsOverrideSet 同构）；日志行「挂载 skill:」保留，改为打实际装配成功的 entries 名单（能反映缺失/被过滤 skill，比打原始 skillsOverride 更准）
- 改动文件清单：
  - `electron/main/agents/tasks/custom-agent-task.ts:54-62`：import 改为从 skill-loader 取 loadAllSkillEntries/formatSkillIndexForPrompt/createSkillTool；overrideSet 过滤 → skillIndexText 拼 systemPrompt → entries 非空时 push createSkillTool
  - `electron/main/services/scheduler/custom-agent-prompt.ts`：删 buildMountedSkillsSection 与随之失去消费方的 `fs` / `loadAllSkillEntries` import，只余 buildCustomAgentPrompt

### 给下一步的接力棒
- 关键签名 / 数据结构：skillsOverride 语义不变（undefined=不挂，名单=挂载）；装配产物是 `<available_skills>` 索引 + 单个 `Skill` 工具（ToolDef，懒加载全文）。存量非 code-workflow 域 skill 照挂（无域过滤），与 plan 全局决策一致
- 下个 step 该从哪里继续：Step 2 编辑页 UI（TaskEditorPage 撤 CustomToolPacksSection/CustomSkillsSection，换场景同款矩阵组件），装配侧无需再动
- 待办或已知限制：无；sanitize（plan-validate.ts）与 types 未动（按边界要求）
