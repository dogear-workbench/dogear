---
step: 5
title: 首页捕捉框 + 老速记板链路清理
status: done
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

- [x] `components/dashboard/CaptureBox.tsx`：替换 ScratchpadSection
  - 单行 textarea 自动增高（shadcn `ui/textarea` + auto-resize），placeholder「记点什么…（#标签 回车保存）」
  - Enter 提交（Shift+Enter 换行不提交）：解析正文 `#[\w\u4e00-\u9fa5-]+` 为 tags，剩余为 content，调 createNote，清空输入
  - 下方最近 5 张卡缩略（时间 + 摘要 + 标签），点击 `setActiveTab(NOTES_TAB_ID)` 并设 activeNoteId 打开详情
- [x] `Dashboard.tsx`：右栏挂 CaptureBox，宽窄屏布局保持原两栏逻辑
- [x] 删除老链路清单全部文件/代码；`grep -r "ScratchpadSection\|getNotes\|saveNotes\|notesContent\|flushNotes"` 确认无残留引用
- [x] `dashboard-store.ts` 清理 notes 相关字段后跑 `bun run lint` 防类型悬空

## 验证

- `bun run dev`：首页右栏为捕捉框 → 输入 `测试 #想法 顺便一条`（含 #tag）回车 → 笔记 Tab 时间流出现该卡且标签正确 → 点缩略跳详情可编辑 → 全局搜索无老链路残留

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. store `createNote` 不再固定「进入编辑态」：改为 `createNote(workspacePath, input?)` 仅创建+本地插入列表，「新建即编辑」上移到 NotesPanel.handleCreate（用返回的 note 调 setActiveNoteId）——捕捉框创建后留在首页不开编辑器，匹配计划行为描述；这也是给捕捉框传 `{content, tags}` 的同一入口，未另开旁路
  2. textarea 自动增高用 shadcn Textarea 自带的 `field-sizing-content`（Tailwind 4 原生），无需手写 scrollHeight 逻辑；`min-h-10 max-h-40` 限高
  3. Enter 提交额外判断 `e.nativeEvent.isComposing`，防中文 IME 确认候选词的回车被误提交
  4. 删除清单比计划多一个 `memory/notes-store.test.ts`（老 store 的直属测试，删 store 必须连带，否则残留悬空 import）
- 改动文件清单：
  - 新增：`components/dashboard/CaptureBox.tsx`
  - 修改：`components/dashboard/Dashboard.tsx`（换挂载点、移除 loadNotes）、`stores/notes-store.ts`（createNote 扩展）、`components/notes/NotesPanel.tsx`（handleCreate 补回激活）、`stores/dashboard-store.ts`（删 notes 四字段）、`electron/main/tipc/notes.ts`（删老路由）
  - 删除：`components/dashboard/ScratchpadSection.tsx`、`electron/main/services/memory/notes-store.ts`、`electron/main/services/memory/notes-store.test.ts`
- 验证：`bun run build:electron` 通过；`bun run lint` 0 errors（76 warnings 全为历史遗留，与基线一致）；`bunx tsc --noEmit` 49 行输出全为仓库历史错误，改动文件零涉及；残留 grep（ScratchpadSection/notesContent/flushNotes/readNotes/saveNotes/notesSaving）0 残留。应用内手测（dev 起首页捕捉→进笔记 Tab 验证）留给主会话

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `createNote(workspacePath, input?: { content?: string; tags?: string[] }): Promise<Note | null>`，不再自动 setActiveNoteId；需要进编辑态的调用方自己拿返回值调 `setActiveNoteId(note.id)`
  - CaptureBox 惰性拉取列表（`loadedWorkspacePath` 去重）后与 NotesPanel 共享同一份 `notes`；notesChanged 广播对新链路照常生效
  - 首页缩略点击 = `setActiveNoteId(noteId)` + `switchTab(NOTES_TAB_ID)`（session-store）
- 下个 step 该从哪里继续：按 step6 文档实施；老速记板链路已彻底移除，无需再考虑迁移/兼容
- 待办或已知限制：
  - 捕捉框只有 tags 解析，不支持 links/todos 快捷输入（详情页可补）
  - 创建失败仅 console.error，无 UI 提示（与 updateNote 同款静默失败，后续可统一接 toast）
