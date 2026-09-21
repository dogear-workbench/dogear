---
step: 4
title: 移入工作区
status: pending
---

## 目标

临时会话可移入真实工作区：索引迁移 + session 文件搬运 + 组归属选择 UI；agent 可用只读话题工具辅助建议归置。

## 依赖上下文（接力棒输入）

- 前置 step 产出：Step 3 临时会话完整可用；PERSONAL_WORKSPACE_ID 常量与 personal 数据形态（单会话组）已落地
- 关键现状签名：
  - 索引迁移：`conversation-service.ts` `importConversation(targetWorkspaceId, conv)`（:628，已存在，保留原 ID、目标已存在则跳过）——**只动 conversations.json，不搬 session JSONL**
  - session 文件：`pi-session-repository.ts` 按 workspaceId 缓存 JsonlSessionRepo，session 根目录 `<configDir>/workspaces/<id>/sessions/`
  - 组：`group-service.ts`；移入需选目标组或新建组
  - 只读话题工具：`tools/reference-tools.ts` ListTopics / ReadGroupBackground（组协作组，已存在）
- 关键决策回顾：移入后按工作区语义归组（现有组/新建组），隐式单会话组随之消解；agent 只建议，执行靠用户点 UI

## 计划改动

- [ ] 主进程新服务函数 `moveConversationToWorkspace(personalConvId, targetWorkspaceId, targetGroupId | 'new' + title)`（放 conversation-service 或独立文件）：
  - 前置校验：session 运行中拒绝（查 pi-session-manager 存活集合）；目标组存在性校验
  - session JSONL 搬运：`workspaces/personal/sessions/<sessionId>.jsonl` → 目标工作区 sessions/（文件系统 rename/copy+delete 跨目录），并使 pi-session-repository 两侧缓存失效（若有打开的 repo 实例）
  - 索引：目标 conversations.json 写入（复用 importConversation 逻辑）+ groupId 更新为目标组 + personal 侧 deleteConversation + personal 隐式组删除（group-service）
  - 完成后广播两侧 conversationListChanged
- [ ] tipc 路由：新 IPC（moveConversationToWorkspace），前端 confirm-store 确认后调用（涉及数据搬迁，用 showConfirm 而非静默）
- [ ] UI 入口：临时会话顶部徽章旁「移入工作区」按钮 → 弹层选工作区（getAll 过滤 personal）+ 组（现有组列表/新建组输入）；执行中 loading，成功后跳转/聚焦目标会话（focusConversation 基建，注意「先切后高亮」铁律：先 await setWorkspace 再 focusConversationById）
- [ ] agent 辅助：personal 会话能力包放行 ListTopics / ReadGroupBackground（只读），提示词引导「用户要移入工作区时可列近期话题给建议」；agent 不获得任何写工具
- [ ] 移入后的会话不再受 7 天归档（它已是目标工作区普通会话，30 天组归档照常）——验证即可
- [ ] `bun run build:electron` + 手动验收

## 验收

- [ ] 临时会话移入工作区后：目标工作区列表可见、历史消息完整可读、topic 归属正确
- [ ] personal 侧会话与隐式组消失，列表刷新无残留
- [ ] 移入后新消息正常（session repo 指向新路径，无「找不到会话」）
- [ ] 运行中的会话移入被拒绝并提示
- [ ] agent 在临时会话可列话题给归置建议（只读），不能读工作区文件

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
