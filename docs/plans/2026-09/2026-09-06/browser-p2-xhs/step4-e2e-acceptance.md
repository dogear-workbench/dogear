---
step: 4
title: 端到端验收
status: pending
---

## 目标

真机全链路验收导航稳定性与节奏预算，完成一次**保守低频的小红书真实调研**，全量回归，P2 收口。

## 依赖上下文（接力棒输入）

- 前置 step 产出：[step3-tools-policy.md] 工具层约束全部生效
- 当前关键文件状态：`resources/browser-eval/` 有 P1 的 driver/pipeline 基建（node 单进程承载 gateway 宿主 + 测试页 server + CDP 驱动）；P1 验证拓扑（安装版占用真实 pipe 时：dist 拷贝树 + 改 pipe 常量 + 独立 node gateway + 临时扩展拷贝 + HKCU NM 注册）先例可复用
- 关键决策回顾：**小红书真机调研是本 step 的一次性真实验证**，保守参数起步（单次 ≤5 篇、≤2 组关键词，间隔拉长），风控信号出现即停并记录；调研待验证 8 项（频次阈值等）不追求一次回答，观察什么记什么

## 计划改动

- [ ] 真机用例矩阵（headful，沿用 P1 driver 模式）：
  1. navigate 工作流：连接任意页 → navigate 到授权域搜索 URL → 快照自动推送（状态行跟随）→ read_text → 返回列表（navigate 回退）→ 再进笔记——**全程无重连**
  2. SPA 跟踪：测试页内 pushState 路由变化 → 快照推送 + 旧 ref 失效（代际误杀路径）
  3. 未授权域 navigate → navigation_blocked（命令不发出）；javascript: 协议拒绝
  4. 预算：mock 策略配额调小 → 超限结构化文案 + 新会话恢复
  5. 风控信号：测试页注入「访问频次异常」文案 → risk_signal_detected + 会话级后续拒绝
  6. 延迟：命中策略域名的命令耗时 ∈ 随机区间
  7. P1 竞态回归：断连/换 tab/关 tab/自行导航四类 + 旧扩展 stale_protocol + SW 冷启授权恢复
- [ ] 工具链装配：浏览器解析 Profile 子会话含 navigate 工具（PiSession 装配反射断言，P1 step5 层 1 模式）
- [ ] 子会话闭环（分层，P1 先例）：真实链路上按 agent 调用序执行 navigate → observe → read_text 序列断言（层 2）；真实 agent loop（层 3）转人工：**本 step 直接做掉**——用 dev electron（NODE_ENV=development + 临时 DOGEAR_CONFIG_DIR，关闭安装版）派浏览器解析子会话，任务「搜索 X（低频敏感词，如某旅游地）读 2 篇笔记，返回要点 + 链接」
- [ ] 小红书真实调研一次（上述层 3 本身即是）：观察风控信号、记录实际耗时与间隔、动作账本核对
- [ ] 全量回归：`bun run lint`（0 errors）/ `bun run build:electron` / `bunx tsc -p tsconfig.json --noEmit` / `node resources/browser-eval/run-pipeline.mjs` 20/20 / P0+P1 状态行用例等价复跑
- [ ] `docs/codebase-map.md` 同步（navigate 工具、site-policy、代际语义、账本新字段）
- [ ] 版本确认（0.1.103 或收口 bump）；环境清理（临时目录/注册表/进程）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 人工遗留清单：（无法自动化项）
- 真机观察记录：（小红书调研的实际行为、风控信号、参数体感——P3 校准输入）
- 后续（P3 输入）：
