---
step: 3
title: 搜索框挪位与 Minimap 常驻
status: done
---

## 目标
搜索框从消息区右上角挪到输入框正上方右下角悬浮；Minimap 与等待交付指示不再因搜索打开而隐藏。

## 依赖上下文（接力棒输入）
- 无前置依赖（step1/2 不影响本 step 区域）
- 现状：`SearchBar.tsx:34` 定位 `absolute top-2 right-2`，挂在最外层 relative 容器（`AgentChat.tsx:388` 注释说明是为避开 overflow-hidden 裁剪）
- 现状：消息区容器 `<div className="relative flex-1 overflow-hidden">`（`AgentChat.tsx:391`）自身是 relative，浮条放它内部底部不会被裁剪也不随内容滚动；右侧有 `w-12` 工具轨道（`AgentChat.tsx:505`）
- 现状：搜索打开时 `MessageMinimap` 与 `AwaitingDeliveryIndicator` 被 `hidden={search.isOpen}` / `!search.isOpen` 隐藏（`AgentChat.tsx:524` 附近），顶部搜索按钮同理——原因是为搜索条腾位，挪位后 Minimap/指示器不再被遮挡

## 计划改动
- [x] `AgentChat.tsx`：把 `<SearchBar>` 移入消息区容器内（`relative flex-1 overflow-hidden` 那层），删除原挂载点及过时注释
- [x] `SearchBar.tsx`：定位改 `absolute bottom-2 right-14`（右移 14 避开 w-12 工具轨道 + 边距），其余逻辑不动
- [x] `AgentChat.tsx`：`MessageMinimap` 去掉 `hidden={search.isOpen}`、`AwaitingDeliveryIndicator` 去掉 `!search.isOpen` 条件，恢复常驻；顶部搜索按钮的 `!search.isOpen` 保留（避免搜索开启期间重复入口）
- [ ] 手动验收：Ctrl+F 打开搜索，浮条悬浮在输入框正上方、不遮右侧轨道与 Minimap；关闭后顶部按钮恢复；消息区滚动时浮条位置固定不动（需 UI 环境，待用户验收）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无。三点全部按计划落地；SearchBar 新挂载点选在消息区容器内、工具轨道 div 之后（absolute 定位与顺序无关，放这里与工具轨道相邻便于理解层级）
- 改动文件清单：
  - `components/agent-chat/AgentChat.tsx`：SearchBar 移入消息区容器（原挂载点及「避免被 overflow-hidden 裁剪」过时注释删除）；MessageMinimap 去掉 `hidden={search.isOpen}`；AwaitingDeliveryIndicator 去掉 `!search.isOpen` 条件；顶部搜索按钮的 `!search.isOpen` 保留
  - `components/agent-chat/SearchBar.tsx`：定位 `absolute top-2 right-2` → `absolute bottom-2 right-14`，其余逻辑未动
- lint：0 errors（83 个既有 no-explicit-any warnings，与本 step 无关）
- 手动验收：待用户在应用内确认（Ctrl+F 浮条位于输入框正上方、不遮右侧轨道与 Minimap；关闭后顶部按钮恢复；滚动时浮条位置固定）

### 给下一步的接力棒
- 关键签名 / 数据结构：SearchBar 挂载点现位于 AgentChat.tsx 消息区容器内（工具轨道 div 之后）；`activeBlockMatchCount` useMemo 仍在 search 解构之后（~L317）未动；MessageMinimap 的 `hidden?: boolean` prop 仍保留（可选），只是不再传
- 下个 step 该从哪里继续：本计划三步全部完成；后续如动搜索 UI，注意 SearchBar 现在的定位锚点是消息区容器而非最外层容器
- 待办或已知限制：搜索打开时浮条覆盖消息区右下角内容（输入框正上方），若与低频交互元素重叠需后续调 `bottom/right` 值
