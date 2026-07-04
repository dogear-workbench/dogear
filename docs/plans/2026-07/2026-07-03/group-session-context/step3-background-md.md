---
step: 3
title: background.md 产物 + SaveGroupBackground 工具
status: done
---

## 目标

让 GROUP_DIGEST_SESSION 任务在同一次执行里产出 `digest.md` + `background.md` 两个文件。新增 `background-store.ts` 处理读写；新增 `SaveGroupBackground` MCP 工具供 agent 调；改造 group-digest-prompt 引导 agent 依次调 SaveGroupDigest + SaveGroupBackground。

## 依赖上下文（接力棒输入）

- 前置 step 产出：
  - Step 1 已经把组卡挪到 `groups/<groupId>/digest.md`
  - Step 2 完成了底层清洗函数收敛（这一步不直接依赖）
- 关键决策回顾：
  - background.md 是**结构化字段**（YAML frontmatter + 4 字段），不做人可读优化
  - 4 字段：`topic` / `progress` / `keyDecisions[]` / `openQuestions[]`
  - background.md 跟 digest.md updatedAt 一致（同任务同批产出）
  - 位置与组卡并列：`<configDir>/workspaces/<wsId>/groups/<groupId>/background.md`
  - 生成失败不阻塞 digest.md 落盘（分开保存，独立成功/失败）

## 计划改动

### 新增

- [ ] `electron/main/services/memory/background-store.ts`
  ```ts
  export interface GroupBackground {
    groupId: string;
    updatedAt: string;
    topic: string;
    progress: string;
    keyDecisions: string[];
    openQuestions: string[];
  }
  export function getBackgroundPath(wsId: string, groupId: string): string;
  export async function readGroupBackground(wsId: string, groupId: string): Promise<GroupBackground | null>;
  export async function saveGroupBackground(wsId: string, bg: GroupBackground): Promise<void>;
  ```
  - 落盘格式：YAML frontmatter + 正文
  - 对称于 group-digest-store.ts 的写法，可以参考它的模式（safe-json 或直接 fs.promises，看现有做法一致性）
- [ ] `electron/main/agents/tools/group-digest-tools.ts` 里新增 MCP 工具 `SaveGroupBackground`
  - 归属：`dogear-group-digest` server（跟 SaveGroupDigest 同一个）
  - 入参：`{ groupId, topic, progress, keyDecisions, openQuestions }`
  - 校验：`groupId` 必须与任务 payload 里的一致（复用 SaveGroupDigest 的校验模式）
  - 校验：4 字段必填，keyDecisions/openQuestions 可以是空数组
  - 内部调 `background-store.saveGroupBackground(wsId, bg)`

### 修改

- [ ] `electron/main/services/memory/group-digest-prompt.ts`
  - 修改 `DEFAULT_GROUP_DIGEST_PROMPT`：明确要求 agent 在保存组卡后**紧接着**调 SaveGroupBackground，并说明 4 个字段各自的语义
  - 关键提示词点：
    - topic 一句话概括组主题
    - progress 2-3 句自然语言说当前进展到哪
    - keyDecisions 数组，已经拍板不该重议的决策（关键，避免下一个新会话 agent 重复讨论）
    - openQuestions 数组，未决/搁置的问题
    - 强调"背景 md 是给下一个新会话 agent 看的目录页"这个目的
  - 保留旧的提示词内容并追加新指令，避免破坏组卡生成质量
  - 用户可编辑（loadGroupDigestPrompt 从磁盘读，如果磁盘上是旧版本，需要考虑覆盖还是保留——建议**首次启动检测缺 SaveGroupBackground 指令则覆盖播种一次**）

### 潜在改动

- [ ] `electron/main/agents/agent-worker.ts` 的 handleGroupDigestSessionTask：
  - 观察现有实现是否需要显式暴露 SaveGroupBackground 到 mcpServers 列表（应该 group-digest-tools.ts 里 registerTools 时会自动加，如果不是则手工加）
- [ ] `types/electron-api.ts` 或 shared types：如果前端要读 background.md，新增 `GroupBackground` 类型镜像

### 前端展示（可选、本 step 可不做）

- background.md 是 agent-only，前端**不需要**展示。DigestsPanel 保持只显示 digest.md。
- 如果未来想在前端 debug 面板加个"背景预览"，另起一个 step，不进本计划

## 手测清单

- [ ] 找一个已有组卡的组，改动几条会话让脏检查触发
- [ ] 触发一次 GROUP_DIGEST_SESSION（可以在 DigestsPanel 点"重新提炼"）
- [ ] 观察产物：`groups/<groupId>/digest.md` 更新 + `background.md` **首次生成**
- [ ] 打开 background.md 肉眼验证：
  - YAML frontmatter 有 groupId / updatedAt
  - topic 一句话且贴题
  - progress 2-3 句
  - keyDecisions 数组合理（不该有明显还没定的东西塞进来）
  - openQuestions 数组合理（不该跟 keyDecisions 冲突）
