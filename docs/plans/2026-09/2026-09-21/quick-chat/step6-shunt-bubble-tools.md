---
step: 6
title: 操作气泡与 ForkSession
status: pending
---

## 目标

打通分流执行链：建议卡按钮 → 输入框操作气泡（可编辑/可删/可忽略）→ 发送注入 `<shunt>` 标签 → agent 调 ForkSession / CreateNote 执行 → 回执可点击跳转。

## 依赖上下文（接力棒输入）

- 前置 step 产出：Step 5 建议卡渲染就绪（协议格式已定稿，卡片组件暴露按钮点击回调）；协议格式见 plan.md 全局决策 6 回填
- 关键现状签名：
  - 引用芯片：`components/agent-chat/ChatInputArea.tsx` 引用芯片渲染；`hooks/useSendMessage.ts:330-362` 发送时把引用转为 `<conversation>`/`<note>` 标签注入消息文本
  - delegation 工具：`tools/delegation-tools.ts` CreateSession 建子会话+父子契约（**ForkSession 不走这条**）；delegation-bridge.ts:441 startChild 是子会话编排入口
  - 会话创建：`conversation-service.ts` create(workspaceId, groupId, title, modelSel)；组创建 group-service
  - 工具注册：文件末尾 registerTools()，命名 `dogear__` 前缀，zod 校验，错误 isError 不抛
  - 跳转：focusConversation 基建 + 「先切后高亮」铁律（跨工作区先 await setWorkspace）
- 关键决策回顾：ForkSession 创建独立平级会话——无父子契约、父会话不等交付、首条输入=分流摘要+用户当前消息；agent 只在收到 `<shunt>` 标签后执行

## 计划改动

- [ ] 输入框操作气泡：ChatInputArea 新增气泡类型（action + summary 展示，可删除）；同会话同时最多一个分流气泡（新点击覆盖旧的并确认）
- [ ] useSendMessage：气泡存在时发送文本前置注入 `<shunt action="new-session|new-topic|note" summary="...">用户补充文字</shunt>` 标签；无气泡则不注入（agent 不感知）
- [ ] 建议卡按钮接线 Step 5 的回调：点击 → 插入气泡（携带 action + 卡上 summary）
- [ ] 新工具 `electron/main/agents/tools/fork-session-tool.ts` `dogear__ForkSession`：
  - 参数：action（new-session/new-topic）、summary、userMessage、可选 title
  - 行为：new-session → 当前组内建会话；new-topic → 新建组+主会话；均为当前工作区；创建后**以摘要+用户消息作为首条输入自动发送**（复用 conversationRuntimeService attach + 发送链路，参考 delegation-bridge 创建后会话启动方式但不建契约不等交付）；返回新会话 id/标题/组信息
  - 仅主会话可用（子会话不注册）；`registerTools()` 注册元数据
- [ ] `dogear__CreateNote` 接线：action=note 时 agent 调现有工具，note 内容=summary+用户补充，tags 加 `分流暂存` 之类固定标记（回填定稿）
- [ ] 提示词补充：收到 `<shunt>` 标签时的行为约定（执行对应工具→简短回执→继续当前话题）；ForkSession 成功后回执中给出会话跳转（路径胶囊/focusConversation 链接）
- [ ] `bun run build:electron` + 手动验收

## 验收

- [ ] 完整链路：岔题 → 建议卡 → 点「另起话题」→ 气泡出现 → 补充一句 → 发出 → agent 调 ForkSession → 新组新会话出现且首条消息为摘要+补充 → 当前会话收到带跳转链接的简短回执，原话题上下文未被污染
- [ ] 「另起会话」落在当前组内（组树正确）
- [ ] 「记为笔记」笔记落盘且可在笔记面板看到
- [ ] 删除气泡后发送 = 普通消息，agent 无分流动作
- [ ] 会话正在运行时发出气泡走插话排队不丢（回归）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
