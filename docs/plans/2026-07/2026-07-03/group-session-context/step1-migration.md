---
step: 1
title: 数据迁移 + _cleaned/ 清理 + startup gate
status: done
---

## 目标

把组卡从 `<configDir>/workspaces/<wsId>/digests/<groupId>.md` 迁移到 `<configDir>/workspaces/<wsId>/groups/<groupId>/digest.md`；删掉 `_cleaned/` 留盘副作用；用启动闸门阻塞 group-digest-trigger / category-trigger 直到迁移完成。

## 依赖上下文（接力棒输入）

- 前置 step：无（这是第一步）
- 关键现状：
  - 现有组卡路径：`electron/main/services/memory/group-digest-store.ts` 里的 `getDigestPath()` 之类函数决定
  - 现有 `_archive/` 目录来自 Phase 3 的 `migration-p3.ts`（保留不动）
  - `_cleaned/` 是 `cleanTranscript` 函数的落盘副作用，来自 `transcript-cleaner.ts`
  - 启动时序：`app.whenReady` 里已有 migration-p3 的调用点，migration-p4 加在它之后
  - 现有 group-digest-trigger 有个 in-flight 队列，无 startup gate 机制
- 关键决策回顾：
  - 迁移 one-shot 不做双写（项目"不做兼容层"原则）
  - `_cleaned/` 完全删掉不留 debug 开关（用户明确确认）
  - `digest-activity.json` 里的 recent path 字段迁移时清空（简单，只是最近活动展示）
  - migration 期间 group-digest-trigger 完全阻塞（否则并发写会撞车）

## 计划改动

### 新增

- [ ] `electron/main/services/memory/migration-p4.ts`
  - 导出 `runMigrationP4(configDir: string): Promise<void>`
  - 幂等检测：`groups/<groupId>/digest.md` 存在即跳过
  - 迁移动作：读旧路径 → 写新路径 → 删旧路径（不用 rename，避免跨挂载点）
  - 单个失败留原地 + 日志报错 + 继续下一个
  - 迁移完成后：`digests/_cleaned/` 目录整个删除；`digests/` 目录如果空了删除，还有 `_archive/` 则保留
  - `digest-activity.json` 里的 recent 字段清空
- [ ] `electron/main/agents/agent-manager.ts` 或 `group-digest-trigger.ts` / `category-trigger.ts` 里加一个 startup gate 标志：
  - 模块级 `let migrationComplete = false`
  - 导出 `markMigrationComplete()`
  - `triggerGroupDigestScan` / `triggerGroupDigest` / `triggerCategorize` / `triggerFullRebuild` 入口检查 gate，未完成时短路返回（配 log）

### 修改

- [ ] `electron/main/services/memory/group-digest-store.ts`
  - `getDigestPath(wsId, groupId)` 返回 `groups/<groupId>/digest.md`（新路径）
  - readGroupDigest / saveGroupDigest / listGroupDigests / deleteGroupDigest 全部指向新路径
  - listGroupDigests 需要扫 `groups/*/digest.md`，不再扫 `digests/*.md`
- [ ] `electron/main/services/memory/transcript-cleaner.ts`
  - 删除 `cleanTranscript` 带 IO + 落盘副作用的函数（保留 `cleanTranscriptFromLines` 纯函数）
  - 说明：`readCleanTranscript` 在 Step 2 新增，这里 Step 1 只做删除
- [ ] `electron/main/agents/tools/digest-tools.ts`
  - `CleanTranscript` MCP 工具内部原本用 `cleanTranscript`（含落盘）→ 改为 `cleanTranscriptFromLines`（本 step 临时用纯函数，Step 2 会换成 readCleanTranscript）
- [ ] `electron/main/main.ts` 或 app 启动入口
  - `app.whenReady` 里 migration-p3 之后调 migration-p4
  - migration-p4 完成后调 markMigrationComplete()
- [ ] `electron/main/services/memory/group-digest-trigger.ts`
  - `digest-activity.json` 里 recent 存的 path 字段：加载时如果检测到旧路径（含 `/digests/` 段），直接清空 recent 数组

### 潜在需要一起改（如果 grep 到）

- 任何硬编码 `digests/` 路径的地方：`review-scanner.ts` / `category-trigger.ts` / `tipc/digest.ts` / `review-tools.ts` / `category-tools.ts`
  - 大部分应该通过 group-digest-store 的 helper 拿路径，如果是的话不用改
  - 有硬编码的直接跟着改

## 手测清单

- [ ] 造 2-3 个旧组卡（在 `digests/xxx.md` 手工放几个文件）
- [ ] 启动 app，观察日志：migration-p4 跑起来、每个组卡的迁移动作 log
- [ ] 迁移后 `groups/<groupId>/digest.md` 存在、旧 `digests/<groupId>.md` 消失
- [ ] `_cleaned/` 目录消失
- [ ] `_archive/` 目录保留
- [ ] 触发一次组提炼：观察 digest.md 落在新路径
- [ ] 打开设置 → 会话摘要 → DigestsPanel，列表能正常显示组卡
- [ ] 触发一次首页复盘：能读到迁移后的组卡（review-scanner 正确工作）
- [ ] 手工二次启动 app：migration-p4 跳过（幂等验证）

## 实施回填

### 实际改动

