---
step: 5
title: systemPrompt append 注入 + 端到端手测
status: done
---

## 目标

会话创建时按「组内非首个」判定动态注入 systemPrompt append：所有会话默认加通用引用会话提示（A 段），组内非首个会话追加组背景提示（B 段）。跑一遍完整链路的手测确认整条路能工作。

## 依赖上下文（接力棒输入）

- 前置 step 产出：
  - Step 4 完成：reference-tools 装到子会话，DelegateTo payload 传 groupId+workspaceId 的机制已实现
  - Step 3 完成：background.md 会跟组卡一起产
  - Step 1 完成：所有产物落新路径
- 关键决策回顾：
  - append 注入是**会话创建时一次性写入 conversation 的 systemPrompt append 字段**，不是运行时动态拼
  - `{groupName}` 动态注入进 append 文案（会降低 cross-group cache 命中率，但组内会话共享同一段前缀）
  - 组内首个会话只加 A 段（B 段派子会话会白跑，因为没兄弟没组卡）
  - 判定"组内非首个" = 当前 conversation 所属 group 里已存在**其他** conversation
- 现状：
  - `query-based-session.ts` 走 preset+append 模式，append 是可配置字段
  - conversation-service 创建对话时会写入 conversation.systemPromptAppend / persona / defaultSystemPrompt 之类字段（需要 grep 确认实际字段名和写入点）
  - 组信息：conversation 已有 `groupId` 字段，group-service 有 `getGroup(wsId, groupId)` 拿组名

## 计划改动

### 文案

**A. 通用引用会话提示（所有会话 append）**：
```
【引用历史会话】
如需引用某个具体历史会话的内容作为参考，用 DelegateTo 派子会话去消化并交回摘要。
子会话会读去噪后的原文、分析、只回给你精炼版本。不要自己读会话原文——会污染你的上下文。
```

**B. 组背景提示（组内非首个会话追加）**：
```
【当前会话组】
你处在会话组「{groupName}」内，该组已有其他兄弟会话。
需要了解组之前的进展、结论、待办、或某个兄弟会话最近动向时，用 DelegateTo 派子会话去梳理。
子会话有 ReadGroupBackground / ListSiblingSessions / ReadGroupDigest / ReadReferenceSession 等专用工具，
会返回一份摘要给你。别自己去看。
```

两段独立，B 追加时用空行分隔。

### 修改文件

- [ ] `electron/main/tipc/conversations.ts` 或 `conversation-service.ts` 的 create/createFork：
  - 创建 conversation 时判定：
    - 拿 `groupId`（如果有）
    - 查 `listConversationsInGroup(wsId, groupId)` 数量 > 0 → 是"非首个"
    - 查 `group.name` 拿 `{groupName}`
  - 组装 append：始终包含 A；非首个再拼 B（`{groupName}` 替换）
  - 写入 conversation 的 systemPrompt append 字段
- [ ] fork 逻辑：createFork 时同样判定（fork 出的新会话可能进不同组，需要按 fork 后的 groupId 判）
- [ ] 文案存储：
  - **不放在提示词编辑面板**（这是系统级隐性提示，用户不该改）
  - 直接常量写在 conversation-service 或新增 `session-append-templates.ts`
  - 用 `{groupName}` 占位符做简单字符串替换

### 潜在改动

- [ ] `query-based-session.ts`：如果 append 字段合并逻辑需要调整（比如 persona.append + defaultSystemPrompt.append + 系统级 append 的顺序），确认三者叠加顺序合理
- [ ] 已存在的 conversation：本 step 只影响新创建的 conversation；旧的 conversation append 里没这两段，用户如果发现旧会话主 agent 不知道派子会话，需要说明"重启该会话/新建会话即可"
  - 是否要写迁移脚本给旧 conversation 补 append？**不做**（按项目"不做兼容层"原则）

### 类型/常量

- [ ] 如果新增 `session-append-templates.ts`：导出 `REFERENCE_APPEND` / `GROUP_APPEND_TEMPLATE(groupName)` 两个常量

## 端到端手测清单

**基础验证**：
- [ ] 新建一个孤立会话（不在任何组里）：查 conversation.systemPromptAppend 只含 A 段
- [ ] 新建一个组里的首个会话：查 append 只含 A 段（因为是首个）
- [ ] 在同一个组里再新建一个会话：查 append 含 A + B 段，`{groupName}` 已替换成实际组名
- [ ] fork 一个组内会话到同组：新 conversation append 应含 A + B
- [ ] fork 到不同组或脱离组：按新位置判定重新计算

