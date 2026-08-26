---
step: 4
title: 数据中心其余面板与设置瘦身收尾
status: done
---

## 目标
平移定时计划（含执行历史）、解析历史、记忆（主题/画像/智能分类配置）到数据中心；设置页删除全部已迁出 tab 完成瘦身；doc-sync 与整体验收。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step3] 数据中心骨架已就位：`app/data-center/page.tsx`（筛选器 + 左侧 tab 挂载点）、`hooks/use-visible-polling.ts`、聚合 RPC 的「workspaceId 可选 = 全部」约定、`windows.ts` 的 openDataCenterWindow
- 当前关键文件状态：
  - `app/settings/scheduler/SchedulerPanel.tsx` — 任务列表 + activity 10s 轮询（scheduler-store）+ HistorySheet 右滑面板；TaskEditor 为 Dialog（modal 在独立窗口内独立渲染，无跨窗口问题）
  - `app/settings/scheduler/HistorySheet.tsx` — 执行历史 Sheet + 筛选 + 分页
  - `components/ArticleParseHistoryPanel.tsx` — 文章解析历史
  - `app/settings/memory/TopicsPanel.tsx` / `CoreProfilePanel.tsx` / `SmartCategoryPanel.tsx` — 主题记忆 / 核心画像 / 智能分类配置（SmartCategoryPanel 有分类列表折叠 + 全量重置 confirm + categoriesUpdated 订阅自动 reload）
  - `app/settings/MemoryTab.tsx` — 设置页 memory tab 容器（组合上述面板）
  - `stores/scheduler-store.ts` / `smart-category-store.ts` — 各自轮询与事件订阅，均在窗口本地（数据中心窗口独立实例，天然不与主窗口冲突；categoriesUpdated 广播两边都收，无写冲突——全是「拉取型」动作）
- 关键决策回顾：
  - 智能分类配置进数据中心（与补分类任务同处）；SystemPromptPreviewTab **留设置**
  - 话题面板（右侧工作台）的单组「重新提炼」保留，与数据中心全库双入口
  - 定时计划的 store 挂到数据中心窗口后，轮询统一换 useVisiblePolling

## 计划改动
- [x] `app/data-center/scheduler/` — 整目录 git mv 自 `app/settings/scheduler/`（文件名不变）；SchedulerPanel 改收 workspaceId/workspaces props（删自取 client.getAll）+ activity 10s 轮询换 useVisiblePolling；选具体工作区时列表前端过滤（`!task.workspaceId || === 筛选值`），新建任务 defaultWorkspaceId 预填筛选工作区；TaskEditor 删 useWorkspaceStore 改 defaultWorkspaceId props。已核实 listTasks 无入参读全局 plans.json，无需后端改动
- [x] `app/data-center/parse-history-panel.tsx` — 平移 ArticleParseHistoryPanel 并改名 ParseHistoryPanel；已核实 getParseHistory 为全局 history.jsonl 无 workspaceId 概念，无需扩展 RPC；保持手动刷新无轮询（原行为）
- [x] `app/data-center/topics-panel.tsx` / `core-profile-panel.tsx` / `smart-category-panel.tsx`（含 topics-list / topic-editor / memory-types 随迁改 kebab-case）— 平移记忆三面板；SmartCategoryPanel 删 workspace-store 改 workspaceId props（含删「请先选择工作区」空态，由容器拦截）；全量重置 confirm 行为不变
- [x] `app/data-center/page.tsx` — 左侧 tab 补齐：组卡 / 用量 / 定时计划 / 解析历史 / 记忆（记忆收成一个 tab，新建 memory-section.tsx 容器内部分节：核心档案/主题记忆/智能分类 + 重建索引按钮 + 'all' 空态）
- [x] `app/settings/page.tsx` — 删 digests / scheduler / memory / usage / parse-history 五个 TabsTrigger + TabsContent 及对应 import；剩余 tab：behavior / abilities / profiles / workspace-management / sub-agent / about
- [x] 删除：`app/settings/MemoryTab.tsx`、`app/settings/memory/DigestsPanel.tsx`、`app/settings/UsageTab.tsx`、`components/ArticleParseHistoryPanel.tsx`（scheduler/ 与 memory/ 其余文件整体迁走）；全局搜残留引用清零
- [x] `docs/codebase-map.md` — doc-sync 一次补齐 step1–4：删 agent-monitor/SystemPromptPreviewTab 失效条目、删设置页已迁面板条目、新增 app/data-center 目录块 + hooks/use-visible-polling + lib/setup-settings-sync + windows.ts 路由 + digest/usage 聚合语义 + stores 描述同步
- [x] `stores/scheduler-store.ts` — 删 startActivityPolling/stopActivityPolling/activityTimer/ACTIVITY_POLL_MS 死代码（轮询改由面板 useVisiblePolling 驱动；reset 保留但去 stop 调用）

