---
step: 2
title: 前端 Tab + 挂载 + 文档
status: pending
---

## 目标
新建 `SystemPromptPreviewTab` 组件，拉后端 `getSystemPromptSegments()` 展示 6 段模板 + 触发说明；挂到设置页导航；更新 codebase-map。

## 依赖上下文（接力棒输入）

- Step 1 已产出：`client.getSystemPromptSegments(): Promise<SystemPromptSegment[]>`，返回结构见 plan.md「数据结构」
- Step 1 的 6 个 segment key：`tool-pack-guide` / `group-context` / `reference-append` / `group-append` / `notes-guidance` / `sub-agent-contract`（如果 Step 1 回填有调整，以那里为准）
- 前端类型来源：`types/system-prompt.ts`（Step 1 新建）

- **设置页现状**：
  - `app/settings/page.tsx` 是纵向 Tab + dirty 检测的表单页
  - Tab 列表位置：page.tsx 内部（Read 后确认具体结构）
  - 参考同级 Tab：`SubAgentTab.tsx` / `PersonaTab.tsx` / `WorkspaceManagementTab.tsx`

- **UI 组件**：项目用 shadcn/ui + Tailwind CSS 4；卡片用 shadcn `Card`；徽章用 `Badge`

## 计划改动

### 2a. 新建 SystemPromptPreviewTab 组件

- [ ] 新建 `app/settings/SystemPromptPreviewTab.tsx`：
  - 用 `useEffect` 首次挂载时调 `client.getSystemPromptSegments()`，loading / error / empty 三态处理
  - 顶部一句总说明："以下是 dogear 会自动附加到系统提示词的段落。这些内容根据会话上下文自动注入，不可编辑；如需修改用户段（默认提示词/人设等）请前往对应 Tab。"
  - 按 category 分组展示（tool-guide / reference / group / notes / sub-agent）；组标题用 h3
  - 每段渲染一个 `<Card>`：
    - `CardHeader`：`label`（h4） + `category` 徽章 + `isDynamic ? "动态" 徽章 : null`
    - `CardContent`：
      - `triggerDescription` 用 `<p className="text-muted-foreground">` 展示
      - `template` 用 `<pre className="text-xs bg-muted p-3 rounded overflow-x-auto whitespace-pre-wrap font-mono">` 展示
  - 全组件纯展示，无 dirty / 保存逻辑（跟其他 Tab 不同，本 Tab 是只读）
  - 单文件预计 <150 行；如超 200 行考虑抽 `SystemPromptSegmentCard.tsx` 子组件

### 2b. 挂载到设置页

- [ ] `app/settings/page.tsx` 加 Tab：
  - Tab 列表新增一项，label "系统提示词"，key 用 `system-prompt`
  - 位置：紧接在「派遣」（SubAgentTab）后面
  - 引入 `SystemPromptPreviewTab` 并在对应 Tab 内容区渲染

**验证**：
- `bun run dev` 启动，打开设置 → 点「系统提示词」Tab
- 页面能看到 6 个 Card，内容非空、触发说明清晰、模板正文可读
- 切走再回来无报错
- lint / build:electron 通过

### 2c. 更新代码地图

- [ ] `.claude/rules/codebase-map.md` 加两条：
  - 「页面（app/）」段下：`app/settings/SystemPromptPreviewTab.tsx` — 系统提示词只读预览面板，拉后端 getSystemPromptSegments 展示 6 段隐形系统契约
  - 「IPC 路由（electron/main/tipc/）」段下：`system-prompt.ts` — 系统提示词模板查询（getSystemPromptSegments，供设置页只读预览）
- [ ] 「业务服务」/「Agent 框架」段的 `session-append-templates.ts` 描述更新：追加"新增 NOTES_GUIDANCE_APPEND / subAgentContractFor / getSystemPromptSegments"
- [ ] 「类型定义（types/）」段加：`system-prompt.ts` — SystemPromptSegment 结构

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
（本 step 是本 plan 最后一步，无下一步；此段可写"完成，plan 收尾"）

- 后续可能的迭代方向（供参考，不在本次 scope）：
  - 加"当前活跃会话实际拼接"视图（方向 1 里的选项 3）
  - `_notes/` 引导等段放开可编辑（如果用户反馈想调）
  - 展示 `DELEGATION_APPEND`（等它实现后自然会加进 getSystemPromptSegments 清单）