**新增文件**：
- `electron/main/services/memory/migration-gate.ts` — 导出 `whenMigrationReady()` Promise / `markMigrationComplete()` / `isMigrationComplete()`。模块加载即创建一个 pending Promise，`markMigrationComplete` 触发 resolve
- `electron/main/services/memory/migration-p4.ts` — `runMigrationP4(configDir)` 遍历工作区：① 扫 `<wsData>/digests/*.md`（跳过 `_` 开头），frontmatter 有 groupId 则 read+write+unlink 挪到 `<wsData>/groups/<groupId>/digest.md`；新路径已存在直接删旧（新是权威）；② `fs.rm(digests/_cleaned, { recursive: true })`。单个失败继续下一个

**核心 helper 换路径**：
- `group-digest-store.ts:68-80` 用 `getGroupsRootDir` / `getGroupDir` / `getGroupDigestPath` 替换旧 `getGroupDigestsDir`，新路径 `<wsData>/groups/<groupId>/digest.md`
- `saveGroupDigest` `:207` 改用 `getGroupDir` mkdir
- `listGroupDigests` `:222-249` 改扫 `groups/` 一级子目录 + 每个子目录下 `digest.md`（跳过下划线开头保留目录）

**agent-worker.ts full-rebuild 扫描同步**：
- `:866` import 从 `getGroupDigestsDir` 改为 `getGroupsRootDir, getGroupDigestPath`
- `:1079-1099` 扫描逻辑：`readdir(getGroupsRootDir, { withFileTypes: true })` → 过滤 `isDirectory && !name.startsWith('_')` → 拼 `getGroupDigestPath(wsId, name)` 读

**删 _cleaned/ 留盘副作用**：
- `digest-tools.ts` 删掉 `saveCleanedBackup` 函数、调用点、`fs/promises/path` import；tool description 去掉「同时落一份留底」
- `transcript-cleaner.ts` **未改动**（原描述有误：`cleanTranscript` 无落盘副作用，Step 2 再收敛为 `readCleanTranscript`）

**startup gate 挂载**：
- `group-digest-trigger.ts`：`triggerScanAll` / `triggerByConversation` / `triggerByGroup` 三个入口起手 `await whenMigrationReady()`
- `category-trigger.ts`：`triggerCategorize` / `triggerFullRebuild` 改为 async 并 `await whenMigrationReady()`
- `review-trigger.ts`：`triggerReviewScan` / `triggerReview` 同样加 gate（**新增于原 plan**——review-scanner 依赖 listGroupDigests，helper 换路径后同样需要 gate）
- 调用点跟着 async 化：`tipc/category.ts` 加 await；`tipc/review.ts` 加 await；`group-digest-trigger.ts` chainCategorize 里 `void triggerCategorize(...)` fire-and-forget

**index.ts 启动流程**：
- `:441-457` 在 migration-p3 之后加 migration-p4 块，finally 里 `markMigrationComplete()`（无论 migration-p4 成败都放开 gate，防永久堵塞）

**migration-p3.ts 适配**：
- 去掉对 `getGroupDigestsDir` 的 import（helper 已换语义），`readLegacyDigest` 里用本地 `getDigestsDir` 上移到函数定义前

**与原 plan 差异**：
- `transcript-cleaner.ts` 无需删函数——`cleanTranscript` 从来无 IO 副作用，落盘在 `digest-tools.ts` 的 `saveCleanedBackup` 里
- `digest-activity.json` 无需清空 recent——数据结构 `GroupDigestRecentEntry` 从来没有 path 字段
- 额外加了 review-trigger 的 gate 和 agent-worker.ts 的 full-rebuild 扫描重写（plan 未覆盖）
- category-trigger `triggerCategorize` 从 `void` 改成 `Promise<void>` 会影响调用点：tipc/category.ts 加 await；group-digest-trigger.ts 里 chainCategorize 加 void

### 手测清单执行情况

**未跑手测**——本次会话直接落代码：
- `bun run build:electron`：**通过**（无 TS 错误）
- `bun run lint`：**0 error**（83 个 preexisting warning，均在无关文件的 any 类型）
- 手测由用户或后续 step 端到端时一起验证（Step 5 会跑完整链路）

### 给下一步（Step 2）的接力棒

**关键状态**：
- `transcript-cleaner.ts` 当前导出：`cleanTranscriptFromLines`（纯函数）+ `cleanTranscript(workspacePath, sdkSessionId)`（读文件 + 调纯函数）
- Step 2 要做：新增 `readCleanTranscript(sessionId, options?)` — 但注意签名里 sessionId 不含 workspacePath，需要考虑怎么定位 JSONL
- `getSessionJsonlPath` 在 `session-paths.ts` 里已有，签名是 `(workspacePath, sessionId)`，Step 2 的 `readCleanTranscript(sessionId, options?)` 要么改签名带 workspacePath，要么内部反查工作区（复杂）
  - **建议**：Step 2 的签名调整为 `readCleanTranscript(workspacePath, sessionId, options?)`，跟 `getSessionJsonlPath` 对齐；子会话/Step 4 拿到 workspacePath 一路传下去
- 调用点收敛：
  - `digest-tools.ts:CleanTranscript` — 目前用 `cleanTranscript`，Step 2 换成 `readCleanTranscript`（全量，不加 options）
  - `review-tools.ts:TraceSource` — 目前独立实现按 uuid 回溯（可能在 memory/trace-source.ts），Step 2 用 `readCleanTranscript(ws, sid, { uuid, uuidContext: 5 })` 替换

**Step 1 遗留**：
- 没做手测，Step 5 一起验证
- migration-p4 幂等策略：新路径已存在直接删旧；如果新旧内容不一致（比如已在新路径运行过一次组提炼，旧路径又有残留），会以新为准，旧丢弃。用户几乎不会撞上这个场景（新路径必须通过组提炼产生）
