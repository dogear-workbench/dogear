---
step: 6
title: Agent 工具面 + 聊完存卡纪律
status: pending
---

## 目标

注册 dogear-notes MCP server（7 个基础工具），主会话系统提示加「聊完方案存卡」纪律，端到端跑通「对话建卡 → 列待办 → 勾选完成」。

## 依赖上下文（接力棒输入）

- 前置 step 产出：读 step1 回填拿 notes-service 签名（工具直接调 service，不绕 tipc）
- 工具注册范式：`electron/main/agents/tools/article-tools.ts`（server: dogear-article，zod schema，`registerToolGroup` 文件末尾注册，错误 `{content:[...], isError:true}` 不抛异常）；批量挂载与 placeholder 写法参照 `delegation-tools.ts` 末尾 `registerToolGroup` 调用
- 前端工具列表走 `client.getRegisteredTools()` 动态获取，**不硬编码**（项目级硬决策）
- 提示模板：`electron/main/agents/session-append-templates.ts:20` 附近是主会话协作纪律注入区

## 计划改动

- [ ] `electron/main/agents/tools/notes-tools.ts`：server `dogear-notes`，7 工具（zod 严格校验）
  - `dogear__CreateNote({content, tags?, links?, todos?})`
  - `dogear__GetNote({noteId})`（返回 frontmatter + 正文）
  - `dogear__SearchNotes({query?, tag?})`
  - `dogear__AppendNote({noteId, content})`
  - `dogear__UpdateNote({noteId, patch})`——patch 里 todos 按整体数组替换（todo 用 id 定位，改 status 等）
  - `dogear__DeleteNote({noteId})`（软删除）
  - `dogear__ListTodos({status?, hasPlan?})`
  - workspaceId 从工具挂载 opts 拿（参照 article-tools 的上下文注入方式）
- [ ] `session-append-templates.ts`：主会话纪律追加一条——「与用户聊完方案/设计并落盘 plan 文档后，调 dogear__CreateNote 存一张卡片：正文一句话摘要，todos 含『实施 <计划名>』且 plan 字段填 plan.md 路径；用户说『把待办里能做的做了』时，用 dogear__ListTodos(hasPlan) 找可实施项，按 staged-execution 纪律执行，完成后 UpdateNote 置 done 并 AppendNote 结果摘要。普通待办（无 plan）只读不动。」
- [ ] `bun run build:electron` 后在应用内真实会话端到端：让 agent 建卡（带 #tag、带 plan 待办）→ ListTodos 看到 → UpdateNote 勾选 → 笔记 Tab 待办视图同步显示已勾选

## 验证

- 端到端手测（上述全流程）+ 前端设置里 getRegisteredTools 能看到 dogear-notes 组 + `bun run lint`

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
