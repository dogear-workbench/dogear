# 会话行排版与状态体系重设计

**背景**：左侧会话行（ConversationRow）元素堆积——展开箭头、状态/类型图标、hover ··· 浮层三个视觉锚点并存；状态图标（StatusPulse/CircleCheck/Ban）与类型图标（Network/GitBranch/MessagesSquare）互斥抢占图标位，导致 Network 随子会话生命周期消失的语义漂移；引入「hover 变箭头」后与状态图标正面冲突（运行中的合集行无法同时表达状态与展开入口）。

**目标**：

- 常驻视觉最少化：行首一个图标位 + 名称 + 第二行元信息
- 图标位职责单一：类型图标常驻、不被状态顶掉；有子会话的行 hover 变箭头，运行中也可展开
- 状态表达足够显眼（行级 + 行内双层），且不与展开交互冲突
- 有子会话的「合集」行平时可识别（不依赖 hover）
- 顶部 tab 页（WorkspaceTabBar）零改动，颜色语义对齐

## 架构

核心做法——**每个视觉位置职责单一**：

| 位置 | 职责 | 表现 |
|------|------|------|
| 行首图标位 | 类型 + 展开交互 | 常驻类型图标（MessagesSquare / Network / GitBranch，不再被状态替换）；有子会话的行 hover 时变 chevron（方向随展开态），点击切换展开；展开后箭头也只在 hover 显示 |
| 行左边缘竖条 | 进行中状态（行级） | 2px 圆角色条，absolute 不占布局：运行中=橙、等待确认=蓝（pending 优先）；终态（交付/停止）不挂竖条；状态结束即消失 |
| 第二行（元信息行） | 状态 + 计数 + 时间 | `相对时间 · 状态点+文字 · N 个子会话`；状态点为缩小版脉冲点（呼吸动画保留）：橙=运行中、蓝=等待确认、绿=已交付、灰=已停止（后两者为子会话行终态，源自 childSnapshot） |
| 底部堆叠线 | 合集氛围暗示（辅助） | 两条 1px 阶梯细线（第二条更短、低 2px），muted 低透明度；仅未展开时显示，展开即消失；hover 略加深；右侧内缩 8px 避免与下行粘连 |

竖条 + 第二行点文字构成状态三层表达：竖条（扫列表定位）→ 点+文字（精确语义）→ 动画（进行中感知）。

排除的选项及原因：

- **状态留在图标位、箭头让位**：运行中合集行 hover 无箭头，展开入口失效，冲突无解
- **类型图标染色表示状态**：变色易被读成选中/链接，语义不干净
- **激进单行化**：「等待确认」需要用户行动的状态无处安放
- **纯上下排布（··· 收第二行但状态仍占图标位）**：元素总量不减，且图标位冲突依旧

其他调整：

- **缩进收紧**：组内主会话 indent 24→16（一个图标位），子会话保持每级 +16；顺带对齐组头 chevron 与行图标位形成竖直状态列
- **··· 按钮挪到第二行右端** hover 出现，去掉现有渐变背景叠字的实现瑕疵
- **Bot 绑定徽标**（名称后绿色 Bot 图标）保持现状

## 模块边界

- `components/conversation-list/ConversationRow.tsx` — 主要改动：图标位逻辑重写、第二行元信息、竖条、堆叠线、··· 迁移
- `components/group-list/GroupCard.tsx` — renderNodes 传 `childCount`（node.children.length）、indent 24→16
- `components/StatusPulse.tsx` — 可能加小尺寸变体或新增 StatusDot（状态点）
- `components/WorkspaceTabBar.tsx` — **零改动**（数据源 runningConversationIds/pendingActionConversationIds 与颜色语义橙/蓝天然对齐，tab 场景粒度更粗不显示终态属合理差异）
- `stores/conversation-store.ts`、`section-collapse-store.ts` — 不动（数据流全部复用现有）

## 数据流

全部复用现有链路，仅消费位置变化：

- 运行态：`sessionStateChanged` / `sessionClosed` → `runningConversationIds` / `pendingActionConversationIds` → 行竖条颜色 + 第二行状态点
- 子会话终态：`childSnapshotsById[conv.id]`（refreshAllChildren / applyChildSnapshot）→ 第二行绿点/灰点
- 子会话数量：GroupCard 树节点 `node.children.length` → `childCount` prop
- 展开/收起：section-collapse-store `subExpandedConvIds`（现状不变），控制箭头方向与堆叠线显隐

## 错误处理 / 边界情况

- **运行中 + hover**：图标位照常变箭头（状态已下沉，无冲突）
- **isPending 与 isRunning 并存**（等待确认时运行标志也在）：竖条颜色 pending 优先蓝
- **选中态蓝背景 vs 蓝竖条**：竖条颜色加深一档或外偏 1px 区分，实施时对界面调
- **多层派遣链**（子会话再派孙会话）：同一逻辑递归适用，`childCount` 取直接子节点数
- **readOnly（归档）**：展开查看照常允许，箭头/堆叠线行为一致
- **第二行信息拥挤**：时间/状态/子会话数超宽时的截断规则（预计 max-w 内 flex 收缩，具体实施调）
- **childSnapshot 缺失**（跨重启快照不全）：显示类型图标 + 无终态点，不 crash

## 未决问题

- 堆叠线的具体样式数值（透明度、第二条偏移量、宽度）需对着界面微调
- 状态点最终形态：复用 StatusPulse 加小尺寸 vs 新建 StatusDot 组件
- 第二行各信息项的确切排布与分隔符样式（「·」vs 间距）
