---
step: 4
title: Agent 工具包 + 权限映射
status: done
---

## 目标

`dogear-browser` 工具包落地：readArticle 声明式工具 + 原子工具集（observe 压缩 + ref 定位协议）+ permission-rules 映射 + 能力域注册。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step2] `readArticleWithBrowser` 可直接复用；[step1] BrowserManager acquire 供原子工具
- 当前关键文件状态：`agents/tools/tool-registry.ts` 的 `registerToolGroup({ server, label, create, placeholder })` 模式（参考 `article-tools.ts` / `stock-announcement-tools.ts`）；`permission-rules.ts` 的 `decideToolPermission`：autoExecute 放行 / 工具包放行 / 基础工具快照 / 其余 ask
- 关键决策：「工具包放行」**不覆盖** `readArticle/click/fill` 三工具（default 模式仍逐次确认）；observe 返回带 ref 编号的结构化清单 + 体积上限

## 计划改动

- [ ] 新建 `agents/tools/browser-tools.ts`，`registerToolGroup({ server: 'dogear-browser', label: '浏览器', ... })`：
  - `dogear__browser__readArticle(url)`：调 readArticleWithBrowser；`need_login` 返回结构化提示（指引 Agent 告知用户窗口已打开、等待用户登录后由用户重试或 Agent 重调）；结果附字数与 quality 信号
  - 原子工具（均走 BrowserManager acquire，单步 30s 超时）：
    - `navigate(url)` → 返回 URL/标题/正文容器字数摘要
    - `observe_page()` → 可交互元素结构化清单：`{ ref, tag, role, text(截断80字), hint(placeholder/aria) }`，总数上限 120 条、超出提示按 `region`（视觉分块）或 `text_filter` 参数二次查询；内部实现 ref→selector 映射表（存内存 Map，随页面导航失效重建）
    - `click(ref)` / `fill(ref, value)` → 执行后自动带轻量验证（URL 变化 / 目标元素消失 / 正文字数变化）
    - `read_text(ref?)` → 元素或正文容器纯文本（上限 + 截断提示）
    - `wait_for(text | url_contains, timeout)`
    - `screenshot()` → 截图存临时文件返回路径（图片附件机制对齐现有 Read 图片路径返回模式）
    - `close()` → 释放任务（浏览器实例交给空闲关闭策略）
  - 错误一律 `isError: true`
- [ ] `permission-rules.ts`：浏览器只读工具入工具包放行集；`readArticle/click/fill` 加特判——default 模式 ask、autoExecute 放行，工具包启用不覆盖
- [ ] `app/settings/ability-types.ts`：`SKILL_PACK_MAP` / `ABILITY_DOMAINS` 增浏览器域映射（无独立 skill，作为工具包域注册；若结构要求 skill 才成域，则挂通用域，以实际结构为准）
- [ ] 提示词：`session-append-templates.ts` 或工具 description 内写清「优先 readArticle、失败再原子探索、need_login 时告知用户」的使用纪律

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. **浏览器工具包挂到 article 能力域**（非独立域）：`buildDomainViews` 对无 skill 的域直接跳过（`domainSkills.length === 0 → continue`），结构要求 skill 才成域；故 `SKILL_PACK_MAP['article-parser']` 加 `'browser'`，浏览器包作为文章解析 skill 的关联包出现在「文章解析」域。副作用（语义正确）：开/关 article-parser skill 会联动开/关 browser 包（AbilityTab 既有 keptByOthers 逻辑保护共享包）；browser 包仍可独立开关。同时 `tool-packs.ts` OPTIONAL_TOOL_PACKS 加 browser 条目（设置页 UI / pi-session 循环 / tool-pack-guide 导览同源）
  2. **挂载点 4 处**（计划未列但工具包落地必需）：pi-session.ts 主会话 switch 加 `case 'browser'`（传 conversationId）；tipc/agent.ts getRegisteredTools 动态 import 列表加 browser-tools（不加则设置页列不出）；scheduler custom-agent-tools.ts 加 browser 包装配（与 listToolPacks UI 一致，不传 conversationId）；子会话 buildSubAgentToolDefs **暂不挂载**（SubAgentEnabledAbilities 无 browser 字段，动它要连 settings UI + 类型镜像，超出本步边界，写进交付文档给后续）
  3. **onAction 接线用模块级 hook**：browser-tools.ts 导出 `setBrowserToolsActionListener()`，readArticle 把 readArticleWithBrowser 的 BrowserArticleActionEvent 转发进 hook，原子工具自发 BrowserToolsActionEvent（source + taskMeta + action 扩展了 fill/read_text/wait_for/screenshot/close）。step5 接动作流只需 import 此函数注册监听，工具层零再改
  4. **screenshot 返回路径文本**（计划原文「对齐 Read 图片路径返回模式」）：现有结构下即「返回路径 → Agent 用 Read 工具读图」（pi-agent-core Read 原生支持图片附件）；tool-adapter.ts 的 ToolResult 只支持 text content，不支持 image 块，改造超出本步
  5. **close 是语义收尾**：BrowserManager 无公开立即关闭 API（dispose 会拒绝后续任务，不能用于此处），且原子工具每次 acquire→操作→release 本就即时释放；close 实现为清空 ref 映射表 + 提示空闲策略（约 3 分钟自动关），不 acquire（避免为关而启动）
  6. **evaluate 全部走 `new Function` 构造函数对象**（step2 踩坑沿用：主进程 tsconfig 无 DOM lib，内联箭头函数编译报错）；`page.$eval` 的期望值必须走第三参传入（闭包变量不会序列化到浏览器上下文，实测踩坑）