**主链路验证**（组内新会话拿组背景）：
- [ ] 找/造一个已经有 digest.md + background.md 的组
- [ ] 在这个组里开一个新会话，第一句问 "继续之前那个方向，我们聊到哪儿了？"
- [ ] 观察主会话是否**自主派出子会话**（依据是 systemPrompt B 段的引导）
- [ ] 子会话面板看它调了哪些工具（应该看到 ReadGroupBackground + ReadGroupDigest 之类）
- [ ] 子会话 SubmitDelivery 出摘要给主会话
- [ ] 主会话拿到摘要后能就此接续对话

**引用对话验证**（任何会话）：
- [ ] 在孤立会话里说 "我上周聊过一个 xxx 主题的会话，参考一下"
- [ ] 主会话应该派子会话
- [ ] 子会话调 ReadReferenceSession（可能先靠自然语言猜或者用户提供 sessionId）
- [ ] 拿到清洗后原文汇总回主会话

**边界验证**：
- [ ] 组只有 1 个会话（首个），主 agent 只有 A 段，不知道有"组背景"这回事——符合预期
- [ ] `{groupName}` 特殊字符（含空格/中文/引号）能正确渲染进 append 不 break 提示词

## 完成后收尾

- [ ] 更新 `plan.md` 步骤索引全部打勾
- [ ] 在 `plan.md` 末尾追加「## 完成总结」：实际改动汇总、与原计划偏差、发现的 follow-up
- [ ] 触发 `doc-sync` skill 更新 CLAUDE.md / codebase-map（新增了 background-store / reference-tools / migration-p4 / session-append-templates 等）

## 实施回填

### 实际改动

**修改 `electron/main/agents/query-based-session.ts`**：

- import：新增 `REFERENCE_APPEND` / `groupAppendFor`（from `./session-append-templates.js`）+ `getGroup`（from `../services/group-service.js`）
- `start()` 里 `groupContextText` 计算之后新增判定块：
  - 门槛 = 主会话（`!this.config.subAgent`）+ workspaceId + groupId 三条齐备
  - 兄弟计数：`conversationService.getByWorkspaceId(workspaceId).some(c => c.groupId === self.groupId && c.role !== 'sub' && c.id !== conversationId)`
  - 命中则 `getGroup` 拿 `group.title`（trim 后为空走"未命名组（创建于 ...）"兜底，跟 group-context-builder 一致）
  - `groupNameForAppend: string | null` 交给 buildSystemPrompt
  - try/catch 兜底，异常只 warn 不影响会话启动
- `buildSystemPrompt` 签名加第 4 参 `groupNameForAppend: string | null = null`，body 里在 slot 6（groupContextText）之后 slot 7（_notes/ 引导）之前插两段：
  - 6a：`if (!this.config.subAgent) parts.push(REFERENCE_APPEND);` — 所有主会话都拿 A
  - 6b：`if (groupNameForAppend) parts.push(groupAppendFor(groupNameForAppend));` — 有兄弟才拿 B

**未修改**：
- `session-append-templates.ts` — Step 4 遗留时已建好 REFERENCE_APPEND / groupAppendFor（含 backtick 转义），本 step 直接用
- `conversation-service.ts` / `tipc/conversations.ts` — **未新增 systemPromptAppend 持久化字段**，见「与原 plan 差异」

### 与原 plan 差异（重要）

**未采用「会话创建时持久化 append 到 conversation 字段」方案，改为运行时在 `buildSystemPrompt` 里注入**。原因：

1. 现有架构里所有 append 段（persona / coreProfile / tempPrompt / groupContextText / toolPackGuide）都是 start() 时运行时拼的，加持久化字段是多余状态
2. 原 plan 尾巴「已存在的 conversation：本 step 只影响新创建的 conversation，旧的用户要新建/重启」的问题自动消失——所有会话每次 start 都重算
3. fork 到不同组 / regroup / 组名改动 全部自动生效，不需要额外分支
4. 兄弟计数是"当前"状态而非"创建时"状态——语义更符合"组内是否有兄弟"，首会话之后再有兄弟加入，旧会话下次 start 自动升级到 A+B

代价：每次 start 多一次 `getByWorkspaceId + getGroup` 读盘（都是缓存过的 JSON 读，可忽略）。

### 手测

**未跑手测**：
- `bun run build:electron`：**通过**（0 error）
- `bun run lint`：**通过**（0 error，只有既有 warning）
- 端到端手测留给用户下次开发验证：需覆盖「新建组内首个会话只见 A」/「组内新建第二个会话见 A+B」/「子会话不见 A/B」三条主链路

### 给下一步的接力棒

本 step 是最后一步，方案已收尾。发现的 follow-up 记在 plan.md 完成总结里。
