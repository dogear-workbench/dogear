---
step: 6
title: 测试基建与基线
status: pending
---

## 目标

六类本地测试页 + 15 个标准任务 + runner 跑通，产出便宜档成功率基线，回填未决问题（翻页拼接是否补做）。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-5] 全链路可用（BrowserManager / readArticle / tipc 编排 / Agent 工具 / 动作流面板）
- 关键决策：两层用途——管线回归（零模型，断言 readArticle 确定性输出）与 Agent 任务层（便宜档模型跑标准任务，量化成功率）；测试页放 `resources/browser-eval/`（随应用分发，dev 亦可用）

## 计划改动

- [ ] `resources/browser-eval/` 六类页面（纯 HTML + 内联 JS，file:// 可跑；若 file:// 下 JS 注入受限则加极简静态 serve 脚本，实施时定）：
  1. `spa-article.html` — 正文由 JS 延迟 2s 注入（静态抓取空壳）
  2. `collapsed.html` — 「展开全文」按钮控制正文显隐
  3. `paged.html` — 3 页翻页（下一页按钮）
  4. `login-wall.html` — 密码框 + 正文仅在 sessionStorage 标记后显示（mock 登录：填任意值提交即过）
  5. `lazy-images.html` — 懒加载图片长文
  6. `odd-container.html` — 正文容器非标准结构（考验 Readability 兜底）
  每页正文埋唯一标记文本 + 已知字数供断言
- [ ] `resources/browser-eval/tasks.json`：15 个标准任务（六类页面各 2-3 个 readArticle 任务 + 降级探索任务「用原子工具找到某段文字」+ 登录墙任务），每个含 url、期望断言（标记文本包含 / 字数阈值 / errorClass）
- [ ] `resources/browser-eval/run-pipeline.mjs`：Node 脚本直调 `readArticleWithBrowser` 跑断言，输出成功/失败报告（dev 下 `bun resources/browser-eval/run-pipeline.mjs`）
- [ ] Agent 任务层基线：用「浏览器解析」子会话 Profile（便宜档模型 + 浏览器工具包，设置页手工配置一次）跑 15 任务中的探索类任务，记录成功率到 `resources/browser-eval/baseline.md`
- [ ] 回填决策：翻页场景失败率 → 翻页拼接是否需要补做（超出阈值则追加实现，否则记入二期）
- [ ] 完成 `plan.md` 末尾「完成总结」

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
