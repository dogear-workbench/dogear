# 话题卡活跃会话指示 设计

**背景**：话题折叠后只剩标题 + 会话总数，组内是否有活会话（agent 存活挂机 / 正在运行）完全不可见，用户必须逐个展开才能知道哪些话题里还有会话活着。

**目标**：话题卡头部显示一个「内部有会话活着」的指示，不区分运行/空闲状态。

**架构**：纯前端小改。GroupCard 头部订阅 `conversation-store` 的 `aliveConversationIds`，对组内会话树递归判断任一 `conv.id` 在集合中，命中则在话题卡左侧渲染绿色竖条。排除的选项：
- 区分 running/pending/alive 三态——用户明确不需要，只要「活着」
- 查 running 集合——正在跑的会话必然 alive（session 实例在才能跑），一个集合足够
- 文件夹层聚合——手动文件夹功能即将删除

**模块边界**：仅 `components/group-list/GroupCard.tsx`（新增 alive 订阅 + 递归判断 helper + 竖条渲染）。

**数据流**：主进程 `broadcastAliveConversations`（全量数组）→ `aliveConversationsChanged` 事件 → conversation-store 整体替换 Set → GroupCard selector 订阅 → 递归 tree 判断 → 竖条显隐。

**错误处理 / 边界情况**：
- 归档话题（mode='archived'）：归档会话不可能 alive，天然不显示，无需特判
- alive Set 全量替换导致所有 GroupCard 重渲：列表规模小，可接受
- 展开/折叠都显示：折叠时是唯一线索，展开时与会话行竖条并存

**未决问题**：无。
