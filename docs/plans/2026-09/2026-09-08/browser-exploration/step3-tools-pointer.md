---
step: 3
title: extension-tools +2 工具 + navigate 指针
status: done
---

## 目标

工具层接入站点档案：`site_knowledge`（读）/ `site_finding`（追加）+ navigate 返回尾部指针。

## 依赖上下文（接力棒输入）

- 前置 step 产出：Step 2 的 site-knowledge-service（签名见其接力棒回填）
- 当前关键文件状态：`electron/main/agents/tools/extension-tools.ts`（~660 行）6 工具 + ownership gate + registerTools 范式；navigate 返回由 formatNavigate 或对应 formatter 拼装；browser-gateway tab snapshot 有当前 url
- 关键决策回顾：site_knowledge 无参（自动取当前通道 tab 域名）；无档案是正常态非错误；工具命名 `mcp__{server}__{tool}` 规范下实际注册名为 `dogear__extension__*`；错误 isError 中文文案；agent 工具注册用文件末尾 registerTools()

## 计划改动

- [ ] `extension-tools.ts` 加 `dogear__extension__site_knowledge`（无参，zod schema 空对象）：从 gateway tab snapshot 取 url 提取域名 → readSiteKnowledge → 有档案返回两区内容；无档案返回「本站暂无档案」+ 探索鼓励话术。过 ownership gate（与其他 6 工具同待遇）+ policyGate？——**不过 policyGate**（读本地文件无页面交互，不占风控节奏；同理 site_finding 也不过）
- [ ] 加 `dogear__extension__site_finding`（参数：finding string）：appendSiteFinding；成功返回「已追加到发现区，待审核合并」
- [ ] navigate 工具返回尾部：目标 url 域名 hasSiteKnowledge 为真时附一行「本站有站点档案，建议先调 dogear__extension__site_knowledge 获取已知地图」
- [ ] 顺手评估：extension-tools.ts 已 660 行，本步 +2 工具后按「>300 行考虑拆分」惯例拆出 `extension-site-tools.ts`（或实施者判断更合理的切分）
- [ ] 冒烟 `resources/browser-eval/extension-site-tools-smoke.mjs`：注册元数据 / 指针拼接 / 无档案态文案

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无实质差异。细节取舍：① acquireGate 的 action 参数放宽为 `BrowserActionType | null`——site 两工具过 ownership gate 同待遇，但 busy 拒绝不记动作流（档案读写非页面操作，BrowserActionType 无对应枚举，不扩渲染层契约）；② 断连/域名解析失败时 site_knowledge/site_finding 返 isError（无法确定当前站点 ≠ 无档案正常态）；③ extension-tools.ts 改后约 720 行，site 工具 + 指针逻辑全部在新文件，主文件不再增长。
- 改动文件清单：
  - `electron/main/agents/tools/extension-site-tools.ts` **新建**（约 120 行）：`createSiteToolDefs(deps)` 返回 site_knowledge / site_finding 两 ToolDef；`siteKnowledgePointer(url)` 导出供 navigate 拼指针；deps 注入 conversationId / acquireGate / currentUrl / isErrorResult / textResult / scopeNote，不复制 helper
  - `electron/main/agents/tools/extension-tools.ts`：acquireGate 支持 action=null（busy 不 emitAction）；navigate 成功返回尾部拼 `siteKnowledgePointer(urlAfter ?? args.url)`；返回数组尾部 `...createSiteToolDefs({...})` 组合（单 registerToolGroup 不变）；文件头注释更新
  - `resources/browser-eval/extension-site-tools-smoke.mjs` **新建**：node 冒烟 16 断言全 PASS（复用 electron-hooks stub + dist copy + pipe 改名 + tab_snapshot mock）
- 验收：bun run lint 0 errors；build:electron 通过；新冒烟 16/16；site-knowledge-smoke 26/26、extension-ownership-smoke 18/18、run-pipeline 27/27 无回归

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `createSiteToolDefs(deps: SiteToolDeps): ToolDef[]`，SiteToolDeps = { conversationId?, acquireGate(action: BrowserActionType | null, detail, url?), currentUrl(), isErrorResult(msg), textResult(text), scopeNote }；extension-tools.ts 组合调用点在返回数组尾部
  - `siteKnowledgePointer(url?: string): string | null`：有档案返回 `\n\n本站有站点档案，建议先调 dogear__extension__site_knowledge 获取已知地图`，否则 null
  - site_knowledge 无参；site_finding 参数 { finding }；两工具域名均取自 currentUrl() → normalizeDomain
- 下个 step 该从哪里继续：Step 4（settings Profile 方法论重构 + description 迁移，设计文档模块边界表第 3、4 行）；工具层无需再动，extension-site-tools.ts 已闭环
- 待办或已知限制：site 工具 busy 拒绝不进动作流（见与计划差异①）；rival 会话冒烟需独立 createExtensionToolDefs 实例（handler 闭包绑死 conversationId，复用实例不会触发 busy）