- 改动文件清单：
  - `electron/main/agents/tools/browser-tools.ts`（**新增**，~640 行）：9 工具 + registerToolGroup + setBrowserToolsActionListener
  - `electron/main/services/tool-packs.ts`：OPTIONAL_TOOL_PACKS 加 browser 条目
  - `electron/main/agents/pi-session/pi-session.ts`：import + 主会话 switch case 'browser'
  - `electron/main/agents/pi-session/permission-rules.ts`：BROWSER_INTERACTIVE_TOOLS 特判（default 模式 ask，在 toolPackMap 放行之前）
  - `electron/main/agents/pi-session/permission-rules.test.ts`：加 3 个浏览器权限用例
  - `electron/main/tipc/agent.ts`：getRegisteredTools import 列表加 browser-tools
  - `electron/main/services/scheduler/custom-agent-tools.ts`：browser 包装配
  - `app/settings/ability-types.ts`：SKILL_PACK_MAP['article-parser'] 加 'browser' + article 域描述更新

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - `setBrowserToolsActionListener((event: BrowserToolsActionEvent) => void | null)` —— step5 动作流接入点；BrowserToolsActionEvent = `{ source, taskMeta, action, url?, detail?, result? }`，source 取工具短名（'readArticle'/'navigate'/'click'/'fill'/'observe_page'/'read_text'/'wait_for'/'screenshot'/'close'），action 兼容 BrowserArticleAction（'navigate'|'wait'|'click'|'observe'|'parse'）并扩展 'fill'|'read_text'|'wait_for'|'screenshot'|'close'，taskMeta 为 `{ kind: 'agent', conversationId? }`
  - `createBrowserToolDefs(opts?: { conversationId?: string }): ToolDef[]`；pi-session 已传 conversationId，scheduler 不传
  - ref 协议：observe_page 给元素打 `data-dogear-ref="eN"` 属性，模块级 Map 存 ref→selector；navigate/readArticle 成功后清空、click 触发导航（URL 变化）时清空；click/fill/read_text 用未知 ref 会 isError 并提示重新 observe_page
- 下个 step 该从哪里继续：step5 伴随面板 + 动作流。在动作流服务初始化处调 `setBrowserToolsActionListener()` 接进环形缓冲；事件里 taskMeta.conversationId 可做归属过滤。注意 step3 的 tipc 手动解析路径（readArticleWithBrowser kind 'article'）动作不经过本 hook——如要同屏展示需像 step3 那样在 tipc/article.ts 传 onAction
- 待办或已知限制：
  - 子会话不可用浏览器工具包（SubAgentEnabledAbilities 未加 browser 字段）；设计文档的「浏览器解析子会话 Profile」需先补该字段 + settings UI
  - observe 的 region 是视口垂直三等分（top/middle/bottom），非设计文档的「视觉分块」完整实现；无滚动，视口外元素不可见即不列出（可配合 wait_for/read_text 使用）
  - 原子工具互相独立 acquire/release（队列串行），跨调用无页面状态锁；Agent 在两工具间页面可能被其他任务（手动解析）导航——ref 验证兜底会报错提示重查，不会误操作
  - readArticle 的 need_login 消息文本已内置「告知用户窗口已打开」的指令，未另加 session-append-templates 段（工具 description 承载使用纪律，避免全局提示词膨胀）
