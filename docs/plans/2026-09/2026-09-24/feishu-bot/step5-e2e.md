---
step: 5
title: 端到端联调（用户参与）
status: in_progress
---

## 目标

真实凭证走通全链路：配置 → 连接 → 私聊遥控 → 卡片回复；修联调问题；文档收尾。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step4-renderer-ui.md] 的完整 UI 流程；[step3-bot-controller.md] 的消息链路
- 关键决策回顾：只处理 p2p + text；错误场景见设计文档「错误处理」表

## 计划改动（联调清单）

- [ ] 用户操作（用户本人）：按 SetupGuide 在开放平台完成应用创建/权限/发布，复制凭证填入 Dogear
- [ ] 走查「测试连接」三层结果：secret 错误文案 / 权限缺失文案 / 成功连接
- [ ] 飞书私聊发 `/help` → 收到命令列表（纯文本）
- [ ] `/ws` → `/ws 1` → `/ls` → `/use 1` → `/new` → `/stop` 逐条验证
- [ ] 普通文本 → Agent 回复以卡片回到私聊（验证 markdown 渲染：代码块/列表/链接；含表格的回复验证降级）
- [ ] 超长回复（让 Agent 写一篇长的）→ 验证拆条
- [ ] 重启 Dogear → 验证自动重连、Bot 绑定状态恢复
- [ ] 断网/恢复 → 验证重连与状态徽标
- [ ] 联调问题修复 + 各 step 文档回填 + plan.md 打勾 + 完成总结
- [ ] doc-sync：chat.md（飞书条目）/ infra.md（tipc）代码地图更新

## 实施回填（做完后填）

### 实际改动
- 与计划差异：本 step 拆为两部分——doc-sync 代码地图更新已无人值守完成；真实凭证联调需用户本人参与，待进行
- 改动文件清单：
  - `docs/codebase-map/index.md`：chat.md 聊天词补「飞书」关键词
  - `docs/codebase-map/chat.md`：feishu/ 组件、feishu-store、services/feishu/ 四文件条目
  - `docs/codebase-map/infra.md`：feishu tipc 十条路由 + renderer 三事件 + feishu/config.json 存储
  - `docs/codebase-map/agent-core.md`：conversation-runtime-service 多附件绑定补 feishu-bot

### 给下一步的接力棒
- 遗留问题（如群聊 @bot、图片消息等已识别未做项）：
  - **待用户**：按 SetupGuide 在开放平台创建应用（七步引导），真实凭证走通全链路（测试连接三层结果 / 斜杠命令 / 卡片回复 / 拆条 / 自动重连）
  - 已知限制：@bot mentions 占位符未剥离（p2p 一般不含）；群聊 @bot、图片消息未支持（设计文档已列为不做项）
