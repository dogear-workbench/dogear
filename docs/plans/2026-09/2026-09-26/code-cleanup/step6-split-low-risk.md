---
step: 6
title: 低风险拆分
status: pending
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
