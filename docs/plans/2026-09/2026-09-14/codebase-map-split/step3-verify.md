---
step: 3
title: 验证检索动线与规范
status: done
---

## 目标
以 agent 真实检索动线抽查新地图命中率，检查无重复条目与体积收敛，验证 doc-sync 写入路由可唯一定位。

## 依赖上下文（接力棒输入）
- 前置 step 产出：[step2-skill-guides.md] 两个 skill 指引已指向 `docs/codebase-map/index.md` 动线
- 当前关键文件状态：`docs/codebase-map/` 9 文件就位，原 `docs/codebase-map.md` 已删
- 关键决策回顾：验收标准来自设计文档「目标」——功能词快速锁定区域、doc-sync 维护成本下降

## 计划改动
- [x] 检索动线抽查（11 个真实功能词）：7 命中 / 4 未命中（骨架屏/历史加载、文件树、确认弹窗、failover），未命中词已全部补进 index 关键词表
- [x] 重复条目检查：真重复 1 处（`app/debug/page.tsx` 双全条目），已删 chat.md 次条目留 infra.md 主条目；其余同名均为不同完整路径或指针行
- [x] 体积收敛检查：9 文件合计 51841 字节（-60.5% vs 原 130KB），最大单文件 chat.md ≈8.6KB，全部 < 20KB
- [x] doc-sync 路由演练：3 个假想改动（文章组件 / stock store / tipc 路由）均可唯一确定写入文件，无歧义
- [x] 无断链检查：index 8 文件引用一致，指针行全通；文档→代码反向抽查 30+ 路径发现 1 断链（data-center.md 记忆节 `notes-store.ts`，文件不存在），已删

## 实施回填（做完后填）

### 实际改动
- 与计划差异：无。验证规模超出计划（抽查 11 词 > ≥5、路由演练 3 例 > 2 例、断链检查扩展到文档→代码反向抽查 30+ 路径）
- 改动文件清单（修补 6 处，均限 docs/codebase-map/）：index.md 3 行关键词追加（chat +骨架屏/历史加载/文件树；agent-core +failover；infra +确认弹窗）；chat.md 删 `app/debug/page.tsx` 重复条目；data-center.md 删 `notes-store.ts` 断链条目

### 给下一步的接力棒
- 关键签名 / 数据结构：验证结论——动线命中率 7/11（4 未命中词已补齐）、体积 -60.5%、重复/断链各修复 1 处、doc-sync 路由无歧义
- 下个 step 该从哪里继续：无下个 step，全部完成，回 plan.md 补「完成总结」
- 待办或已知限制：① step1 遗留的临时放 infra.md 待复核条目（通知中心、lib/sdk、types/ai、ui-store、wechat 归属）待用户复核；② agent-core.md 节内简写路径依赖节标题示层级，若未来检索反馈迷路可统一补目录前缀；③ index 关键词表天然不完备，靠 doc-sync 与使用反馈迭代
