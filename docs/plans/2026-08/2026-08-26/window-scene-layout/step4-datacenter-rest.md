---
step: 4
title: 数据中心其余面板与设置瘦身收尾
status: pending
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
- [ ] `app/data-center/scheduler-panel.tsx` — 平移 SchedulerPanel + HistorySheet + TaskEditor 等子组件（整个 `app/settings/scheduler/` 目录迁到 `app/data-center/scheduler/`，import 路径改）；activity 轮询换 useVisiblePolling；workspaceId 相关交互按筛选值（任务本身是全局 `.dogear/plans.json`，builtin 任务带 workspaceId 字段，列表展示「全部」时自然全量，无需后端改动——实施时核实 listTasks 是否本就跨工作区）
- [ ] `app/data-center/parse-history-panel.tsx` — 平移 ArticleParseHistoryPanel（article.ts RPC 按实施时签名核对是否 workspaceId 必填，缺则随聚合约定扩展）
- [ ] `app/data-center/topics-panel.tsx` / `core-profile-panel.tsx` / `smart-category-panel.tsx` — 平移记忆三面板（MemoryTab 拆开直接挂 tab，不再保留组合容器）；workspaceId 改 props；SmartCategoryPanel 的全量重置 confirm 行为不变
- [ ] `app/data-center/page.tsx` — 左侧 tab 补齐：组卡 / 用量 / 定时计划 / 解析历史 / 记忆（记忆下再分主题·画像·分类配置二级或并列，以实际面板体量定，倾向并列三 tab 粒度太细则收成「记忆」一个 tab 内部分节）
- [ ] `app/settings/page.tsx` — 瘦身：删 digests / scheduler / memory / usage / parse-history 五个 TabsTrigger + TabsContent + 顶部返回按钮改「关闭窗口」语义已在 step2 完成（此处只做 tab 删除与 import 清理）；剩余 tab：behavior / abilities / profiles / workspace-management / sub-agent / 系统提示词预览 / about
- [ ] 删除已无引用的设置页子文件：`app/settings/MemoryTab.tsx`、`app/settings/memory/**`、`app/settings/scheduler/**`、`app/settings/UsageTab.tsx`、`components/ArticleParseHistoryPanel.tsx`（迁移后原位置）；全局搜残留引用清零
- [ ] `docs/codebase-map.md` — doc-sync：数据中心窗口、设置窗口、新 hook、windows.ts 路由、删除的 agent-monitor

## 验收
- 数据中心六个分区全部可用；定时任务编辑/运行/停止/历史查看与原设置页行为一致
- 智能分类「全量重置」走 confirm；categoriesUpdated 事件下列表自动刷新
- 设置窗口只剩纯设置 tab；无死链 import；`bun run lint` + `bun run build` 通过
- 全窗口冒烟：主窗口（会话+话题面板重新提炼）+ 数据中心（全库）+ 设置（改模型保存并重启）三窗口并行无互相干扰、无重复 toast
- 完成后回 `plan.md` 补「完成总结」

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
