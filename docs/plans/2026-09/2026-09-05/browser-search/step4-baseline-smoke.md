---
step: 4
title: agent 基线 + 真实冒烟 + 收尾
status: pending
---

## 目标

真实环境端到端验证：agent 基线任务加 search 场景、三个引擎真实站点冒烟（含代理路径）、baseline 回填、文档同步收尾。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step3-tool-settings.md] 工具已注册、设置项已落地
- 当前关键文件状态：`resources/browser-eval/run-agent.mjs` 是 agent 模式 runner（electron stub + PiSession 进程内起，便宜档模型）；`resources/browser-eval/baseline.md` 是基线记录；`resources/browser-eval/tasks.json` 是任务清单
- 关键决策回顾：红线不绕 CAPTCHA——真实冒烟遇验证页不算失败，记录「检测到 → 降级」行为正确即可；patchright 若在 step1 被降级预案接管（Google 暂缓），本 step 冒烟范围相应缩减

## 计划改动

- [ ] `resources/browser-eval/tasks.json` 加 search 任务 2 个（如「搜索 playwright patchright 用法并给出 top 结果」「用搜索定位某文档 URL 再 readArticle」——覆盖 发现→阅读 闭环）
- [ ] `run-agent.mjs` 跑 agent 基线（node 执行），结果回填 `baseline.md`
- [ ] 真实冒烟（node 直调 searchWeb 或 dev 内工具调用）：
  - Bing cn 直连：正常查询返回结构化结果
  - 代理可用时：Google 查询（遇 sorry page 验证降级链行为）+ DDG 查询；代理关掉（模拟 Clash 退出）：auto 引擎直接落 Bing，无长等待
- [ ] 收尾：`docs/codebase-map.md` 同步（新服务/工具/设置项）；plan.md 写完成总结；确认无 TODO 残留、无死代码

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
