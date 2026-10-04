---
step: 7
title: 收口验证与文档同步
status: pending
---

## 目标
全链路回归（双机手测清单）、doc-sync 更新代码地图、写完成总结。

## 依赖上下文（接力棒输入）
- 前置 step 产出：step1-6 全部完成（各 step 回填的接力棒 + 与计划差异）
- 设计验收参照：[../sync-data-semantics-design.md](../sync-data-semantics-design.md) §5（错误边界）、§6（未决问题）

## 计划改动
- [ ] 单测全量跑通（sync / task-store / settings 相关）
- [ ] `build:electron` + 前端构建通过
- [ ] 双机手测清单（依赖 Mac 真机，同 lan-sync step5 约束，不可用则记待办）：
  - Win 建任务 → 同步 → Mac 任务面板出现，plan 内容可读（dogear 工作区 clone 在场）
  - 文章库跨端出现（注意首轮体积提示）
  - 勾选目录跨端同步 + 双端勾选配置收敛一致
  - 改 snapshot 排除 → 同步 → 对端 settings.snapshot 不变（不再传播）
  - 旧版本对端（如有）不收 `__ws-external__` 垃圾条目
- [ ] doc-sync：`docs/codebase-map/` 更新 sync 分域（虚拟路径机制、settings 白名单传播、userSyncPaths）
- [ ] plan.md 末尾写「完成总结」（实际改动汇总、与计划偏差）

## 实施回填（做完后填）

### 实际改动
- 与计划差异：
- 改动文件清单：

### 给下一步的接力棒
- 关键签名 / 数据结构：
- 下个 step 该从哪里继续：
- 待办或已知限制：
