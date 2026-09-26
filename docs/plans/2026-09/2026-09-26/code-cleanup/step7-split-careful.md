---
step: 7
title: 谨慎拆分
status: done
---

## 目标
3 个高价值但波及面大的文件拆分：agent-worker、pi-session（只抽纯函数段）、stock-analysis-tools。

## 依赖上下文（接力棒输入）
- 调研报告：共享区 `20260926-large-file-report.md` 第二节 P1/P5/P7 与「不建议拆」清单
- 前置：Step 4 已建 `tools/stock-format.ts` 骨架（safe 已迁入）
- ⚠️ agent-worker.ts 是 Worker 线程入口（agent-manager.ts:230 字符串路径加载，绝不可改名/移动）；**新模块不得静态 import electron/tipc**（现 article-service 为动态 import，保持该模式）；可用 `scripts/analyze-worker-imports.mjs` 验证打包依赖

## 计划改动

- [ ] **P1 agent-worker（961→壳+任务模块）**：新建 `electron/main/agents/tasks/`：parse-article-task.ts(≈370，含 buildV2ParsePrompt/loadArticleParseSkill/appendParseHistory) / state-extract-task.ts(≈220) / custom-agent-task.ts(≈150，含 summarize/reading-assist)；agent-worker.ts 留壳 ≈250（init/handleTask 分发/通讯/cancel/cleanup）。handler 原依赖 this 的共享方法（sendTaskUpdate/simplifyToolInput 等）设计 context 对象传入——先读代码列出 this 依赖清单再动手
- [ ] **P5 pi-session 第一步（1486→抽 tool-assembly）**：新建 `pi-session/tool-assembly.ts`：registerPack/buildMainAgentToolDefs/buildSubAgentToolDefs + filterSkillsForSubAgent/computeSubAgentActiveTools（665-916 段，全纯函数，≈300 行）；主文件降 ~1180。**事件处理段（916-1200）本步不动**；第二步 compaction.ts（maybeAutoCompact+extractLastContextTokens ≈120）视第一步顺利与否决定是否顺手做
- [ ] **P7 stock-analysis-tools（1143→按域分组）**：safe/formatYuan/formatIndicatorResult 等共享助手迁入 `tools/stock-format.ts`（Step 4 骨架扩展）；内部按域拆 2-3 个 create*ToolDefs()（行情/指标 167-563、资金/板块 563-916、其余 916-1143），原工厂聚合返回；**不拆文件只分组**，保持单工厂入口

## 收尾验证
- [ ] 每项拆完：`scripts/analyze-worker-imports.mjs` 验证 worker 打包（P1）+ lint + 双侧 tsc + bun test
- [ ] P1 后必须真机冒烟：派一个子会话任务跑通（parse-article 后台任务 + 会话状态提炼两条链）
- [ ] P5 后冒烟：主会话正常启动、工具列表完整（能力 tab 查看）、子会话工具裁剪正常

## 实施回填（2026-09-26 完成）

- P1 agent-worker 961→277 壳 + agents/tasks/ 四模块（task-context 11/parse-article 297/state-extract 227/custom-agent 148）：this 依赖收敛为 TaskHandlerContext（configDir/sendMessage/setAbortController），delay 降为模块私有，simplifyToolInput 确认死码删除，this.workspacePath 原样（原即无消费）；新模块零静态 electron import，analyze-worker-imports 基线 diff 仅 +4 新模块、违规集合零变化；worker 入口路径未动
- P5 pi-session 1486→1142：抽 tool-assembly.ts（355，5 纯函数，config+toolPackMap 参数注入）+ pi-session-config.ts（36，PiSessionConfig 迁出避免循环依赖，re-export 保持外部 import 零改动）；类保留同名薄方法，tool-registration-smoke 测试零改动全绿（行为锚点）；**第二步 compaction.ts 主动不做**：maybeAutoCompact 与 7 个实例可变状态耦合，抽出示例复杂度反超收益，与调研「不建议拆」判断一致
- P7 stock-analysis-tools 1143→1061：formatYuan/lastValue/formatIndicatorResult 迁入 stock-format.ts（safe 原有）；单工厂内部按域分 3 组 create*ToolDefs()（指标信号/量化/板块资金），10 工具逐字迁移，入口签名不变（返回数组顺序按域重排，消费方按 name 查找无影响）
- 验证：每项拆后 lint 0 errors、双侧 tsc 通过、bun test 319 pass/0 fail/1 skip（=基线）、build:electron 产物齐全、parse handler 逐字 diff 核对
- 遗留：真机冒烟待用户（PARSE_ARTICLE 链/主会话+能力 tab+子会话裁剪/CUSTOM_AGENT 定时任务）
