# 手动触发反馈与术语修正（manual-run-feedback）设计

**背景**：categorize-sweep 实施后试用发现三个问题：①「补挂」是内部黑话，用户看不懂；②面板补分类按钮与定时任务「智能分类（补挂）」入口重合（同一引擎，范围/完成语义还更弱）；③手动触发的长任务（全量重置分类、单组重新提炼）不进运行历史、无完成通知，且模型配置入口（定时任务详情 → 模型，写全局 `categorizeModelSelection` / `digestModelSelection`）无任何提示，等于功能存在但不可发现。

**目标**：
1. 术语统一「补分类」，删除面板补分类按钮（全量重置按钮保留，它是 full-rebuild 唯一入口）
2. 手动触发的全量重置 / 重新提炼跑完时写入运行历史（`triggerReason: 'manual'`）+ 全局 toast 完成/失败通知
3. 全量重置确认弹窗与重新提炼提示文案注明所用模型与修改入口，不新增模型选择 UI

**架构**：
- **改名**：`BUILTIN_LABELS.categorize` → `'补分类'`（定时任务列表与「组卡提炼 / 复盘报告 / 分类整理」对仗；避免「智能分类（补分类）」重复）。summary 改人话：`已为 X 个话题补分类，Y 个话题缺标签需重新提炼` / `没有未分类的话题` / `智能分类已禁用，跳过`（不变）。plan-store 的 builtin name 同步迁移（step2 已有）自动处理旧任务名
- **删按钮**：SmartCategoryPanel 删 handleSweep/按钮/sweeping；`tipc/category.ts` 的 `triggerCategorizeSweep` RPC、store 的 `sweep` action 与 `CategorizeSweepResult` 类型一并删除（无消费者即删，不留死代码）。主进程 `triggerCategorizeSweep` 函数保留（task-executor 消费）
- **run-history manual 记录**：在 trigger 层任务完成点写 `appendHistoryEntry`——full-rebuild job 跑完写 `planName: '全量重置分类'`，单组重新提炼跑完写 `planName: '重新提炼：<组名>'`；`triggerReason: 'manual'`，planId 用伪 id（如 `manual-full-rebuild` / `manual-redigest`）。这两个入口均只被手动按钮调用（定时任务走 sweep/scanAll 别的路径），写入点无重复记录风险
- **完成 toast**：主进程在上述完成点向所有窗口广播新事件（照抄 `categoriesUpdated` 的 `BrowserWindow.getAllWindows().webContents.send` 惯例）；渲染层挂全局监听（lib/events 模式）→ sonner toast：成功「全量重置分类完成，耗时 X 分钟」/「<组名> 重新提炼完成」，失败 toast.error
- **模型提示**：确认弹窗 description 追加「将使用模型 X（可在 定时计划 → 智能分类 → 详情 中修改）」；DigestsPanel 重新提炼提示追加「使用模型 X」。模型名经现有 get RPC 读取（不指定时回退显示默认模型），展示格式对照 BuiltinTaskDetailSection 现有逻辑

**模块边界**：
- `electron/main/services/scheduler/builtin-task-meta.ts`（label）
- `electron/main/services/scheduler/runtime/task-executor.ts`（summary 文案）
- `electron/main/tipc/category.ts`（删 sweep RPC）
- `stores/smart-category-store.ts`（删 sweep action / 类型）
- `app/settings/memory/SmartCategoryPanel.tsx`（删按钮 + 确认弹窗模型提示 + 介绍文案改）
- `app/settings/page.tsx`（Tab 介绍文案）
- `app/settings/memory/DigestsPanel.tsx`（提示 + 模型名）
- `electron/main/services/memory/category-trigger.ts` / `group-digest-trigger.ts`（完成点：写 run-history + 广播）
- 渲染层全局事件监听 → toast（挂载位置实施时定，App 根级）

**数据流**：手动点击 → RPC → trigger 层入队跑完 → ①appendHistoryEntry（run-history 页可回查）②webContents.send 完成事件 → 全局监听 toast。模型读取：面板组件挂载/弹窗打开时 get RPC → 文案拼接。

**错误处理 / 边界情况**：
- run-history 写失败只 mainLogger.warn，不影响任务本身
- 完成事件在无窗口时（全关闭）自然丢弃；重启后靠 run-history 回查
- toast 与 run-history 双通道独立失败（一个挂不影响另一个）
- 全量重置取消（cancelCurrent）时写 `status: 'cancelled'` 历史，不 toast 成功

**未决问题**（实施时确认）：
- `RunHistoryEntry` 必填字段全集与伪 planId 在 run-history 页的展示效果（是否按 plan 分组）
- 模型「友好名」的拼装格式（provider/model/profile 展示哪几段）
- 重新提炼完成点在 group-digest-trigger 的具体钩子位置（单组 job 的成功回调）
