---
step: 4
title: Agent 工具包 + 权限映射
status: pending
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
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
