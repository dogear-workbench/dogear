# Step 2: 记录型文件条目级合并

> **状态：已完成（2026-09-27）**。实施中核对确认：conversations.json 为 Record 型（设计表未写明）；notifications.json 条目无 updatedAt 仅 createdAt（fallback 链取新者）。主会话验收时修复一处子会话引入的 bug：本端文件缺失分支把已被 readGzipText 消费的流二次传给 writeIncomingFile（Node 实测 Z_BUF_ERROR，单侧新增记录文件主路径拉取必败），改为直接用已解压的 remoteParsed 原子落盘。遗留：真机双端端到端未验；apply 层无测试基建（merge 原语有 9 单测）；settings.json 合并未做 mtime max（走 saveSettings 保原行为，hash 语义无影响）。

对应设计决策 D4。目标：`workspaces.json`、`conversations.json`、`groups.json`、`plans.json`、`notifications.json` 等「两端各自追加条目」的记录文件不再整文件覆盖，改为条目级合并；合并幂等，两端各同步一次即收敛。

## 2A merge registry（apply.ts）

- `apply.ts` 新增模式表与合并函数：

```ts
type MergeHandler = (localRaw: string, remoteRaw: string) => string; // 返回合并后 JSON 文本
const MERGE_PATTERNS: Array<{ test: (relPath: string) => boolean; merge: MergeHandler }>
```

- 各文件规则（详见 design.md D4 表）：
  - `workspaces/workspaces.json`：按 workspace id 并集；同 id：`path`/`additionalPaths`/`isDefault` 取本端（机器亲和），`name`/`createdAt` 取更早（稳定字段）。
  - `workspaces/*/conversations.json`：按 sessionId 并集；同 id 取 `updatedAt` 新者。
  - `workspaces/*/groups.json`：按 group id 并集；同 id 取 `updatedAt` 新者。
  - `plans.json`：按 task id 并集；同 id 取 `updatedAt` 新者（实施时核对任务条目实际字段名，plans.json 现为 `{version:2,tasks:[]}`）。
  - `notifications.json`：按通知 id 并集；同 id 取新者。
  - `settings.json`：现 `mergeIncomingSettings` 迁入 registry（对外行为不变，pairedDevices 并集、deviceName 保本端、其余取对端）。
- 合并实现统一小工具：`mergeRecordById(localObj, remoteObj, keyPath, pick)`（Record 型）与数组版，容错：任一侧 JSON 解析失败 → **放弃合并、返回 null → 该文件降级走整文件覆盖 + 本端副本**（解析失败说明数据异常，保底不静默丢）。数组型文件同理。
- `applyIncoming` 路由：item 命中 MERGE_PATTERNS → 拉流落临时文本 → merge → 安全写回（safeJsonWrite 或等价原子写）；报告字段 `settingsMerged: boolean` 推广为 `mergedFiles: string[]`（orchestrator 同步改 baseline 逻辑：merged 文件一律重算 hash）。
- **mtime 处理**：合并落盘文件 mtime 取 max(本端, 对端 entry.mtimeMs)，避免下轮 diff 因 mtime 回退误判。

## 2B orchestrator 后处理（conflict → merge 路由）

- `runSyncInternal` 在 conflict 循环**之前**：`diff.conflict` 中 relPath 命中 MERGE_PATTERNS 的条目移入 `pullItems`（不带 saveConflictCopyBeforeOverwrite，apply 层合并），不进 conflicts。
- 同样地，`diff.pull` 中命中模式者天然走合并（单侧新增条目并入，无副作用）。
- 合并失败（merge 返回 null，解析异常）的文件从 applied 剔除，降级：走现有 conflict 挂起路径，进 conflicts 待用户处理。
- `buildNextBaseline`：mergedFiles 中的条目用落盘重算 hash（现 settingsMerged 特判推广）。

## 2C 结果面板

- SyncReport 无需新字段；可在 warnings 提示「N 个记录文件已条目级合并」。
- 结果面板统计里「拉取」计数含合并文件（沿用 applied 计数）。

## 验收

1. 双端各自往 `conversations.json` 加不同会话 → 同步 → 两端条目并集、无 conflict 副本、无待处理冲突。
2. 双端改同一条目（同 id 不同内容）→ 同步 → 取 updatedAt 新者。
3. `workspaces.json`：本端注册新工作区、对端注册另一工作区 → 同步 → 两端注册表都含两个条目；各自 `isDefault` 与 `path` 不被对端覆盖。
4. 连续两次同步（不改动）→ 第二次 same，无重复动作（合并幂等 + baseline hash 正确）。
5. 人为把某 conversations.json 写坏（非法 JSON）→ 同步不崩，该文件进待处理冲突。

## 实施确认项

- `plans.json` 任务条目字段名（id/updatedAt）核对真实文件（当前本机 tasks 为空，可看类型定义 `electron/main/services/` 下 plans/tasks service）。
- `groups.json` 条目 updatedAt 存在性核对（记忆确认过 schema 有 updatedAt，复核代码）。
- conversations.json 条目 updatedAt 单调性抽查。
