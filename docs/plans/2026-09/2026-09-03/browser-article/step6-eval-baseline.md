---
step: 6
title: 测试基建与基线
status: done
---

## 目标

六类本地测试页 + 15 个标准任务 + runner 跑通，产出便宜档成功率基线，回填未决问题（翻页拼接是否补做）。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step1-5] 全链路可用（BrowserManager / readArticle / tipc 编排 / Agent 工具 / 动作流面板）
- 关键决策：两层用途——管线回归（零模型，断言 readArticle 确定性输出）与 Agent 任务层（便宜档模型跑标准任务，量化成功率）；测试页放 `resources/browser-eval/`（随应用分发，dev 亦可用）

## 计划改动

- [x] `resources/browser-eval/` 六类页面（纯 HTML + 内联 JS，file:// 可跑；若 file:// 下 JS 注入受限则加极简静态 serve 脚本，实施时定）：
  1. `spa-article.html` — 正文由 JS 延迟 2s 注入（静态抓取空壳）
  2. `collapsed.html` — 「展开全文」按钮控制正文显隐
  3. `paged.html` — 3 页翻页（下一页按钮）
  4. `login-wall.html` — 密码框 + 正文仅在 sessionStorage 标记后显示（mock 登录：填任意值提交即过）
  5. `lazy-images.html` — 懒加载图片长文
  6. `odd-container.html` — 正文容器非标准结构（考验 Readability 兜底）
  每页正文埋唯一标记文本 + 已知字数供断言
- [x] `resources/browser-eval/tasks.json`：15 个标准任务（六类页面各 2-3 个 readArticle 任务 + 降级探索任务「用原子工具找到某段文字」+ 登录墙任务），每个含 url、期望断言（标记文本包含 / 字数阈值 / errorClass）
- [x] `resources/browser-eval/run-pipeline.mjs`：Node 脚本直调 `readArticleWithBrowser` 跑断言，输出成功/失败报告（dev 下 `bun resources/browser-eval/run-pipeline.mjs`）
- [x] Agent 任务层基线：用「浏览器解析」子会话 Profile（便宜档模型 + 浏览器工具包，设置页手工配置一次）跑 15 任务中的探索类任务，记录成功率到 `resources/browser-eval/baseline.md`
- [x] 回填决策：翻页场景失败率 → 翻页拼接是否需要补做（超出阈值则追加实现，否则记入二期）
- [x] 完成 `plan.md` 末尾「完成总结」

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - Agent 任务层基线未采集（降级方案）：子会话不可用浏览器工具包（SubAgentEnabledAbilities 无 browser 字段），主会话侧验证需搭 pi-session 基建 + 消耗真实模型调用，超出一期边界；6 个 agent 任务已在 tasks.json 定义好，runner 跳过并标 SKIPPED-agent-not-configured，二期采集条件写入 baseline.md
  - runner 需用 node 运行（`node resources/browser-eval/run-pipeline.mjs`）：playwright 与 Bun 运行时不兼容（bun 下 acquire 永久挂起，浏览器无法启动），计划中「bun 运行」的写法不可行
  - 未改任何主进程代码，build:electron 跳过；lint 0 errors（99 warnings 均既有遗留）
  - 管线回归 9/9 PASS 且可重复；发现并实测确认 1 个管线缺陷（登录墙 DOM 检测对「正文隐藏在标准容器内」页面失效，innerText 对未渲染元素退化为 textContent），按边界如实记录不修，详见 baseline.md
  - 翻页拼接决策：管线只取最长可见单页（约 1/3 内容），断言不到完整内容 → 记「待补做」（二期优先）
- 改动文件清单（均为新增，未动其他模块）：
  - `resources/browser-eval/` 下 9 个文件：spa-article.html / collapsed.html / paged.html / login-wall.html / lazy-images.html / odd-container.html / tasks.json（15 任务：9 pipeline + 6 agent）/ run-pipeline.mjs / baseline.md

### 给下一步的接力棒
- 关键签名 / 数据结构：tasks.json 结构 `{ id, type: 'pipeline'|'agent', action, url（{{BASE}} 占位符）, scenario/goal, expect: { ok, errorClass, contains, notContains, titleContains, wordCountMin, wordCountMax, qualityHint: 'present'|'absent', found } }`；runner 断言逻辑在 run-pipeline.mjs 的 assertTask，可复用于二期 agent runner
- 下个 step 该从哪里继续：一期已全部完成；二期入口 = ①翻页拼接补做（含 URL 跳转型覆盖）②登录墙检测修复（innerText 可见性度量）③Agent 基线采集（先补 SubAgentEnabledAbilities.browser + settings UI）
- 待办或已知限制：见 `resources/browser-eval/baseline.md`「已知限制」段（登录墙检测盲区 / Bun 不兼容 / qualityHint 恒存在误示 / 翻页拼接未做）
