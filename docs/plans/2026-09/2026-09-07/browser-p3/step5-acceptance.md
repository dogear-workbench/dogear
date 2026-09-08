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
- [ ] 真机验收清单（2026-09-08 真机验收大部分完成，A 段全过；剩余项待用户在场执行，勾选均附证据，不虚构）：
  - [x] 扩展重载（协议 v3 硬要求）：✓ 已完成——2026-09-08 真机验收时扩展已重载并连接（A 段串联全部经扩展通道跑通，即重载 + 连接的间接证据）
  - [x] A1 独占：✓ 真机证据——异 owner 并行收到 busy 明确报错；10 分钟 IDLE_RELEASE 空闲释放正常
  - [x] A2 observe 透 href：✓ 真机小红书搜索页 observe 卡片带 `href=...`（含 xsec_token 完整可用，直链导航成功）
  - [x] A2+A3 串联（核心验收目标「详情可达」）：✓ observe → navigate 直链 → read_text 读到正文，全链路通过；字段路径已探明——搜索卡片 `__INITIAL_STATE__.search.feeds._value.{index}`、详情 `note.noteDetailMap.{noteId}.note`（完整结构见计划共享区 p3-xhs-acceptance-state-paths.md）
  - [x] A3 read_state 下钻：✓ 真机连续 6 次（详情页）+ 4 次（搜索页）下钻全成功无超限；原计划「字段路径回填到工具描述示例」按 2026-09-08 browser-exploration 计划设计变更调整为**进首批站点档案**（`.dogear/site-knowledge/xiaohongshu.com.md` 正式地图 + 探索发现两区），工具描述只写通用引导
  - [ ] B 站内搜索：△ 部分完成（环境因素，parser 无 bug）——2026-09-08 真机诊断：zhihu 未登录软登录墙（结果区空 + 登录弹窗，服务端置空结果）、reddit 未登录硬登录墙（302 → `/login/?reason=lor2`）；已细化降级文案与 search 工具描述（提示人工登录后重试），站内降级态加 site: 域名过滤兜底（Bing 真机无视 site: 语法，8 条 0~1 条目标域）。**遗留：受控浏览器窗口人工登录知乎/Reddit 后复测 + 关 Clash 降级链验收，待用户在场执行**
  - [ ] 预算账本核对：△ 代码级事实已核实（read_state 按 conversationId×页面 URL 去重计 1 次；预算数字只在超限报错出现，正常返回不带）+ 真机佐证（详情页连续 6 次 / 搜索页连续 4 次 read_state 全成功无 budget_exceeded）；伴随面板账本逐笔核对未做，保留待办（agent 侧无法从工具返回直接读预算余量，需看动作流或超限报错）
  - [x] 真机风险点：✓ patchright CDP 主世界注入真机验证通过（zhihu state 路径 + 扩展 read_state world:MAIN 双路径跑通）；「知乎真实选择器/字段命名」——真机结论：DOM 兜底与 state walk 逻辑均正确，空结果是登录墙所致（环境因素非代码问题）
- [x] doc-sync：`docs/codebase-map.md` 同步 9 处（nm-protocol v3 + read_state kind / browser-manager PAC reddit 系 / browser-search-service site 参数与站内降级 / serp-parsers reddit、zhihu 解析器 / browser-action-stream result 枚举扩展 / site-policy controlledBrowserBlock / 新增 extension-ownership.ts 与 site-search.ts 两行 / browser-tools search site / extension-tools 6 工具与独占 gate / 扩展命令链路 gate 顺序）；顺带修 site-policy.ts controlledBrowserBlock 文案补全 read_state（step3 遗留小遗漏）
- [x] 记忆沉淀：无真机新坑可存；step4 生产级发现（patchright page.evaluate 隔离世界读不到页面 window 全局，需 CDP Runtime.evaluate 直连主世界）已由 step4 子会话更新进既有记忆 playwright-evaluate-no-dom-lib

## 实施回填（做完后填）

### 实际改动
- 与计划差异：真机清单于 2026-09-08 由 browser-exploration 计划 Step 5 收口子会话按已核实真机事实勾选（扩展重载/A1/A2/A2+A3/A3/风险点 ✓ 附证据；B 段诊断为登录墙环境因素部分完成；预算账本仅代码级 + 真机佐证）——勾选依据：2026-09-08 真机验收执行记录 + browser-exploration Step 1 诊断交付（共享区 step1-delivery.md）+ 共享区 p3-xhs-acceptance-state-paths.md；「字段路径回填工具描述」按 browser-exploration 计划拍板改为进站点档案；B 段修复与降级兜底（refineEmptyReason / urlMatchesDomain 域名过滤）已由 browser-exploration Step 1 落地代码
- 改动文件清单：仅 docs（本文件真机清单 + 实施回填段；browser-p3/plan.md 完成总结），无代码改动；自动化回归由 browser-exploration Step 5 重跑全绿（site-policy 45 / extension-ownership 18 / observe-href 9 / nm-protocol 6 / nm-navigate 15 / nm-read-state 14 / nav-tracker 15 / stale-protocol 5 / profile-migration 11 / site-knowledge 26 / extension-site-tools 16 冒烟 + run-pipeline 27/27 + bun test 285 pass 1 skip 0 fail + lint 0 errors）

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
