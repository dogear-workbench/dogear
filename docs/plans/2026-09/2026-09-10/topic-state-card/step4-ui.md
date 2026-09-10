---
step: 4
title: 工具适配与前端状态卡渲染
status: done
---

## 目标
ReadGroupBackground 工具适配新 schema（会话中 agent 自取最新）；TopicPanel 话题背景 Section 改渲染条目化状态卡，含 topicChange 待确认交互。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step1-store.md] 状态卡读取 API 与条目类型；[step3-inject.md] 注入已生效（本 step 与 Step 5 无强依赖，可并行）
- 现状：`reference-tools.ts:71 dogear__ReadGroupBackground` 返回旧 4 字段；`TopicPanel.tsx:52-100` 三 Section（话题背景 :172 / 组卡 :212 / 共享文件 :245）；`TopicPanel.tsx:94-100` 已监听 groupDataChanged 自动重拉；IPC 入口 `tipc/group.ts:194 readGroupBackground`
- 前端目录在根下 components/（无 src/）

## 计划改动
- [x] `reference-tools.ts`：ReadGroupBackground 返回新结构（topic 生效版 + 版本链摘要 + 六类条目带来源/ts + updatedAt + pendingTopicChanges 数量）
- [x] `tipc/group.ts`：readGroupBackground procedure 适配新 schema；新增 `confirmTopicChange(groupId, index, accept|reject)` procedure（调 Step 1 的 topic 合并逻辑：accept 追加版本链，reject 丢弃）
- [x] `TopicPanel.tsx` 话题背景 Section 重写：
  - topic 生效版展示（含"确立于 X"）
  - pendingTopicChanges 非空时显示待确认条目（卡片样式 + 接受/拒绝按钮 → 调 confirmTopicChange）
  - 六类条目分组渲染，每条显示来源徽标（会话/用户/迁移）与时间
  - 空态（未初始化）提示
- [x] 样式对齐现有 Section 风格（shadcn + Tailwind 4），不引入新依赖
- [x] 验证：手动触发抽取后 TopicPanel 自动刷新；待确认流程走通；`bun run dev:renderer` 热重载检查

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
