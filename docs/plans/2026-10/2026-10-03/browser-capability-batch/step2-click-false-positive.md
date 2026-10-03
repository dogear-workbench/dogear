---
step: 2
title: click 误报核查
status: pending
---

## 目标

排查「click 报页面已变化/元素不在但页面实际未导航」的误报根因（hvszlply 议题 + P1.5 A4 新证据），产出根因结论 + 修复或边界说明。

## 依赖上下文（接力棒输入）

- 两份证据：
  1. hvszlply 原议题：同页导航 click 误报「页面已离开命令发起时的地址」
  2. P1.5 验证 A4（2026-10-03 15:49 审计日志）：click 返回 `errorCode=ref_expired`（DOM 查不到 `[data-dogear-ref]` 元素）发生在 guard 弹窗**之前**，与用户手动提交窗口重叠；30 秒后同 ref 重试成功命中——判定竞态，根因未定位
- 关键文件：`extension/src/dom-actions.js` clickFn（ref 校验 → isSubmit 判定 → 执行 → urlBefore/textBefore 对比）、`nav-tracker.js`（导航追踪）
- 审计日志可复现取证：`logs/dogear-YYYY-MM-DD.log` 的「click 命令结果」「焦点页面导航」（WARN 级）

## 计划改动

- [ ] 通读 dom-actions.js click 全链路 + nav-tracker 的导航判定时机，列出所有可能产生 ref_expired / 「页面已变化」的条件分支
- [ ] 分析与用户手动操作/确认卡出现的竞态窗口（元素 focus 变化、表单交互是否会导致 data-dogear-ref 属性丢失或 DOM 重建）
- [ ] 若能本地复现（构造脚本或 dev-selftest 场景），定位到具体分支
- [ ] 产出：根因结论；能修则修（小改动直接改 + 回归验证），改动大则写边界说明留待后续任务
- [ ] 结论回填 hvszlply 任务与本文档

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 根因结论：
- 待办或已知限制：
