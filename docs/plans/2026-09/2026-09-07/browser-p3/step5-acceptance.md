---
step: 5
title: 验收收口
status: done
---

## 目标

全量冒烟 + 真机验收 + 文档同步，P3 收口。

## 依赖上下文（接力棒输入）

- 前置 step 产出：step1 gate / step2 href / step3 read_state / step4 site 引擎全部编译通过且各自冒烟过
- 关键决策回顾：风控优先——真机验收出现滑块/验证码即停，人工处理后换新会话再试（宁慢勿 ban）

## 计划改动

- [x] 全量回归：`node` 跑 `resources/browser-eval/` 全部冒烟（site-policy 45 / extension-ownership 18 / observe-href 9 / nm-protocol 6 / nm-navigate 15 / nm-read-state 14 / nav-tracker 15 / stale-protocol 5 / profile-migration 3 全 PASS）；run-pipeline 25/25；`bun run build:electron` 通过；`bun run lint` 0 errors；`bun test` 286 tests 0 fail
- [ ] 真机验收清单（**待用户在场执行**，无人值守部分已完成；逐项记录结果）：
  - 扩展重载（协议 v3 硬要求）：chrome://extensions 重载 Dogear → 扩展状态显示已连接
  - A1：主会话并行派两个浏览器解析子会话 → 第二个应收到 busy 明确报错并在交付里说明
  - A2：小红书搜索页 observe → 卡片元素带 `href=...`（含 xsec_token 完整可用）
  - A2+A3 串联：拿 href → navigate 直达笔记详情 → read_state 或 read_text 读到正文（本轮核心验收目标：**详情可达**）
  - A3：搜索页 read_state 无 path 看顶层 → 下钻拿到卡片数组（真机探小红书实际字段路径，**回填到工具描述示例**）
  - B：`search('renovation mistakes', {site:'reddit'})`（Clash 存活）出带 score 结果；关 Clash 重试 → 降级 site: 通用链 + degradations 提示；`site:'zhihu'` 直连出结果（观察动作流：「知乎状态数据解析成功」= state 路径，「解析成功」= DOM 兑底）
  - 预算：小红书同一页面多次 read_state 只计 1 次笔记（账本核对）
  - 真机风险点：MAIN world 注入行为、patchright CDP 直连主世界（升级 patchright 需复测）、知乎真实选择器/字段命名
- [x] doc-sync：`docs/codebase-map.md` 同步 9 处（nm-protocol v3 + read_state kind / browser-manager PAC reddit 系 / browser-search-service site 参数与站内降级 / serp-parsers reddit、zhihu 解析器 / browser-action-stream result 枚举扩展 / site-policy controlledBrowserBlock / 新增 extension-ownership.ts 与 site-search.ts 两行 / browser-tools search site / extension-tools 6 工具与独占 gate / 扩展命令链路 gate 顺序）；顺带修 site-policy.ts controlledBrowserBlock 文案补全 read_state（step3 遗留小遗漏）
- [x] 记忆沉淀：无真机新坑可存；step4 生产级发现（patchright page.evaluate 隔离世界读不到页面 window 全局，需 CDP Runtime.evaluate 直连主世界）已由 step4 子会话更新进既有记忆 playwright-evaluate-no-dom-lib

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
