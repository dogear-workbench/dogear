---
step: 3
title: 左侧话题界面与只读归档浏览
status: pending
---

## 目标

把左侧所有可见语义切换为话题级归档，并使归档话题中的会话只能查看、不能继续工作。

## 依赖上下文（接力棒输入）

- 前置 step 产出：Group 已有 `archivedAt`，活跃 store 与归档话题读模型已分离，归档会话可获得所属话题状态。
- 当前左侧单会话归档区在 `components/conversation-list/ArchiveSection.tsx`，使用 `listArchivedConversations` 并渲染 `ConversationRow`。
- 当前组卡 `components/group-list/GroupCard.tsx:84` 的删除确认文案与后端行为不一致；会话行的归档恢复/永久删除分支在 `components/conversation-list/ConversationRow.tsx:82`。
- 聊天页仅识别历史 SDK 冻结归档，见 `components/agent-chat/AgentChat.tsx:90`；需扩展为话题归档只读。

## 计划改动

- [ ] 将 `ConversationList`、`GroupCard`、文件夹菜单、确认框和空状态中的“会话组”统一改为“话题”；保留内部变量和 ID 的 `group` 技术命名。
- [ ] 重写 `ArchiveSection` 为“已归档话题”：按话题计数和排序，使用只读模式的 `GroupCard` 展开会话，不再直接渲染独立归档会话。
- [ ] 为 `GroupCard` 增加活跃/归档展示模式：活跃模式提供归档、删除、重命名、文件夹和新建会话；归档模式仅提供恢复话题、永久删除话题和只读会话列表。
- [ ] 简化 `ConversationRow`：移除单会话归档恢复/永久删除分支；在归档话题内隐藏编辑、删除、引用到当前对话等写入性操作。
- [ ] `AgentChat`、输入区和相关 hooks 根据 `topicArchived` 进入只读状态：显示归档提示，禁用发送、编辑重发、分叉、模型切换和权限操作；历史仍可阅读。
- [ ] 移除 `components/ArchivePanel.tsx` 与 `ui-store.ts` 的旧单会话归档面板状态，以及所有无调用方的旧归档文案和类型字段。
- [ ] 验证归档、恢复、永久删除后列表、标签页、选中项和视图切换同步刷新。

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
