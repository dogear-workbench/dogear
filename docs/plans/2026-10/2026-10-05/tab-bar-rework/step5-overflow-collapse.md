---
step: 5
title: 溢出收纳与哨兵图标化
status: done
---

## 目标

tab 栏取消横向滚动：哨兵 tab 图标化省宽，会话 tab 按容器宽度弹性显示，超出收进「…」溢出菜单，任何情况下不出滚动条、可见 tab 标题可读。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2-tab-sorting.md](./step2-tab-sorting.md) tabs LRU 排序（溢出菜单顺序直接复用 tabs 数组序）；[step3-unread-ui.md](./step3-unread-ui.md) 三态视觉与绿点（溢出菜单项复用同套状态源）
- `components/WorkspaceTabBar.tsx` 现状：左组会话 tabs 在 `ScrollArea`（横向 ScrollBar）内，右组哨兵 tabs 固定不滚动；哨兵均为「图标 + 固定文字」形式
- 关键决策回顾：滚动区里的 tab 没有存在价值（看不见）且挤窄可见 tab；LRU + 未读置顶保证可视区永远是最该看的，被收起的本来就是最久没动的；「…」按钮要在溢出区存在未读 tab 时显示绿点（防未读被藏进菜单）；纵向 tab 已排除（与左侧列表职责冲突）

## 计划改动

- [ ] 哨兵图标化：笔记/数据中心/归档/飞书/网页AI 改纯图标 + title tooltip（保留激活态高亮与现有弹出/关闭 hover 按钮）；文章 tab 保留标题（内容语义）；网页 AI 的 WebAiSiteMenu 站点名处理方式执行时定夺（可保留站点名或收进菜单）
- [ ] 移除会话组 ScrollArea 横向滚动，改容器测宽（ResizeObserver / 现有 useMeasure 类工具，核实项目内既有模式优先复用）：可见数 = 容器宽度预算下的弹性计算（tab min-w 至 max-w-[200px] 弹性）
- [ ] 超出可见数的 tabs 收进右端「…」溢出菜单（shadcn DropdownMenu，参照 WebAiSiteMenu 弹层先例）：菜单项 = 状态指示（pulse/绿点）+ 标题 + hover 关闭按钮；点击项 = switchTab 并确保其弹回可视区（排序置顶逻辑天然保证）
- [ ] 「…」按钮溢出区有未读 tab 时显示绿点
- [ ] 右侧伴随面板开合（容器宽度变化）响应式重算，验证挤压场景不出滚动条
- [ ] 视觉走查：0/3/8/10 个 tab × 伴随面板开/关 的组合场景

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. **网页 AI 站点名选「收进菜单」**：tab 只剩 Globe + 切换箭头，菜单内 Check 标记选中项；WebAiPanel 只复用该文件工具函数无波及
  2. **tab 渲染拆同文件子组件**（SessionTabItem / OverflowTabMenuItem，flexible prop 切换 flex-1 min-w-0 / shrink-0）：溢出逻辑加入后主组件 JSX 超限，按项目 >300 行拆分规范；哨兵 JSX 保持内联（抽出需传 10+ store 字段，样板大于收益）
  3. **溢出菜单项不做右键菜单、不渲染闲置淡化**（菜单项可读性优先，YAGNI）
  4. **溢出菜单序 = displayTabs 聚组序**（可见区 = 前缀、溢出 = 后缀，拼接即完整展示序，主子相邻在菜单内保持；与 step3 接力棒「二选一统一」对齐）
  5. 新建 hooks/use-container-width.ts（ResizeObserver；项目内无既有 useMeasure 先例）；无振荡：溢出按钮可见性只由 total×120 vs W 决定，按钮 40px 预算一次性扣除
  6. 已知语义例外：子会话从菜单点击后弹回跟随父 tab 位置（父若在溢出区子也留溢出区，主子相邻优先于单 tab 置顶，聚组序固有语义）
- 改动文件清单：
  - `hooks/use-container-width.ts`（新建）— ResizeObserver 测容器内容宽度
  - `components/WorkspaceTabBar.tsx` — 移除 ScrollArea；visibleCount/visibleTabs/overflowTabs/flexible/overflowHasUnread 派生；SessionTabItem/OverflowTabMenuItem 子组件；「…」DropdownMenu（溢出区未读右上角绿点）；哨兵图标化（笔记/数据中心/归档/飞书删文字，文章保留标题，网页 AI 纯图标）
  - `components/webai/WebAiSiteMenu.tsx` — 去站点名 span，站点名收进菜单

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `useContainerWidth<T>(): [RefObject<T | null>, number]`；易调常量 MIN_TAB_WIDTH(120) / OVERFLOW_BUTTON_WIDTH(40) / IDLE_FADE_MS(24h)
  - 可见数策略：total×120 ≤ W 全显（max-w-[200px] 兜底）；否则 max(1, floor((W−40)/120))，可见 tab flexible 模式均分预算
- 下个 step 该从哪里继续：本计划最后一个 step，全部完成
- 待办或已知限制：
  - 手测未做（无 UI 环境）：①开 8-10 tab 看溢出与压缩；②开合右侧面板看迁移；③后台完成溢出区会话看「…」绿点；④点菜单项弹回可视区；⑤子会话从菜单点击确认「跟随父位置」产品可接受度
  - 哨兵全开 + 窗口 <600px 时左组极端压缩（标题省略号），功能不破属合理退化
