---
step: 5
title: 首页捕捉框 + 老速记板链路清理
status: pending
---

## 目标

首页右栏速记板替换为快速捕捉框（回车成卡 + #tag 解析 + 最近卡片缩略），老速记板全链路删除。

## 依赖上下文（接力棒输入）

- 前置 step 产出：读 step3 回填（createNote action 可用）
- 被替换物：`components/dashboard/ScratchpadSection.tsx` 全组件 + `components/dashboard/Dashboard.tsx:31` 右栏挂载点
- 老链路清单（全部删除）：`electron/main/tipc/notes.ts` 的 getNotes/saveNotes 路由、`tipc/index.ts:24,54` 注册、`electron/main/services/memory/notes-store.ts`、`stores/dashboard-store.ts:100-125` 的 `loadNotes/flushNotes/notesContent/notesSaving`（:25-26）及 ScratchpadSection 的消费
- 数据迁移：**不做**（调研确认 `.dogear/workspaces/*/` 下无 notes.md 实文件，设计文档已注明）
- 旧文件兜底：若用户环境出现过 notes.md，新代码不读它即自然失效，无需检测逻辑

## 计划改动

- [ ] `components/dashboard/CaptureBox.tsx`：替换 ScratchpadSection
  - 单行 textarea 自动增高（shadcn `ui/textarea` + auto-resize），placeholder「记点什么…（#标签 回车保存）」
  - Enter 提交（Shift+Enter 换行不提交）：解析正文 `#[\w\u4e00-\u9fa5-]+` 为 tags，剩余为 content，调 createNote，清空输入
  - 下方最近 5 张卡缩略（时间 + 摘要 + 标签），点击 `setActiveTab(NOTES_TAB_ID)` 并设 activeNoteId 打开详情
- [ ] `Dashboard.tsx`：右栏挂 CaptureBox，宽窄屏布局保持原两栏逻辑
- [ ] 删除老链路清单全部文件/代码；`grep -r "ScratchpadSection\|getNotes\|saveNotes\|notesContent\|flushNotes"` 确认无残留引用
- [ ] `dashboard-store.ts` 清理 notes 相关字段后跑 `bun run lint` 防类型悬空

## 验证

- `bun run dev`：首页右栏为捕捉框 → 输入 `测试 #想法 顺便一条`（含 #tag）回车 → 笔记 Tab 时间流出现该卡且标签正确 → 点缩略跳详情可编辑 → 全局搜索无老链路残留

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
