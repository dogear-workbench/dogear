---
step: 2
title: 前端骨架——notes-store + NOTES_TAB_ID + 时间流只读
status: pending
---

## 目标

主窗口出现「笔记」哨兵 Tab（紧挨首页，固定 Tab 在前、动态会话 Tab 在后），Tab 内能以时间流只读列表展示卡片。

## 依赖上下文（接力棒输入）

- 前置 step 产出：读 step1 实施回填，拿 tipc 路由名、NoteMeta 结构、notes-changed 事件 payload
- 哨兵 Tab 范式：`stores/session-store.ts:10` `HOME_TAB_ID = '__home__'`；渲染 `app/page.tsx:283-300`——所有内容同时挂载、`display` 切换、组件不卸载。加 `NOTES_TAB_ID = '__notes__'` 照抄
- TabBar：`components/WorkspaceTabBar.tsx`（抽取注释见 page.tsx:280）——执行时先读它，看 HOME 固定项的现有实现方式，笔记照抄成第二个固定项，排在首页右侧、所有动态会话 Tab 之前
- IPC 调用：渲染层一律 `lib/client.ts` 的 tipc client，禁止直连 fs

## 计划改动

- [ ] `stores/session-store.ts`：导出 `NOTES_TAB_ID`；检查 activeTabId 类型注释（session-store.ts:24）与关闭逻辑（:95 关到最后一个 Tab 回 HOME 的行为不需要改，笔记是固定 Tab 不参与关闭）
- [ ] `components/WorkspaceTabBar.tsx`：固定 Tab 区加「笔记」项（图标用 lucide `StickyNote` 或同类），点击 `setActiveTab(NOTES_TAB_ID)`；布局保证 固定区(首页|笔记) + 动态会话区 顺序
- [ ] `app/page.tsx`：HOME 渲染 div 旁加同构的 NOTES div（display 切换挂 `<NotesPanel />`）
- [ ] `stores/notes-store.ts`：`notes: NoteMeta[]`、`loading`；action：`loadNotes()`（listNotes）、`subscribeNotesChanged()`（监听 step1 的广播事件刷新）；初始化时机——首次激活笔记 Tab 时惰性加载
- [ ] `components/notes/NotesPanel.tsx`：骨架 = 左侧窄视图栏（时间流/待办/标签/回收站，本步仅时间流可用，其余 disabled 占位）+ 右侧列表区
- [ ] 时间流列表项：时间、正文摘要（首行 ≤80 字）、标签 chips、未完成待办计数（`2/3`）；按 created 倒序
- [ ] 订阅渲染层类型：`types/electron-api.ts` 若集中声明 tipc 类型，同步补齐

## 验证

- `bun run dev`：Tab 栏出现「首页 | 笔记 | 会话…」；切到笔记 Tab 列出 Step 1 冒烟残留/手工放置的测试卡片；切走再切回列表状态保持（组件不卸载）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
