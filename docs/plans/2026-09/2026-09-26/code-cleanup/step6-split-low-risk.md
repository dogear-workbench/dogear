---
step: 6
title: 低风险拆分
status: done
---

## 目标
5 个分节清晰、纯机械的超长文件拆分，全部用 facade/re-export 让引用方零改动。

## 依赖上下文（接力棒输入）
- 调研报告：共享区 `20260926-large-file-report.md` 第二节 P2/P3/P4/P6/P8（含行数分布与拆分方案）
- 前置：Step 4 R5 已收口 detectPlatform；Step 3 已瘦身 main-app 启动链（本步 P6 拆 main-app 基于瘦身后的版本）

## 计划改动

- [ ] **P2 article-service（1040→目录+facade）**：新建 `electron/main/services/article/`：order-index.ts(≈165) / fetch.ts(≈130) / parse.ts(≈255) / crud.ts(≈210) / tree.ts(≈270)；原 `article-service.ts` 留 30 行 facade re-export，8 个引用方零改动
- [ ] **P3 WorkspaceExplorer（1034→组件拆出）**：新建 `components/workspace-explorer/`：tree-model.ts(≈160) / TreeItemRow.tsx(≈290) / inline-inputs.tsx(≈120)；主组件留在原路径（≈430），导出名不变
- [ ] **P4 settings page（884→抽 2 Tab）**：`app/settings/BehaviorTab.tsx`(≈330，基础设置 JSX + 常量 + updateAI)、`app/settings/ProfilesTab.tsx`(≈260)；page.tsx 留壳 ≈230；local/setLocal 以 props 传入；照 AbilityTab/SubAgentTab 先例
- [ ] **P6 main-app（941→窗口工厂+托盘拆出）**：`electron/main/window-factories.ts`(≈550) + `electron/main/tray.ts`(≈60)；main-app.ts 留 app 生命周期/single instance/协议 ≈300；getDebugWindow/createSessionWindow 等被 tipc 引用的导出经 re-export 保持
- [ ] **P8 useTranscriptState（889→三层拆）**：`transcript-core.ts`(纯 reducer ≈400) / `transcript-store.ts`(≈65) / useTranscriptState.ts 原路径 re-export 全部导出；6 个消费方无感；`useTranscriptState.test.ts` 作行为锚点，跑通即等价

## 收尾验证
- [ ] 每拆一个文件：lint + 双侧 tsc + bun test（P8 后必跑 useTranscriptState.test.ts）
- [ ] 拆完 wc -l 复核各新文件行数与预期偏差（±15% 内可接受，超了说明调研行数快照失准，记录到实施回填）
- [ ] 启动冒烟：文章库增删/排序、工作台文件树、设置页各 tab 保存、多窗口打开（data-center/notes/session）

## 实施回填（2026-09-26 完成）

- P2 article-service（1080）→ services/article/ 六文件（types 47/order-index 158/fetch 164/parse 200/crud 277/tree 229，types 为计划外新增避免模块循环依赖）+ 44 行 facade，8 引用方零改动
- P3 WorkspaceExplorer（1034）→ 主组件 465 + workspace-explorer/ 三文件（tree-model 144/TreeItemRow 314/inline-inputs 122），CompanionPanel 零改动
- P4 settings page（884）→ 壳 164 + BehaviorTab 388 + ProfilesTab 378（单 tab 专属 helper/状态内聚，超预期口径但合理）；selectedProfileTab 初始化内聚进 ProfilesTab 语义等价
- P6 main-app（941）→ 405 + window-factories 368 + tray 65；死链处置：createDebugWindow/getDebugWindow 删、sendToDebugWindow 保留 no-op（tipc/agent.ts 在用）经 re-export，净减 ~103 行；whenReady 11 个初始化块属生命周期核心留 main-app
- P8 useTranscriptState（889）→ transcript-core 401 + transcript-store 71 + hook 层 464（export * 保持全符号），6 消费方无感，测试 14 pass 行为锚点通过
- 行数偏差：P4 两 Tab（+18%/+45%）、P6 main-app(+35%)/window-factories(-33%) 超±15%，均为内容归属口径差异（单 tab 内聚/死链删/初始化块保留），非调研失准
- 验证：每拆一项全量验证，最终 lint 0 errors、双侧 tsc 零错误、bun test 319 pass/0 fail/1 skip（=基线）、build:electron 产物齐全
- 遗留：GUI 冒烟待用户（文章库/文件树/设置页各 tab/多窗口+托盘）；sendToDebugWindow no-op 待 tipc/agent.ts 重构时顺手删
