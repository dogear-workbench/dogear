---
step: 5
title: Agent 基线采集
status: done
---

## 目标

runner 支持 agent 任务模式，用「浏览器解析」Profile（便宜档模型）跑 6 个已定义 agent 任务，成功率量化回填 baseline.md——验证「浏览器解析子会话」省钱路径决策。

## 依赖上下文（接力棒输入）

- 前置 step4 产出：`SubAgentEnabledAbilities.browser` 全链路可用；「浏览器解析」Profile 模板就绪
- baseline.md 现状：6 个 `type=agent` 任务已定义（goal + expect.found 断言），runner 跳过标注 `SKIPPED-agent-not-configured`
- 未决问题 4 在本步定：runner 与 pi-session 子会话基建对接方式——优先评估复用现有 PiSession 子会话创建路径（agents/pi-session/），绕开 dogear__CreateSession 的会话组耦合；autoExecute 权限模式免审批阻塞
- 一期踩坑：runner 必须 node 执行

## 计划改动

- [ ] `resources/browser-eval/run-pipeline.mjs`（或新增 run-agent.mjs，实施时按体量定）：agent 任务模式——按 Profile 配置起子会话、发送 goal、等待完成、`expect.found` 断言；autoExecute 权限；逐任务记录耗时/步数/结果
- [ ] 配置「浏览器解析」Profile（便宜档模型 + browser 能力；模型选型实施时从现有 profiles 里挑最便宜可用档）
- [ ] 跑 6 个 agent 任务，回填 `resources/browser-eval/baseline.md`：成功率、模型、每任务步数与耗时、失败任务原因归类
- [ ] SKIPPED 标注消除；「二期采集条件」三条件逐条销项

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
  1. 新增独立 `run-agent.mjs`（而非扩展 run-pipeline.mjs）：PiSession 子会话驱动 + electron stub/hooks 体量较大，且管线 runner 需保持零模型语义，两入口职责分离。
  2. run-pipeline.mjs 的 agent 分支不删除而是改为 `SKIP-agent` 有意分流：零模型回归不能真实调模型，agent 采集由 run-agent.mjs 承担；baseline.md 中 `SKIPPED-agent-not-configured`（未配置）语义已消除。
  3. 便宜档选型实现为 runner 侧启发式（候选清单按序匹配用户可用 profile），因内置 Profile 的 modelSelection 为 null（step4 决策：用户便宜档因人而异）；`--model profileId:tier` 可显式覆盖。实测选中 `default:glm-4.5-air`。
- 改动文件清单：
  - 新增 `resources/browser-eval/run-agent.mjs`（agent 基线采集 runner）
  - 新增 `resources/browser-eval/electron-stub.mjs` + `electron-hooks.mjs`（纯 node 加载 PiSession 依赖链所需，详见 baseline.md 已知限制 5）
  - 修改 `resources/browser-eval/run-pipeline.mjs`（agent 分支 SKIP-agent 分流 + 合计行拆分口径）
  - 回填 `resources/browser-eval/baseline.md`（agent 基线节 + 三条件销项 + 二期注记）
  - 生产代码（electron/、src/）零改动；工作区预存未提交改动（提示音等）未触碰。

### 实测结果（2026-09-04，node，连续两轮一致）

- 模型：`default:glm-4.5-air`，6/6 PASS，成功率 100%，无失败任务；总消耗约 13k in / 0.9k out tokens。
- 明细见 baseline.md「Agent 任务层基线」节（步数 1-6 步/任务，耗时 16.1-38.0s/任务）。
- 验证：`node resources/browser-eval/run-pipeline.mjs` → 11 管线 PASS / EXIT=0；`node resources/browser-eval/run-agent.mjs` → 6/6 PASS / EXIT=0。

### 给下一步的接力棒
- 浏览器二期五步全部完成；本 step 无后续 step。
- 关键签名：`run-agent.mjs` 依赖 dist 编译产物（改动主进程后需先 `bun run build:electron`）；单任务超时 8 分钟写死常量 `TASK_TIMEOUT_MS`；便宜档候选清单 `CHEAP_TIERS` 在文件头部。
- 已知限制：PiSession 依赖链在裸 node 下需 electron stub（hooks 方案）；readArticle 首选入口会使部分探索任务退化为管线能力（任务 2 仅 1 步），解读步数基线时注意；switch 到其他便宜档需确认对应 profile 的 API 可用性。
