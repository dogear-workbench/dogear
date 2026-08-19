---
step: 3
title: 工具层与提示词
status: pending
---

## 目标

ListLinkedSessions 描述写明交付判定规则，ListGroupFiles 支持 relPath 按需读单个文件（默认只列清单），契约提示词对齐新模型。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2-remove-persistence.md] 持久层已删，补集截断 10 条已生效；快照字段为 `{ status: running|stopped, delivered, lastError?, task, outputPath, ... }`
- 当前关键文件状态：
  - `electron/main/agents/tools/delegation-tools.ts` — `ListLinkedSessions`（:155 附近调 getChildrenByParent）、`ResumeSession`（:326 起，含 status === 'running' 拦截与「不在运行时跟踪中」错误）
  - `electron/main/agents/tools/group-tools.ts` — `ListGroupFiles`（:11 起，当前「列全部文件并返回全部内容」）
  - `electron/main/agents/session-append-templates.ts` — `MAIN_AGENT_DELEGATION_APPEND` / `subAgentContractFor`
- 关键决策回顾：交付判定不持久化，靠 delivery 消息（主会话上下文）+ 共享区文件两个锚点；ListGroupFiles 默认轻量化是行为变更，需检查全部引用点；工具 isError 返回只陈述事实不引导改用其他工具（8-18 前缀改革纪律）

## 计划改动

- [ ] `delegation-tools.ts` `ListLinkedSessions` — 返回行增加 delivered 标记（如 `✅已交付` / `⚠未交付`）；工具描述写明判定规则：
  - `running` → 等通知，不用管
  - `stopped` + 你上下文中收到过 delivery 或共享区文件已存在 → 完成，别动
  - `stopped` + 无交付 → 可 ResumeSession 调起，子会话自检进度续跑
  - 声明 delivered 是运行时视角，应用重启后一律 false——以上下文记忆 / 共享区文件为准
- [ ] `delegation-tools.ts` `ResumeSession` — 描述补充「stopped 且未交付的子会话调起后它会检查进度从中断处继续」；`不在运行时跟踪中` 错误文案对齐（现在是「状态文件缺失」措辞，改为「本进程未跟踪（重启后请先用 ListLinkedSessions 查）」）
- [ ] `group-tools.ts` `ListGroupFiles` — 新增可选参数 `relPath`：传入则只读该文件内容（`readNativeFile`，找不到返回 isError 陈述事实）；不传则**只列清单**（relPath + 大小 + mtime，不再返回全部内容）；描述改为「列出共享区文件清单；传 relPath 读取单个文件内容」
- [ ] grep `ListGroupFiles` 全部引用点（`agent-worker.ts:442` 等代码级匹配 + 提示词提法）确认行为变更影响：提示词里「查看共享区产出」类引导改为「列表后按需读」
- [ ] `session-append-templates.ts` — `MAIN_AGENT_DELEGATION_APPEND`：交付判定规则（收 delivery 消息为准）、ListGroupFiles 按需读引导；`subAgentContractFor`：子会话侧「查看共享区已有产出」措辞对齐（列表 + relPath 读）
- [ ] `agents/group-context-builder.ts` / 其他含 ListGroupFiles 提法的提示词（grep 确认）同步

## 验证

- `bun run build:electron` + `bun test` 全绿
- dev 手动：主会话 ListGroupFiles 不带参数 → 只有清单；带 relPath → 单文件内容；读不存在路径 → isError 且无「请改用」引导
- 工具描述里 grep 无「请改用 / 请使用 Xxx 工具」类引导文本

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
