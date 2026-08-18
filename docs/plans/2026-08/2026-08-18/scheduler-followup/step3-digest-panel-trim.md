---
step: 3
title: 会话摘要 Tab 删减 + 文档同步
status: done
---

## 目标

会话摘要 Tab 收敛为「结果查看 + 行为配置」：DigestsPanel/SmartCategoryPanel 删全部 agent 运行入口，ReviewPanel 整体删除；codebase-map 同步。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2-scheduler-ui.md] 内置任务编辑器已有模型选择（本步删面板模型入口不丢配置能力）；调度器已有停止/立即运行（DigestsPanel 停止/重新开始入口的替代）
- 当前关键文件状态（已核实）：
  - `DigestsPanel.tsx`：模型行（get/setDigestModelSelection）、停止（cancelAllGroupDigest）、重新开始（triggerGroupDigestScan）、活动状态轮询（getGroupDigestActivity + 2s list 刷新）、提示词折叠编辑器（get/setGroupDigestPrompt）、组卡列表+详情、单组「重新提炼」（triggerGroupDigest，**保留**）
  - `ReviewPanel.tsx`：整个面板删（模型/立即复盘/活动/停止/提示词全被定时计划覆盖；复盘卡查看在首页仪表盘）
  - `SmartCategoryPanel.tsx`：删模型行（getCategorizeModelSelection）、立即重跑（triggerFullRebuild）、一键整理（triggerOrganize）、活动轮询（refreshActivity）、提示词编辑器；**保留** 总开关/阈值/上限（get/setSmartCategorySettings）+ 分类列表（load/刷新）
  - `page.tsx:643` 会话摘要 tab：三段结构（会话摘要/跨会话复盘/智能分类）+ 描述文案
- 关键决策回顾：单组「重新提炼」保留（调度器替代不了）；列表 2s 轮询保留但只拉列表；ReviewPanel 是删除不是删减

## 计划改动

- [x] `DigestsPanel.tsx`：
  - 删：提炼模型整行（含 selection/settings state + handleSelectionChange）、停止+重新开始按钮（handleStopAll/handleRestart + activity 相关 state）、活动状态展示区、提示词折叠编辑器（prompt 相关 state + handleSavePrompt/handleResetPrompt）
  - 改：2s 轮询只调 `client.listGroupDigests`（去 getGroupDigestActivity），保留列表自动刷新；删 GroupDigestActivity 接口定义与相关 import（RefreshCw/Square/RotateCcw/ChevronDown/ModelSelector/confirm 等按实际残留清理）
  - 留：组卡列表 + 详情（概述/想法/决策/关键产出/回溯链接）+ 单组「重新提炼」按钮（handleReDigest 保留，其 confirm 提示不变）
- [x] `app/settings/memory/ReviewPanel.tsx`：删除文件
- [x] `page.tsx`：删「跨会话复盘」分节（标题+描述+`<ReviewPanel />`）及 ReviewPanel import；三段描述文案更新——会话摘要段去「重新提炼、配置提炼方案与提示词」（改为查看与单组补跑）、智能分类段去「模型/提示词/立即重跑全量」（改为调节阈值、查看分类；运行入口在定时计划）
- [x] `SmartCategoryPanel.tsx`：
  - 删：分类模型行（selection/settings + handleSelectionChange）、立即重跑/一键整理按钮（handleRebuild/handleOrganize + triggerFullRebuild/triggerOrganize）、活动状态区（activity 轮询 useEffect + 展示块 + cancel/cancelOrganize/refreshActivity 引用）、提示词编辑器（prompt 相关 state + handlers）
  - 留：总开关/阈值/上限行（enabled/threshold + handleToggleEnabled/handleThresholdBlur）、分类列表折叠区（categories + load + 刷新按钮）；`useSmartCategoryStore` 里仅保留消费 load/categories，其余 selector 解绑
- [x] 残留清理：grep `triggerGroupDigestScan|cancelAllGroupDigest|getGroupDigestActivity|getDigestModelSelection|setDigestModelSelection|getReviewModelSelection|triggerReview|cancelReview|triggerFullRebuild|triggerOrganize|getCategorizeModelSelection|setCategorizeModelSelection|refreshActivity|ReviewPanel` 在 `app/` 下零命中（tipc 主进程侧路由保留不动——调度器与其他入口仍用；仅渲染层消费点移除）
- [x] `docs/codebase-map.md` 同步：DigestsPanel/SmartCategoryPanel 条目改为删减后语义、ReviewPanel 条目删除、会话摘要 Tab 描述、scheduler 条目补 stopTask 路由与 on_task_done 触发器（Step 1/2 的映射若前两步未同步也在此一并补）
- [x] 验证：`bunx tsc --noEmit -p tsconfig.json`（零新增）+ `bun run build:renderer` + `bun run lint`（基线不变）+ 上述 grep 清零
- [x] 提交前确认：dogear__ 前缀与 sidebar 两批改动是否已单独提交（plan.md 全局决策），避免 codebase-map.md 混批

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - tsc 基线 15 → 12：删除 ReviewPanel 消除其自带错误，12 条全在既有未触碰文件（零新增）
  - 残留 grep 两处合法保留：BuiltinTaskDetailSection 的 MODEL_IO 模型 IPC（调度器编辑器本身要用）、HistorySheet 的 scheduler refreshActivity（调度器活动轮询，非 memory 面板）
  - smart-category-store 的运行类 action（triggerFullRebuild/triggerOrganize 等的 store 方法）已无 UI 消费，但 store 不在 5 文件范围未动——潜在死代码，待后续批次清理
- 改动文件清单：`DigestsPanel.tsx`（删减）、`ReviewPanel.tsx`（删除）、`app/settings/page.tsx`、`SmartCategoryPanel.tsx`（删减）、`docs/codebase-map.md`（12 处同步，含 Step 1/2 的 scheduler 条目补充）
- 验证：tsc 12 errors 全在既有文件零新增；lint 0 errors / 74 warnings = 基线；build:renderer ✓；残留 grep 清零

### 给下一步的接力棒
- 关键签名 / 数据结构：DigestsPanel 只剩列表+详情+单组重新提炼+2s 列表轮询；SmartCategoryPanel 只剩开关/阈值/分类列表；会话摘要 Tab 两段文案指向定时计划
- 下个 step 该从哪里继续：本计划三步全部完成；后续可选清理 smart-category-store 运行类死代码
- 待办或已知限制：codebase-map.md 的 dogear__ 前缀批改动由主会话 stash 隔离，commit 后恢复