- [ ] 再触发一次同组的提炼：background.md updatedAt 更新，内容跟组卡一致演进
- [ ] 构造一个"agent 生成时 SaveGroupBackground 校验失败"的场景（比如提示词故意让它传错 groupId），观察 digest.md 仍然保存成功、background.md 失败但不阻塞

## 实施回填

### 实际改动

**新增文件 `electron/main/services/memory/background-store.ts`**：
- `GroupBackground { groupId, updatedAt, topic, progress, keyDecisions[], openQuestions[] }` 类型
- `getBackgroundPath(wsId, groupId)` → `<wsData>/groups/<groupId>/background.md`
- `serializeGroupBackground` / `parseGroupBackground` — YAML frontmatter（groupId/updatedAt/topic/progress + keyDecisionsJson/openQuestionsJson）+ 4 段人可读正文
- `readGroupBackground(wsId, groupId)`（ENOENT 返回 null）
- `saveGroupBackground(wsId, bg)`（mkdir + writeFile）
- 复用 `getGroupDir` from group-digest-store（与 digest.md 并列在 `groups/<groupId>/` 目录里）

**修改 `agents/tools/group-digest-tools.ts`**：
- 新增 `SaveGroupBackground` 工具，同一个 dogear-group-digest server
- 校验 groupId 一致（复用 SaveGroupDigest 模式）
- Zod schema：`{ groupId, topic, progress, keyDecisions[], openQuestions[] }` 全必填，数组允许空
- 工具描述强调「写这个之前一定要先写 SaveGroupDigest」但两者独立成功/失败
- `createGroupDigestTools` 签名从 `onSaved?` 拆成 `onDigestSaved? + onBackgroundSaved?`
- registerTools 加了 SaveGroupBackground 元数据（供设置页动态展示）

**修改 `agents/agent-worker.ts` (handleGroupDigestTask)**：
- 双回调：`let saved = false; let backgroundSaved = false;`
- allowedTools 加 `mcp__dogear-group-digest__SaveGroupBackground`
- 返回结果多带 `backgroundSaved` 字段（cancelled 分支也带）
- taskLogger 结尾同时打两个 saved 状态

**修改 `services/memory/group-digest-prompt.ts`**：
- DEFAULT_GROUP_DIGEST_PROMPT 改写：加步骤 5 引导 SaveGroupBackground，含 4 字段各自的语义 + 关键提示「background 是给下一个新会话的 agent 看的目录页，只写当前状态 + 已定 + 未定，不是复盘」
- 引入 `SAVE_BACKGROUND_SENTINEL = 'SaveGroupBackground'` 常量
- `loadGroupDigestPrompt`：磁盘上老提示词若**不包含** SaveGroupBackground 字样，视为旧版并覆盖播种一次（Phase 4 引入 background.md 时的一次性升级）

### 与原 plan 差异

- **未新增 GroupBackground 类型镜像到 types.ts** — background.md 是 agent-only，前端不读，types.ts 无需镜像
- **加了老模板覆盖播种检测** — 原 plan 提及「建议**首次启动检测缺 SaveGroupBackground 指令则覆盖播种一次**」，实际实现放在 `loadGroupDigestPrompt` 内部（比启动时全局扫更简单，任何触发点都能触发升级）
- **回调分离**：原 plan 单 `onSaved?` 保留到 SaveGroupDigest；新增 `onBackgroundSaved?` 给 SaveGroupBackground。这样 worker 能独立追踪两者

### 手测

未跑手测：
- `bun run build:electron`：**通过**
- Step 5 端到端时验证：GROUP_DIGEST_SESSION agent 是否两个都调、`background.md` 是否与 `digest.md` updatedAt 一致、SaveGroupBackground 失败是否不影响 digest.md

### 给下一步（Step 4）的接力棒

**关键 API**：
- `background-store.ts` 导出 `readGroupBackground(wsId, groupId)` + `getBackgroundPath(wsId, groupId)` + 类型 `GroupBackground`
- Step 4 的 `ReadGroupBackground` 工具直接调 `readGroupBackground`，null 时返回明确 message

**其他**：
- 组卡任务返回值多 `backgroundSaved` 字段；`group-digest-trigger.ts` 的 `pushRecent` / `classifyGroupDigestOutcome` **未消费** background 状态，暂不影响活动展示。若未来想在设置页 DigestsPanel 显示"两个产物是否都产出"再补
- 老提示词升级逻辑一次性，用户后续手动编辑不会被覆盖（因为编辑后应仍含 SaveGroupBackground 字样）；若用户手动删掉这个词会触发再一次覆盖——可接受
- SaveGroupBackground 独立成功/失败：agent 调用顺序（先 digest 后 background）由提示词保证；若 background 单独失败，digest.md 已落，下次 dirty 触发时会重新尝试 background
