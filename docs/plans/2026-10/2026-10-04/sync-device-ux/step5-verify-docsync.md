---
step: 5
title: 全量验证与文档收尾
status: pending
---

## 目标
全量验证绿 + 代码地图同步 + 计划回填收尾。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step1~4] 全部已实施
- 项目验证基线：`bun run lint`（0 errors）、`bun run build:electron`、`vite build`、`bun test`（当前 sync 域 112 pass 基线，允许新增）

## 计划改动
- [ ] 全量跑四项验证，全绿
- [ ] `docs/codebase-map/` 数据中心/同步条目更新（删 peer-notify、加 scanNow/unpair/常驻快照语义）
- [ ] plan.md 步骤索引全部勾选 + 末尾「完成总结」（实际改动汇总、与原计划偏差）
- [ ] 提交：UI 与文档可合并一笔，message 概括本 feature

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：
