# 智能分类补漏（categorize-sweep）实施计划

**目标**：categorize builtin 从全量重建重定义为幂等补漏（差集补挂），使「提炼→分组→复盘」三段可控 + 断点续跑。

**架构思路**：trigger 层新增 `triggerCategorizeSweep`——算差集（有 tags 活跃组卡 − 分类挂载并集），对差集逐组入队**现有 incremental job**（复用 Step A → LLM 全部决策逻辑，activity 天然逐组可见）。scheduler 的 categorize builtin 改调它；full-rebuild 退回设置页手动按钮（改名「全量重置分类」）。排除了「sweep 作为单一大 job」方案——逐组入队让每组建一条决策记录、单组失败不拖累其他组、queueDepth 即差集进度。

**涉及模块**：
- `electron/main/services/memory/category-trigger.ts`（+sweep 编排）
- `electron/main/services/memory/smart-category-engine.ts`（+差集纯函数）
- `electron/main/services/scheduler/runtime/task-executor.ts`（builtin 映射切换）
- `electron/main/services/scheduler/builtin-task-meta.ts`（label/描述）
- `electron/main/tipc/category.ts`（+sweep RPC）
- `stores/smart-category-store.ts` + `app/settings/memory/SmartCategoryPanel.tsx`（手动入口 + 改名）

**设计文档**：[../categorize-sweep-design.md](../categorize-sweep-design.md)

## 步骤索引

- [x] [Step 1: trigger 层补漏编排](./step1-sweep-trigger.md) — `triggerCategorizeSweep` 差集扫描 + 逐组入队 + engine 纯函数
- [x] [Step 2: scheduler 接线](./step2-scheduler-remap.md) — categorize builtin 改调 sweep，meta/描述更新
- [ ] [Step 3: 手动入口与 UI](./step3-tipc-ui.md) — sweep RPC + 设置页「补挂漏网组」按钮 + full-rebuild 改名

## 全局决策

- **builtinId `'categorize'` 不变**：用户 plans.json 已有同 id 任务，改 id 会破坏现有数据；仅重定义其行为与文案
- **不新建 job kind**：sweep 只编排入队，每个漏网组走现有 incremental job（key `c:${ws}:${groupId}`），去重/串行/取消全部复用现有机制
- **enabled 检查**：`settings.smartCategory?.enabled === false` 时 sweep 空转，返回结构需能表达 disabled（RPC/summary 据此提示）
- **无 tags 组卡不入队、不产生决策记录**：只计数（noTags），引导用户重提炼，不在分类活动里制造 skip 噪音
- **full-rebuild 代码不动**（staging 原子性保留），只改设置页按钮文案；tipc `triggerFullRebuild` RPC 保留
- 命名约定：主进程 `triggerCategorizeSweep`，UI 文案「补挂漏网组」「全量重置分类」
