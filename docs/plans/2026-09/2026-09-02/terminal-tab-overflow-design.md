# 终端面板 Tab 栏叠放改造设计

**背景**：底部 tab 栏平铺 + `overflow-x-auto`，开 3+ 终端时前面的被挤出视野，需要横向滚动找；已退出与运行中的终端只靠 opacity-55 区分，混在一起难寻找。

**目标**：保持底部栏形态，tab 固定尺寸，运行中/已结束状态视觉明确，放不下的收进「更多 ▾」下拉，激活 tab 始终可见。

## Tab 本身

- 固定宽度 `w-32`（128px），内容 truncate，不再随内容伸缩
- 状态视觉（与父会话行橙色运行点的语言一致）：
  - **运行中**：左侧橙色脉动小点（`animate-pulse`），文字正常色；会话终端跑命令时保留现有 `Loader2` spinner（spinner 和橙点二选一，会话终端用 spinner，shell 用橙点）
  - **已结束**：整体 muted 灰 + 左侧灰色实心圆点，保留 `exit N` 小字
- 移除「我的 shell | 会话终端」分隔线，统一一个流（标签本身可区分：命令截断 vs `$ shell N`），渲染顺序保持 mine 在前 session 在后

## 溢出机制

- `ResizeObserver` 监听 tab 栏容器宽度，存 state
- 可见 tab 数 = `floor((容器宽 - 预留宽度) / 128)`；预留宽度 = 栏 padding + `[+]` 按钮（~30px）+ 溢出时的「更多」按钮（~44px）
- **激活保底**：激活 tab 若按顺序落在溢出区，强制换入可见区末位（挤出的那个进下拉），避免当前终端凭空消失
- 「更多 ▾」按钮：仅存在溢出时渲染，带溢出数量徽章
- 下拉条目（shadcn `DropdownMenu`）：完整命令不截断 + 与 tab 相同的状态表达（spinner/橙点/灰点/exit N）+ hover 出关闭按钮；点击条目切换激活并关下拉
- 面板拖动宽度变化时 ResizeObserver 实时重算

## 不做（YAGNI）

- 不自动清理已结束终端（重启自然清空，堆积可见是接受的）
- 不加「一键清空已结束」按钮

## 模块边界

- 仅改 `components/companion/TerminalPanel.tsx`（底部栏 + TerminalTab 组件）
- `stores/terminal-store.ts` 不动：`selectTerminalGroups` 继续返回 mine/session 分组（保持数据层语义），UI 层不再画分隔线、拼接为一个流

## 实施要点

- 溢出计算放在渲染层：`useLayoutEffect` 建 ResizeObserver，容器宽度变化 setState 触发重算
- 可见/溢出切分是纯函数：输入 `(orderedTabs, visibleCount, activeId)` → 输出 `(visibleTabs, overflowTabs)`，激活保底在此处理
- 中间终端显示区（`XtermTerminal`）与顶部固定/跟随栏不动
- 下拉内点击关闭按钮时 `stopPropagation` 避免误切换
