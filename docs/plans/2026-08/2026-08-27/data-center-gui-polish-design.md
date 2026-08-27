# 数据中心 GUI 验证反馈修正 设计

**背景**：数据中心 5 步重构完成后用户 GUI 验证提出 4 条反馈。

**目标**：
1. 去掉各面板与导航重复的 `<h2>` 标题
2. 内容容器水平居中（`mx-auto`），容器统一下沉到各面板自持，页面外壳只留整屏滚动层
3. 任务编辑页：提示词默认 MD 预览（紧凑 max-h-80），点「编辑」进 textarea（方案 A：显式按钮进入，「完成」/Esc 退出；新建或提示词为空直接编辑态）；右列参数卡片全部去边框去底色
4. 用量面板客户端分页（shadcn Pagination，每页 20，切筛选回第 1 页）

**架构**：
- 复用 `components/MarkdownRenderer.tsx` 渲染提示词预览（digests-panel 已有同款用法）
- 分页用 `bunx shadcn add pagination` 安装的 `components/ui/pagination.tsx`，客户端 slice
- 触发器行框从 `rounded-md border` 改 `rounded-md bg-muted/40`（去卡片后唯一保留的行级视觉层）

**模块边界**：
- `app/data-center/page.tsx`：digests / parse-history / memory 三个 TabsContent 的 max-w 容器下沉到面板，统一为滚动外壳
- `digests-panel.tsx` / `parse-history-panel.tsx` / `memory-section.tsx`：自持 `mx-auto max-w-* px-6 py-6`，删标题
- `usage-panel.tsx` / `history-panel.tsx` / `scheduler/SchedulerPanel.tsx`：容器加 `mx-auto`，删标题
- `scheduler/TaskEditorPage.tsx`：提示词预览/编辑切换 + 右列 section 去框、label 统一 `text-xs text-muted-foreground`、组距 `space-y-5`
- `scheduler/BuiltinTaskDetailSection.tsx`：BuiltinPromptSection 同款预览切换（保存/恢复按钮仅编辑态显示）；BuiltinParamsSection 去框
- `scheduler/TriggerRow.tsx`：行框改 muted 底色

**数据流**：零改动（纯展示层调整；分页为客户端 slice，不新增 IPC）。

**错误处理 / 边界**：
- 分页 page 越界（数据刷新后变少）clamp 到 totalPages
- 预览态提示词为空显示占位文案
- builtin 提示词预览反映未保存编辑（保存仍走显式「保存提示词」按钮，说明文字已有提示）

**未决问题**：无。
