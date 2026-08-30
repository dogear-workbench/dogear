---
step: 3
title: 待办 mode 视图
status: pending
---

## 目标

待办 mode 完整可用：todo-store + TodosPanel（快速输入、due 排序、双链跳转、软删、agent 记录标识）。

## 依赖上下文（接力棒输入）

- 前置 step 产出：step2 的 tipc todos 路由（listTodos/createTodo/updateTodo/setTodoStatus/deleteTodo/restoreTodo）
- 关键决策：due 仅排序标红不做通知；`source: agent` 带小图标；noteId 悬空（目标笔记在回收站/已删）时链接灰态不自动清理

## 计划改动

- [ ] 新建 `stores/todo-store.ts`：todos/loading/load/create/update/setStatus/softDelete（调 tipc）+ `subscribeTodosChanged`（主进程 todosChanged 广播，step1 若未加广播此处补主进程侧）；分域搜索用 `filterByQuery(query)` 辅助
- [ ] 新建 `components/notes/TodosPanel.tsx`：
  - 顶部常驻快速输入行（Enter 即建，不走顶栏 + 按钮）
  - 列表排序：未完成在前（due 升序、过期标红、无 due 靠后）→ 完成折叠区收底（默认折叠）
  - 行结构：checkbox + 文本 + due（行内编辑，日期选择器不做自然语言解析）+ 关联笔记 chip（点击切笔记 mode 并打开该卡；悬空灰态）+ hover 编辑/删除（软删）
  - `source: agent` 行首小图标
  - 顶部接收 `query` prop 做文本过滤（step6 接顶栏分域搜索）
- [ ] 组件暂以独立路由/临时入口验证（正式挂载在 step6 收口）

## 验收

- 手动建/勾选完成/编辑 due/软删后进回收站（step4 呈现）全链路可用
- due 过期行标红且排最前；完成项折叠
- agent 记录的待办（用 createTodo 工具）显示 agent 图标

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
