---
step: 9
title: 基准验证与虚拟化决策
status: done
---

## 目标

用 step 1-8 的实现在完整 DOM 与当前虚拟化两种模式下跑基准场景，以数据决定保留手写虚拟化、完整 DOM 还是迁移 react-virtuoso；完成重构纲领的验收。

## 依赖上下文（接力棒输入）

- 前置 step：[step1-8] 全部完成。重构纲领 `docs/plans/2026-08/2026-08-25/chat-render-boundary-state-plan.md` 的「完成标准」节是本 step 的验收清单。
- 基准工具：React Profiler（开发模式）+ Chrome Performance 面板；流式期间记录 React 提交次数/秒、长帧（>50ms）数量、快速滚动帧率。基准脚本（生成 50/100/300 轮对话的长会话 JSONL）如不存在则本 step 写一个 dev-only 的 seed 工具放 scripts/ 下。

## 计划改动

- [ ] 准备长会话测试数据：300 轮、含长 Markdown/长代码块/大量工具调用/图片的会话 JSONL（脚本生成或真实会话拷贝）。
- [ ] 模式 A（当前手写虚拟化）跑纲领阶段 6 的全部验证场景并记录指标。
- [ ] 模式 B（完整 DOM）：临时关闭 useVirtualTurns（visibleTurnIds 全集）同场景记录。
- [ ] 决策（按数据，不预设结论）：
  - A、B 均达标 → 保留 A（删 B 的开关）；
  - 仅 A 达标 → 保留 A，记录 B 的差距原因；
  - A 不达标且瓶颈在历史 DOM layout/paint → 迁移 react-virtuoso：按稳定 turnId 虚拟化，删除手写可见区计算与占位逻辑，不叠两套 virtualizer。
- [ ] 完成纲领「完成标准」逐项验收，结果写入 plan.md 完成总结。
- [ ] 若决策为保留现状：清理基准过程引入的临时代码；若迁移 Virtuoso：作为独立后续 step 补充到本目录（不塞进本 step）。
- [ ] `/compact` 遗留缺陷（前端发字面文本，见调研报告 §5）在完成总结中记为已知问题移交。

## 验证（即本 step 本身）

纲领完成标准逐条：
- 流式 delta 合并提交，历史消息不因每个 token 重复参与重渲染。
- StableHistory 历史对象和组件 props 在流式期间保持稳定。
- task summary、搜索、minimap、turn map 不再通过整份消息数组高频重算。
- 原生滚动条拖拽不被自动跟随拉回。
- 切换到正在流式输出的会话不丢消息、不重复渲染。
- 权限/AskUser 卡片晚于 result 到达时仍落在 live tail。
- 窗口最小化期间流式输出，恢复后消息完整、无积压卡顿。
- 动态高度、缩放、展开折叠和图片加载无明显跳位。
- turns.test.ts 通过；消息 reducer、稳定 ID、任务派生、流式批处理的补充测试（step 2/3/4/5 各自补充过，本 step 汇总确认）。
- 真实长会话手动性能验收。

## 实施回填

### 实际改动
- 新增 `scripts/chat-render-benchmark.ts`，新增 `bun run bench:chat-render` 命令；脚本仅手动运行，不进入 renderer 生产入口，不引入 Virtuoso 或其他生产依赖。
- 基准确定性生成 50/100/300 轮 JSONL fixture，A 使用当前手写虚拟化的 400px 轮高、800px viewport 和 1 viewport buffer，B 计入完整 DOM；同时测 buildTurns/aggregateTasks 纯函数耗时。运行结束后已清理 `tmp/chat-render-benchmark/` 生成物。
- 与计划差异：未新增真实会话 seed 到业务存储；没有 React Profiler、Chrome Performance、DOM layout/paint、FPS 或 Electron GUI 自动采集能力，因此不编造这些指标，也未引入 react-virtuoso。
- 决策结果与数据：保留当前手写虚拟化 A。实际运行 `bun run bench:chat-render`：300 轮/600 条消息时，A 渲染 8 轮/16 条消息并保留 292 个高度占位，B 渲染 300 轮/600 条消息；buildTurns 约 0.109ms，aggregateTasks 约 0.181ms。50/100 轮同样保持 A 的固定可见窗口优势。纯函数开销未发现瓶颈，但不等同于真实 React/DOM 性能。
- 纲领完成标准：delta buffer、StableHistory/LiveTail 边界、task/search/minimap 派生、滚动拖拽、entryIds 合并、pending 晚到、隐藏 tab 兜底均已由代码与自动测试覆盖；真实 GUI/Profiler 视觉和性能项仍未完成。
- 验证：指定测试 20 pass ✓ / build:renderer ✓ / lint 0 errors（74 个存量 warnings）/ git diff --check ✓。
- 改动文件清单：`scripts/chat-render-benchmark.ts`、`package.json`、本文档及 `plan.md` 完成总结。

### 给下一步的接力棒
- 后续事项：本计划不迁移 Virtuoso；只有未来真实浏览器/Electron 指标证明 A 不达标且瓶颈明确位于历史 DOM layout/paint 时，另开独立 step 评估迁移。继续保留当前手写虚拟化，不叠加第二套 virtualizer。
- 已知问题移交：`/compact` 前端发送字面文本的遗留缺陷不在本重构中修复；React Profiler/Chrome Performance、真实长会话 GUI、窗口最小化恢复、动态高度/图片/折叠视觉回归需后续手工验收。
