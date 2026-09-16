---
step: 3
title: 右侧精简展示
status: pending
---

## 目标
点主会话行右侧展示该会话的精简轮次流（输入 + 最后文字结论），含话题级缓存、空态与错误态。

## 依赖上下文（接力棒输入）
- 前置 step 产出：
  - Step 1：`client.getArchivedTopicDigest({ workspaceId, groupId })` 返回 `{ digest }`，结构见设计文档（sessions[].turns[]）；缺失文件由后端懒构建。
  - Step 2：ArchivePage 左列表就绪，主会话行已有选中态回调与子会话数量（node.children 递归总数）。
- 当前关键文件状态：
  - `components/MarkdownRenderer.tsx`：现有 markdown 渲染组件，直接复用渲染 input / conclusion。
  - 选中态由 Step 2 的 ArchivePage 内部状态承载（选中 topicId + conversationId）。
- 关键决策回顾：digest 话题级拉取一次、同话题切会话行用缓存（缓存随选中话题切换丢弃即可，无需全局缓存）；无结论轮灰字「（无文字回复）」；无 sessionId 会话（后端 turns 为空数组）显示「（无对话内容）」；右侧标题栏显示主会话标题 +「N 个子会话」徽标（数量取左侧树，不取 digest）；拉取失败显示错误 + 重试按钮；恢复话题后若右侧正展示该话题，清为空态（Step 2 已处理列表侧，本步确保右侧联动）。

## 计划改动
- [ ] 新建 `components/archive/` 下 digest 视图组件：标题栏（会话标题 + 子会话徽标）+ 轮次流（input / conclusion 两段 MarkdownRenderer）+ 空态/错误态
- [ ] ArchivePage 接线：选中会话行 → 拉 digest → 缓存 → 渲染；同话题切换不重复 IPC
- [ ] 全动线验证：打开 tab → 选话题/会话 → 浏览轮次 → 搜索过滤 → 恢复/删除 → 右侧联动

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