## 验收
- 数据中心六个分区全部可用；定时任务编辑/运行/停止/历史查看与原设置页行为一致
- 智能分类「全量重置」走 confirm；categoriesUpdated 事件下列表自动刷新
- 设置窗口只剩纯设置 tab；无死链 import；`bun run lint` + `bun run build` 通过
- 全窗口冒烟：主窗口（会话+话题面板重新提炼）+ 数据中心（全库）+ 设置（改模型保存并重启）三窗口并行无互相干扰、无重复 toast
- 完成后回 `plan.md` 补「完成总结」

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. 新建 `app/data-center/memory-section.tsx`：计划说「不再保留组合容器」，但「记忆」收成一个 tab 后仍需内部分节（'all' 空态 + 重建索引按钮 + 内层三节 Tabs），独立成文件避免 page.tsx 膨胀；MemoryTab.tsx 本体（读 workspace-store）未平移，直接删除
  2. 记忆子文件随迁改 kebab-case（topics-list / topic-editor / memory-types），对齐 step3 已建立的 data-center 命名惯例；scheduler/ 目录按「整目录迁移」保留 PascalCase 文件名
  3. 定时计划列表选具体工作区时前端过滤（builtin 无工作区=全局任务始终可见），新建任务预填筛选工作区（'all' 时空待选）——计划未明说，按「筛选器影响交互」原则实施
  4. scheduler-store 删轮询死代码（startActivityPolling/stopActivityPolling/activityTimer/ACTIVITY_POLL_MS）——计划未列，属「不留半成品」延伸
  5. SystemPromptPreviewTab 实际已不存在（其功能已内嵌在 AbilityTab，map 旧条目失效）；设置页剩余 tab 为 behavior/abilities/profiles/workspace-management/sub-agent/about，拍板「留设置」经由 AbilityTab 自然满足
  6. parse-history-panel 保持手动刷新无轮询（原行为，非漏改）
- 改动文件清单：
  - 迁移（git mv）：`app/settings/scheduler/`（9 文件）→ `app/data-center/scheduler/`（其中 SchedulerPanel.tsx / TaskEditor.tsx 改造）；`app/settings/memory/TopicsPanel.tsx`→`app/data-center/topics-panel.tsx`、`CoreProfilePanel.tsx`→`core-profile-panel.tsx`、`SmartCategoryPanel.tsx`→`smart-category-panel.tsx`、`TopicsList.tsx`→`topics-list.tsx`、`TopicEditor.tsx`→`topic-editor.tsx`、`types.ts`→`memory-types.ts`
  - 新建：`app/data-center/parse-history-panel.tsx`、`app/data-center/memory-section.tsx`
  - 删除：`app/settings/MemoryTab.tsx`、`app/settings/memory/DigestsPanel.tsx`、`app/settings/UsageTab.tsx`、`components/ArticleParseHistoryPanel.tsx`
  - 修改：`app/data-center/page.tsx`（补三个 tab）、`app/settings/page.tsx`（删五个 tab）、`stores/scheduler-store.ts`（删轮询死代码）、`docs/codebase-map.md`（step1–4 doc-sync 一次补齐）

### 验证结果
- `bun run lint`：0 errors，72 warnings 全为既有 any 警告（与 step1/2/3 基线一致）
- `bunx tsc --noEmit -p tsconfig.json`：20 errors 与 step2/step3 记录基线完全一致（含 tool-registry-store.ts 1 条既有），新改动零错误
- `bun run build:electron`：通过
- `bun run build`（完整）：通过（chunk 体积警告为既有）
- 全局搜 MemoryTab/UsageTab/ArticleParseHistoryPanel/startActivityPolling 残留：清零
- GUI 手动验收（三窗口并行冒烟、智能分类全量重置 confirm、categoriesUpdated 自动刷新）子会话环境无法执行，需人工跑 `bun run dev` 确认

### 给下一步的接力棒
- 关键签名 / 数据结构：数据中心面板统一 `workspaceId: string | 'all'` + `workspaces: Workspace[]` props；SchedulerPanel 新增列表前端过滤与 defaultWorkspaceId 预填；smart-category-store / scheduler-store 均为窗口本地实例，主窗口与数据中心同时消费无冲突
- 下个 step 该从哪里继续：本 step 是 plan 收尾步，无后续 step；plan.md 已补完成总结
- 待办或已知限制：
  - GUI 三窗口冒烟需人工验证
  - step1 遗留 getDetailedStatus procedure 无调用方仍未清理（跨 plan 可顺手）
  - 数据中心「记忆」tab 在 'all' 筛选下为空态提示（记忆按工作区组织，无跨工作区聚合视图）
