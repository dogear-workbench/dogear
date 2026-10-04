---
step: 5
title: settings 白名单传播制
status: pending
---

## 目标
settings.json 三方合并从「全字段」改为「白名单字段传播、其余保本端」，根治 snapshot 类机器亲和字段的跨端污染。

## 依赖上下文（接力棒输入）
- 设计依据：[../sync-data-semantics-design.md](../sync-data-semantics-design.md) §2.2（A 模型、分类草案、选 A 弃 B 理由）
- 前置 step 产出：[step1-registry-settings-model.md] `SETTINGS_SYNC_FIELDS` 白名单常量草案已立
- 现状：`apply.ts` `mergeFieldsThreeWay` 全字段三方合并；`computeMergedSettings` 内 syncOptions 走 rev-LWW 特判（保持不动）；双改警告 `onWarning` 机制已有
- 注意：settings.json 的 persist 走 saveSettings（默认值合并 + 副作用），改造不触碰该路径

## 计划改动
- [ ] 逐字段核对 AppSettings 真实结构（`settings-types.ts` / settings-service 各 normalize 函数），定稿 `SETTINGS_SYNC_FIELDS`；特别注意 `ai` 内是否混有 API key 类敏感值（有则降级为保本端或拆字段，回填记录结论）
- [ ] `apply.ts` `mergeFieldsThreeWay` 改造：仅白名单字段进三方合并；非白名单字段一律取本端（含未知新字段）；双改警告只对白名单字段冲突报告；syncOptions 特判逻辑原样保留（在白名单之外自成体系）
- [ ] 基线语义核对：settingsBaseline 记录合并落盘全量结果，非白名单字段保本端后基线自然收敛，确认无振荡（下轮 diff 不误判）
- [ ] 测试：白名单字段单侧变传播 / 双改保本端+警告；非白名单（snapshot/backup/ui）单侧变**不**传播；未知新字段保守保本端；syncOptions rev-LWW 不回归

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
