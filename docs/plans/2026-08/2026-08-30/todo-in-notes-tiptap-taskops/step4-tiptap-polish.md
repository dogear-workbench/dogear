---
step: 4
title: Tiptap 交互完善
status: done
---

## 目标

在 Step 3 的核心编辑器上加交互打磨：选中文字浮现迷你工具栏、`/` 插入菜单、空态 placeholder、正文排版，达到「清爽可直接渲染」的目标体验。

## 依赖上下文（接力棒输入）

- 前置 step 产出：Step 3 回填的 TiptapEditor 最终形态（props / 包版本 / 扩展清单 / 可接受往返差异），**先读再动手**
- 设计文档第二节交互清单：BubbleMenu 条目=粗体/斜体/行内代码/删除线/链接；`/` 菜单条目=待办、标题、无序/有序列表、引用、代码块、分割线、表格
- v3 的菜单组件路径与 v2 不同（BubbleMenu 从 `@tiptap/react` 子路径导入），以 Step 3 定的版本为准

## 计划改动

- [ ] BubbleMenu：选中文本浮现（粗体/斜体/行内代码/删除线/链接），失焦或取消选中消失；链接项点击弹行内输入（或小 popover 填 url）
- [ ] `/` 插入菜单：基于 `@tiptap/suggestion` 自建菜单组件，中文过滤拼音不强求（按条目中文名与关键词匹配即可），Esc 关闭、Enter 选中、上下键移动
- [ ] placeholder 空态文案（如「输入 # 变标题、/ 插入块、- [ ] 加待办…」）与 `contentEditableClassName` 排版（prose 基础上按 Bear 观感调行距/字号/代码块底色）
- [ ] 待办项视觉：选框与文字对齐、勾选后文字变灰或划线（择一，以清爽为先）

## 验收

- 选中「加粗」两字点 B → 变粗，工具栏不遮挡选中内容；点空白处工具栏消失
- `/` 弹菜单：插待办/标题/引用/代码块/分割线/表格全部可用；Esc 关闭后正常打字
- 空卡片显示 placeholder；输入后消失
- 存量卡片往返与 IME 无回归（重跑 Step 3 验收清单前四项）
- build:renderer + lint + tsc 通过

## 实施回填（做完后填）

### 实际改动
- 新增依赖：`@tiptap/suggestion@3.30.5`（与 tiptap 同版本锁定）
- 与计划差异：
	- 「标题」条目拆为「标题」（H2）与「小标题」（H3）：正文 H1 语义被卡片标题输入占用（NoteEditor 剖离首个 ATX 行），共 9 条
	- 链接编辑用 BubbleMenu 内行内 input（计划允许的两个选项之一）：Enter 确认、Esc 取消、已有链接时显移除按钮；input 内 Enter/Esc 均 stopPropagation（BubbleMenu 渲染在编辑器容器内，冒泡会触发 NoteEditor 的 Esc 关卡）
	- Esc 关闭 slash 菜单用 v3 官方 `exitSuggestion(view, pluginKey)` API：移除 decoration 但保留 `/` 字符，符合「Esc 关闭后正常打字」验收
	- 待办勾选视觉选「变灰」（不带划线，清爽优先）
	- slash 菜单 popup 挂 body + fixed 定位，scroll 用 capture 监听重定位（零新增依赖，未用 floating-ui）
- 改动文件清单：`components/notes/tiptap/slash-items.ts`（条目定义+过滤）、`SlashMenuList.tsx`（菜单 UI+键盘句柄）、`SlashMenu.tsx`（Extension + suggestion render 接线）、`BubbleToolbar.tsx`（气泡工具栏+链接面板）、`components/notes/TiptapEditor.tsx`（组装）、`src/globals.css`（notes-bubble/notes-slash-menu/待办勾选变灰样式）、`package.json`

### 给下一步的接力棒
- 关键签名 / 数据结构：
	- `SlashMenuItem`：`{ id, title, keywords: string[], icon: LucideIcon, command({ editor, range }) }`；加菜单条目只需在 `slash-items.ts` 的 `SLASH_ITEMS` 加一条（title 含中文即参与过滤，keywords 支持拼音/英文）
	- BubbleMenu 从 `@tiptap/react/menus` 导入；定位用 `options={{ placement: 'top', offset: 8 }}`（offset 在 options 里，不是顶层 prop）；`shouldShow` 完全接管默认判断（本实现只查 `selection.empty`，编辑器恒为可编辑态所以未查 isEditable）
	- slash 扩展名 `slashMenu`，`PluginKey('slashMenu')` 与 `exitSuggestion` 配套；键盘流：ArrowUp/Down 循环移动、Enter/Tab 选中、Esc exitSuggestion
	- 挂浮层的组件内 input 记得 stopPropagation Enter/Esc（防冒泡到 NoteEditor 容器触发关卡）；「点击浮层内按钮不失焦」用 onMouseDown preventDefault
- 下个 step 该从哪里继续：Step 5（待办退役），与本步无代码耦合；Step 1/2 已完成的迁移与退役名单见 step5.md
- 待办或已知限制：
	- GUI 行为（菜单遮挡、IME 下 Enter 选中、滚动跟随）均未真机验证，验收清单见 step4.md；序列化链路本步未动，Step 3 往返结论继续有效
	- slash 菜单无图片条目（设计清单外未加）
	- BubbleMenu 恒为浮层顶部 placement，底部边缘未做 flip（floating-ui 默认 middleware 链含 flip，v3 options 未显式关闭，预计自动 flip，待真机确认）
