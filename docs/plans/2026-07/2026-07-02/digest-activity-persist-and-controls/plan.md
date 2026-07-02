# 组提炼活动状态持久化 + 控制按钮重构

**目标**：解决用户「每次上来都在重新提炼」的错觉——根因是 `recent` / `lastScan` 是 in-memory，重启就丢，导致设置面板看不到历史；同时把无用的「刷新」按钮换成「停止 / 重新开始」。

**架构思路**：
- 持久化路径：`<configDir>/digest-activity.json`（全局单份，跨工作区）
- 字段：`{ version: 1, recent: GroupDigestRecentEntry[], lastScan: { at, dirtyCount } | null, updatedAt: number }`
- 写盘策略：debounce 500ms（短时间内多次完成只写一次）
- 启动时 load → 灌入 in-memory；写盘失败只打 log 不阻塞业务
- `cancelAllGroupDigest()`：清 queue + 如果有 current，cancelTask(current.taskId)
- 前端轮询同时拉 activity + list（2 秒），事件驱动不需要

**排除选项**：
- 不持久化 `current`（重启时 in-flight task 已丢，没法恢复）
- 不做事件推送（轮询 2 秒已经够用，事件增加复杂度）
- 不持久化 queue（已完成的不会重扫，未完成的从头跑代价不大）

**涉及模块**：
- `electron/main/services/memory/group-digest-trigger.ts`（核心改动）
- `electron/main/tipc/digest.ts`（新增 RPC）
- `app/settings/memory/DigestsPanel.tsx`（UI 重构）

## 步骤索引

- [x] [Step 1: 服务层持久化 + cancelAll](./step1-persist-and-cancel-all.md) — trigger.ts 加 load/save 持久化 + 新增 cancelAllGroupDigest
- [x] [Step 2: tipc 路由](./step2-tipc-rpc.md) — digest.ts 新增 cancelAllGroupDigest RPC
- [x] [Step 3: DigestsPanel UI 重构](./step3-panel-buttons.md) — 移除刷新按钮 / 标题区放停止+重新开始 / 移除 inline 停止 / list 自动刷新

## 全局决策

- **配置目录**：所有持久化文件落 `<configDir>/`（即 `getConfigDir()` 返回值），与现有 `digest-prompt.md` / `review-prompt.md` 同级
- **文件命名**：`digest-activity.json`（不加 workspace 前缀，因为 recent 跨工作区聚合）
- **RECENT_MAX 上限**：维持 15 条
- **debounce 写盘**：用模块级 `writeTimer: NodeJS.Timeout | null`，500ms 后写
- **错误处理**：load 失败 → 用空状态启动；save 失败 → mainLogger.warn，不抛
- **类型不漂移**：persisted schema 加 `version: 1`，未来变更时按版本号迁移
- **cancelAllGroupDigest 返回值**：`{ cancelledQueued: number, cancelledCurrent: boolean }`，让前端能给用户准确反馈

## 完成总结

### 实际改动
- `electron/main/services/memory/group-digest-trigger.ts`：加 `DigestActivityDoc` 持久化（`<configDir>/digest-activity.json`，sync load + debounce 500ms save）；新增 `cancelAllGroupDigest()` 清队列 + 取消当前任务
- `electron/main/tipc/digest.ts`：新增 `cancelAllGroupDigest` RPC 转发到服务层
- `app/settings/memory/DigestsPanel.tsx`：移除「刷新」按钮 + inline「停止」；标题区加「停止」「重新开始」两按钮；轮询同时拉 activity + list；清理 dead code（`handleCancelDigest` / `loading` state）

### 与原计划的偏差
- Step 1：用 `readFileSync` 同步加载（不是 lazy load）——简化代码，首次拉 activity 即拿到历史
- Step 1：`cancelAllGroupDigest` 额外手动 notify idleWaiters——pump 不在跑时 waiters 不会自动触发
- Step 3：清理 dead code（`handleCancelDigest` / `loading`）——「不留半成品」原则

### 验证状态
- ✅ `bun run build:electron`：通过
- ✅ `bun run lint`：0 errors，我改的三个文件无任何 warning
- ⏸ 手测：用户需重启 dogear 应用，进入「设置 → 会话摘要」面板验证：
  1. 启动后立即看到上次的「上次扫描」+「最近完成」（持久化生效）
  2. 「停止」按钮可点击（current 任务或 queue 非空时）
  3. 点「停止」→ confirm 提示取消了多少
  4. 点「重新开始」→ 立即触发扫描，几秒后看到「上次扫描」时间刷新
