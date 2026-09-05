---
step: 4
title: agent 基线 + 真实冒烟 + 收尾
status: done
---

## 目标

真实环境端到端验证：agent 基线任务加 search 场景、三个引擎真实站点冒烟（含代理路径）、baseline 回填、文档同步收尾。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step3-tool-settings.md] 工具已注册、设置项已落地
- 当前关键文件状态：`resources/browser-eval/run-agent.mjs` 是 agent 模式 runner（electron stub + PiSession 进程内起，便宜档模型）；`resources/browser-eval/baseline.md` 是基线记录；`resources/browser-eval/tasks.json` 是任务清单
- 关键决策回顾：红线不绕 CAPTCHA——真实冒烟遇验证页不算失败，记录「检测到 → 降级」行为正确即可；patchright 若在 step1 被降级预案接管（Google 暂缓），本 step 冒烟范围相应缩减

## 计划改动

- [x] `resources/browser-eval/tasks.json` 加 search 任务 2 个（如「搜索 playwright patchright 用法并给出 top 结果」「用搜索定位某文档 URL 再 readArticle」——覆盖 发现→阅读 闭环）
- [x] `run-agent.mjs` 跑 agent 基线（node 执行），结果回填 `baseline.md`
- [x] 真实冒烟（node 直调 searchWeb 或 dev 内工具调用）：
  - Bing cn 直连：正常查询返回结构化结果
  - 代理可用时：Google 查询（遇 sorry page 验证降级链行为）+ DDG 查询；代理关掉（模拟 Clash 退出）：auto 引擎直接落 Bing，无长等待
- [x] 收尾：`docs/codebase-map.md` 同步（新服务/工具/设置项）；plan.md 写完成总结；确认无 TODO 残留、无死代码

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  - run-agent.mjs 做了最小扩展以支持 search 任务：无 url 字段的任务不拼「页面 URL」行；断言新增 expect.tools（必调用工具）与 expect.minUrls（工具输出+回复去重 http(s) URL 数下限），与既有 found 标记断言并存
  - 真实冒烟额外跑了 auto 完整链经代理样本（b3）；另做了一次 Google 真实 DOM 诊断（临时脚本，已清理）
  - 冒烟未遇 /sorry/ 验证页，遇到的是更隐蔽的 Google 降质形态（见下），降级链行为正确，已记录为已知限制
- 改动文件清单：
  - `resources/browser-eval/tasks.json`：新增 2 个 search 类 agent 任务（search-agent-top-results 纯搜索给结果 / search-agent-read-article 搜索定位 URL 后 readArticle，覆盖发现→阅读闭环）+ notes 补充 search 类任务说明
  - `resources/browser-eval/run-agent.mjs`：goal 拼接支持无 url 任务；断言扩展 expect.tools / expect.minUrls
  - `resources/browser-eval/baseline.md`：新增「WebSearch agent 基线」小节（2 任务表格，两轮均 2/2 PASS）+「WebSearch 真实冒烟」表（5 项）+ 已知限制第 6 条（Google goto 降质形态）
  - `docs/codebase-map.md`：新增 `browser/` 服务目录条目（6 文件）、`tools/browser-tools.ts` 工具组条目、settings-service 追加两个浏览器设置项、设置页条目追加「受控浏览器」小节、新增「测试基建（resources/）」章节
- 冒烟结果明细（详见 baseline.md）
  - a. Bing cn 直连（auto 无代理配置）：OK，engine=bing，8 条，1.1s
  - b. Google 经代理 7897：导航成功无验证页但解析空（Google 当前返回 goto 加密链接降质形态）→ 自动降级 DDG 成功，降级原因正确记录；DDG 直查 OK 8 条 0.0s
  - c. auto + 代理不可达（127.0.0.1:9）：探测失败直接落 Bing，8 条 0.6s，无长等待
- 验证：管线回归 20/20 PASS（node 执行）；`bun run build:electron` 通过；lint 0 errors（99 warnings 均为存量）；TODO/死代码 grep 零命中

### 给下一步的接力棒
- 关键签名 / 数据结构：
  - tasks.json search 类任务：无 url 字段，expect 用 tools + minUrls（无 found）；run-agent.mjs 自动兼容两类断言
  - 一次性冒烟脚本未留仓（临时文件已删），复跑方式见 baseline.md「WebSearch 真实冒烟」小节
- 下个 step 该从哪里继续：本计划已全部完成，无下个 step
- 待办或已知限制：
  - Google 引擎当前恒降级 DDG（goto 降质形态，非 /sorry/ 验证页，解析器无法适配出真实 URL，按红线不绕）；auto 引擎实际由 DDG 兑底，效果不受影响；Google 恢复常规 DOM 后再校准块选择器（候选应加 `#rso > div`），详见 baseline.md 已知限制 6
  - 真机配置代理后建议日常观察一次 search 工具行为（DDG 兑底为常态路径）
