---
step: 3
title: 工具层与提示词
status: done
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

- [x] `delegation-tools.ts` `ListLinkedSessions` — 返回行增加 delivered 标记（如 `✅已交付` / `⚠未交付`）；工具描述写明判定规则：
  - `running` → 等通知，不用管
  - `stopped` + 你上下文中收到过 delivery 或共享区文件已存在 → 完成，别动
  - `stopped` + 无交付 → 可 ResumeSession 调起，子会话自检进度续跑
  - 声明 delivered 是运行时视角，应用重启后一律 false——以上下文记忆 / 共享区文件为准
- [x] `delegation-tools.ts` `ResumeSession` — 描述补充「stopped 且未交付的子会话调起后它会检查进度从中断处继续」；`不在运行时跟踪中` 错误文案对齐（现在是「状态文件缺失」措辞，改为「本进程未跟踪（重启后请先用 ListLinkedSessions 查）」）
- [x] `group-tools.ts` `ListGroupFiles` — 新增可选参数 `relPath`：传入则只读该文件内容（`readNativeFile`，找不到返回 isError 陈述事实）；不传则**只列清单**（relPath + 大小 + mtime，不再返回全部内容）；描述改为「列出共享区文件清单；传 relPath 读取单个文件内容」
- [x] grep `ListGroupFiles` 全部引用点（`agent-worker.ts:442` 等代码级匹配 + 提示词提法）确认行为变更影响：提示词里「查看共享区产出」类引导改为「列表后按需读」
- [x] `session-append-templates.ts` — `MAIN_AGENT_DELEGATION_APPEND`：交付判定规则（收 delivery 消息为准）、ListGroupFiles 按需读引导；`subAgentContractFor`：子会话侧「查看共享区已有产出」措辞对齐（列表 + relPath 读）
- [x] `agents/group-context-builder.ts` / 其他含 ListGroupFiles 提法的提示词（grep 确认）同步

## 验证

- `bun run build:electron` + `bun test` 全绿
- dev 手动：主会话 ListGroupFiles 不带参数 → 只有清单；带 relPath → 单文件内容；读不存在路径 → isError 且无「请改用」引导
- 工具描述里 grep 无「请改用 / 请使用 Xxx 工具」类引导文本

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - 超出计划清单但必要的同步：`delegation-terminal.ts:103` no_delivery 终态通知「检查共享区是否已有交付」→「列共享区文件清单确认是否已有交付文件」；`agent-worker.ts:490` digest 注入「可读取完整内容」→「传 relPath 可读单个文件内容」；`resources/skill-templates/stock-picking/SKILL.md` 两处「读报告」→「列清单 + 传 relPath 读」（属计划 grep 引用点确认项的落地）
  - `group-digest-prompt.ts` 除改 DEFAULT 文案外，按该文件头注释「语义调整时同步哨兵」惯例新增 LEGACY_LIST_FULL_CONTENT 旧特征检测：磁盘模板含「返回结果含每个文件的完整内容」时覆盖重播种（存量模板在新工具行为下是错误陈述）
  - ListLinkedSessions 渲染未加 lastError 字段（计划只要求 delivered 标记，保持最小改动）
- 改动文件清单：electron/main/agents/tools/group-tools.ts（ListGroupFiles 加 relPath 参数、默认只列清单）、electron/main/agents/tools/delegation-tools.ts（LIST_LINKED_DESC 判定规则 + RESUME_SESSION_DESC + 渲染加 ✅已交付/⚠未交付 + Resume 错误文案去「状态文件」措辞）、electron/main/agents/session-append-templates.ts（MAIN_AGENT_DELEGATION_APPEND 加交付判定/按需读引导、subAgentContractFor 加共享区已有产出一行、GROUP_CONTEXT_EXAMPLE + triggerDescription 对齐）、electron/main/agents/group-context-builder.ts（注入文案 + 头注释对齐）、electron/main/agents/agent-worker.ts（:490 注入文案）、electron/main/agents/delegation-terminal.ts（no_delivery 通知文案）、electron/main/services/memory/group-digest-prompt.ts（DEFAULT 步骤 3 改按需读 + 旧特征重播种哨兵）、resources/skill-templates/stock-picking/SKILL.md（两处按需读）

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `dogear__ListGroupFiles` schema：`{ relPath?: string }`；不传 → 清单（`- relPath (x KB, 时间)` 一行一文件 + 尾部「需要完整内容时传 relPath」提示）；传 relPath → 文件全文；ENOENT → isError「共享区不存在文件 <relPath>」
  - ListLinkedSessions 渲染行：`sessionId=… · title · status=running|stopped · ✅已交付|⚠未交付 · outputPath=… · task=… · 你派出的`
- 下个 step 该从哪里继续：step4（前端 UI：子会话图标换 Network、状态模型 running|stopped + delivered 渲染、docs/codebase-map.md 同步——包括ListGroupFiles/ResumeSession 描述更新与 delegation-persist 条目删除）
- 待办或已知限制：
  - docs/standards/tool-description-guide.md:66 与 tool-description-changes.md:83 里 ListGroupFiles 的「好示例」描述已过时（仍写「并返回内容」），属文档非提示词，未纳入本步
  - dev 手动验证（主会话真实调 ListGroupFiles 三路径 + ListLinkedSessions 看到 delivered 标记）未在子会话环境执行，留给主会话 dev 冒烟；行为级验证已用临时脚本（DOGEAR_CONFIG_DIR 隔离）跑通三路径
  - `package.json` version 0.1.40→0.1.41 的 diff 是其他流程改动，非本步产物
